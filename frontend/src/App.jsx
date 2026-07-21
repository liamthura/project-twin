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
  Sun,
  Moon,
  Monitor,
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
import { SECTION_LABELS, SECTION_DESCRIPTIONS } from "@/lib/sections.js";
import { WelcomeAuth } from "@/components/WelcomeAuth";
import ProfileEditor from "@/editors/ProfileEditor";
import KnowledgeEditor from "@/editors/KnowledgeEditor";
import PreferencesEditor from "@/editors/PreferencesEditor";
import ProjectsEditor from "@/editors/ProjectsEditor";
import LifestyleEditor from "@/editors/LifestyleEditor";
import CircleEditor from "@/editors/CircleEditor";
import LearningLogEditor from "@/editors/LearningLogEditor";

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

  const [profile, setProfile] = useState({});
  const [knowledge, setKnowledge] = useState({});
  const [preferences, setPreferences] = useState({});
  const [projects, setProjects] = useState({});
  const [lifestyle, setLifestyle] = useState({});
  const [circle, setCircle] = useState({});
  const [learningLog, setLearningLog] = useState({});

  const [disabledSections, setDisabledSections] = useState([]);
  // Tab count changes when sections are toggled, so re-measure the strip then.
  const [tabStripRef, tabStripEdges] = useEdgeFade([disabledSections]);
  const [toggleable, setToggleable] = useState([]);

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

  useEffect(() => {
    loadAllData();
    loadSettings();
  }, []);

  const loadAllData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api("/all");
      setProfile(response.data.profile || {});
      setKnowledge(response.data.knowledge || {});
      setPreferences(response.data.preferences || {});
      setProjects(response.data.projects || {});
      setLifestyle(response.data.lifestyle || {});
      setCircle(response.data.circle || {});
      setLearningLog(response.data.learning_log || {});
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
      setToggleable(s.toggleable || []);
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

  const handleProfileChange = (newData) => {
    setProfile(newData);
    if (isAutosaveEnabled) debouncedSave("profile", newData);
  };
  const handleKnowledgeChange = (newData) => {
    setKnowledge(newData);
    if (isAutosaveEnabled) debouncedSave("knowledge", newData);
  };
  const handlePreferencesChange = (newData) => {
    setPreferences(newData);
    if (isAutosaveEnabled) debouncedSave("preferences", newData);
  };
  const handleProjectsChange = (newData) => {
    setProjects(newData);
    if (isAutosaveEnabled) debouncedSave("projects", newData);
  };
  const handleLifestyleChange = (newData) => {
    setLifestyle(newData);
    if (isAutosaveEnabled) debouncedSave("lifestyle", newData);
  };
  const handleCircleChange = (newData) => {
    setCircle(newData);
    if (isAutosaveEnabled) debouncedSave("circle", newData);
  };
  const handleLearningLogChange = (newData) => {
    setLearningLog(newData);
    if (isAutosaveEnabled) debouncedSave("learning_log", newData);
  };

  const saveAll = async () => {
    setIsSaving(true);
    try {
      await api("/all", {
        method: "PUT",
        body: JSON.stringify({
          profile,
          knowledge,
          preferences,
          projects,
          lifestyle,
          circle,
          learning_log: learningLog,
        }),
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

  const toggleSection = async (key) => {
    const previous = disabledSections;
    const next = disabledSections.includes(key)
      ? disabledSections.filter((k) => k !== key)
      : [...disabledSections, key];
    setDisabledSections(next); // optimistic
    try {
      await api("/settings", {
        method: "PUT",
        body: JSON.stringify({ disabled_sections: next }),
      });
    } catch (err) {
      setDisabledSections(previous); // rollback
      toast({
        title: "Failed to update section settings",
        description: err.message,
        variant: "destructive",
      });
    }
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

  // First run: no token configured yet. Welcome instead of an error.
  if (error && !getAuthToken()) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
              <svg
                width="40"
                height="40"
                viewBox="0 0 96 96"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <circle
                  cx="45"
                  cy="40"
                  r="15"
                  fill="none"
                  stroke="hsl(var(--primary-foreground))"
                  strokeWidth="9"
                />
                <path
                  d="M60 40 v22 a14 14 0 0 1 -14 14 h-9"
                  fill="none"
                  stroke="hsl(var(--primary-foreground))"
                  strokeWidth="9"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Welcome to MyGist</h1>
            <p className="text-sm text-muted-foreground">
              Your portable personal context for AI. Sign in or create an
              account to get started.
            </p>
          </div>
          <WelcomeAuth
            onUseToken={() => setShowConnectionSettings(true)}
            onSuccess={() => {
              loadAllData();
              loadSettings();
            }}
          />
        </div>
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
                {profile?.preferred_name || profile?.name || "Account"}
              </span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8">
        <Tabs
          defaultValue="profile"
          orientation="vertical"
          className="flex flex-col gap-6 md:flex-row"
        >
          <div className="sticky top-[60px] z-10 -mx-4 bg-background px-4 pb-2 md:mx-0 md:px-0 md:pb-0 md:sticky md:top-[84px] md:w-48 md:self-start">
          <TabsList
            ref={tabStripRef}
            data-at-start={tabStripEdges.start}
            data-at-end={tabStripEdges.end}
            className="scrollbar-none w-full flex-nowrap overflow-x-auto snap-x snap-proximity tab-strip-fade md:flex-wrap md:overflow-visible md:h-fit md:flex-col md:items-stretch md:justify-start"
          >
            <TabsTrigger value="profile" className={TAB_TRIGGER_CLASS}>
              <User className="h-4 w-4" />
              <span>Profile</span>
            </TabsTrigger>
            {!disabledSections.includes("knowledge") && (
              <TabsTrigger value="knowledge" className={TAB_TRIGGER_CLASS}>
                <Brain className="h-4 w-4" />
                <span>Knowledge</span>
              </TabsTrigger>
            )}
            {!disabledSections.includes("projects") && (
              <TabsTrigger value="projects" className={TAB_TRIGGER_CLASS}>
                <FolderKanban className="h-4 w-4" />
                <span>Projects</span>
              </TabsTrigger>
            )}
            {!disabledSections.includes("lifestyle") && (
              <TabsTrigger value="lifestyle" className={TAB_TRIGGER_CLASS}>
                <Heart className="h-4 w-4" />
                <span>Lifestyle</span>
              </TabsTrigger>
            )}
            {!disabledSections.includes("circle") && (
              <TabsTrigger value="circle" className={TAB_TRIGGER_CLASS}>
                <Users className="h-4 w-4" />
                <span>Circle</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="learning" className={TAB_TRIGGER_CLASS}>
              <BookOpen className="h-4 w-4" />
              <span>Learning Log</span>
            </TabsTrigger>
            <TabsTrigger value="preferences" className={TAB_TRIGGER_CLASS}>
              <Settings className="h-4 w-4" />
              <span>Preferences</span>
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

          <TabsContent value="profile">
            <ProfileEditor
              data={profile}
              onChange={handleProfileChange}
              onShowConfirmation={showConfirmation}
            />
          </TabsContent>
          {!disabledSections.includes("knowledge") && (
            <TabsContent value="knowledge">
              <KnowledgeEditor
                data={knowledge}
                onChange={handleKnowledgeChange}
                onShowConfirmation={showConfirmation}
              />
            </TabsContent>
          )}
          {!disabledSections.includes("projects") && (
            <TabsContent value="projects">
              <ProjectsEditor
                data={projects}
                onChange={handleProjectsChange}
                onShowConfirmation={showConfirmation}
              />
            </TabsContent>
          )}
          {!disabledSections.includes("lifestyle") && (
            <TabsContent value="lifestyle">
              <LifestyleEditor
                data={lifestyle}
                onChange={handleLifestyleChange}
                onShowConfirmation={showConfirmation}
              />
            </TabsContent>
          )}
          {!disabledSections.includes("circle") && (
            <TabsContent value="circle">
              <CircleEditor
                data={circle}
                onChange={handleCircleChange}
                onShowConfirmation={showConfirmation}
              />
            </TabsContent>
          )}
          <TabsContent value="learning">
            <LearningLogEditor
              data={learningLog}
              onChange={handleLearningLogChange}
              onShowConfirmation={showConfirmation}
            />
          </TabsContent>
          <TabsContent value="preferences">
            <PreferencesEditor
              data={preferences}
              onChange={handlePreferencesChange}
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
                {toggleable.length === 0 && (
                  <EmptyState>No toggleable sections available.</EmptyState>
                )}
                {toggleable.map((key) => {
                  const enabled = !disabledSections.includes(key);
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-6 border-b border-border py-4 first:pt-1 last:border-b-0 last:pb-1"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium leading-none">
                          {SECTION_LABELS[key] || key}
                        </p>
                        {SECTION_DESCRIPTIONS[key] && (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {SECTION_DESCRIPTIONS[key]}
                          </p>
                        )}
                      </div>
                      <Switch
                        checked={enabled}
                        onCheckedChange={() => toggleSection(key)}
                        aria-label={`Toggle ${SECTION_LABELS[key] || key}`}
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
