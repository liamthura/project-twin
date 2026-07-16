import { useState, useEffect } from "react";
import {
  Settings,
  Wifi,
  WifiOff,
  Loader2,
  Check,
  X,
  Server,
  Key,
  ExternalLink,
  Laptop,
  Globe,
  Download,
  Upload,
  Copy,
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
import {
  getConfig,
  saveConfig,
  clearConfig,
  testConnection,
  registerAccount,
  whoami,
  getApiBase,
  exportData,
  importData,
} from "@/lib/api.js";

const CLOUD_API_URL = "https://mygist-api.thuradev.qzz.io/api";

export function ConnectionSettings({
  isOpen,
  onClose,
  onConnectionChange,
  initialMode = "connect",
}) {
  const [connectionType, setConnectionType] = useState("cloud"); // "cloud" | "self-hosted"
  const [serverUrl, setServerUrl] = useState(CLOUD_API_URL);
  const [selfHostedUrl, setSelfHostedUrl] = useState("");
  const [token, setToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showToken, setShowToken] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState("replace");
  const [backupResult, setBackupResult] = useState(null);
  const [mode, setMode] = useState("connect"); // "connect" | "register" | "created"
  const [username, setUsername] = useState("");
  const [connectedAs, setConnectedAs] = useState(null);
  const [newAccount, setNewAccount] = useState(null); // { username, token }
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
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
      setBackupResult(null);
      setMode(initialMode);
      setUsername("");
      setConnectedAs(null);
      setNewAccount(null);
      setCopied(false);
    }
  }, [isOpen, initialMode]);

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
    setConnectedAs(null);

    try {
      await testConnection(serverUrl, token);
      // Reachable -- now confirm the token identifies a user.
      try {
        const me = await whoami(serverUrl, token);
        setConnectedAs(me.username);
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

  const handleRegister = async () => {
    if (!serverUrl || !username) {
      setTestResult({
        success: false,
        message: "Server URL and username are required",
      });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const { token: newToken } = await registerAccount(serverUrl, username);
      setToken(newToken);
      setNewAccount({ username, token: newToken });
      setMode("created");
      setTestResult(null);
    } catch (err) {
      setTestResult({ success: false, message: err.message });
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

  const handleCopyToken = async () => {
    if (!newAccount) return;
    try {
      await navigator.clipboard.writeText(newAccount.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable; token stays visible for manual copy
    }
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

  const handleExport = async () => {
    setExporting(true);
    setBackupResult(null);
    try {
      const result = await exportData();
      setBackupResult({
        success: true,
        message: `Downloaded ${result.filename}`,
      });
    } catch (error) {
      setBackupResult({ success: false, message: error.message });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setBackupResult(null);
    try {
      const result = await importData(file, importMode);
      setBackupResult({
        success: true,
        message: `${importMode === "merge" ? "Merged" : "Imported"} ${
          result.imported_files?.length || 0
        } files`,
      });
    } catch (error) {
      setBackupResult({ success: false, message: error.message });
    } finally {
      setImporting(false);
      e.target.value = ""; // Reset file input
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          {mode === "created" ? (
            <>
              <DialogTitle className="flex items-center gap-2">
                <Check className="h-5 w-5 text-primary" />
                Account created
              </DialogTitle>
              <DialogDescription>
                One last step: save your access token before continuing.
              </DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Server Connection
              </DialogTitle>
              <DialogDescription>
                Connect to your MyGist MCP server. Use Cloud for the hosted
                instance, or Self-hosted to point at your own server API.
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        {mode === "created" && newAccount ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3 text-sm">
              <Check className="h-4 w-4 flex-shrink-0 text-primary" />
              <span>
                Welcome, <strong>{newAccount.username}</strong>. Your account
                is ready to use.
              </span>
            </div>
            <div className="space-y-2">
              <Label>Your access token</Label>
              <div className="select-all break-all rounded-lg border bg-muted/50 p-3 font-mono text-sm">
                {newAccount.token}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleCopyToken}
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
                This token is the only key to your account. Save it in a
                password manager or somewhere safe. For your security it will
                not be shown again.
              </span>
            </div>
          </div>
        ) : (
        <div className="space-y-4">
          {/* Connection type */}
          <div className="space-y-2">
            <Label>Connection Type</Label>
            <div className="flex rounded-lg bg-muted p-0.5">
              <button
                type="button"
                onClick={selectCloud}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  connectionType === "cloud"
                    ? "border bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Globe className="h-4 w-4" />
                Cloud
              </button>
              <button
                type="button"
                onClick={selectSelfHosted}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  connectionType === "self-hosted"
                    ? "border bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
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

          {/* API Token */}
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
            {mode === "connect" ? (
              <p className="text-xs text-muted-foreground">
                Don&apos;t have a token?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("register");
                    setTestResult(null);
                  }}
                  className="underline hover:text-foreground"
                >
                  Create an account
                </button>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Registering issues a token — save it, it won&apos;t be shown again.
              </p>
            )}
          </div>

          {/* Create account (register mode) */}
          {mode === "register" && (
            <div className="space-y-2">
              <Label htmlFor="username">New account username</Label>
              <div className="flex gap-2">
                <Input
                  id="username"
                  placeholder="pick a username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={handleRegister}
                  disabled={testing || !serverUrl || !username}
                >
                  {testing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Create account"
                  )}
                </Button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMode("connect");
                  setTestResult(null);
                }}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Back to sign in
              </button>
            </div>
          )}

          {/* Test Result */}
          {testResult && (
            <div
              className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
                testResult.success
                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : "bg-red-500/10 text-red-600 dark:text-red-400"
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
            {connectedAs && (
              <p>
                <strong>Signed in as:</strong> {connectedAs}
              </p>
            )}
          </div>

          {/* Backup & Restore */}
          <div className="border-t pt-4 space-y-3">
            <Label className="text-sm font-medium">Backup & Restore</Label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={exporting || importing}
                className="flex-1"
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Export Data
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => document.getElementById("import-file").click()}
                disabled={exporting || importing}
                className="flex-1"
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Import Data
              </Button>
              <input
                id="import-file"
                type="file"
                accept=".zip"
                onChange={handleImport}
                className="hidden"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">
                Import mode:
              </label>
              <select
                value={importMode}
                onChange={(e) => setImportMode(e.target.value)}
                className="text-xs bg-background border rounded px-2 py-1"
              >
                <option value="replace">Replace (overwrite)</option>
                <option value="merge">Merge (combine data)</option>
              </select>
            </div>
            {backupResult && (
              <div
                className={`p-2 rounded text-xs flex items-center gap-2 ${
                  backupResult.success
                    ? "bg-green-500/10 text-green-600 dark:text-green-400"
                    : "bg-red-500/10 text-red-600 dark:text-red-400"
                }`}
              >
                {backupResult.success ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <X className="h-3 w-3" />
                )}
                {backupResult.message}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Export downloads a zip of all your data. Import restores from a
              backup (creates a safety backup first).
            </p>
          </div>
        </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {mode === "created" ? (
            <Button className="w-full" onClick={handleSave}>
              I saved my token, continue
            </Button>
          ) : (
            <>
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
            </>
          )}
        </DialogFooter>
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
    connected: { color: "text-green-500", label: "Connected" },
    disconnected: { color: "text-red-500", label: "Disconnected" },
    error: { color: "text-yellow-500", label: "Error" },
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
