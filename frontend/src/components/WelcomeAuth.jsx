import { useState } from "react";
import { Globe, Loader2, Server } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { segmentClass } from "@/components/ui/segmented-control";
import { saveConfig, loginAccount, registerAccount, CLOUD_API_URL } from "@/lib/api.js";

// Welcome / sign-in form: username + password, with a "Create account"
// toggle. Lives on the first-run welcome screen (see the `error &&
// !getAuthToken()` branch below). On success it saves the config and hands
// control back to the caller (which reloads app data).
export function WelcomeAuth({ onUseToken, onSuccess }) {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState(null);
  const [showServer, setShowServer] = useState(false);
  const [connectionType, setConnectionType] = useState("cloud"); // "cloud" | "self-hosted"
  const [selfHostedUrl, setSelfHostedUrl] = useState("");

  const serverUrl =
    connectionType === "cloud" ? CLOUD_API_URL : selfHostedUrl.trim();

  const switchMode = (next) => {
    setMode(next);
    setFormError(null);
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!username.trim() || !password) {
      setFormError("Enter a username and password.");
      return;
    }
    if (connectionType === "self-hosted" && !selfHostedUrl.trim()) {
      setFormError("Server URL is required.");
      return;
    }
    if (mode === "signup") {
      if (password.length < 8) {
        setFormError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setFormError("Passwords do not match.");
        return;
      }
    }

    setPending(true);
    try {
      const result =
        mode === "signup"
          ? await registerAccount(serverUrl, username.trim(), password)
          : await loginAccount(serverUrl, username.trim(), password);
      saveConfig({ serverUrl, token: result.token });
      onSuccess();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="w-full space-y-4 text-left">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="welcome-username" className="text-xs font-medium">
            Username
          </Label>
          <Input
            id="welcome-username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="yourname"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="welcome-password" className="text-xs font-medium">
            Password
          </Label>
          <Input
            id="welcome-password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
          />
        </div>
        {mode === "signup" && (
          <div className="space-y-1.5">
            <Label htmlFor="welcome-confirm-password" className="text-xs font-medium">
              Confirm password
            </Label>
            <Input
              id="welcome-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
            />
          </div>
        )}

        {showServer && (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-left">
            <Label className="text-xs font-medium">Server</Label>
            <div className="flex rounded-lg bg-muted p-0.5">
              <button
                type="button"
                onClick={() => setConnectionType("cloud")}
                className={segmentClass(connectionType === "cloud")}
              >
                <Globe className="h-4 w-4" />
                Cloud
              </button>
              <button
                type="button"
                onClick={() => setConnectionType("self-hosted")}
                className={segmentClass(connectionType === "self-hosted")}
              >
                <Server className="h-4 w-4" />
                Self-hosted
              </button>
            </div>
            {connectionType === "self-hosted" && (
              <Input
                placeholder="https://your-mygist-server.com/api"
                value={selfHostedUrl}
                onChange={(e) => setSelfHostedUrl(e.target.value)}
              />
            )}
          </div>
        )}

        {formError && <p className="text-xs text-destructive">{formError}</p>}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === "signup" ? (
            "Create account"
          ) : (
            "Sign in"
          )}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="underline hover:text-foreground"
            >
              Sign in
            </button>
          </>
        ) : (
          <>
            New to MyGist?{" "}
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className="underline hover:text-foreground"
            >
              Create an account
            </button>
          </>
        )}
      </p>

      <div className="flex items-center justify-center gap-3 border-t pt-3 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={onUseToken}
          className="underline hover:text-foreground"
        >
          Use an access token instead
        </button>
        <span aria-hidden="true">&middot;</span>
        <button
          type="button"
          onClick={() => setShowServer((v) => !v)}
          className="underline hover:text-foreground"
        >
          Server: {connectionType === "cloud" ? "Cloud" : "Self-hosted"}
        </button>
      </div>
    </div>
  );
}
