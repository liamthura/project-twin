import { useState, useEffect, useCallback, useRef } from "react";
import {
  User,
  Brain,
  BookOpen,
  Settings,
  FolderKanban,
  Heart,
  RefreshCw,
  WifiOff,
  Loader2,
  Users,
  SlidersHorizontal,
  Inbox,
  Sun,
  Moon,
  Monitor,
  Package,
  Target,
  Film,
  Palette,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { Toaster } from "@/components/ui/toaster";
import ProposalsPanel from "@/components/ProposalsPanel";
import { useToast } from "@/components/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConnectionSettings } from "@/components/ConnectionSettings";
import { api, getAuthToken } from "@/lib/api.js";
import { hasSession } from "@/lib/session.js";
import { WelcomeAuth } from "@/components/WelcomeAuth";
import { AuthShell } from "@/components/AuthShell";
import { ResetPassword } from "@/components/ResetPassword";
import { AddEmailBanner } from "@/components/AddEmailBanner";
import Consent from "@/components/Consent";
import SectionRenderer from "@/renderers/SectionRenderer";

// Debounce hook
function useDebounce(callback, delay) {
  const timeoutRef = useRef(null);

  const debouncedCallback = useCallback(
    (...args) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    },
    [callback, delay]
  );

  return debouncedCallback;
}

const TAB_TRIGGER_CLASS =
  "h-11 shrink-0 snap-start gap-2 rounded-full border md:h-9 md:w-full md:justify-start md:rounded-lg md:border-0 data-[state=active]:border-transparent";

// Sections with a bespoke, hand-built editor. Everything else that's
// enabled gets a generic, manifest-driven tab instead.
const PACK_ICONS = {
  goals: Target,
  media: Film,
  aesthetics: Palette,
  circle: Users,
  learning_log: BookOpen,
  knowledge: Brain,
  projects: FolderKanban,
  lifestyle: Heart,
  preferences: Settings,
  profile: User,
};

// Tracks whether a horizontally scrollable element is at its start/end edge,
// so the tab strip only fades the side that actually has more content.
function useEdgeFade(deps) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setEdges({
        start: el.scrollLeft <= 1,
        end: el.scrollLeft >= max - 1,
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return [ref, edges];
}

// Main App
export default function App() {
  // Two real paths, not hash routes: Better Auth appends query parameters when
  // it redirects here, and anything after a `#` lands in the fragment rather
  // than in location.search. Everything else in the app stays on the hash
  // router -- see lib/routes.js for why. Checked before any hook runs: these
  // are separate page loads (a full navigation, not a client-side route
  // change), so a component that returns here never does so having already
  // called a hook on a previous render.
  const oauthScreen = window.location.pathname;
  if (oauthScreen === "/consent") return <Consent />;
  if (oauthScreen === "/sign-in") {
    // Captured now rather than read again in onSuccess below, so this does
    // not depend on WelcomeAuth's own address-bar handling: goToRoute
    // preserves window.location.search on every hash change, and the only
    // param it ever strips is `invite`, which never appears here -- but this
    // stays correct regardless of what WelcomeAuth does internally.
    const oauthQuery = window.location.search;
    // /sign-in is a real, bookmarkable path, so it gets opened with no OAuth
    // query behind it -- and /oauth2/authorize with an empty query is an
    // error page, not a sign-in. client_id is the parameter that makes this a
    // connection request; without it there is no flow to resume and the app
    // itself is where someone signing in wanted to end up.
    const isOAuthRequest = new URLSearchParams(oauthQuery).has("client_id");
    return (
      <AuthShell
        title={isOAuthRequest ? "Sign in to connect" : "Sign in"}
        description={
          isOAuthRequest
            ? "Sign in to let this application connect to your persona."
            : "Sign in to your MyGist account."
        }
      >
        <WelcomeAuth
          // Detached mode -- a UI pointed at someone else's server -- has no
          // meaning mid-OAuth-flow: this page IS the server the client is
          // connecting to. The link still renders (WelcomeAuth is not
          // forked for this), it just has nothing to do here.
          onUseToken={() => {}}
          onSuccess={() => {
            if (!isOAuthRequest) {
              window.location.assign("/");
              return;
            }
            // Better Auth's /oauth2/authorize re-evaluates now that a
            // session cookie exists, and continues the flow it interrupted
            // -- on to /consent, or straight through for a client that has
            // one already.
            window.location.assign(`/auth/oauth2/authorize${oauthQuery}`);
          }}
        />
      </AuthShell>
    );
  }

  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [lastSaved, setLastSaved] = useState(null);
  const [isAutosaveEnabled, setIsAutosaveEnabled] = useState(true);
  const [showConnectionSettings, setShowConnectionSettings] = useState(false);

  // Theme: "light" | "dark" | "system" (system follows the OS live)
  const [theme, setTheme] = useState(
    () => localStorage.getItem("mygist_theme") || "system"
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    localStorage.setItem("mygist_theme", theme);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  const cycleTheme = () =>
    setTheme((t) => (t === "light" ? "dark" : t === "dark" ? "system" : "light"));
  const { toast } = useToast();


  const [disabledSections, setDisabledSections] = useState([]);
  const [packs, setPacks] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  // The tab lives in the URL so a refresh keeps your place. Without it, any
  // reload drops you back on Profile, which is worst exactly when you have
  // just been sent somewhere by a "View in ..." link.
  const [activeTab, setActiveTab] = useState(
    () => window.location.hash.replace(/^#\/?/, "") || "profile",
  );
  // Tab count changes when sections are toggled, so re-measure the strip then.
  const [tabStripRef, tabStripEdges] = useEdgeFade([disabledSections, packs]);
  // Data for enabled sections WITHOUT a bespoke editor, keyed by section key.
  const [packData, setPackData] = useState({});

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: "",
    description: "",
    action: null,
  });

  const showConfirmation = (title, description, action) => {
    setConfirmDialog({
      isOpen: true,
      title,
      description,
      action,
    });
  };

  const handleConfirm = () => {
    if (confirmDialog.action) {
      confirmDialog.action();
    }
    setConfirmDialog({ ...confirmDialog, isOpen: false });
  };

  const handleCancel = () => {
    setConfirmDialog({ ...confirmDialog, isOpen: false });
  };

  // Whether any credential exists -- a stored token, or a Better Auth session.
  // Seeded from the token synchronously so the first render is right when one
  // is present, then corrected once the session check resolves.
  const [hasCredential, setHasCredential] = useState(() => !!getAuthToken());

  // Landed here from a password-reset email. Better Auth checks the token and
  // then redirects to the callback we gave it, appending `token`; `reset=1` is
  // ours, and is required because `token` alone is far too generic a parameter
  // name to treat as a claim about what this page is.
  const [resetToken, setResetToken] = useState(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("reset") === "1" ? params.get("token") : null;
  });

  // Landed here from a verification email. Better Auth has already confirmed
  // the address by this point -- without a word to the person who clicked,
  // unless we say one.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") !== "1") return;

    toast({ title: "Email verified", variant: "success" });
    window.history.replaceState({}, "", window.location.pathname);
  }, [toast]);

  useEffect(() => {
    if (getAuthToken()) return;
    let cancelled = false;
    hasSession().then((present) => {
      if (!cancelled) setHasCredential(present);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    loadAllData();
    loadSettings();
  }, []);

  // Controlling the tab strip means nothing re-picks a valid tab for us. Turn
  // off the section you are looking at and `activeTab` would name a tab that
  // no longer exists, which renders as an empty page with no way back.
  // Must sit above the loading/error early returns -- hooks cannot be
  // conditional.
  const enabledKeys = packs.filter((p) => p.enabled).map((p) => p.key).join(",");
  useEffect(() => {
    if (!enabledKeys) return;
    const valid = new Set([...enabledKeys.split(","), "review", "sections"]);
    if (!valid.has(activeTab)) setActiveTab("profile");
  }, [enabledKeys, activeTab]);

  // The welcome screen owns the URL while it is up -- it writes #/signin,
  // #/signup or #/forgot. Without this guard the tab sync ran anyway and
  // stamped #/profile over it, so someone looking at a sign-in form had an
  // address bar naming a page they could not reach.
  //
  // Above the early returns because hooks cannot be conditional; the condition
  // is therefore inside it.
  const showingAuth = error && !hasCredential;
  useEffect(() => {
    // Nothing is decided yet while the first load is in flight, and writing a
    // tab route here would put #/profile in the address bar for the moment
    // before the welcome screen replaces it with #/signin.
    if (isLoading || showingAuth) return;
    if (window.location.hash.replace(/^#\/?/, "") !== activeTab) {
      // replaceState, not a hash assignment: switching tabs should not stack
      // up history entries that the back button then has to walk through.
      window.history.replaceState(null, "", `#/${activeTab}`);
    }
  }, [activeTab, showingAuth, isLoading]);

  // The dot on the Review tab. Counted rather than listed: listing marks rows
  // seen, which is what protects them from eviction, and this polls from every
  // tab -- so sitting on Profile would quietly strip that protection off
  // observations you have never opened.
  const refreshPendingCount = useCallback(async () => {
    try {
      const data = await api("/proposals/count");
      setPendingCount(data?.total ?? 0);
    } catch (_) {
      // Non-fatal: a missing dot is better than a broken page.
    }
  }, []);

  useEffect(() => {
    if (!isConnected) return;
    refreshPendingCount();
    const tick = () => {
      // The panel refreshes itself while it is open, and a hidden tab has
      // nobody to tell.
      if (document.visibilityState === "visible" && activeTab !== "review") {
        refreshPendingCount();
      }
    };
    const timer = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [isConnected, activeTab, refreshPendingCount]);

  // Approving or promoting writes server-side, so the section it landed in is
  // stale in this page until we go and get it. We know which one changed, so
  // refetch exactly that -- no polling, and no window where the "View in ..."
  // link shows the old data.
  const refreshSection = useCallback(async (key) => {
    try {
      const response = await api(`/files/${key}`);
      setPackData((prev) => ({ ...prev, [key]: response.data ?? {} }));
    } catch (_) {
      // Non-fatal: the toast already said the change went through, and the
      // next load will pick it up.
    }
  }, []);

  const loadAllData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api("/all");
      // Every section is manifest-driven as of wave 6, so the whole response
      // is pack data -- there is no bespoke editor left to carve out.
      setPackData(response.data || {});
      setIsConnected(true);
    } catch (err) {
      setError(err.message);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const s = await api("/settings");
      setDisabledSections(s.disabled_sections || []);
      setPacks(s.packs || []);
    } catch (_) {
      // non-fatal: default to all sections enabled
    }
  };

  const saveFile = async (fileType, data) => {
    setIsSaving(true);
    try {
      await api(`/files/${fileType}`, {
        method: "PUT",
        body: JSON.stringify({ data }),
      });
      setLastSaved(new Date());
      toast({ title: "Saved", variant: "success" });
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const debouncedSave = useDebounce(saveFile, 1500);

  const handlePackChange = (key) => (newData) => {
    setPackData((prev) => ({ ...prev, [key]: newData }));
    if (isAutosaveEnabled) debouncedSave(key, newData);
  };

  const saveAll = async () => {
    setIsSaving(true);
    try {
      await api("/all", {
        method: "PUT",
        body: JSON.stringify(packData),
      });
      setLastSaved(new Date());
      toast({ title: "All files saved", variant: "success" });
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const togglePack = async (key, wantEnabled) => {
    const previous = packs;
    const prevDisabledSections = disabledSections;
    const next = packs.map((p) => (p.key === key ? { ...p, enabled: wantEnabled } : p));
    const disabled = next.filter((p) => !p.core && p.default_enabled && !p.enabled).map((p) => p.key);
    const optins = next.filter((p) => !p.default_enabled && p.enabled).map((p) => p.key);
    setPacks(next); // optimistic
    setDisabledSections(disabled); // optimistic (for tab visibility)
    try {
      await api("/settings", {
        method: "PUT",
        body: JSON.stringify({ disabled_sections: disabled, enabled_sections: optins }),
      });
      if (wantEnabled) {
        // Fetch fresh data but merge in ONLY the newly-enabled section —
        // a full setState of all sections would race the debounced autosave.
        const response = await api("/all");
        setPackData((prev) => ({ ...prev, [key]: response.data?.[key] ?? {} }));
      } else {
        setPackData((prev) => {
          const rest = { ...prev };
          delete rest[key];
          return rest;
        });
      }
    } catch (err) {
      setPacks(previous); // rollback
      setDisabledSections(prevDisabledSections); // rollback
      toast({
        title: "Failed to update section settings",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  // A reset link outranks everything else on screen, including the loading
  // state: whoever followed it cannot sign in, so waiting for data that needs a
  // credential would leave them watching a spinner instead of the one form that
  // helps them.
  if (resetToken) {
    return (
      <ResetPassword
        token={resetToken}
        onDone={() => {
          // Strip the token from the address bar before anything else. It is
          // single-use and already spent, but a live-looking credential left in
          // history and in the next referrer is worth removing.
          window.history.replaceState({}, "", window.location.pathname);
          setResetToken(null);
        }}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Connecting to backend...</p>
        </div>
      </div>
    );
  }

  // First run: no credential at all. Welcome instead of an error.
  //
  // `hasCredential` rather than getAuthToken() alone: a Better Auth session is
  // an HttpOnly cookie, so a signed-in account has no token here and would
  // otherwise be shown the sign-in screen the moment any request failed --
  // told to sign in while already signed in.
  if (showingAuth) {
    return (
      <AuthShell
        title="Welcome to MyGist"
        description="Your portable personal context for AI. Sign in or create an account to get started."
      >
        <>
          <WelcomeAuth
            onUseToken={() => setShowConnectionSettings(true)}
            onSuccess={() => {
              loadAllData();
              loadSettings();
            }}
          />
          {/* Renders through a portal, so its place in this tree is only
              about which state it reads. */}
          <ConnectionSettings
            isOpen={showConnectionSettings}
            onClose={() => setShowConnectionSettings(false)}
            onConnectionChange={() => {
              loadAllData();
              loadSettings();
            }}
          />
        </>
      </AuthShell>
    );
  }

  if (error) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-destructive">
              Connection Failed
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={loadAllData} className="w-full">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry Connection
            </Button>
            <Button
              onClick={() => setShowConnectionSettings(true)}
              variant="outline"
              className="w-full"
            >
              <Settings className="h-4 w-4 mr-2" />
              Configure Server
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Connect to a remote server or run locally
            </p>
          </CardContent>
        </Card>
        <ConnectionSettings
          isOpen={showConnectionSettings}
          onClose={() => setShowConnectionSettings(false)}
          onConnectionChange={() => {
            loadAllData();
            loadSettings();
          }}
        />
      </div>
    );
  }

  const dynamicPacks = packs.filter((p) => p.enabled);
  // The Review tab's toasts link to whatever section just changed, so the tab
  // strip has to be steerable from outside itself.
  const sectionTitles = Object.fromEntries(packs.map((p) => [p.key, p.title]));

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-20 border-b bg-card pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-[60px] max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <svg
              width="22"
              height="22"
              viewBox="0 0 96 96"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <circle
                cx="45"
                cy="40"
                r="15"
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="9"
              />
              <path
                d="M60 40 v22 a14 14 0 0 1 -14 14 h-9"
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="9"
                strokeLinecap="round"
              />
            </svg>
            <h1 className="text-lg font-semibold">MyGist</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Auto-save toggle */}
            <label className="flex cursor-pointer items-center gap-2">
              <Switch
                checked={isAutosaveEnabled}
                onCheckedChange={(next) => {
                  setIsAutosaveEnabled(next);
                  if (next) saveAll();
                }}
                aria-label="Auto-save"
              />
              <span className="hidden sm:inline text-xs font-medium text-muted-foreground">Auto-save</span>
            </label>
            {/* Save status */}
            <span className="hidden sm:inline text-xs text-muted-foreground">
              {isSaving
                ? "Saving..."
                : isAutosaveEnabled
                  ? lastSaved
                    ? "Saved just now"
                    : "Saved"
                  : "Unsaved changes"}
            </span>
            {!isAutosaveEnabled && (
              <Button size="sm" onClick={saveAll} disabled={isSaving}>
                Save changes
              </Button>
            )}
            {!isConnected && (
              <Badge variant="destructive" className="gap-1.5">
                <WifiOff className="h-3 w-3" />
                Disconnected
              </Badge>
            )}
            {/* Theme toggle: light -> dark -> system */}
            <button
              type="button"
              onClick={cycleTheme}
              aria-label={`Theme: ${theme}. Click to change.`}
              title={`Theme: ${theme}`}
              className="flex h-8 w-8 items-center justify-center rounded-lg border bg-card text-muted-foreground hover:text-foreground"
            >
              {theme === "light" ? (
                <Sun className="h-4 w-4" />
              ) : theme === "dark" ? (
                <Moon className="h-4 w-4" />
              ) : (
                <Monitor className="h-4 w-4" />
              )}
            </button>
            {/* Account chip */}
            <button
              type="button"
              onClick={() => setShowConnectionSettings(true)}
              className="flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-[13px] font-medium hover:bg-muted/50"
            >
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="max-w-[128px] truncate">
                {packData.profile?.preferred_name || packData.profile?.name || "Account"}
              </span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Above the tabs rather than in a corner: an account that cannot be
            recovered is worth one line of the page until it can be. */}
        <div className="mb-4 empty:mb-0">
          <AddEmailBanner onAddEmail={() => setShowConnectionSettings(true)} />
        </div>
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          orientation="vertical"
          className="flex flex-col gap-6 md:flex-row"
        >
          <div className="sticky top-[60px] z-10 -mx-4 border-b bg-background px-4 py-2.5 md:mx-0 md:border-0 md:px-0 md:py-0 md:sticky md:top-[84px] md:w-48 md:self-start">
          <TabsList
            ref={tabStripRef}
            data-at-start={tabStripEdges.start}
            data-at-end={tabStripEdges.end}
            className="scrollbar-none w-full flex-nowrap overflow-x-auto snap-x snap-proximity tab-strip-fade md:flex-wrap md:overflow-visible md:h-fit md:flex-col md:items-stretch md:justify-start"
          >
            {dynamicPacks.map((p) => {
              const Icon = PACK_ICONS[p.key] || Package;
              return (
                <TabsTrigger key={p.key} value={p.key} className={TAB_TRIGGER_CLASS}>
                  <Icon className="h-4 w-4" />
                  <span>{p.title}</span>
                </TabsTrigger>
              );
            })}
            <TabsTrigger value="review" className={TAB_TRIGGER_CLASS}>
              <Inbox className="h-4 w-4" />
              <span>Review</span>
              {pendingCount > 0 && (
                <>
                  <span
                    data-pending-dot
                    aria-hidden="true"
                    className="ml-auto h-2 w-2 shrink-0 rounded-full bg-primary"
                  />
                  {/* The dot is decoration; this is the part a screen reader
                      can actually convey. */}
                  <span className="sr-only">{pendingCount} waiting</span>
                </>
              )}
            </TabsTrigger>
            <TabsTrigger value="sections" className={TAB_TRIGGER_CLASS}>
              <SlidersHorizontal className="h-4 w-4" />
              <span>Sections</span>
            </TabsTrigger>
          </TabsList>
          <p className="mt-4 hidden px-3 font-mono text-[11px] text-muted-foreground md:block">
            {`v${__APP_VERSION__} (${__APP_COMMIT__})`}
          </p>
          </div>

          <div className="min-w-0 flex-1">

          {dynamicPacks.map((p) => (
            <TabsContent key={p.key} value={p.key}>
              <SectionRenderer
                pack={p}
                data={packData[p.key]}
                onChange={handlePackChange(p.key)}
                onShowConfirmation={showConfirmation}
              />
            </TabsContent>
          ))}
          <TabsContent value="review">
            <ProposalsPanel
              onViewSection={setActiveTab}
              onSectionChanged={refreshSection}
              onResolved={refreshPendingCount}
              sectionTitles={sectionTitles}
              packs={packs}
            />
          </TabsContent>
          <TabsContent value="sections">
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Manage Sections</CardTitle>
                <CardDescription>
                  Turn optional sections on or off. Disabled sections are
                  hidden from the tab bar, but their data is preserved and
                  restored when re-enabled.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {packs.filter((p) => !p.core).length === 0 && (
                  <EmptyState>No toggleable sections available.</EmptyState>
                )}
                {packs.filter((p) => !p.core).map((p) => {
                  return (
                    <div
                      key={p.key}
                      className="flex items-center justify-between gap-6 border-b border-border py-4 first:pt-1 last:border-b-0 last:pb-1"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium leading-none">
                          {p.title}
                        </p>
                        {p.description && (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {p.description}
                          </p>
                        )}
                      </div>
                      <Switch
                        checked={p.enabled}
                        onCheckedChange={(next) => togglePack(p.key, next)}
                        aria-label={`Toggle ${p.title}`}
                      />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <p className="mt-4 px-1 font-mono text-[11px] text-muted-foreground md:hidden">
              {`v${__APP_VERSION__} (${__APP_COMMIT__})`}
            </p>
          </TabsContent>
        </div>
        </Tabs>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialog.isOpen} onOpenChange={handleCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmDialog.title}</DialogTitle>
            <DialogDescription>{confirmDialog.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirm}>
              {confirmDialog.title?.startsWith("Remove") ? "Remove" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Connection Settings Dialog */}
      <ConnectionSettings
        isOpen={showConnectionSettings}
        onClose={() => setShowConnectionSettings(false)}
        onConnectionChange={() => {
          loadAllData();
          loadSettings();
        }}
      />

      <Toaster />
    </div>
  );
}
