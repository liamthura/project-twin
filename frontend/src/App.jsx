import { useState, useEffect, useCallback, useRef } from "react";
import { Settings, RefreshCw, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { api, getAuthToken } from "@/lib/api.js";
import { hasSession } from "@/lib/session.js";
import { WelcomeAuth } from "@/components/WelcomeAuth";
import { AuthShell } from "@/components/AuthShell";
import { ResetPassword } from "@/components/ResetPassword";
import { AddEmailBanner } from "@/components/AddEmailBanner";
import Consent from "@/components/Consent";
import Landing from "@/landing/Landing";
import {
  DEFAULT_ONBOARDING_STEP,
  goToRoute,
  isAuthRoute,
  isOnboardingRoute,
  normaliseStep,
  parseRoute,
  readRoute,
} from "@/lib/routes.js";
import OnboardingFlow from "@/components/onboarding/OnboardingFlow";
import { GettingStartedCard } from "@/components/GettingStartedCard";
import SectionRenderer from "@/renderers/SectionRenderer";
import { outline } from "@/renderers/paths";
import { Header } from "@/shell/Header";
import { Rail } from "@/shell/Rail";
import { SectionSheet } from "@/shell/SectionSheet";
import { useScrollSpy } from "@/shell/useScrollSpy";

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
  // Only meaningful with autosave OFF, which is the one state where a change
  // sits in the page with nothing coming to collect it. It is what the header
  // chip reads, and it is cleared only by a save that actually succeeded -- so a
  // failed write leaves the chip honest and Save now still on offer.
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
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
  // Where you are lives in the URL, in two segments -- `#/preferences/code-style`
  // -- so a refresh keeps your place down to the subsection. Without it a reload
  // drops you on Profile, which is worst exactly when a "View in ..." link just
  // sent you somewhere.
  const [{ section: activeSection, band: activeBand }, setPlace] = useState(() =>
    parseRoute(readRoute() || "profile")
  );

  // A band we owe a scroll to, and have not delivered yet.
  //
  // Seeded from the URL so a cold deep link scrolls too: the rail can render
  // from the manifest immediately, but the anchor does not exist until
  // SectionRenderer has mounted, so the scroll has to wait for it rather than
  // firing once and missing.
  const pendingBandRef = useRef(parseRoute(readRoute()).band);
  // Until when scroll-spy's URL writes are ignored. A smooth scroll crosses the
  // bands in between, and each one gets reported -- so without this the address
  // bar and the marker chase the scroll backwards past every band on the way,
  // and the click's own destination is overwritten before it arrives.
  const spyQuietUntilRef = useRef(0);
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

  const dynamicPacks = packs.filter((p) => p.enabled);
  const activePack = dynamicPacks.find((p) => p.key === activeSection);
  // The bands of whichever section is open. Manifest-derived, so this is
  // complete before any content mounts -- which is what lets a cold deep link
  // render a correctly marked rail immediately.
  const activeBands = activePack ? outline(activePack) : [];

  /**
   * Go somewhere. A deliberate move, so it PUSHES: back walks the places you
   * chose. Scroll-spy replaces instead -- see the effect below.
   */
  const navigate = useCallback((section, band) => {
    setPlace({ section, band: band ?? null });
    goToRoute(band ? `${section}/${band}` : section);
    // A section click means "start at the top", which is where a section change
    // already puts you -- only a band click owes a scroll.
    pendingBandRef.current = band ?? null;
  }, []);

  // Nothing re-picks a valid destination for us, so this does. Turn off the
  // section you are looking at and `activeSection` would name a page that no
  // longer exists, which renders as empty with no way back. An unknown BAND is
  // corrected the same way, one level up: to the bare section.
  //
  // Both corrections replace rather than push -- they are not moves anyone made.
  // Must sit above the loading/error early returns; hooks cannot be conditional.
  const enabledKeys = dynamicPacks.map((p) => p.key).join(",");
  const bandKeys = activeBands.map((b) => b.id).join(",");
  useEffect(() => {
    if (!enabledKeys) return;
    // Onboarding is a route family of its own, not a section, so it is not in
    // `valid` and would be rewritten to profile the moment settings resolved.
    // Its own step correction lives in the branch that renders it.
    if (isOnboardingRoute(activeSection)) return;
    const valid = new Set([...enabledKeys.split(","), "review", "sections"]);
    if (!valid.has(activeSection)) {
      setPlace({ section: "profile", band: null });
      goToRoute("profile", { replace: true });
      return;
    }
    if (activeBand && !bandKeys.split(",").includes(activeBand)) {
      setPlace({ section: activeSection, band: null });
      goToRoute(activeSection, { replace: true });
    }
  }, [enabledKeys, activeSection, activeBand, bandKeys]);

  // The welcome screen owns the URL while it is up -- it writes #/signin,
  // #/signup or #/forgot. Without this guard the tab sync ran anyway and
  // stamped #/profile over it, so someone looking at a sign-in form had an
  // address bar naming a page they could not reach.
  //
  // Above the early returns because hooks cannot be conditional; the condition
  // is therefore inside it.
  const showingAuth = error && !hasCredential;

  // Which of the two no-credential screens is up: the marketing page, or the
  // sign-in form. WelcomeAuth listens for hash changes once it is mounted, but
  // the landing page has to be able to hand over to it, so App needs to see
  // the route too. Note goToRoute uses pushState, which fires neither
  // hashchange nor popstate -- hence setRoute at the call site rather than
  // relying on the listener alone.
  const [route, setRoute] = useState(() => readRoute());
  useEffect(() => {
    const sync = () => setRoute(readRoute());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  // Which band the reader is actually looking at. The rail shows it, and the
  // address bar follows it.
  const spiedBand = useScrollSpy(activeBands.map((b) => b.id));

  // Deliver the scroll a click (or a deep link) asked for.
  //
  // Runs on every render that could have produced the anchor, rather than once:
  // clicking a band in a different section changes what is mounted, and the
  // element does not exist on the render that handled the click. If it is still
  // missing the request stays pending and the next render tries again.
  useEffect(() => {
    const band = pendingBandRef.current;
    if (!band) return;
    const target = document.querySelector(`[data-band="${band}"]`);
    if (!target) return;
    pendingBandRef.current = null;
    // `scroll-mt-[60px]` on the anchor is what keeps the heading clear of the
    // sticky header; `block: "start"` is what makes that margin apply.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    // Long enough to cover --duration-scroll, after which whatever is under the
    // header genuinely is where the reader ended up.
    spyQuietUntilRef.current = Date.now() + 500;
  }, [activeSection, activeBand, packData, isLoading]);

  useEffect(() => {
    // Nothing is decided yet while the first load is in flight, and writing a
    // route here would put #/profile in the address bar for the moment before
    // the welcome screen replaces it with #/signin.
    if (isLoading || showingAuth) return;
    if (!spiedBand || spiedBand === activeBand) return;
    // A scroll we started is still in flight: the bands it is crossing are not
    // places the reader chose to be.
    if (pendingBandRef.current || Date.now() < spyQuietUntilRef.current) return;
    // replaceState: a position you scrolled to is not a place you navigated to,
    // so it must stay invisible to the back button. Rail clicks push; this does
    // not. Guarded on a CHANGE of band, not on every observer callback.
    setPlace({ section: activeSection, band: spiedBand });
    goToRoute(`${activeSection}/${spiedBand}`, { replace: true });
  }, [spiedBand, activeBand, activeSection, showingAuth, isLoading]);

  // The address bar can also change under us -- the back button, or a hand-typed
  // hash. goToRoute pushes without firing either event, hence the sync at the
  // call site too.
  useEffect(() => {
    const sync = () => {
      if (isAuthRoute(readRoute())) return;
      setPlace(parseRoute(readRoute() || "profile"));
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

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
      if (document.visibilityState === "visible" && activeSection !== "review") {
        refreshPendingCount();
      }
    };
    const timer = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [isConnected, activeSection, refreshPendingCount]);

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
      setHasUnsavedChanges(false);
      // No success toast. This fires on every debounced flush, so editing three
      // fields in a row stacked three toasts for something the reader never
      // doubted -- and toasts are for things that happened away from their
      // attention. The card that changed shows a tick instead (`savedAt` below),
      // and the header chip carries the state for the whole page. A FAILURE
      // still toasts: that genuinely needs interrupting.
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
    // With autosave on, the flush is already on its way and the chip would
    // flicker "Unsaved" for 1.5s per keystroke with a Save now button coming and
    // going inside it.
    else setHasUnsavedChanges(true);
  };

  const saveAll = async () => {
    setIsSaving(true);
    try {
      await api("/all", {
        method: "PUT",
        body: JSON.stringify(packData),
      });
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      // This one keeps its toast: it answers a button the user just pressed,
      // which is the opposite case from a background flush.
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

  // Turning auto-save ON flushes immediately: the changes made while it was off
  // are exactly the ones nobody has saved. Turning it off must NOT save, or the
  // switch becomes an unlabelled save button.
  const handleAutosaveChange = (next) => {
    setIsAutosaveEnabled(next);
    if (next) saveAll();
  };

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
  // No credential and no auth route asked for: this is a visitor, not a user
  // locked out. Show them the page that explains what MyGist is. Sign in and
  // the landing page hands over to WelcomeAuth below.
  if (showingAuth && !isAuthRoute(route)) {
    return (
      <Landing
        onSignIn={() => {
          goToRoute("signin");
          setRoute("signin");
        }}
      />
    );
  }

  if (showingAuth) {
    return (
      <AuthShell
        title="Welcome to MyGist"
        description="Your portable personal context for AI. Sign in or create an account to get started."
      >
        <>
          <WelcomeAuth
            onUseToken={() => setShowConnectionSettings(true)}
            onSuccess={({ isNew } = {}) => {
              // A brand-new account lands on Welcome, not on an empty Profile:
              // that is the moment intent is highest, and Welcome is where the
              // offer to hand the work to a client is made.
              if (isNew) navigate("onboarding", DEFAULT_ONBOARDING_STEP);
              loadAllData();
              loadSettings();
            }}
          />
          {/* Renders through a portal, so its place in this tree is only
              about which state it reads. */}
          <SettingsDialog
            isOpen={showConnectionSettings}
            disabledSections={disabledSections}
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
        <SettingsDialog
          isOpen={showConnectionSettings}
          disabledSections={disabledSections}
          onClose={() => setShowConnectionSettings(false)}
          onConnectionChange={() => {
            loadAllData();
            loadSettings();
          }}
          isAutosaveEnabled={isAutosaveEnabled}
          onAutosaveChange={handleAutosaveChange}
        />
      </div>
    );
  }

  // The third render branch. A credential exists and the route names the
  // onboarding family, so the flow replaces the shell entirely -- no header,
  // no rail. `routes.js` promises the families never appear at once, and this
  // is where that promise is kept rather than quietly broken.
  if (isOnboardingRoute(activeSection)) {
    const step = normaliseStep(activeBand);
    // A step nobody navigated to must not become a history entry, which is why
    // this replaces. Same correction the shell already makes for an unknown
    // band, one level up.
    if (step !== activeBand) goToRoute(`onboarding/${step}`, { replace: true });
    return (
      <OnboardingFlow
        step={step}
        onNavigate={(next) => navigate("onboarding", next)}
        onLeave={() => navigate("profile", null)}
      />
    );
  }

  // Review's toasts link to whatever section just changed, so navigation has
  // to be steerable from outside the rail.
  const sectionTitles = Object.fromEntries(packs.map((p) => [p.key, p.title]));

  // The header's one chip, from the two booleans that used to feed three prose
  // states plus a separate button.
  //
  // It used to read `isAutosaveEnabled ? "saved" : "unsaved"`, which meant that
  // with autosave off the chip said "Unsaved" forever -- including immediately
  // after a successful Save now, and before the reader had changed anything at
  // all. What is actually unsaved is tracked instead, so the chip reports a fact
  // rather than a preference.
  const saveState = isSaving ? "saving" : hasUnsavedChanges ? "unsaved" : "saved";

  const shellProps = {
    packs: dynamicPacks,
    activeSection,
    activeBand,
    pendingCount,
    version: `v${__APP_VERSION__} (${__APP_COMMIT__})`,
    onNavigate: navigate,
  };

  return (
    <div className="min-h-dvh bg-background">
      <Header
        saveState={saveState}
        isConnected={isConnected}
        theme={theme}
        onCycleTheme={cycleTheme}
        accountName={packData.profile?.preferred_name || packData.profile?.name}
        onOpenSettings={() => setShowConnectionSettings(true)}
        onSaveNow={saveAll}
      />

      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Above the navigation rather than in a corner: an account that cannot
            be recovered is worth one line of the page until it can be. */}
        <div className="mb-4 empty:mb-0">
          <AddEmailBanner onAddEmail={() => setShowConnectionSettings(true)} />
        </div>

        <SectionSheet {...shellProps} />

        <div className="flex flex-col gap-6 md:flex-row">
          <Rail {...shellProps} />

          {/* A plain conditional, not TabsContent. Radix Tabs mounted every
              section's content and hid all but one, so ten SectionRenderers
              were live at once; only the section being read is now built. */}
          <div className="min-w-0 flex-1">
            {/* Profile only. It is the screen someone lands on, and a card that
                followed them to every section would be an interruption rather
                than a starting point. */}
            {activeSection === "profile" && (
              <GettingStartedCard
                disabledSections={disabledSections}
                onStart={() => navigate("onboarding", DEFAULT_ONBOARDING_STEP)}
                onOpenSettings={() => setShowConnectionSettings(true)}
              />
            )}

            {activePack && (
              <SectionRenderer
                key={activePack.key}
                pack={activePack}
                data={packData[activePack.key]}
                onChange={handlePackChange(activePack.key)}
                onShowConfirmation={showConfirmation}
                // Every successful write moves this, so the card the reader was
                // editing ticks once -- autosave flush or an explicit Save now.
                savedAt={lastSaved}
              />
            )}

            {activeSection === "review" && (
              <ProposalsPanel
                onViewSection={(section) => navigate(section, null)}
                onSectionChanged={refreshSection}
                // The panel already fetches the count for its own tab badges,
                // so it hands the total over rather than making us fetch the
                // same number again. The polling exception below still stands:
                // it is what stops the two of us polling at once.
                onCounts={setPendingCount}
                onOpenSettings={() => setShowConnectionSettings(true)}
                sectionTitles={sectionTitles}
                packs={packs}
              />
            )}

            {activeSection === "sections" && (
              <Card>
                <CardHeader className="border-b">
                  <CardTitle>Manage Sections</CardTitle>
                  <CardDescription>
                    Turn optional sections on or off. Disabled sections are
                    hidden from the rail, but their data is preserved and
                    restored when re-enabled.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {packs.filter((p) => !p.core).length === 0 && (
                    <EmptyState>No toggleable sections available.</EmptyState>
                  )}
                  {packs.filter((p) => !p.core).map((p) => (
                    <div
                      key={p.key}
                      className="flex items-center justify-between gap-6 border-b border-border py-4 first:pt-1 last:border-b-0 last:pb-1"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium leading-none">{p.title}</p>
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
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
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
      <SettingsDialog
        isOpen={showConnectionSettings}
        disabledSections={disabledSections}
        onClose={() => setShowConnectionSettings(false)}
        onConnectionChange={() => {
          loadAllData();
          loadSettings();
        }}
        isAutosaveEnabled={isAutosaveEnabled}
        onAutosaveChange={handleAutosaveChange}
      />

      <Toaster />
    </div>
  );
}
