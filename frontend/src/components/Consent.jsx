/**
 * The OAuth consent screen.
 *
 * This is where the scope decision lives, permanently. MCP has no per-tool
 * step-up: a refusal inside a JSON-RPC response cannot carry a
 * `WWW-Authenticate` header, so there is no second chance to widen or narrow a
 * grant once it is made. What gets decided here is the grant, for good.
 *
 * It is also the last line of defence against authorising the *wrong*
 * persona -- someone signed into a second account in this browser, approving
 * a client they meant to point at their main one, gets no protection from any
 * amount of token validation afterwards. Naming the account below is what
 * catches that, which is why it is not optional decoration.
 *
 * `client` and `username` are accepted as props so this can be rendered and
 * asserted on without a network (see Consent.test.jsx). Real usage from
 * App.jsx renders `<Consent />` with neither: this component then reads
 * `client_id` and `scope` off its own URL -- the ones Better Auth's
 * /oauth2/authorize redirect put there -- and fetches the rest itself.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { authFetch, getSession } from "@/lib/session.js";

// Must match auth/src/oauth.js exactly -- these are the wire values Better
// Auth stores and checks, not display strings.
const READ = "persona:read";
const PROPOSE = "persona:propose";
const WRITE = "persona:write";

async function readError(res, fallback) {
  const body = await res.json().catch(() => ({}));
  return body?.error_description || body?.message || fallback;
}

export default function Consent({ client: clientProp, username: usernameProp } = {}) {
  const [client, setClient] = useState(clientProp ?? null);
  const [username, setUsername] = useState(usernameProp ?? null);
  const [loadError, setLoadError] = useState(null);

  // write implies propose (write ⊃ propose ⊃ read): both start selected, and
  // the handlers below keep that implication true no matter what gets
  // clicked, rather than letting a click build a grant that means nothing.
  const [propose, setPropose] = useState(true);
  const [write, setWrite] = useState(true);

  const [pending, setPending] = useState(null); // "approve" | "deny" | null
  const [actionError, setActionError] = useState(null);

  // Fetch the client's display name and this session's account -- but only
  // when neither was handed in as a prop. Tests supply both, so this effect
  // is a no-op there and no fetch mock is needed.
  useEffect(() => {
    if (clientProp && usernameProp) return;
    let cancelled = false;
    (async () => {
      try {
        const search = new URLSearchParams(window.location.search);
        const clientId = search.get("client_id");
        const requestedScopes = (search.get("scope") || "").split(" ").filter(Boolean);
        if (!clientId) throw new Error("This link is missing the application it's for.");

        const [session, clientRes] = await Promise.all([
          getSession(),
          // Public fields for any logged-in user -- exactly what a consent
          // screen needs, and nothing a client shouldn't be able to see about
          // itself. Requires the session cookie, which is why this screen
          // only ever follows a sign-in, never precedes one.
          authFetch(`/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`),
        ]);
        if (cancelled) return;
        if (!session) throw new Error("Sign in to continue.");
        if (!clientRes.ok) {
          throw new Error(await readError(clientRes, "Could not load this application."));
        }
        const body = await clientRes.json();
        setClient({ client_name: body.client_name, scopes: requestedScopes });
        setUsername(session.user?.username || session.user?.name || session.user?.email || "");
      } catch (err) {
        if (!cancelled) setLoadError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // clientProp/usernameProp are only ever set once, by a test render -- this
    // effect's job is the opposite case, and it needs to run exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWriteChange = (next) => {
    setWrite(next);
    // Granting direct writes without the ability to propose them is not a
    // narrower permission, it's an incoherent one -- so turning this on always
    // implies the row above it.
    if (next) setPropose(true);
  };

  const onProposeChange = (next) => {
    setPropose(next);
    // The reverse: withdrawing "suggest changes" while "change directly"
    // stays on would leave a grant that writes but can't propose, which
    // means the same thing. Withdraw both together.
    if (!next) setWrite(false);
  };

  const decide = async (accept) => {
    setPending(accept ? "approve" : "deny");
    setActionError(null);
    try {
      const scope = [READ, ...(propose ? [PROPOSE] : []), ...(write ? [WRITE] : [])].join(" ");
      const res = await authFetch("/oauth2/consent", {
        method: "POST",
        body: JSON.stringify({
          accept,
          ...(accept ? { scope } : {}),
          // Sent back byte-for-byte. The server re-derives its signature
          // from this string, so it has to be exactly what arrived in the
          // address bar -- not a value rebuilt parameter by parameter, which
          // would silently reorder or re-encode something and invalidate it.
          oauth_query: window.location.search.replace(/^\?/, ""),
        }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "Could not complete that request."));
      }
      const body = await res.json();
      if (body?.redirect_uri) {
        window.location.assign(body.redirect_uri);
      }
    } catch (err) {
      setActionError(err.message);
      setPending(null);
    }
  };

  if (loadError) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-2 text-center">
          <h1 className="text-lg font-semibold">Could not load this request</h1>
          <p className="text-sm text-muted-foreground">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!client || !username) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">
            <strong>{client.client_name}</strong> wants to connect
          </h1>
          <p className="text-sm text-muted-foreground">
            Signing in as <strong className="text-foreground">{username}</strong>. Not you?{" "}
            <a href="/sign-in" className="underline hover:text-foreground">
              Switch account
            </a>
            .
          </p>
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <ScopeRow
            id="scope-read"
            label="Read your persona"
            help="Always granted -- a connection needs this to do anything."
            checked
            disabled
          />
          <ScopeRow
            id="scope-propose"
            label="Suggest changes for your approval"
            help={
              write
                ? "Included -- you're allowing direct changes below, which needs this too."
                : "Changes wait for you to approve them before they apply."
            }
            checked={propose}
            onCheckedChange={onProposeChange}
          />
          <ScopeRow
            id="scope-write"
            label="Change your persona directly"
            help="Applied immediately, without asking first."
            checked={write}
            onCheckedChange={onWriteChange}
          />
        </div>

        {actionError && <p className="text-xs text-destructive">{actionError}</p>}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={pending !== null}
            onClick={() => decide(false)}
          >
            {pending === "deny" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Deny"}
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={pending !== null}
            onClick={() => decide(true)}
          >
            {pending === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Allow"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ScopeRow({ id, label, help, checked, disabled, onCheckedChange }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5 pr-2">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange ?? (() => {})}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}
