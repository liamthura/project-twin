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

export function ConnectionSettings({ isOpen, onClose, onConnectionChange }) {
  const [serverUrl, setServerUrl] = useState("");
  const [token, setToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showToken, setShowToken] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState("replace");
  const [backupResult, setBackupResult] = useState(null);
  const [mode, setMode] = useState("connect"); // "connect" | "register"
  const [username, setUsername] = useState("");
  const [connectedAs, setConnectedAs] = useState(null);

  useEffect(() => {
    if (isOpen) {
      const config = getConfig();
      setServerUrl(config?.serverUrl || "");
      setToken(config?.token || "");
      setTestResult(null);
      setBackupResult(null);
      setMode("connect");
      setUsername("");
      setConnectedAs(null);
    }
  }, [isOpen]);

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
      setMode("connect");
      setTestResult({
        success: true,
        message:
          "Account created — token filled in below. Save it, it won't be shown again.",
      });
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

  const handleReset = () => {
    clearConfig();
    setServerUrl("");
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
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Server Connection
          </DialogTitle>
          <DialogDescription>
            Connect to your MyGist MCP server. Leave empty to use local
            development server.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Server URL */}
          <div className="space-y-2">
            <Label htmlFor="serverUrl">Server URL</Label>
            <Input
              id="serverUrl"
              placeholder="https://mygist.thuradev.qzz.io/api"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Full URL to your MyGist API endpoint (e.g.,
              https://mygist.example.com/api)
            </p>
          </div>

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
