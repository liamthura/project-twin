/**
 * Which server this UI talks to.
 *
 * The prototype leads with MyGist Cloud. That reproduces a bug this code already
 * fixed once: the old panel selected Cloud whenever there was no saved config,
 * while getApiBase() with no config returns /api -- the origin that served the
 * page. On a self-hosted instance it therefore claimed to be talking to the
 * cloud while talking to itself, and printed the contradiction two panels below.
 * WelcomeAuth.jsx documents the same mistake on the sign-up path, where it sent
 * self-hosters' registrations to a host their browser then refused.
 *
 * So this leads with the instance that served the page. MyGist Cloud is what
 * that resolves to when the serving origin IS the cloud, and it stays available
 * as a preset for the case api.js describes: running this UI somewhere other
 * than the server it talks to.
 *
 * Reset signs you out, and says so. A token in the config belongs to the server
 * being left behind, and it has always been cleared -- "Reset to Default" just
 * never mentioned it.
 */
import { useState } from "react";
import { Check, Loader2, Wifi, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CLOUD_API_URL,
  getConfig,
  saveConfig,
  clearConfig,
  testConnection,
  whoami,
  getApiBase,
} from "@/lib/api.js";
import { signOut } from "@/lib/session.js";

export function ServerPanel({ isSignedIn, onConnectionChange, onClose }) {
  // A saved serverUrl means someone deliberately pointed this UI elsewhere.
  // Anything else -- no config at all -- means the origin that served this page,
  // which is what getApiBase() already returns.
  const saved = getConfig();
  const [custom, setCustom] = useState(() => !!saved?.serverUrl);
  const [url, setUrl] = useState(saved?.serverUrl || "");
  const [token, setToken] = useState(saved?.token || "");
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const [resetting, setResetting] = useState(false);

  const handleTest = async () => {
    if (!url) {
      setResult({ ok: false, message: "Server URL is required" });
      return;
    }

    setTesting(true);
    setResult(null);
    try {
      await testConnection(url, token);
      try {
        const me = await whoami(url, token);
        setResult({ ok: true, message: `Connected as ${me.username}` });
      } catch {
        setResult({
          ok: true,
          message: "Server reachable, but the token is missing or invalid.",
        });
      }
    } catch (error) {
      setResult({ ok: false, message: error.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (url) saveConfig({ serverUrl: url, token });
    else clearConfig();
    onConnectionChange?.();
    onClose();
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      // The token in the config belongs to the server being left behind, and
      // the session cookie is HttpOnly, so only the service can revoke it.
      await signOut();
      clearConfig();
      setCustom(false);
      setUrl("");
      setToken("");
      setResult(null);
      onConnectionChange?.();
    } finally {
      setResetting(false);
    }
  };

  if (!custom) {
    return (
      <div className="space-y-3">
        <div className="space-y-1 rounded-lg border p-3">
          <p className="text-sm font-medium">This instance</p>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {getApiBase()}
          </p>
          <p className="text-xs text-muted-foreground">
            The app and the API it talks to are served from here.
          </p>
        </div>
        <Button
          variant="link"
          className="h-auto p-0 text-xs"
          onClick={() => setCustom(true)}
        >
          Use a custom server
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="server-url">Server URL</Label>
        <Input
          id="server-url"
          placeholder="https://your-mygist-server.com/api"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Full URL to the MyGist API, including /api.
        </p>
        <Button
          variant="link"
          className="h-auto p-0 text-xs"
          onClick={() => setUrl(CLOUD_API_URL)}
        >
          Use MyGist Cloud
        </Button>
      </div>

      {/* Only without a credential. This is the recovery path: a session that
          has stopped working, or a UI pointed at a server it cannot hold a
          cookie for. */}
      {!isSignedIn && (
        <div className="space-y-2">
          <Label htmlFor="server-token">API token</Label>
          <div className="flex gap-2">
            <Input
              id="server-token"
              type={showToken ? "text" : "password"}
              placeholder="Your access token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken ? "Hide" : "Show"}
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div
          className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
            result.ok
              ? "bg-accent text-accent-foreground"
              : "border border-destructive/40 text-destructive"
          }`}
        >
          {result.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
          {result.message}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={handleTest} disabled={testing}>
          {testing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Testing...
            </>
          ) : (
            <>
              <Wifi className="mr-2 h-4 w-4" />
              Test connection
            </>
          )}
        </Button>
        <Button onClick={handleSave}>Save</Button>
      </div>

      <div className="border-t pt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          disabled={resetting}
        >
          {resetting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Reset to this instance"
          )}
        </Button>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Clears the custom server and signs you out.
        </p>
      </div>
    </div>
  );
}
