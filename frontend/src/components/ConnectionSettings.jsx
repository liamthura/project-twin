import { useState, useEffect } from "react";
import {
  Wifi,
  Loader2,
  Check,
  X,
  Server,
  Key,
  Laptop,
  Globe,
  User,
  LogOut,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { segmentClass } from "@/components/ui/segmented-control";
import {
  CLOUD_API_URL,
  getConfig,
  saveConfig,
  clearConfig,
  testConnection,
  whoami,
  getApiBase,
  setPassword,
} from "@/lib/api.js";
import { signOut } from "@/lib/session.js";
import { getOnboarding, saveOnboarding } from "@/lib/onboarding.js";
import { EmailSettings } from "@/components/EmailSettings";
import { AppsPanel } from "@/components/settings/AppsPanel";
import { DataPanel } from "@/components/settings/DataPanel";
import { TokenPanel } from "@/components/settings/TokenPanel";

const TABS = [
  { id: "connection", label: "Connection" },
  { id: "tokens", label: "API tokens" },
  { id: "apps", label: "Connected apps" },
  { id: "data", label: "Data" },
];

export function ConnectionSettings({
  isOpen,
  onClose,
  onConnectionChange,
  // Owned by App -- the same state the header's switch used to drive. Passed in
  // rather than held here so a dialog that is closed most of the time is not the
  // source of truth for how the app saves.
  isAutosaveEnabled = true,
  onAutosaveChange = () => {},
  // Also App's. Needed only to write onboarding state back without clearing it:
  // SettingsUpdate requires disabled_sections and writes what it is sent.
  disabledSections = [],
}) {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("connection");
  // Whether the Getting-started card has been dismissed. Only read to decide
  // whether to OFFER the restore -- there is nothing to say to someone whose
  // card is already on screen.
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    getOnboarding()
      .then((s) => {
        if (!cancelled) setOnboardingDismissed(!!s.dismissed);
      })
      .catch(() => {
        // Nothing to offer if we cannot tell. The card is either showing
        // already or genuinely unavailable, and a control that might do nothing
        // is worse than no control.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [signedInUsername, setSignedInUsername] = useState(null);

  // Connection tab
  const [connectionType, setConnectionType] = useState("cloud"); // "cloud" | "self-hosted"
  const [serverUrl, setServerUrl] = useState(CLOUD_API_URL);
  const [selfHostedUrl, setSelfHostedUrl] = useState("");
  const [token, setToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showToken, setShowToken] = useState(false);

  // Change password disclosure
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPasswordValue, setNewPasswordValue] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;

    const config = getConfig();
    const savedUrl = config?.serverUrl || "";
    if (!config || savedUrl === CLOUD_API_URL) {
      setConnectionType("cloud");
      setServerUrl(CLOUD_API_URL);
      setSelfHostedUrl("");
    } else {
      setConnectionType("self-hosted");
      setServerUrl(savedUrl);
      setSelfHostedUrl(savedUrl);
    }
    setToken(config?.token || "");
    setTestResult(null);
    setShowToken(false);
    setActiveTab("connection");

    setShowPasswordForm(false);
    setCurrentPassword("");
    setNewPasswordValue("");
    setConfirmNewPassword("");
    setPasswordError(null);

    // Ask the server rather than inferring from localStorage. There used to be
    // a token there for every signed-in account, so `!!config?.token` was a
    // fair proxy; with Better Auth the credential is an HttpOnly cookie that
    // JavaScript cannot see, so that test reported "signed out" for everyone
    // who signed in through it -- hiding the account details, disabling the
    // tokens and data tabs, and hiding the sign-out button, which left no way
    // to sign out at all.
    //
    // whoami() resolves whichever credential applies, so this is right for a
    // session, a stored token, or neither. It also catches a token that has
    // stopped working, which the old check would still have called signed in.
    setIsSignedIn(false);
    setSignedInUsername(null);
    whoami()
      .then((me) => {
        setIsSignedIn(true);
        setSignedInUsername(me.username || "your account");
      })
      .catch(() => {
        setIsSignedIn(false);
        setSignedInUsername(null);
      });
  }, [isOpen]);

  const selectCloud = () => {
    setConnectionType("cloud");
    setServerUrl(CLOUD_API_URL);
  };

  const selectSelfHosted = () => {
    setConnectionType("self-hosted");
    setServerUrl(selfHostedUrl);
  };

  const handleSelfHostedUrlChange = (value) => {
    setServerUrl(value);
    setSelfHostedUrl(value);
  };

  const handleTest = async () => {
    if (!serverUrl) {
      setTestResult({ success: false, message: "Server URL is required" });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      await testConnection(serverUrl, token);
      try {
        const me = await whoami(serverUrl, token);
        setTestResult({ success: true, message: `Connected as ${me.username}` });
      } catch {
        setTestResult({
          success: true,
          message: "Server reachable, but token is missing or invalid.",
        });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error.message,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (serverUrl) {
      saveConfig({ serverUrl, token });
    } else {
      clearConfig();
    }
    onConnectionChange?.();
    onClose();
  };

  const handleReset = async () => {
    await signOut();
    clearConfig();
    setConnectionType("cloud");
    setServerUrl(CLOUD_API_URL);
    setSelfHostedUrl("");
    setToken("");
    setTestResult(null);
    onConnectionChange?.();
  };

  const handleSignOut = async () => {
    // Clearing localStorage alone would leave the Better Auth session cookie
    // intact -- the UI would look signed out while a reload silently signed
    // you back in. The cookie is HttpOnly, so only the service can revoke it.
    await signOut();
    clearConfig();
    onConnectionChange?.();
    onClose();
  };

  const handleSetPassword = async (e) => {
    e.preventDefault();
    setPasswordError(null);

    if (newPasswordValue.length < 8) {
      setPasswordError("Password must be at least 8 characters.");
      return;
    }
    if (newPasswordValue !== confirmNewPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    setPasswordSaving(true);
    try {
      await setPassword(newPasswordValue, currentPassword || undefined);
      toast({ title: "Password updated", variant: "success" });
      setShowPasswordForm(false);
      setCurrentPassword("");
      setNewPasswordValue("");
      setConfirmNewPassword("");
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Account & Connection
          </DialogTitle>
          <DialogDescription>
            Manage your connection, tokens, and data.
          </DialogDescription>
        </DialogHeader>

        <div className="flex rounded-lg bg-muted p-0.5">
          {TABS.map((tab) => {
            const disabled = tab.id !== "connection" && !isSignedIn;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => !disabled && setActiveTab(tab.id)}
                disabled={disabled}
                title={disabled ? "Sign in to manage tokens and data" : undefined}
                className={segmentClass(activeTab === tab.id, disabled)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "connection" && (
          <div className="space-y-4">
            {isSignedIn && (
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/50 p-3 text-sm">
                <span className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  Signed in as <strong>{signedInUsername || "your account"}</strong>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSignOut}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <LogOut className="h-3.5 w-3.5 mr-1.5" />
                  Sign out
                </Button>
              </div>
            )}

            {/* Renders nothing without a Better Auth session, which is exactly
                the detached-mode case: a token there carries no email and the
                reset flow it feeds does not exist. */}
            {isSignedIn && <EmailSettings />}

            {/* Auto-save, evicted from the header in slice 1. It is a
                once-per-lifetime preference and it was competing with content
                for the most valuable strip on the page.

                It lands in this panel rather than a new Account tab: slice 5
                rebuilds this dialog with Account / Server / Token tabs, and
                inventing one here would prejudge that structure. The copy says
                what happens rather than naming a mechanism -- "auto-save" alone
                does not tell you the alternative is a button in the header. */}
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0 space-y-1">
                <Label htmlFor="autosave-preference" className="text-sm font-medium">
                  Save as you type
                </Label>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Changes are saved automatically. Turn this off and the header
                  keeps a Save now button instead.
                </p>
              </div>
              <Switch
                id="autosave-preference"
                checked={isAutosaveEnabled}
                onCheckedChange={onAutosaveChange}
                aria-label="Auto-save"
              />
            </div>

            {/* Dismissing the Getting-started card is not destructive -- nothing
                is deleted, and #/onboarding/welcome still works if typed -- so
                this brings back a card, not data.

                It lands here rather than in a new Account tab for the same
                reason auto-save above does: slice 5 rebuilds this dialog with
                Account / Server / Token tabs, and inventing one now would
                prejudge that structure. The account button in the header
                already opens this panel, which is the route the design calls
                for. */}
            {onboardingDismissed && (
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">Getting started</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    You dismissed the setup card. Bring it back to pick up where
                    you left off.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    setOnboardingDismissed(false);
                    saveOnboarding(
                      { dismissed: false, steps: {} },
                      disabledSections,
                    ).catch(() => {
                      // The offer is already gone from this panel; a lost write
                      // costs one more click on the next visit.
                    });
                  }}
                >
                  Show getting started
                </Button>
              </div>
            )}

            {/* Connection type */}
            <div className="space-y-2">
              <Label>Connection Type</Label>
              <div className="flex rounded-lg bg-muted p-0.5">
                <button
                  type="button"
                  onClick={selectCloud}
                  className={segmentClass(connectionType === "cloud", false)}
                >
                  <Globe className="h-4 w-4" />
                  Cloud
                </button>
                <button
                  type="button"
                  onClick={selectSelfHosted}
                  className={segmentClass(connectionType === "self-hosted", false)}
                >
                  <Server className="h-4 w-4" />
                  Self-hosted
                </button>
              </div>
            </div>

            {/* Server URL (self-hosted only) */}
            {connectionType === "self-hosted" && (
              <div className="space-y-2">
                <Label htmlFor="serverUrl">Server URL</Label>
                <Input
                  id="serverUrl"
                  placeholder="https://your-mygist-server.com/api"
                  value={serverUrl}
                  onChange={(e) => handleSelfHostedUrlChange(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Full URL to your MyGist API endpoint. Leave empty to use the
                  local development server.
                </p>
              </div>
            )}

            {/* Manual token entry -- recovery path when not signed in */}
            {!isSignedIn && (
              <div className="space-y-2">
                <Label htmlFor="token" className="flex items-center gap-2">
                  <Key className="h-3 w-3" />
                  API Token
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="token"
                    type={showToken ? "text" : "password"}
                    placeholder="Your access token"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowToken(!showToken)}
                  >
                    {showToken ? "Hide" : "Show"}
                  </Button>
                </div>
              </div>
            )}

            {/* Test Result */}
            {testResult && (
              <div
                className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
                  testResult.success
                    ? "bg-accent text-accent-foreground"
                    : "border border-destructive/40 text-destructive"
                }`}
              >
                {testResult.success ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                {testResult.message}
              </div>
            )}

            {/* Current Config Info */}
            <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
              <p>
                <strong>Current API:</strong> {getApiBase()}
              </p>
              <p>
                <strong>Mode:</strong>{" "}
                {import.meta.env.DEV ? "Development (proxied)" : "Production"}
              </p>
            </div>

            {/* Change password */}
            {isSignedIn && (
              <div className="border-t pt-4">
                <button
                  type="button"
                  onClick={() => setShowPasswordForm((v) => !v)}
                  className="flex w-full items-center justify-between text-sm font-medium"
                >
                  Change password
                  {showPasswordForm ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                {showPasswordForm && (
                  <form onSubmit={handleSetPassword} className="mt-3 space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="current-password">Current password</Label>
                      <Input
                        id="current-password"
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Leave empty if you have not set a password before.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="new-password">New password</Label>
                      <Input
                        id="new-password"
                        type="password"
                        autoComplete="new-password"
                        placeholder="At least 8 characters"
                        value={newPasswordValue}
                        onChange={(e) => setNewPasswordValue(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="confirm-new-password">
                        Confirm new password
                      </Label>
                      <Input
                        id="confirm-new-password"
                        type="password"
                        autoComplete="new-password"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                      />
                    </div>
                    {passwordError && (
                      <p className="text-xs text-destructive">{passwordError}</p>
                    )}
                    <Button type="submit" size="sm" disabled={passwordSaving}>
                      {passwordSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Update password"
                      )}
                    </Button>
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "tokens" && <TokenPanel isOpen />}

        {activeTab === "apps" && <AppsPanel isOpen />}

        {activeTab === "data" && <DataPanel />}

        {activeTab === "connection" && (
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={handleReset}
              className="sm:mr-auto"
            >
              Reset to Default
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleTest} disabled={testing}>
                {testing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Wifi className="h-4 w-4 mr-2" />
                    Test Connection
                  </>
                )}
              </Button>
              <Button onClick={handleSave}>Save</Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Connection status indicator for the header
export function ConnectionStatus({ onClick }) {
  const [status, setStatus] = useState("unknown");
  const config = getConfig();

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  const checkStatus = async () => {
    try {
      const response = await fetch(`${getApiBase()}/health`, {
        headers: config?.token
          ? { Authorization: `Bearer ${config.token}` }
          : {},
      });
      setStatus(response.ok ? "connected" : "error");
    } catch {
      setStatus("disconnected");
    }
  };

  const isRemote = !!config?.serverUrl;
  const ModeIcon = isRemote ? Globe : Laptop;

  const statusConfig = {
    connected: { color: "text-success", label: "Connected" },
    disconnected: { color: "text-destructive", label: "Disconnected" },
    error: { color: "text-warning", label: "Error" },
    unknown: { color: "text-muted-foreground", label: "Checking..." },
  };

  const { color, label } = statusConfig[status];

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="gap-1.5"
      title={`${label} (${isRemote ? "Remote" : "Local"}) - Click to configure`}
    >
      {status === "unknown" ? (
        <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
      ) : (
        <ModeIcon className={`h-4 w-4 ${color}`} />
      )}
      <span className="hidden sm:block text-xs">
        {isRemote ? "Remote" : "Local"}
      </span>
    </Button>
  );
}
