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
  Download,
  Upload,
  Copy,
  User,
  LogOut,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  exportData,
  importData,
  setPassword,
  listTokens,
  createToken,
  revokeToken,
} from "@/lib/api.js";

const TABS = [
  { id: "connection", label: "Connection" },
  { id: "tokens", label: "API tokens" },
  { id: "data", label: "Data" },
];

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function ConnectionSettings({ isOpen, onClose, onConnectionChange }) {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("connection");
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

  // API tokens tab
  const [tokensList, setTokensList] = useState([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensError, setTokensError] = useState(null);
  const [newTokenLabel, setNewTokenLabel] = useState("mcp");
  const [generating, setGenerating] = useState(false);
  const [revealedToken, setRevealedToken] = useState(null); // { id, label, token }
  const [copied, setCopied] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState(null);
  const [revokingId, setRevokingId] = useState(null);

  // Data tab
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState("replace");

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

    setTokensList([]);
    setTokensError(null);
    setNewTokenLabel("mcp");
    setRevealedToken(null);
    setCopied(false);
    setConfirmRevokeId(null);

    setImportMode("replace");

    const signedIn = !!config?.token;
    setIsSignedIn(signedIn);
    setSignedInUsername(null);
    if (signedIn) {
      whoami()
        .then((me) => setSignedInUsername(me.username))
        .catch(() => setSignedInUsername("your account"));
    }
  }, [isOpen]);

  const loadTokens = async () => {
    setTokensLoading(true);
    setTokensError(null);
    try {
      const list = await listTokens();
      setTokensList(list);
    } catch (err) {
      setTokensError(err.message);
    } finally {
      setTokensLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === "tokens" && isSignedIn) {
      loadTokens();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab, isSignedIn]);

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

  const handleReset = () => {
    clearConfig();
    setConnectionType("cloud");
    setServerUrl(CLOUD_API_URL);
    setSelfHostedUrl("");
    setToken("");
    setTestResult(null);
    onConnectionChange?.();
  };

  const handleSignOut = () => {
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

  const handleGenerateToken = async () => {
    setGenerating(true);
    try {
      const result = await createToken(newTokenLabel.trim() || "mcp");
      setRevealedToken(result);
      setCopied(false);
    } catch (err) {
      toast({
        title: "Failed to generate token",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyRevealedToken = async () => {
    if (!revealedToken) return;
    try {
      await navigator.clipboard.writeText(revealedToken.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable; token stays visible for manual copy
    }
  };

  const handleDoneReveal = () => {
    setRevealedToken(null);
    setNewTokenLabel("mcp");
    loadTokens();
  };

  const handleRevoke = async (id) => {
    setRevokingId(id);
    try {
      await revokeToken(id);
      setConfirmRevokeId(null);
      toast({ title: "Token revoked", variant: "success" });
      loadTokens();
    } catch (err) {
      toast({
        title: "Failed to revoke token",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setRevokingId(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await exportData();
      toast({
        title: "Export complete",
        description: `Downloaded ${result.filename}`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Export failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const result = await importData(file, importMode);
      toast({
        title: importMode === "merge" ? "Merge complete" : "Import complete",
        description: `${result.imported_files?.length || 0} files ${
          importMode === "merge" ? "merged" : "imported"
        }`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Import failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setImporting(false);
      e.target.value = ""; // Reset file input
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

        {activeTab === "tokens" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Tokens let AI clients (Claude, MCP) access your MyGist.
            </p>

            {revealedToken ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3 text-sm">
                  <Check className="h-4 w-4 flex-shrink-0 text-primary" />
                  <span>
                    Token <strong>{revealedToken.label}</strong> created.
                  </span>
                </div>
                <div className="space-y-2">
                  <Label>Token</Label>
                  <div className="select-all break-all rounded-lg border bg-muted/50 p-3 font-mono text-sm">
                    {revealedToken.token}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={handleCopyRevealedToken}
                  >
                    {copied ? (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-2" />
                        Copy token
                      </>
                    )}
                  </Button>
                </div>
                <div className="flex gap-2 rounded-lg border p-3 text-xs text-muted-foreground">
                  <Key className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>
                    This token won&apos;t be shown again. Save it in a password
                    manager or somewhere safe.
                  </span>
                </div>
                <Button className="w-full" onClick={handleDoneReveal}>
                  Done
                </Button>
              </div>
            ) : (
              <>
                {tokensLoading ? (
                  <div className="flex items-center justify-center py-6 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : tokensError ? (
                  <p className="text-sm text-destructive">{tokensError}</p>
                ) : tokensList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No tokens yet. Generate one below to connect an AI client.
                  </p>
                ) : (
                  <div className="rounded-lg border divide-y">
                    {tokensList.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between gap-3 p-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="truncate text-sm font-medium">{t.label}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            created {formatDate(t.created_at) || "unknown"} &middot;{" "}
                            last used {formatDate(t.last_used_at) || "never"}
                          </p>
                        </div>
                        {confirmRevokeId === t.id ? (
                          <div className="flex shrink-0 gap-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleRevoke(t.id)}
                              disabled={revokingId === t.id}
                            >
                              {revokingId === t.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                "Revoke"
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setConfirmRevokeId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => setConfirmRevokeId(t.id)}
                            title="Revoke token"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2 border-t pt-4">
                  <Label htmlFor="new-token-label">Generate token</Label>
                  <div className="flex gap-2">
                    <Input
                      id="new-token-label"
                      placeholder="mcp"
                      value={newTokenLabel}
                      onChange={(e) => setNewTokenLabel(e.target.value)}
                      className="flex-1"
                    />
                    <Button onClick={handleGenerateToken} disabled={generating}>
                      {generating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Generate token"
                      )}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "data" && (
          <div className="space-y-4">
            <div className="rounded-lg border divide-y">
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Export backup</p>
                  <p className="text-xs text-muted-foreground">
                    Download everything as a zip.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExport}
                  disabled={exporting || importing}
                  className="shrink-0"
                >
                  {exporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Export
                    </>
                  )}
                </Button>
              </div>
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Import backup</p>
                  <p className="text-xs text-muted-foreground">
                    Restore from a backup zip. A safety backup is made first.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById("import-file").click()}
                  disabled={exporting || importing}
                  className="shrink-0"
                >
                  {importing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Choose file
                    </>
                  )}
                </Button>
                <input
                  id="import-file"
                  type="file"
                  accept=".zip"
                  onChange={handleImport}
                  className="hidden"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Import mode</Label>
              <div className="flex rounded-lg bg-muted p-0.5">
                <button
                  type="button"
                  onClick={() => setImportMode("replace")}
                  className={segmentClass(importMode === "replace", false)}
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode("merge")}
                  className={segmentClass(importMode === "merge", false)}
                >
                  Merge
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {importMode === "replace"
                  ? "Replace overwrites your existing data with the backup's contents."
                  : "Merge combines the backup with your existing data."}
              </p>
            </div>
          </div>
        )}

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
