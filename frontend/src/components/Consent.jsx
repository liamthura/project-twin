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
 *
 * The requested scope is not decoration on this screen, it is the input.
 * Better Auth's `consentEndpoint` takes the `scope` posted below as the
 * AUTHORITATIVE granted set -- it overwrites the authorization query with it --
 * and refuses any value that was not in the original request
 * ("Scope not originally requested"). Two rules follow, and both are load
 * bearing rather than tidy:
 *
 *   1. Anything the client asked for that this screen has no row for is
 *      carried through untouched. `offline_access` is the one that matters:
 *      the token endpoint issues a refresh token only when the GRANTED set
 *      contains it, so dropping it here would silently cap every connection at
 *      one ten-minute access token and re-prompt for consent forever.
 *   2. A scope the client did not ask for is neither offered nor sent. Posting
 *      one back is a 400 with nothing the person at the screen can act on, so
 *      a client that asks only for `persona:read` must see only that row.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { authFetch, getSession } from "@/lib/session.js";
// PERSONA_SCOPES is the three this screen has a row for. Anything else in the
// request -- `offline_access`, `openid` -- is the client's business, not the
// user's, and is passed through rather than decided on.
import { READ, PROPOSE, WRITE, PERSONA_SCOPES } from "@/lib/scopes.js";

async function readError(res, fallback) {
  const body = await res.json().catch(() => ({}));
  return body?.error_description || body?.message || fallback;
}

export default function Consent({ client: clientProp, username: usernameProp } = {}) {
  const [client, setClient] = useState(clientProp ?? null);
  const [username, setUsername] = useState(usernameProp ?? null);
  const [loadError, setLoadError] = useState(null);

  // write implies propose (write ⊃ propose ⊃ read): each starts selected IF
  // the client asked for it, and the handlers below keep that implication true
  // no matter what gets clicked, rather than letting a click build a grant that
  // means nothing. Starting from the request rather than from `true` is what
  // stops a least-privilege client from being handed a form it cannot submit.
  const [propose, setPropose] = useState(() =>
    (clientProp?.scopes ?? []).includes(PROPOSE),
  );
  const [write, setWrite] = useState(() => (clientProp?.scopes ?? []).includes(WRITE));

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
        // Seeded from the request, for the same reason the initial state above
        // is: a toggle for a scope the client never asked for cannot be sent.
        setPropose(requestedScopes.includes(PROPOSE));
        setWrite(requestedScopes.includes(WRITE));
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

  // What the client actually asked for. Everything below is decided against
  // this rather than against the three scopes MyGist happens to define.
  const requested = client?.scopes ?? [];
  const askedRead = requested.includes(READ);
  const askedPropose = requested.includes(PROPOSE);
  const askedWrite = requested.includes(WRITE);
  const carried = requested.filter((scope) => !PERSONA_SCOPES.includes(scope));

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
      // Read is granted whenever it was asked for and never added when it was
      // not -- see the module comment: a scope outside the original request is
      // a 400, not a generosity. `carried` is what keeps offline_access (and so
      // the refresh token) alive.
      const scope = [
        ...(askedRead ? [READ] : []),
        ...(askedPropose && propose ? [PROPOSE] : []),
        ...(askedWrite && write ? [WRITE] : []),
        ...carried,
      ].join(" ");
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

      // `url`, not `redirect_uri`. The consent endpoint answers a non-browser
      // caller with {redirect: true, url} -- for Deny as much as for Allow,
      // since a denial is still a redirect back to the client carrying
      // access_denied. Reading the wrong key meant neither button navigated
      // and neither threw, so the spinner ran forever and the only way out was
      // to close the tab. redirect_uri is accepted too, defensively, because
      // being wrong about this shape once was enough.
      const target = body?.url ?? body?.redirect_uri;
      if (!target) {
        throw new Error(
          "The authorization server did not say where to send you back to. " +
            "Close this tab and start again from the application.",
        );
      }
      window.location.assign(target);
    } catch (err) {
      setActionError(err.message);
      setPending(null);
    }
  };

  if (loadError) {
    return <AuthShell title="Could not load this request" description={loadError} />;
  }

  if (!client || !username) {
    return (
      <AuthShell title="Connecting…" description="Loading the connection request.">
        <div role="status" aria-label="Loading">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      </AuthShell>
    );
  }

  // A request naming none of the three is refused rather than rendered. The
  // alternative -- an empty form whose Allow button grants nothing -- would
  // produce a connection that authenticates and then sees no tools at all,
  // which looks like a MyGist fault and is not one. Read is not silently added
  // back to rescue it: adding a scope the client did not request is exactly
  // what Better Auth rejects, so the honest answer is to say so here.
  if (!askedRead && !askedPropose && !askedWrite) {
    return (
      <AuthShell
        title="Nothing to approve"
        description={
          <>
            <strong>{client.client_name}</strong> asked to connect without
            requesting any access to your persona, so there is nothing to grant.
            Start the connection again from the application.
          </>
        }
      />
    );
  }

  return (
    <AuthShell
      title={
        <>
          <strong>{client.client_name}</strong> wants to connect
        </>
      }
      description={
        <>
          Signing in as <strong className="text-foreground">{username}</strong>. Not you?{" "}
          <a href="/sign-in" className="underline hover:text-foreground">
            Switch account
          </a>
          .
        </>
      }
    >
      <div className="space-y-6 text-left">
        {/* One row per scope the client actually asked for. A row for
            anything else would offer a permission that cannot be granted. */}
        <div className="space-y-4 rounded-lg border p-4">
          {askedRead && (
            <ScopeRow
              id="scope-read"
              label="Read your persona"
              help="Always granted -- a connection needs this to do anything."
              checked
              disabled
            />
          )}
          {askedPropose && (
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
          )}
          {askedWrite && (
            <ScopeRow
              id="scope-write"
              label="Change your persona directly"
              help="Applied immediately, without asking first."
              checked={write}
              onCheckedChange={onWriteChange}
            />
          )}
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
    </AuthShell>
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
