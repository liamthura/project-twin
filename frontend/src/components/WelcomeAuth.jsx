import { useEffect, useRef, useState } from "react";
import { Globe, Loader2, Server } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { segmentClass } from "@/components/ui/segmented-control";
import {
  saveConfig,
  loginAccount,
  registerAccount,
  getInstance,
  CLOUD_API_URL,
} from "@/lib/api.js";
import {
  signIn,
  signUp,
  requestPasswordReset,
  isCompleteInvite,
  normaliseInvite,
} from "@/lib/session.js";
import { InviteGate, AcceptedInvite } from "@/components/InviteGate";
import { AuthShell } from "@/components/AuthShell";
import {
  DEFAULT_AUTH_ROUTE,
  goToRoute,
  isAuthRoute,
  readRoute,
} from "@/lib/routes.js";

/** An invite link: ?invite=7F2K-QX91. Read once at mount -- it cannot change
 *  while the page is open, and reading it in render would re-check it on every
 *  keystroke. */
function inviteFromUrl() {
  if (typeof window === "undefined") return "";
  return normaliseInvite(new URLSearchParams(window.location.search).get("invite"));
}

// Better Auth is same-origin only: its session cookie cannot be set from, or
// sent to, another site. A UI pointed at someone else's server therefore keeps
// the original username/password endpoints and a stored bearer token, which is
// the one place the old flow is not merely deprecated but still required.
function isDetached(serverUrl) {
  if (!serverUrl) return false;
  try {
    return new URL(serverUrl, window.location.origin).origin !== window.location.origin;
  } catch {
    return false;
  }
}

// The API served by whatever origin handed us this page. Computed once at
// module scope rather than per render: it cannot change while the page is
// open, and jsdom gives it a real value so tests exercise the same branch a
// browser does. Guarded for any non-browser import.
const ORIGIN_API_URL =
  typeof window !== "undefined" && window.location?.origin
    ? `${window.location.origin}/api`
    : CLOUD_API_URL;

/**
 * The card's heading, by what it is currently asking for.
 *
 * This used to live in App, at the point it mounted this component -- so the
 * heading could not change when the form did, and "Welcome to MyGist. Sign in
 * or create an account to get started" sat above the forgot-password form and
 * above the invite gate.
 *
 * `intent` is the one thing App knows that this component does not: whether
 * this is the app's own sign-in or the middle of an OAuth flow, where the
 * person did not come here to sign in and is owed a sentence saying why they
 * are being asked.
 */
const COPY = {
  app: {
    signin: {
      title: "Welcome to MyGist",
      description: "Your portable personal context for AI.",
    },
    signup: {
      title: "Create your account",
      description: "One account, and every AI client you use reads the same persona.",
    },
    forgot: {
      title: "Reset your password",
      description: "We will email you a link.",
    },
  },
  connect: {
    signin: {
      title: "Sign in to connect",
      description: "Sign in to let this application connect to your persona.",
    },
    signup: {
      title: "Create your account",
      description: "You will be asked to approve the connection next.",
    },
    forgot: {
      title: "Reset your password",
      description: "We will email you a link.",
    },
  },
};

// The gate reads the same under both intents: it is a statement about the
// instance, and nothing about it changes because a client is waiting.
const INVITE_COPY = {
  title: "You need an invite",
  description: "MyGist is in closed testing.",
};

// Welcome / sign-in form: username + password, with a "Create account"
// toggle. Lives on the first-run welcome screen (see the `error &&
// !getAuthToken()` branch below). On success it saves the config and hands
// control back to the caller (which reloads app data).
export function WelcomeAuth({ intent = "app", onSuccess }) {
  // The mode IS the route -- #/signin, #/signup, #/forgot. Seeded from the URL
  // so a deep link lands on the right screen, and written back to it on every
  // change so the address bar never describes a page nobody is looking at.
  const [mode, setMode] = useState(() =>
    isAuthRoute(readRoute()) ? readRoute() : DEFAULT_AUTH_ROUTE,
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);

  // Whether this instance requires an invite code. Null until asked, so the
  // sign-up form is not rendered and then replaced by a gate a moment later.
  const [inviteOnly, setInviteOnly] = useState(null);
  const [acceptedInvite, setAcceptedInvite] = useState("");
  const [linkInvite] = useState(inviteFromUrl);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState(null);
  const [showServer, setShowServer] = useState(false);
  // MyGist ships as one container serving both this page and /api, so the
  // server that handed you this form is almost always the one you want to
  // authenticate against -- and `getApiBase()` already defaults to the
  // same origin for every other request. This screen used to hardcode the
  // cloud preset instead, so a self-hosted instance sent its own users'
  // sign-ups to mygist.thuradev.qzz.io, where the browser rejects the
  // cross-origin preflight and registration fails with no way to tell why.
  //
  // On the hosted instance the serving origin IS the cloud URL, so this
  // resolves to "cloud" there and nothing changes for its users. Anywhere
  // else it prefills the origin you are already on. The cloud preset stays
  // one click away for the case its comment in api.js describes: running
  // this UI somewhere other than the server it talks to.
  const [connectionType, setConnectionType] = useState(
    ORIGIN_API_URL === CLOUD_API_URL ? "cloud" : "self-hosted"
  );
  const [selfHostedUrl, setSelfHostedUrl] = useState(
    ORIGIN_API_URL === CLOUD_API_URL ? "" : ORIGIN_API_URL
  );

  const serverUrl =
    connectionType === "cloud" ? CLOUD_API_URL : selfHostedUrl.trim();

  // Signing IN accepts either identifier, because Better Auth has an endpoint
  // for each and session.js routes on the shape of what was typed.
  //
  // Not while signing up: that still asks for a username only, and offering a
  // choice here would promise something the next field does not deliver.
  //
  // Not in detached mode either: that talks to /api/auth/login, which knows
  // only usernames. A label promising email would be a lie on that path.
  const acceptsEmail = mode === "signin" && !isDetached(serverUrl);

  // Asked once, on mount. Detached mode is excluded on purpose: /api/instance
  // there describes SOMEBODY ELSE'S server, and its registration path is the
  // old one, which has no notion of invite codes.
  useEffect(() => {
    if (isDetached(serverUrl)) {
      setInviteOnly(false);
      return;
    }
    let cancelled = false;
    getInstance().then((info) => {
      if (!cancelled) setInviteOnly(info?.invite_only === true);
    });
    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  // An invite link means someone intends to sign up, so start there rather
  // than on the sign-in tab they would immediately have to leave.
  useEffect(() => {
    if (isCompleteInvite(linkInvite)) setMode("signup");
  }, [linkInvite]);

  // Once a code is in hand the query has done its job. Leaving it there means a
  // spent code sitting in the address bar, which is the sort of thing that gets
  // copied out of a screenshot and passed on to somebody it will not work for.
  useEffect(() => {
    if (!acceptedInvite) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("invite")) return;

    params.delete("invite");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, [acceptedInvite]);

  // Keep the URL describing what is on screen. Replaced rather than pushed on
  // the first render: arriving at #/ and being corrected to #/signin is not a
  // navigation anyone made, and a back button that walks through it is a back
  // button that appears not to work.
  const routeSettled = useRef(false);
  useEffect(() => {
    goToRoute(mode, { replace: !routeSettled.current });
    routeSettled.current = true;
  }, [mode]);

  // Back and forward between the auth screens. Both events are listened for:
  // hashchange covers a hash edited in the address bar, popstate covers
  // stepping back through the entries pushed above.
  useEffect(() => {
    const sync = () => {
      const route = readRoute();
      if (isAuthRoute(route)) setMode(route);
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  // The gate stands between "create an account" and the account form, and only
  // while this instance actually requires one.
  const needsInvite = mode === "signup" && inviteOnly === true && !acceptedInvite;

  const switchMode = (next) => {
    setMode(next);
    setFormError(null);
    setPassword("");
    setConfirmPassword("");
    setResetSent(false);
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!resetEmail.trim()) {
      setFormError("Enter the email on your account.");
      return;
    }

    setPending(true);
    try {
      await requestPasswordReset(resetEmail.trim());
      setResetSent(true);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setPending(false);
    }
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
      // Same-origin instances authenticate through Better Auth, which sets an
      // HttpOnly session cookie -- so nothing is stored here, and the config
      // deliberately carries no token. Detached mode (a UI pointed at someone
      // else's server) cannot use a cross-site cookie, so it keeps the old
      // endpoints and the localStorage token.
      if (isDetached(serverUrl)) {
        const result =
          mode === "signup"
            ? await registerAccount(serverUrl, username.trim(), password)
            : await loginAccount(serverUrl, username.trim(), password);
        saveConfig({ serverUrl, token: result.token });
      } else {
        if (mode === "signup") {
          // undefined when this instance is open; the service ignores it
          // then, and requires it when it is not.
          await signUp(username.trim(), password, undefined, acceptedInvite || undefined);
        } else {
          await signIn(username.trim(), password);
        }
        // No token: the session is the cookie. Any token left from a previous
        // sign-in would otherwise take precedence over it in resolveCredential.
        saveConfig({ serverUrl });
      }
      // The signup moment is the one thing only this component knows, and it
      // knows it without asking the server anything. App uses it to send a
      // brand-new account to onboarding rather than to an empty Profile.
      onSuccess({ isNew: mode === "signup" });
    } catch (err) {
      setFormError(err.message);
    } finally {
      setPending(false);
    }
  };

  const copy = needsInvite ? INVITE_COPY : COPY[intent][mode];

  if (needsInvite) {
    return (
      <AuthShell title={copy.title} description={copy.description}>
        <InviteGate
          initialCode={linkInvite}
          onAccepted={setAcceptedInvite}
          onBack={() => switchMode("signin")}
        />
      </AuthShell>
    );
  }

  if (mode === "forgot") {
    return (
      <AuthShell title={copy.title} description={copy.description}>
        <div className="w-full space-y-4 text-left">
          {resetSent ? (
            // Deliberately says nothing about whether that address has an
            // account. The service answers identically either way so a stranger
            // cannot use this to find out who has signed up, and it would be a
            // waste of that care to give it away in the copy.
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <p className="text-sm">
                If <strong>{resetEmail.trim()}</strong> is on a MyGist account, a reset
                link is on its way.
              </p>
              <p className="text-xs text-muted-foreground">
                The link works once and expires within the hour. Nothing has changed
                until you open it.
              </p>
            </div>
          ) : (
            <form onSubmit={handleResetSubmit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="reset-email" className="text-xs font-medium">
                  Email
                </Label>
                <Input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="you@example.com"
                />
                <p className="text-xs text-muted-foreground">
                  The address on your account. If you never added one, a reset cannot
                  reach you — sign in and add one first.
                </p>
              </div>

              {formError && <p className="text-xs text-destructive">{formError}</p>}

              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Send reset link"
                )}
              </Button>
            </form>
          )}

          <p className="text-center text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="underline hover:text-foreground"
            >
              Back to sign in
            </button>
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={copy.title} description={copy.description}>
      <div className="w-full space-y-4 text-left">
        {/* Which code is about to be spent, and a way back to change it. */}
        {mode === "signup" && acceptedInvite && (
          <AcceptedInvite code={acceptedInvite} onChange={() => setAcceptedInvite("")} />
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="welcome-username" className="text-xs font-medium">
              {acceptsEmail ? "Username or email" : "Username"}
            </Label>
            <Input
              id="welcome-username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={acceptsEmail ? "yourname or you@example.com" : "yourname"}
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
              {/* Reset runs through Better Auth, which is same-origin only.
                  Detached mode talks to the old endpoints, which have no reset
                  at all -- offering it there would be a dead end. */}
              {!isDetached(serverUrl) && (
                <>
                  <br />
                  <button
                    type="button"
                    onClick={() => switchMode("forgot")}
                    className="underline hover:text-foreground"
                  >
                    Forgot your password?
                  </button>
                </>
              )}
            </>
          )}
        </p>

        {/* "Use an access token instead" used to share this row. Deleted per the
            prototype's change 5 -- Better Auth supersedes it -- and the cost is
            recorded in the auth slice spec: a first run with no account now has
            no way to paste a bare token. */}
        <div className="flex items-center justify-center border-t pt-3 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setShowServer((v) => !v)}
            className="underline hover:text-foreground"
          >
            Server: {connectionType === "cloud" ? "Cloud" : "Self-hosted"}
          </button>
        </div>
      </div>
    </AuthShell>
  );
}
