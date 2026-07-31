# OAuth for MCP connections — design

**Status:** draft for review
**Date:** 2026-07-31

Turn the Better Auth service into an OAuth 2.1 authorization server so an MCP
client connects the way the industry expects — click connect, sign in, consent —
instead of being handed a token to paste into a config file.

Takes up the *Deferred — OAuth* section of
[the Better Auth integration design](2026-07-31-better-auth-integration-design.md),
ahead of that document's Phase 4 (MFA) and Phase 5 (sessions), because the
connection experience is what other people actually touch.

---

## Decisions taken

| Question | Answer |
|---|---|
| Authorization server | Better Auth, via `@better-auth/oauth-provider` |
| Resource server | FastAPI's existing middleware, extended — not FastMCP's `RemoteAuthProvider` |
| Opaque tokens | **Kept permanently**, given scopes and an `mg_` prefix. Not deprecated |
| Scopes | `persona:write` ⊃ `persona:propose` ⊃ `persona:read`, hierarchical |
| Minimum grant | `persona:read`, always. A connection that cannot read has nothing to authorise |
| SPA routing | Unchanged — stays on the hash router. Two real paths added, because OAuth requires them |
| Client registration | Open dynamic registration, rate-limited. A compatibility bridge, not the destination |
| Access tokens | JWT, audience-bound to the MCP resource, 10-minute TTL, 30-day rotating refresh |
| Management surface | Connected-apps list with revoke, shipping with the grant |
| `client_credentials` | **Disabled** — it cannot carry a user, so it has no use here |

## What this is not

Not a replacement for the opaque bearer tokens. Those stay, permanently, with a
sharper role than they have today:

> **OAuth is how an application connects. A token is how you script.**

That is the shape GitHub, Stripe, Anthropic, OpenAI and Vercel all ship, and for
the same reason: a cron job has no browser to redirect to and nowhere good to
keep a refresh token. What is genuinely wrong with MyGist's tokens today is not
that they exist — it is that they are the *only* option and they are unscoped.
This design fixes both halves.

---

## Verified against current docs

Six facts this design rests on. Three of them contradict what the documentation
tells you to do, which is why they are written down.

**Better Auth's provider is genuinely spec-grade.** PKCE required, `S256` only
with `plain` rejected, HTTPS-only redirect URIs with localhost exempted, and the
RFC 9207 `iss` parameter on every authorization response including errors — the
MCP spec has that last one at SHOULD and states it expects to raise it to MUST.
Refresh tokens rotate on every refresh, which is what OAuth 2.1 requires for
public clients.

**Audience binding works through RFC 8707.** The `resource` parameter becomes the
JWT `aud` claim, validated against `validAudiences`. This is the mechanism that
satisfies the hardest requirement in the MCP spec: *"MCP servers MUST validate
that access tokens were issued specifically for them as the intended audience."*

**`validAudiences` defaults to `[baseURL]`.** For MyGist that is
`https://…/auth`, while clients will send `resource=https://…/mcp`. Left at the
default, Better Auth throws `invalid_request` and **every connection attempt
fails at the token endpoint**. This is the single most likely way to lose an
afternoon to this feature.

**No `resource` means no JWT.** From `oauth-provider/src/token.ts`: the token is
signed as a JWT only when an audience is present. Omit `resource` and you get an
opaque string carrying no audience at all. The MCP spec makes sending it a MUST,
and a token that cannot be shown to have been issued for us cannot be validated
per the spec — so audience-less tokens are **rejected** rather than given an
introspection fallback. Correct, and less code.

**`sub` is `user?.id` — optional.** In a `client_credentials` grant there is no
user, so the claim is absent. See *Tenant isolation* below; this is why that
grant is disabled outright rather than defended against.

**Dynamic client registration is deprecated by the MCP spec itself**, not merely
by Better Auth's own note on `allowUnauthenticatedClientRegistration`:

> Dynamic Client Registration is **deprecated** and retained for backwards
> compatibility with authorization servers that do not support Client ID
> Metadata Documents.

The successor is Client ID Metadata Documents, where `client_id` is an HTTPS URL
the server fetches — no registration call, no client rows. Better Auth 1.6.23
has no CIMD support. Open DCR ships anyway, because it is the only thing that
makes Claude and ChatGPT connect today, but it is a bridge and this document
says so rather than letting a future reader mistake it for the intended design.

---

## The credential model

Three credentials, kept apart by **audience** rather than by convention:

| Credential | Issued by | `aud` | Valid on | Scoped | Purpose |
|---|---|---|---|---|---|
| Session JWT | `jwt()` plugin, `/auth/token` | `…/auth` | `/api` | no — full | The browser SPA |
| OAuth access token | `/auth/oauth2/token` | `…/mcp` | `/mcp` | yes | Application connections |
| Opaque token `mg_…` | FastAPI, `tokens` table | — | `/mcp`, `/api` | yes (new) | You, scripting |

The audience check does the separating, and it needs no rule of its own — a
session JWT cannot drive MCP and an OAuth token cannot drive the web API, both
because `aud` does not match. Enforcing what the spec already requires happens to
give the isolation for free.

### Request flows

**Application connecting over MCP — new**

```
1. POST /mcp                          no token
   → 401  WWW-Authenticate: Bearer resource_metadata="…", scope="…"
2. GET  /.well-known/oauth-protected-resource/mcp
   → authorization_servers: [https://…/auth]
3. GET  /.well-known/oauth-authorization-server/auth
   → endpoints, scopes_supported
4. POST /auth/oauth2/register         (DCR — until CIMD exists)
5. GET  /auth/oauth2/authorize        + PKCE + resource=https://…/mcp
   → sign in → consent → code + iss
6. POST /auth/oauth2/token            + code_verifier + resource
   → JWT access token (aud=…/mcp, 10m) + rotating refresh token
7. POST /mcp                          Authorization: Bearer <jwt>
```

**Human, browser — unchanged.** **Script with a token — unchanged**, except the
token now carries scopes.

---

## Authorization server

```js
oauthProvider({
  loginPage:   "/sign-in",
  consentPage: "/consent",

  scopes: ["persona:read", "persona:propose", "persona:write", "offline_access"],

  // Without the second entry, every MCP connection 400s at the token endpoint.
  // publicOrigin is BETTER_AUTH_URL, which already holds the public origin --
  // so a self-hoster on another domain gets a correct canonical resource URI
  // with no new configuration.
  validAudiences: [baseURL, `${publicOrigin}/mcp`],

  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true,

  accessTokenExpiresIn:  "10m",
  refreshTokenExpiresIn: "30d",

  rateLimit: {
    register:  { window: 60, max: 5 },
    token:     { window: 60, max: 20 },
    authorize: { window: 60, max: 30 },
  },
})
```

`client_credentials` is not enabled. It mints tokens with no `sub`, and every
persona query in MyGist keys off a user id — so the grant designed for machine
access cannot carry the one claim the system needs. Disabling it removes the
whole class rather than defending against it downstream.

**Scope hierarchy is a MUST**, not a nicety: *"Servers MUST account for scope
hierarchies, where a broader scope implies narrower ones."* So
`persona:write` implies `persona:propose` implies `persona:read`, in one
comparison function with its own tests, not three independent flags checked at
each call site.

---

## Discovery surface

Four documents, all unauthenticated, all registered **before**
`app.mount("/", mcp_app)` — the ordering trap that once made a bare `/docs` 404,
and which will silently swallow every one of these.

| Path | Served by |
|---|---|
| `/.well-known/oauth-protected-resource/mcp` | FastAPI, generated |
| `/.well-known/oauth-protected-resource` | FastAPI, same document |
| `/.well-known/oauth-authorization-server/auth` | Proxied to Node |
| `/.well-known/oauth-authorization-server` | Proxied to Node |

The path-inserted forms are the load-bearing ones. Better Auth sits at basePath
`/auth`, so its issuer is `https://…/auth`, and RFC 8414 clients look for the
metadata at the **root** with the issuer's path appended — a location the
existing `/auth/{path}` proxy cannot reach. Without these routes discovery fails
before anything else is exercised, and the symptom is a client that simply says
it cannot connect.

The bare forms are served too, because clients that fail to parse
`WWW-Authenticate` fall back to them — Better Auth's own MCP documentation calls
this out.

```json
{
  "resource": "https://mygist.thuradev.qzz.io/mcp",
  "authorization_servers": ["https://mygist.thuradev.qzz.io/auth"],
  "scopes_supported": ["persona:read", "persona:propose", "persona:write"],
  "bearer_methods_supported": ["header"]
}
```

**All three scopes are advertised, including `persona:write`.** An earlier draft
omitted it, reading the spec's *"minimal set of scopes necessary for basic
functionality"* as an argument for landing new connections on read-and-suggest
and acquiring write later through step-up authorization. Two things kill that.

The product argument: MyGist's value is a persona that stays current, and what
keeps it current is an assistant writing to it mid-conversation. A default
connection that cannot write does not do the main job. That spec language is
written for multi-tenant SaaS where a connector touches a large API; here the
sole owner is granting access to their own assistant, and the honest minimum for
basic functionality includes writing.

The mechanical argument, which is the stronger one: **the step-up it depended on
cannot fire.** Tool-list filtering (below) means a read-and-propose connection
never sees `persona_modify`, so it never calls it, so no `insufficient_scope` is
ever returned and nothing triggers a re-authorization — the connection stays
narrow silently and forever. Even unfiltered it would not work: MCP step-up is an
HTTP mechanism, a 403 carrying `WWW-Authenticate`, and a per-tool scope failure
happens inside a JSON-RPC response that cannot carry that header. Supporting it
would mean parsing the JSON-RPC body in the middleware to choose a status code —
real complexity in the security-critical path, bought for a default nobody wants.

So the choice moves to the consent screen, where a human is already looking at
the decision. The narrower tiers are still real and still enforced: they are what
a deliberately narrowed grant gets, and what a scoped `mg_` token gets.

`offline_access` is still omitted: *"MCP Servers SHOULD NOT include
`offline_access` in `WWW-Authenticate` scope or Protected Resource Metadata
`scopes_supported`, as refresh tokens are not a resource requirement."* It is
still granted — clients request it themselves.

---

## Resource server

Two layers, because HTTP and JSON-RPC see different things. HTTP knows the
request; only the MCP layer knows which tool is being called.

### FastAPI middleware

The existing shape-based discriminator gains a third branch:

```
mg_ prefix, or bare legacy string  → opaque token: existing path, now scoped
aud == …/mcp                       → OAuth access token: scope + azp claims
aud == …/auth                      → session JWT: valid on /api only
```

Bare unprefixed tokens resolve forever. The prefix makes the discriminator
explicit rather than implicit in a dot count, makes a leaked credential
identifiable in a log, and lets secret scanners match a pattern.

Challenges, per the spec:

| Status | When | Header |
|---|---|---|
| 401 | absent, invalid, or wrong audience | `Bearer resource_metadata="…", scope="persona:read persona:propose persona:write"` |
| 403 | valid token, no `persona:*` scope at all | `Bearer error="insufficient_scope", scope="…", resource_metadata="…"` |

The 403 covers the case HTTP can actually see: a token carrying no persona scope
whatsoever. It is deliberately **not** a per-tool step-up — see the discovery
section for why that mechanism cannot fire here.

A new `current_scopes` contextvar carries the grant inward, mirroring
`current_user_id`. Both credential paths populate it, so every enforcement point
below is written once and never learns which credential it is serving.

### On `/api`, the method is the scope

`GET` requires `persona:read`; every other method requires `persona:write`.

Every `/api` route was checked against this rule: there is no `GET` that writes
and no `POST` that only reads. A method test therefore needs no per-route table,
and so has nothing to drift out of date when a route is added. `persona:propose`
grants nothing extra here — proposing has no API route; it is an MCP-only
capability.

Two carve-outs, both of which already exist in some form:

- The **public route list** is tested first and is unchanged, so
  `/api/auth/register` and `/api/auth/login` never reach a scope check despite
  being `POST`.
- **`/api/auth/whoami`** requires authentication but no scope. It returns a user
  id and username, not persona data, and a client that cannot call it cannot
  tell the user which account it is connected to.

### Account endpoints require `persona:write`, and never an OAuth token

`/api/auth/set-password` and all three `/api/auth/tokens` methods accept a
session JWT or an opaque token carrying `persona:write`. They reject OAuth access
tokens outright, whatever their scope.

This closes a privilege-escalation hole that scoping would otherwise open: today
an opaque token can call `POST /api/auth/tokens`, so a `persona:read` token could
mint itself a full-scope one. A read-only token that can do that is not a
read-only token.

> **Corrected while planning.** An earlier draft made these endpoints
> session-JWT-only. That breaks **detached mode** — `api.js:69` resolves a
> manually configured token ahead of the session, precisely because the UI can
> point at a remote instance where cookie auth cannot apply at all, and because
> pre-Better-Auth accounts still hold a thirty-day token in localStorage. Both
> are supported today. Requiring `persona:write` rather than a session closes the
> same hole without taking either away: legacy tokens are grandfathered to all
> scopes and keep working, while a newly minted read-only token cannot mint its
> way up.

An OAuth-connected application has no business changing your password or minting
bearer tokens, so that rejection is by credential kind, not by scope.

### On `/mcp`, the tool is the scope

| Scope | Tools |
|---|---|
| `persona:read` | `get_context`, `get_raw`, `search_context`, `get_entity`, `get_schema` |
| `persona:propose` | `propose_update` |
| `persona:write` | `persona_modify`, `persona_batch` |

A FastMCP middleware filters `list_tools` by granted scope, so a read-only
connection **does not see** `persona_modify` rather than discovering it and
failing, and rejects out-of-scope calls as a backstop.

One consequence worth stating plainly: `persona:propose` cannot approve its own
proposal. `approve`, `reject` and `promote` are non-`GET`, so they require
`persona:write`. That is what stops propose collapsing into write, and it is now
enforced by the credential rather than by good manners.

---

## Scoped opaque tokens

One column — `tokens.scopes text[]` — defaulting to all three, so **every
existing row grandfathers to today's behaviour**. Tokens already sitting in
config files on other people's machines keep working unchanged, which is the same
constraint that shaped the original Better Auth migration.

New tokens are minted with a scope choice in the UI and carry the `mg_` prefix.
`persona:read` is the floor here too — a token with no scopes is not a narrower
credential, it is a broken one — so the UI offers the same two additions the
consent screen does.

Expiry is untouched: `create_token`'s never-by-default remains right for a
credential configured once.

---

## Tenant isolation

The question this design has to answer is whether an OAuth token can reach
somebody else's persona. It cannot, and the mechanism is the one already
carrying the browser and token paths.

`db.py:42` declares the contextvar with **no default**:

```python
current_user_id: ContextVar[str] = ContextVar("current_user_id")
```

`.get()` therefore raises `LookupError` when unset. A code path that reached
persona data without authenticating crashes rather than quietly serving a `NULL`
user or the previous caller. Every persona query — `persona_store`,
`settings_store`, `proposals_store`, `search_index` — is parameterised on it.
Isolation lives in the SQL, not in a convention.

OAuth introduces no new isolation model. It feeds the same contextvar from the
token's `sub`, which is Better Auth's `user.id`, which *is* `public.users.id` by
the one-id-space property established in the integration design.

Three ways that could stop being true, and what this design does about each:

**A token with no `sub`.** Fails closed today only by luck — `resolve_user_by_id`
refuses to create a missing user, returns `None`, 401. Luck is a poor control.
The verifier **rejects tokens without `sub`**, and `client_credentials` is
disabled so none can be minted.

**Keying on the wrong claim.** The payload carries `sub` (the user) and `azp`
(the client), adjacent in the same object. One client can be authorized by many
users, so keying isolation on `azp` would merge every user of a given client into
one persona. **`azp` is for display and last-used tracking only, never an
identity input.** Scope and identity are independent axes: `persona:write` says
how much, `sub` says whose, and no scope grants cross-user access because no
cross-user query exists.

**Contextvar bleed under concurrency.** The contextvar is `set()` per request and
never `reset()`; safety depends on each ASGI request running in its own copied
context. `requirements.txt` pins Starlette *specifically* for
"contextvar/request.state propagation" behaviour, so this has bitten once
already. Today the exposure is small because the traffic is one person's tokens.
OAuth changes that: several real users, several clients, and FastMCP's streamable
HTTP holding **sessions** across requests. A tool call executing in a context
inherited from session establishment rather than from the current request is a
cross-user data leak with no other symptom.

So this design specifies a test rather than an assurance: **two users, interleaved
concurrent `/mcp` calls, asserting each sees only its own persona.** End-to-end,
not a unit test of the middleware — the failure would live in the seam between
Starlette, FastMCP's session handling and the contextvar, which is exactly where
no unit test looks.

**And the human half.** The consent screen names the account it is about to grant
— *"Claude Desktop wants to read the persona of **liamthura**"* — with a
switch-account path. Someone signed into a second account in the same browser,
authorizing a client they meant to point at their main one, grants the wrong
persona, and no amount of `sub` checking catches that.

---

## Consent and sign-in screens

### Two real paths, and no more

The SPA already has a router — a small hash-based one in `lib/routes.js`, with
the auth screens already on it at `#/signin`, `#/signup`, `#/forgot`. That module
states why it is hash-based, and the reasoning is the same one that put the
`/auth` proxy in FastAPI rather than in platform config:

> a real path like `/profile` would need every unknown URL to serve index.html,
> which is a rule that has to live in FastAPI, in the Dockerfile's static mount,
> and in anything anyone puts in front of it. Hash routing keeps that promise of
> "one upstream, one port" intact.

**The app is not converted to path routing.** No router library, and above all no
catch-all: the MCP app is mounted at `/` and matches everything, so a fallback
would need an exclusion list covering `/mcp`, `/api`, `/auth`, `/docs` and
`/.well-known`, kept in sync by hand. That is the exact shape of the mistake that
once made a bare `/docs` 404.

OAuth forces exactly two exceptions. `/sign-in` and `/consent` must be **real
paths**, because Better Auth redirects to them with query parameters attached,
and parameters appended after a `#` land in the fragment rather than in
`location.search`. Two named routes registered beside `/favicon.svg` create no
fallback rule, so the one-upstream-one-port promise is untouched. They are OAuth
surface, in the same category as `/.well-known/*` — not app navigation, which
stays on the hash.

Both render the **existing** `WelcomeAuth` component. One sign-in
implementation, not two.

### The consent screen

**This screen carries the scope decision**, since protocol-level step-up cannot.
It names the client, names the account, and lists each scope as a separate line
in plain terms:

| Scope | Shown as | Default |
|---|---|---|
| `persona:read` | Read your persona | **always granted, not optional** |
| `persona:propose` | Suggest changes for your approval | pre-selected |
| `persona:write` | Change your persona directly | pre-selected |

`persona:read` is the floor, shown for transparency rather than as a choice. A
connection that cannot read has nothing to authorise — granting it would produce
a client that can write to a persona it cannot see, which is not a narrower
permission but an incoherent one.

The other two are pre-selected because they are what make a connection useful,
and deselectable because that is the whole point of showing them. Because the
scopes are hierarchical, selecting *change directly* implies *suggest* — the UI
shows the implied line as included rather than letting someone construct a grant
that means nothing.

Narrowing here is the supported path to a read-only or propose-only connection.
There is no second flow to discover, and widening later means reconnecting from
the connected-apps list, which the UI should say plainly.

The screen carries the OAuth query parameters across sign-in so an
unauthenticated authorize request survives the round trip. Sign-up from here goes
through the existing invite gate unchanged.

## Connected apps

Settings gains a list: client name, granted scopes, last used (`azp` on incoming
tokens feeds this), and revoke. Revoke calls `/oauth2/delete-consent`, which
kills the refresh token immediately; the live access token dies within ten
minutes, and the UI says exactly that rather than implying an instant cutoff.

`GET /oauth2/get-clients` returns clients a user *owns*, not clients they have
*authorized* — so if no endpoint lists grants, a small plugin endpoint in
`auth.js` queries `oauthConsent` joined to `oauthClient`, in the same shape as the
existing `invitePlugin`.

## Database

Four new tables — `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`,
`oauthConsent` — in the `better_auth` schema, plus `tokens.scopes` in `public`.

Created by **Alembic**, not Better Auth's CLI, keeping the existing rule that one
tool owns the schema. Generated with the existing `schema:generate` script, then
ported into a migration.

---

## Phases

### Phase 1 — authorization server, discovery, consent

Provider configured, tables migrated, four well-known documents reachable, sign-in
and consent screens in the SPA.

*Done when:* MCP Inspector completes a full authorization flow and holds an
access token with the right `aud` and `scope`. Nothing on the Python side has
changed yet.

### Phase 2 — resource server and scoped tokens

Audience-validated OAuth tokens accepted on `/mcp`, scope enforced at both
layers, 401 and 403 challenges correct, `tokens.scopes` added with the `mg_`
prefix, account endpoints tightened to session-only.

*Done when:* a read-only connection can read and cannot write, the concurrency
isolation test passes, and every existing opaque token still works unchanged.

### Phase 3 — connected apps

List and revoke.

### Phase 4 — documentation

Connection instructions, the scope model, and the self-hosting story for the new
root-level well-known routes.

---

## Consequences to accept

**`disabledPaths: ["/token"]` is not applied, against documented advice.** Both
the OAuth-provider and JWT plugin docs instruct it for OAuth compliance.
Following it **breaks the SPA**: `session.js:187` exchanges the session cookie
for a JWT at `/auth/token`, and that JWT is how the browser calls `/api`.

The advice exists so an OAuth client cannot reach a JWT mint that has no client,
no scopes and no audience. Three things make that unreachable here: `/token`
requires a session cookie an MCP client never has; conforming clients read
`token_endpoint` from discovery and go to `/oauth2/token`; and the audience check
stops a session JWT working on `/mcp` regardless.

**Verify first, before anything else is built:** whether `oauth-provider` also
registers a bare `/token` and collides at the route level. If it does, this
decision needs revisiting, and everything downstream of it waits.

**Open DCR is a bridge.** Rate-limited, and kept isolated enough that adding CIMD
later is additive rather than a rewrite.

**Unused client rows accumulate.** Anyone can register. They gain nothing without
an invited human signing in and consenting, but the rows are real. Rate limiting
caps the rate; a cleanup for never-authorized clients is worth having before this
is public.

**`/mcp` stops accepting browser session JWTs.** Verified safe — the SPA never
calls `/mcp`.

**Opaque tokens on `/mcp` are a considered deviation.** The spec says a server
must only accept tokens valid for its own resource and must not accept any
others. MyGist's tokens are its own and are for this resource, and MCP
authorization is OPTIONAL in the first place — but they are not audience-bound
OAuth tokens. Recorded as a compatibility decision, not left for a future reader
to mistake for an oversight.

**A minor version bump touches every existing auth flow.** 1.6.23 → 1.6.25 is
required by the plugin's peer dependency and lands under sign-in, reset,
verification and the invite gate. Full regression run, not a spot check.

**`aud` can be an array.** When `openid` is requested, Better Auth appends the
userinfo endpoint to the audience. The verifier must accept both a string and a
list.

**Scripts that manage tokens with a token break.** The deliberate half of closing
the escalation hole. Worth a release note.

---

## Open questions

1. **Does `oauth-provider` register a bare `/token`?** Decides whether the
   departure above holds. First thing to check.
2. **Does Better Auth serve the path-inserted AS metadata itself**, or must the
   FastAPI proxy map the root path onto whatever path Node actually serves? The
   proxy owns the mapping either way, so this is a lookup, not a risk.
3. **Is there an endpoint listing a user's grants?** If not, a plugin endpoint in
   the `invitePlugin` shape.
4. **Does the device-authorization plugin issue an OAuth access token or a Better
   Auth session?** Only matters if a `mygist login` CLI is ever wanted; parked
   until then.

---

## First step

Phase 1, and within it the `/token` collision check before anything else. If
`oauth-provider` claims that route, the SPA's session-to-JWT exchange is the
casualty, and it is better to find that out in the first hour than after the
consent screen exists.
