# Authentik SSO — design

**Status:** draft for review
**Date:** 2026-08-25

Make Authentik (`https://door.thuradev.qzz.io`) the single identity provider for
MyGist's cloud instance, without taking password sign-in away from anyone who
self-hosts. First step in an estate where every app Liam hosts federates to one
gateway.

---

## Decisions taken

| Question | Answer |
|---|---|
| Plugin | `genericOAuth`, **not** `@better-auth/sso` |
| Gating | `AUTH_OIDC_*` unset → no plugin, no button, no new surface |
| Linking | **Explicit only**, from settings. No auto-linking on email |
| New SSO user | Unknown `sub` → new account → existing onboarding |
| Handle | `preferred_username` at creation, never synced |
| Access control | Authentik **Application binding**, not a check in MyGist |
| Subject mode | User's ID/UUID, identical on every provider |
| Logout | `disableProviderLogout: true` — local only |
| Revocation | Back-channel logout receiver; **browser sessions only** |
| Legacy Python auth | `/api/auth/login` and `/register` 403 when SSO configured |
| Version | Upgrade to 1.7 **first**, on its own branch |

## What this is not

Not a rewrite of authentication. Better Auth still owns human sign-in; the
Python API still owns opaque machine tokens; MCP clients still authenticate
against `/api` and never touch the auth service.

MyGist stays an OAuth **authorization server** for MCP clients while becoming an
OAuth **client** of Authentik. That is not duplication. MyGist owns the scopes
and consent for persona access — Authentik has no business knowing what
`persona:write` means.

Self-hosted instances are untouched. Every behaviour below is gated on
`AUTH_OIDC_DISCOVERY_URL`, the same fail-closed rule `AUTH_MCP_RESOURCE`
already follows.

---

## Verified against current docs and installed code

Nine assumptions, each confirmed rather than assumed.

**Authentik cannot check passwords for us.** The OAuth2 provider supports
authorization code, implicit, hybrid, client credentials, device code, token
exchange and refresh. It does **not** implement Resource Owner Password
Credentials, so "keep the form, authenticate against Authentik" is impossible,
not merely discouraged. ROPC was also removed outright in OAuth 2.1, which the
MCP side of this service already targets. The sign-in form becomes a redirect.

**The docs describe a version we do not have.** `ProviderConfig` in the
installed `better-auth@1.6.25` has no `disableProviderLogout`,
`endSessionEndpoint`, `postLogoutRedirectURI`, `requireIdTokenVerification`,
`validateUserInfo`, `tokenEndpointAuth` or `refreshTokenParams`. All are 1.7+.
This is the reason for Phase 1.

**No route collision.** `@better-auth/oauth-provider` registers twenty
`/oauth2/*` routes; `callback` is not among them. `genericOAuth` adds
`/oauth2/callback/:providerId` and `/sign-in/oauth2` cleanly.

**`mapProfileToUser` runs on every callback**, not only on creation —
`generic-oauth/routes.mjs:212`, before link-or-create is decided. Anything
expensive or stateful in there runs on every sign-in. It stays pure.

**Explicit linking is already implemented.** `/link-social`, `/list-accounts`
and `/unlink-account` exist, and the genericOAuth callback has a dedicated link
branch (`routes.mjs:237-262`) requiring an authenticated session, checking the
email matches, and refusing with `account_already_linked_to_different_user`.

**Authentik defaults `email_verified` to `false`** from 2025.10 onwards, and
**has no email-verified field on the User object** (`username`, `email`, `uid`,
`name`, `is_staff`, `is_active`, `date_joined`, `attributes`, `groups`). So the
claim could only ever be hardcoded, never reported. This is why auto-linking is
rejected below rather than configured around.

**An unbound Authentik Application is open to everyone.** Access exists when
"the user has access defined via policies (or the application has no policies
bound)". Binding is the control; absence of binding is not.

**`public.users.username` is a handle, not a key.** `text unique not null`, and
`persona_data` / `persona_search` foreign-key on `users(id)`. Nothing structural
depends on the handle's value, which is what makes it safe to decouple from the
IdP.

**Invite-only and SSO already coexist without crashing.** An SSO sign-up reaches
`invite.redeem` with no code; `normalise(undefined)` returns `""`,
`CODE_PATTERN` rejects it, and it returns `false` before any query. Harmless —
but see "Invite-only" below.

---

## Phase 1 — upgrade to 1.7

Its own branch, merged before any SSO work starts. No SSO in it.

Bump `better-auth` and `@better-auth/oauth-provider` together — they share a
schema, so they move in lockstep.

Alembic owns MyGist's schema (migration 0003), deliberately, so that one tool
owns it. None of 1.7's schema changes arrive on their own. Each is a
hand-written migration:

| Change | Work |
|---|---|
| Account identity | `issuer` column + compound index on the account table, **plus a backfill** |
| Provider client store | `oauthApplication` → `oauthClient`, plus new token tables, **plus a client-data move** |
| Protected resources, resource-bound tokens, DPoP, refresh reuse window, auth-code replay, back-channel logout columns, requested claims | Additive columns and indexes only |

Not applicable: Drizzle, SCIM, organizations, secondary storage, rate-limit
storage, mobile.

**Exit criterion: a full MCP OAuth regression against a running preview** —
register a client, authorize, consent, token, refresh, revoke-connection — with
an existing registered client surviving the `oauthClient` move. This is the
riskiest part of the whole project and it is not covered by unit tests.

## Phase 2 — SSO

### Authentik side

One OAuth2/OIDC Provider and one Application, slug `mygist`.

- Confidential client, authorization code grant
- **Subject mode: Based on the User's ID (or UUID)** — set identically on every
  provider from here on. Changing it later re-keys every federated account in
  every app.
- Redirect URI: `https://<mygist-host>/auth/oauth2/callback/authentik`
- Scopes: `openid profile email` — Better Auth hard-errors with
  `email_is_missing` if no email comes back
- **Bind a group to the Application.** This is the access control. Verify by
  signing in as a non-bound user and confirming refusal.
- Leave `email_verified` alone. Nothing below depends on it.

### Auth service

Gated block in `auth/src/auth.js`, mirroring the `MCP_RESOURCE` pattern:

```js
const OIDC_DISCOVERY = process.env.AUTH_OIDC_DISCOVERY_URL;

...(OIDC_DISCOVERY ? [genericOAuth({ config: [{
  providerId: "authentik",
  discoveryUrl: OIDC_DISCOVERY,
  clientId: required("AUTH_OIDC_CLIENT_ID"),
  clientSecret: required("AUTH_OIDC_CLIENT_SECRET"),
  scopes: ["openid", "profile", "email"],
  pkce: true,
  requireIdTokenVerification: true,
  disableProviderLogout: true,
  mapProfileToUser: (p) => ({ username: p.preferred_username }),
}] })] : []),
```

One variable for the discovery URL rather than an issuer we then concatenate:
no trailing-slash bug, nothing to get wrong.

`overrideUserInfo` stays at its default `false`. That default is what makes
"the handle is never synced" true rather than hopeful.

**No `accountLinking` config, no `trustedProviders`.** Deliberate — see below.

### The handle

`preferred_username` seeds `username` at creation, and nothing syncs it
afterwards. OIDC's only stable identifier is `sub`; `preferred_username` is a
mutable attribute. Tracking it would drift `public.users` away from the IdP on
any rename — silently, since nothing would error.

The existing provisioning hook's `user.username ?? user.name` fallback becomes
`user.username` with a throw. A null username is impossible once
`mapProfileToUser` exists, and the fallback's real behaviour was to write a
display name — `"Khant Thura"`, space and all — into a column the legacy
`/api/auth/login` treats as a credential.

Three failure modes, all now loud:

| | Before | After |
|---|---|---|
| Claim absent | Writes display name | NOT NULL violation |
| Claim has spaces | Writes it as a credential | Cannot happen; Authentik usernames are handles |
| Handle taken | — | UNIQUE violation |

The unique constraint is the collision handling. **No suffix loop.** A collision
means someone signed in via SSO and did not link to their existing account —
resolving that to `liam-2` would hand them a second, empty account with no
persona data, which reads as "my data is gone". Failing is correct; the fix is
to link, never to rename.

The error copy matters more than the logic here, because the person hitting it
will be Liam at 11pm: *"An account with this username already exists — sign in
with your password and link Authentik from settings."*

### Linking — explicit only

Auto-linking on email match is a known takeover class, and Authentik cannot
truthfully assert verification, so the claim would be a hardcoded lie. Instead:

1. Sign in with a password, as today.
2. Settings → Link Authentik. `POST /auth/link-social`, session cookie required.
   Better Auth binds `sub` to the existing user id.
3. Flip `AUTH_OIDC_*` on.

An unauthenticated Authentik sign-in whose `sub` is unknown creates a genuinely
new account and runs the existing onboarding. It never adopts an existing one.

Settings also gets unlink, backed by `/unlink-account`. Guard: refuse to unlink
the last credential, or the account becomes unreachable.

### Frontend

`WelcomeAuth.jsx`, when `instance.sso`:

- Primary: **"Continue with TDev Door"**. `POST /auth/sign-in/oauth2` returns
  `{url}`; assign `window.location.href`. No client SDK needed —
  `session.js` already hand-rolls `authFetch`.
- Password form hidden behind a **"sign in with a password instead"** link.

That link is not only for the migration window, when Liam must sign in with a
password to reach the link button. It permanently covers anyone with an account
who has not linked yet. One line of UI state, no second env var.

Settings hides "change password" when SSO is configured and the account has no
password credential.

### Session revocation

A back-channel logout receiver in the **Node auth service**, not FastAPI:
it owns the `better_auth` schema and the pool, and reaching into it from a
second language is exactly the drift `db.resolve_user_by_id` was written to keep
visible.

- Unauthenticated endpoint. Verify the logout token against Authentik's JWKS —
  issuer, audience, `events` claim — before trusting anything in it.
- Revoke **browser sessions only** for that user. Opaque API tokens and MCP
  connections are untouched: Authentik sends this on ordinary session end, and
  killing long-lived credentials sitting in config files on other machines would
  break every MCP client with no way to tell them why.
- Configure the URL on the Authentik provider.

An account-disable path that also revokes tokens is a separate mechanism, if it
is ever wanted.

### Legacy Python auth

`POST /api/auth/login` and `POST /api/auth/register` return 403 when
`AUTH_OIDC_DISCOVERY_URL` is set. They are a second password path — `login`
calls `db.verify_password` in Python and mints an opaque token, gated on nothing
but rate limiting. Hiding the form in the SPA would not have stopped a `curl`.

Detached and CLI users sign in through Authentik in the browser and mint a token
from Account → API tokens, which already exists.

### Instance flag

`/api/instance` gains `"sso": bool`, read from the same
`AUTH_OIDC_DISCOVERY_URL` on the API container — the "set it on both" rule
`AUTH_MCP_RESOURCE` already teaches. The SPA already fetches this before showing
the auth screen; no new endpoint.

### Invite-only

Unchanged, and still the gate for email/password sign-ups on any instance.

It does not gate SSO sign-in, because SSO never reaches `/sign-up/email`. On an
SSO instance the Authentik Application binding is the gate — stricter than a
code, since a code can be forwarded and an Authentik account cannot.

**Docs change:** self-hosting and troubleshooting currently say "set
`INVITE_ONLY` on both services". They need a line saying it does not gate SSO
sign-in, or someone turns invite-only on for an SSO instance and believes they
are protected by something that is not running.

---

## Testing

Unit, in the existing `node --test` suite:

- No `AUTH_OIDC_DISCOVERY_URL` → no genericOAuth plugin registered, no `sso` in
  `/api/instance`, legacy Python endpoints still work. Mirrors
  `oauth-flow.test.js`.
- `mapProfileToUser` returns `preferred_username` as `username`.
- Provisioning hook throws on a null username rather than falling back.
- Back-channel receiver rejects an unsigned token, a wrong issuer, and a wrong
  audience.

Manual, against a running preview — none of these are unit-testable:

1. Existing account signs in with password → links Authentik → signs out →
   signs in with Authentik → lands on the **same** account with persona data.
2. New Authentik user signs in → new account, onboarding runs, handle is
   `preferred_username`.
3. Non-bound Authentik user is refused by the Application binding.
4. `user.username` is actually populated in `create.after` for an SSO sign-up.
5. Back-channel logout from Authentik ends the browser session; an MCP client's
   token still works afterwards.
6. **MCP client → `/auth/oauth2/authorize` → not signed in → Authentik → back →
   authorize resumes.** The fiddliest path here: MyGist is an OAuth server and
   an OAuth client in the same request. `callbackURL` must preserve the
   in-flight authorize request.

## Not building

- `@better-auth/sso` — multi-tenant, runtime-registered IdPs, none of which
  exist here.
- Auto-linking on email, `trustedProviders`, an `email_verified` scope mapping,
  a curated verified-email group. All exist only to serve auto-linking.
- Seeding real emails onto `<username>@mygist.invalid` accounts. Same reason.
- A group check inside MyGist. Access policy belongs at the gateway, in one
  place, across the estate. Group claims stay available for *roles inside*
  MyGist, which is a different decision.
- Global sign-out. Local only; a deliberate "sign out everywhere" is a later
  addition if closing one app should ever close all of them.
- Shortening `session.expiresIn` from the seven-day default. Back-channel
  logout revokes on the actual event; a shorter cookie would be belt-and-braces
  for a case already covered.
- `accessType: "offline"`. MyGist never calls Authentik on a user's behalf.
- A configurable button label. It says "TDev Door". Add the variable when a
  second self-hoster wants a different one.
