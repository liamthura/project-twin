# Authentik SSO (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Authentik (`https://door.thuradev.qzz.io`) an optional identity provider for MyGist, gated entirely on `AUTH_OIDC_DISCOVERY_URL`, without taking password sign-in away from self-hosters.

**Architecture:** The Node auth service registers Better Auth's `genericOAuth` plugin when `AUTH_OIDC_*` is set. In 1.7 that plugin registers **no endpoints of its own** — it injects a provider into `context.socialProviders`, and the flow rides the core `/sign-in/social`, `/callback/:id` and `/link-social` routes. A back-channel logout receiver lives in the same service, verifying Authentik's logout token against the JWKS the provider already configured. FastAPI gains an `sso` flag on `/api/instance` and 403s its two legacy password endpoints. The SPA gets a redirect button, a linking panel, and nothing else.

**Tech Stack:** better-auth 1.7.1 (`genericOAuth`), `jose` 6.x, node:test, FastAPI, React 18 + Vitest.

---

## Spec corrections — read before Task 1

The spec (`docs/superpowers/specs/2026-08-25-authentik-sso-design.md`) was written against
better-auth **1.6.25**. Five of its statements are wrong against the **1.7.1** now installed.
Each was verified by reading `auth/node_modules/better-auth/dist`. **The plan below is
correct; where it and the spec disagree, the plan governs.**

| Spec says | 1.7.1 actually does | Evidence |
|---|---|---|
| `genericOAuth` adds `/oauth2/callback/:providerId` and `/sign-in/oauth2` | It adds **no endpoints**. Providers ride core `/sign-in/social`, `/callback/:id`, `/link-social` | `plugins/generic-oauth/index.d.mts`: *"Providers are used through the standard `signIn.social` and `callback/:id` core endpoints — no plugin-specific endpoints needed."* |
| Redirect URI is `/auth/oauth2/callback/authentik` | Redirect URI is **`/auth/callback/authentik`** | `oauth2/utils.mjs:29` — `` `/callback/${provider.id}` `` under `ctx.context.baseURL`, which is origin + `/auth` |
| The callback has a link branch requiring an authenticated session | Explicit linking is the core `/link-social` endpoint (`use: [sessionMiddleware]`) | `api/routes/account.mjs:77` |
| Unlink needs a guard against removing the last credential | Core already refuses: `FAILED_TO_UNLINK_LAST_ACCOUNT` | `api/routes/account.mjs:281` |
| "No `accountLinking` config" is enough for explicit-only linking | The callback **does** look up by email and would implicitly link. It refuses only because Authentik reports `email_verified: false` **and** local users are unverified — two contingent facts | `oauth2/link-account.mjs:63` and `:83` |

Two further facts the spec could not know:

- **`account.issuer` for a federated account is Authentik's discovered issuer URL**, e.g.
  `https://door.thuradev.qzz.io/application/o/mygist/` — not `local:oauth:authentik`.
  `plugins/generic-oauth/index.mjs:143` resolves `accountIssuer ?? issuer`, where `issuer`
  is `discovered.issuer`. This is what makes the back-channel receiver's lookup work: the
  logout token's `iss` claim **is** the stored `account.issuer`.

- **`genericOAuth`'s `init` fetches the discovery document at boot and throws if it fails**
  (`index.mjs:96`, `:118`, `:121`). `preflight.js` awaits `auth.$context`, so **the auth
  container will not start while Authentik is unreachable** — including for password
  sign-in. This is accepted, not worked around: the alternatives are dropping
  `requireIdTokenVerification` (weakens ID-token verification) or booting with SSO silently
  disabled (a security feature that turns itself off is worse than one that fails loudly).
  Task 2 makes the failure legible in the deploy log instead.

## Global Constraints

- **Every behaviour in this plan is gated on `AUTH_OIDC_DISCOVERY_URL`.** Unset: no plugin, no button, no new endpoint, no new field value. Same fail-closed rule `AUTH_MCP_RESOURCE` already follows.
- Provider id is exactly `authentik`. Button label is exactly `TDev Door`. Neither is configurable — see the spec's "Not building".
- **Explicit linking only.** No auto-linking on email, no `trustedProviders`, no `email_verified` scope mapping.
- `overrideUserInfo` stays at its default `false`. The handle is seeded once and never synced.
- `disableProviderLogout: true`. Sign-out is local only.
- Back-channel logout revokes **browser sessions only**. Opaque API tokens and MCP connections are untouched.
- Alembic owns all DDL. **This phase needs no migration** — `genericOAuth` stores federated accounts in the existing `better_auth.account` table, and the receiver creates nothing.
- **Never use `@better-auth/cli`** — see `docs/superpowers/plans/notes/README.md`. It hard-pins better-auth 1.4.22 and emits a silently stale core schema.
- `AUTH_OIDC_*` must be added to **both** `backend/docker-compose.yml` (auth service) and `scripts/local-preview.sh` (API container), the same "set it on both" rule `AUTH_MCP_RESOURCE` teaches.
- Auth service tests: `cd auth && npm test` (node:test). Backend: `cd backend && pytest`. Frontend: `cd frontend && npx vitest run`.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `auth/src/sso.js` | Everything gated on `AUTH_OIDC_*`: the gate, the `genericOAuth` config, the profile mapping, the username guard, and the back-channel logout plugin. One file because these all come and go together and all read the same variables — the shape `oauth.js` already established. |
| `auth/src/sso.test.js` | Unit tests for all of the above. No network: the logout-token tests sign against a locally generated key pair. |
| `auth/src/auth-config.test.js` | Decisions asserted against the assembled Better Auth config. Its own file because importing `auth.js` opens a pool that has to be closed, and `node --test` hangs if it is not. |
| `frontend/src/components/LinkedAccounts.jsx` | The link/unlink panel. Presentational plus its two actions; the fetch belongs to `AccountPanel`, which needs the same data to decide whether to offer a password change. |
| `frontend/src/components/LinkedAccounts.test.jsx` | Its tests. |

**Modified**

| File | Change |
|---|---|
| `auth/src/auth.js` | Register the SSO plugins; `disableImplicitLinking`; provisioning hook uses `usernameFor` |
| `auth/src/server.js` | Preflight failure copy names `AUTH_OIDC_DISCOVERY_URL` |
| `auth/package.json` | Declare `jose` |
| `auth/.env.example` | Document the three variables |
| `backend/main.py` | `sso` on `/api/instance`; 403 on the two legacy password endpoints |
| `backend/docker-compose.yml`, `scripts/local-preview.sh` | Env plumbing, both containers |
| `frontend/src/lib/session.js` | `signInWithSso`, `linkSso`, `listAccounts`, `unlinkAccount` |
| `frontend/src/lib/api.js` | `getInstance`'s offline fallback names `sso` |
| `frontend/src/components/WelcomeAuth.jsx` | The button, the password-instead link, the error banner |
| `frontend/src/components/settings/AccountPanel.jsx` | Mount `LinkedAccounts`; hide password change when SSO and no credential |
| `docs-site/content/docs/run/self-hosting.mdx`, `troubleshooting.mdx` | The three variables, and that invite-only does not gate SSO |

---

### Task 1: The SSO module — gate, config, and the username guard

**Files:**
- Create: `auth/src/sso.js`
- Create: `auth/src/sso.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, for Tasks 2 and 3:
  - `PROVIDER_ID: "authentik"` (string constant)
  - `ssoDiscoveryUrl(env?: object) => string` — trimmed value, `""` when unset
  - `ssoConfig(env?: object) => GenericOAuthConfig` — throws if a required var is missing
  - `ssoPlugins(env?: object) => BetterAuthPlugin[]` — `[]` when the gate is closed
  - `mapProfileToUser(profile: object) => { username: string | undefined }`
  - `usernameFor(user: object) => string` — throws with actionable copy when absent

- [ ] **Step 1: Write the failing test**

Create `auth/src/sso.test.js`:

```js
/**
 * The SSO module, tested without a network and without a database.
 *
 * `genericOAuth`'s own init fetches the discovery document, so anything that
 * builds a live plugin needs Authentik reachable. Everything here therefore
 * tests the CONFIG we hand it, which is the part we actually author -- the
 * same split oauth.test.js makes for the OAuth provider plugin.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PROVIDER_ID,
  mapProfileToUser,
  ssoConfig,
  ssoDiscoveryUrl,
  ssoPlugins,
  usernameFor,
} from "./sso.js";

const ENV = {
  AUTH_OIDC_DISCOVERY_URL:
    "https://door.thuradev.qzz.io/application/o/mygist/.well-known/openid-configuration",
  AUTH_OIDC_CLIENT_ID: "mygist-client-id",
  AUTH_OIDC_CLIENT_SECRET: "mygist-client-secret",
};

test("the whole SSO surface is gated on AUTH_OIDC_DISCOVERY_URL", () => {
  // Unset, a self-hosted instance gains no provider, no callback route and no
  // new way in -- the same fail-closed rule AUTH_MCP_RESOURCE follows.
  assert.equal(ssoDiscoveryUrl({}), "");
  assert.equal(ssoDiscoveryUrl({ AUTH_OIDC_DISCOVERY_URL: "  " }), "");
  assert.deepEqual(ssoPlugins({}), []);
  assert.equal(ssoDiscoveryUrl(ENV), ENV.AUTH_OIDC_DISCOVERY_URL);
});

test("a discovery URL without credentials fails at boot, not at first sign-in", () => {
  // Half-configured is the dangerous state: the button appears and every press
  // fails in a browser redirect, where nobody can read the reason.
  assert.throws(
    () => ssoConfig({ AUTH_OIDC_DISCOVERY_URL: ENV.AUTH_OIDC_DISCOVERY_URL }),
    /AUTH_OIDC_CLIENT_ID is required/,
  );
  assert.throws(
    () =>
      ssoConfig({
        AUTH_OIDC_DISCOVERY_URL: ENV.AUTH_OIDC_DISCOVERY_URL,
        AUTH_OIDC_CLIENT_ID: "id",
      }),
    /AUTH_OIDC_CLIENT_SECRET is required/,
  );
});

test("the provider config says exactly what the design decided", () => {
  const config = ssoConfig(ENV);

  assert.equal(config.providerId, PROVIDER_ID);
  assert.equal(config.discoveryUrl, ENV.AUTH_OIDC_DISCOVERY_URL);
  assert.equal(config.clientId, ENV.AUTH_OIDC_CLIENT_ID);
  assert.equal(config.clientSecret, ENV.AUTH_OIDC_CLIENT_SECRET);

  // Better Auth hard-errors with `email_is_missing` without the email scope.
  assert.deepEqual(config.scopes, ["openid", "profile", "email"]);

  assert.equal(config.pkce, true);
  assert.equal(config.requireIdTokenVerification, true);
  assert.equal(config.disableProviderLogout, true);

  // Left at its default `false`. This is what makes "the handle is never
  // synced" true rather than hopeful, so it is asserted as absent -- it is
  // this file NOT setting it that is the decision.
  assert.equal(config.overrideUserInfo, undefined);

  // No accountIssuer: the discovered issuer is the account namespace, and
  // overriding it would re-key every federated account.
  assert.equal(config.accountIssuer, undefined);
});

test("the handle comes from preferred_username and nothing else", () => {
  assert.deepEqual(mapProfileToUser({ preferred_username: "liam" }), {
    username: "liam",
  });

  // `name` is a display name -- "Khant Thura", space and all -- and
  // public.users.username is treated as a credential by the legacy
  // /api/auth/login. Falling back to it writes a space into a credential.
  assert.deepEqual(mapProfileToUser({ name: "Khant Thura" }), {
    username: undefined,
  });
});

test("mapProfileToUser is pure -- it runs on EVERY callback, not just creation", () => {
  const profile = { preferred_username: "liam", sub: "abc" };
  const frozen = Object.freeze({ ...profile });
  mapProfileToUser(frozen);
  assert.deepEqual(frozen, profile);
});

test("provisioning refuses to invent a username", () => {
  assert.equal(usernameFor({ username: "liam" }), "liam");
  assert.equal(usernameFor({ username: "  liam  " }), "liam");

  // The old fallback was `user.username ?? user.name`, which quietly wrote a
  // display name into a credential column. Loud is the fix.
  assert.throws(() => usernameFor({ name: "Khant Thura" }), /preferred_username/);
  assert.throws(() => usernameFor({ username: "   " }), /preferred_username/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd auth && node --test src/sso.test.js`
Expected: FAIL — `Cannot find module './sso.js'`

- [ ] **Step 3: Write the implementation**

Create `auth/src/sso.js`:

```js
/**
 * MyGist as an OAuth CLIENT of an OIDC provider.
 *
 * The mirror image of oauth.js, which makes MyGist an authorization SERVER for
 * MCP clients. Both are true at once and neither is duplication: MyGist owns
 * the scopes and consent for persona access -- Authentik has no business
 * knowing what `persona:write` means -- while Authentik owns who the person is.
 *
 * Everything here is gated on AUTH_OIDC_DISCOVERY_URL, the same fail-closed
 * rule AUTH_MCP_RESOURCE follows in oauth.js. A self-hosted instance that never
 * asked for federated sign-in does not acquire one by upgrading.
 *
 * NO ENDPOINTS OF ITS OWN, and none from genericOAuth either. That changed in
 * 1.7: the plugin now injects a provider into `context.socialProviders` and the
 * flow rides the CORE routes -- /sign-in/social, /callback/:id, /link-social.
 * The redirect URI Authentik must be given is therefore
 * `<origin>/auth/callback/authentik`, with no `oauth2` segment in it.
 */
import { genericOAuth } from "better-auth/plugins/generic-oauth";

/** Matches the Application slug on Authentik, and the `providerId` stored on
 *  every federated account row. Changing it re-keys every linked account. */
export const PROVIDER_ID = "authentik";

const required = (env, name) => {
  const value = (env[name] || "").trim();
  if (!value) {
    // Same rule as auth.js: fail at boot rather than at first sign-in. A
    // half-configured provider shows the button and fails inside a browser
    // redirect, which is the least reachable place to put a reason.
    throw new Error(`${name} is required when AUTH_OIDC_DISCOVERY_URL is set`);
  }
  return value;
};

/** The gate. Empty string when SSO is not configured. */
export function ssoDiscoveryUrl(env = process.env) {
  return (env.AUTH_OIDC_DISCOVERY_URL || "").trim();
}

/**
 * The handle, at creation only.
 *
 * OIDC's one stable identifier is `sub`; `preferred_username` is a mutable
 * attribute. Tracking it would drift public.users away from the IdP on any
 * rename -- silently, since nothing would error. `overrideUserInfo` is left at
 * its default `false` for exactly that reason.
 *
 * Pure, and it has to be: this runs on EVERY callback, before link-or-create is
 * decided, not only when an account is made.
 */
export function mapProfileToUser(profile) {
  const handle = profile?.preferred_username;
  return { username: typeof handle === "string" ? handle : undefined };
}

/**
 * The username the provisioning hook writes into public.users.
 *
 * Replaces `user.username ?? user.name`. That fallback's real behaviour was to
 * write a DISPLAY name -- "Khant Thura", space and all -- into a column the
 * legacy /api/auth/login treats as a credential. There is no correct value to
 * invent here, so there is no fallback.
 *
 * The unique constraint on public.users.username is the collision handling, and
 * deliberately so. Resolving a clash to `liam-2` would hand someone a second,
 * empty account with no persona data, which reads as "my data is gone". Failing
 * is correct; the fix is to link, never to rename.
 */
export function usernameFor(user) {
  const username = typeof user?.username === "string" ? user.username.trim() : "";
  if (!username) {
    throw new Error(
      "Cannot provision an account with no username. An SSO sign-in must " +
        "supply preferred_username -- check the Authentik provider's scope " +
        "mappings include `profile`.",
    );
  }
  return username;
}

/** The GenericOAuthConfig, separated from the plugin so it can be asserted
 *  without a network: genericOAuth's own init fetches the discovery document. */
export function ssoConfig(env = process.env) {
  return {
    providerId: PROVIDER_ID,

    // One variable for the whole document rather than an issuer we concatenate
    // onto: no trailing-slash bug, nothing to get wrong.
    discoveryUrl: ssoDiscoveryUrl(env),

    clientId: required(env, "AUTH_OIDC_CLIENT_ID"),
    clientSecret: required(env, "AUTH_OIDC_CLIENT_SECRET"),

    // `email` is not optional: Better Auth hard-errors with `email_is_missing`
    // if the callback returns no address.
    scopes: ["openid", "profile", "email"],

    // Both are 1.7 defaults; stated anyway because they are decisions rather
    // than accidents, and a default that changes should break a test here
    // rather than a sign-in in production.
    pkce: true,

    // Refuses to register the provider at all unless discovery yields an issuer
    // AND a jwks_uri. Without it, an incomplete discovery document silently
    // downgrades to unverified token decoding.
    requireIdTokenVerification: true,

    // Signing out of MyGist does not sign you out of Authentik. Global sign-out
    // is a separate, deliberate feature if closing one app should ever close
    // all of them.
    disableProviderLogout: true,

    mapProfileToUser,
  };
}

/** The plugin list -- empty, and therefore inert, when the gate is closed. */
export function ssoPlugins(env = process.env) {
  if (!ssoDiscoveryUrl(env)) return [];
  return [genericOAuth({ config: [ssoConfig(env)] })];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd auth && node --test src/sso.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Run the whole auth suite for regressions**

Run: `cd auth && npm test`
Expected: PASS — the pre-existing 56 tests plus these 6

- [ ] **Step 6: Commit**

```bash
git add auth/src/sso.js auth/src/sso.test.js
git commit -m "feat(auth): the Authentik provider config, gated on AUTH_OIDC_DISCOVERY_URL"
```

---

### Task 2: Register the provider, and make provisioning loud

**Files:**
- Modify: `auth/src/auth.js`
- Modify: `auth/src/server.js`
- Modify: `auth/.env.example`
- Modify: `backend/docker-compose.yml`
- Modify: `scripts/local-preview.sh`
- Create: `auth/src/auth-config.test.js`

**Interfaces:**
- Consumes: `ssoPlugins`, `ssoDiscoveryUrl`, `usernameFor` from `auth/src/sso.js` (Task 1).
- Produces: nothing new for later tasks. After this task, `POST /auth/sign-in/social {"provider":"authentik"}` returns a redirect URL when `AUTH_OIDC_*` is set.

- [ ] **Step 1: Write the failing test**

Create `auth/src/auth-config.test.js`. Its own file, not an append to `sso.test.js`:
importing `auth.js` opens a `pg.Pool` that has to be closed or `node --test` never exits,
and a whole file is the honest place to own that lifecycle.

```js
/**
 * Decisions asserted against the assembled Better Auth config.
 *
 * Its own file because importing auth.js opens a connection pool. Nothing here
 * ever queries -- `new Pool()` does not dial until something does -- but the
 * pool still has to be closed or `node --test` hangs at the end of the run.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

// auth.js reads all of these at module scope. The database URL is never
// connected to; it only has to parse. AUTH_OIDC_DISCOVERY_URL is deliberately
// NOT set: genericOAuth's init would try to reach the identity provider.
process.env.BETTER_AUTH_URL = "http://localhost:3999";
process.env.BETTER_AUTH_SECRET = "config-test-secret-at-least-32-characters";
process.env.DATABASE_URL = "postgres://mygist:mygist@localhost:5433/mygist_test";
delete process.env.AUTH_OIDC_DISCOVERY_URL;

const { auth, pool } = await import("./auth.js");

after(async () => {
  await pool.end();
});

test("implicit linking is switched off explicitly, not left to luck", async () => {
  // The 1.7 callback DOES look up an existing user by email
  // (oauth2/link-account.mjs:63) and would link the account to it. Today it
  // refuses only because Authentik reports email_verified:false AND MyGist's
  // seeded accounts are unverified -- two contingent facts, either of which
  // could change without anyone connecting the change to a takeover.
  //
  // Auto-linking on an unverifiable email claim is a known takeover class, so
  // "explicit only" is configured rather than inferred. It does not touch
  // /link-social: that path sets `selectedUser`, which skips the guard.
  const { auth } = await import("./auth.js");
  assert.equal(
    auth.options.account.accountLinking.disableImplicitLinking,
    true,
  );
});

test("no discovery URL means no provider and no receiver", () => {
  // The gate, asserted on the assembled config rather than on ssoPlugins in
  // isolation: this is the thing that actually decides whether a self-hosted
  // instance grows a federated sign-in surface by upgrading.
  const ids = auth.options.plugins.map((p) => p.id);
  assert.ok(!ids.includes("generic-oauth"));
  assert.ok(!ids.includes("mygist-sso-logout"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd auth && node --test src/auth-config.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'accountLinking')`

- [ ] **Step 3: Register the plugin and the linking policy in `auth.js`**

Add to the imports, beside the existing `./oauth.js` import:

```js
import { ssoDiscoveryUrl, ssoPlugins, usernameFor } from "./sso.js";
```

Add below the `MCP_RESOURCE` constant:

```js
// The OIDC provider this instance federates to, and the switch for the whole
// SSO surface. Same fail-closed rule as MCP_RESOURCE above -- see sso.js.
const OIDC_DISCOVERY = ssoDiscoveryUrl();
```

Add a top-level `account` option to the `betterAuth({...})` call, immediately after
the `advanced: {...}` block:

```js
  account: {
    accountLinking: {
      // Explicit only. Better Auth's callback looks an existing user up by
      // email and links to it, refusing today only because Authentik reports
      // `email_verified: false` and MyGist's seeded accounts are unverified.
      // Both are contingent; auto-linking on an email a provider cannot
      // truthfully assert is a known takeover class, so the decision is
      // configured rather than inferred from a default.
      //
      // /link-social is unaffected -- it passes `selectedUser`, which skips
      // this guard entirely. That is the whole point: linking stays possible,
      // and stays something a signed-in person chooses.
      disableImplicitLinking: true,
    },
  },
```

Replace the provisioning hook's insert parameters. Find:

```js
            [user.id, user.username ?? user.name],
```

Replace with:

```js
            // No fallback to user.name. See usernameFor in sso.js: the old
            // fallback wrote a display name into a column the legacy
            // /api/auth/login treats as a credential.
            [user.id, usernameFor(user)],
```

Add the plugins. In the `plugins: [...]` array, immediately before `invitePlugin()`:

```js
    // Sign in with Authentik. Inert unless AUTH_OIDC_DISCOVERY_URL is set.
    //
    // Registers NO endpoints -- that changed in 1.7. The plugin injects a
    // provider into context.socialProviders and the flow rides the core routes:
    // /sign-in/social, /callback/authentik, /link-social. The redirect URI to
    // configure on Authentik is therefore <origin>/auth/callback/authentik,
    // with no `oauth2` segment in it.
    //
    // Its init FETCHES the discovery document, so this service will not boot
    // while Authentik is unreachable. Deliberate: the alternatives are dropping
    // ID-token verification, or booting with SSO quietly off. A security
    // feature that disables itself is worse than one that fails in the deploy
    // log, which is where someone is already looking.
    ...ssoPlugins(),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd auth && node --test src/auth-config.test.js`
Expected: PASS, 2 tests

- [ ] **Step 5: Name the new variable in the preflight failure copy**

In `auth/src/server.js`, the catch block lists what can throw before preflight reaches a
verdict. Find:

```js
      "    - Awaiting the OAuth plugin's startup, which the client backfill\n" +
      "      has to do before it can link anything. A plugin misconfiguration\n" +
      "      -- AUTH_MCP_RESOURCE that is not an absolute URI, above all --\n" +
      "      arrives here rather than at the first request, which is the\n" +
      "      point of it arriving here at all.\n",
```

Replace with:

```js
      "    - Awaiting the OAuth plugin's startup, which the client backfill\n" +
      "      has to do before it can link anything. A plugin misconfiguration\n" +
      "      -- AUTH_MCP_RESOURCE that is not an absolute URI, above all --\n" +
      "      arrives here rather than at the first request, which is the\n" +
      "      point of it arriving here at all.\n" +
      "    - Fetching AUTH_OIDC_DISCOVERY_URL, which the Authentik provider\n" +
      "      does at startup. This service does NOT boot while the identity\n" +
      "      provider is unreachable, by design. Check that the URL resolves\n" +
      "      from inside this container and returns an `issuer` and a\n" +
      "      `jwks_uri`; a document missing either is refused, because\n" +
      "      accepting it would downgrade ID tokens to unverified decoding.\n",
```

- [ ] **Step 6: Plumb the three variables into the auth container**

In `backend/docker-compose.yml`, in the `auth` service's `environment:` list, after the
`AUTH_MCP_RESOURCE` line:

```yaml
      # Federated sign-in. All three or none: a discovery URL without
      # credentials refuses to boot rather than showing a button that fails
      # inside a browser redirect. Empty by default, so a self-hosted instance
      # keeps password sign-in and gains no new surface.
      #
      # This container FETCHES the discovery URL at startup and will not boot
      # while it is unreachable, which is deliberate -- see auth/src/sso.js.
      - AUTH_OIDC_DISCOVERY_URL=${AUTH_OIDC_DISCOVERY_URL:-}
      - AUTH_OIDC_CLIENT_ID=${AUTH_OIDC_CLIENT_ID:-}
      - AUTH_OIDC_CLIENT_SECRET=${AUTH_OIDC_CLIENT_SECRET:-}
```

- [ ] **Step 7: Plumb the gate into the API container**

In `scripts/local-preview.sh`, after the `-e AUTH_MCP_RESOURCE=...` line and before
`"$IMAGE" >/dev/null`:

```bash
  `# The API needs only the gate, never the credentials: all it does with it` \
  `# is answer "sso": true on /api/instance, which is what makes the SPA show` \
  `# the button. Set on both containers or on neither -- the same rule` \
  `# AUTH_MCP_RESOURCE follows. Set here alone, the button appears and every` \
  `# press 404s; set on the auth service alone, SSO works but is invisible.` \
  -e AUTH_OIDC_DISCOVERY_URL="${AUTH_OIDC_DISCOVERY_URL:-}" \
```

- [ ] **Step 8: Document the variables**

Append to `auth/.env.example`:

```sh
# ---------------------------------------------------------------------------
# Federated sign-in (optional)
# ---------------------------------------------------------------------------
# Set all three, or none. A discovery URL without credentials refuses to boot.
#
# Unset, this service registers no provider, the SPA shows no button, and
# password sign-in is the only way in -- which is what every self-hosted
# instance runs.
#
# On the identity provider, the redirect URI to register is:
#
#     <your public origin>/auth/callback/authentik
#
# Note: no `oauth2` segment. Better Auth 1.7 serves federated callbacks on its
# core /callback/:providerId route.
#
# Also set AUTH_OIDC_DISCOVERY_URL (the URL only, never the secret) on the API
# container, or the button never appears. See docs/run/self-hosting.
#
# This service fetches the discovery document at startup and will NOT boot while
# it is unreachable. That is deliberate: booting with SSO quietly disabled is
# worse than failing where the deploy log can show why.
#
# AUTH_OIDC_DISCOVERY_URL=https://door.example.com/application/o/mygist/.well-known/openid-configuration
# AUTH_OIDC_CLIENT_ID=
# AUTH_OIDC_CLIENT_SECRET=
```

- [ ] **Step 9: Run the whole auth suite**

Run: `cd auth && npm test`
Expected: PASS, no regressions. `oauth-flow.test.js` in particular must still pass —
it boots a real service, and `usernameFor` now runs in its sign-up path.

- [ ] **Step 10: Commit**

```bash
git add auth/src/auth.js auth/src/server.js auth/src/auth-config.test.js auth/.env.example \
        backend/docker-compose.yml scripts/local-preview.sh
git commit -m "feat(auth): register the Authentik provider, and refuse to invent a username"
```

---

### Task 3: Back-channel logout receiver

**Files:**
- Modify: `auth/src/sso.js`
- Modify: `auth/src/auth.js`
- Modify: `auth/package.json`
- Test: `auth/src/sso.test.js` (append)

**Interfaces:**
- Consumes: `PROVIDER_ID`, `ssoDiscoveryUrl` from `auth/src/sso.js`.
- Produces:
  - `LOGOUT_EVENT: "http://schemas.openid.net/event/backchannel-logout"`
  - `verifyLogoutToken(provider, token) => Promise<{ sub: string }>` — throws on any failure
  - `backchannelLogoutPlugin() => BetterAuthPlugin` — serves `POST /backchannel-logout`
- Public URL of the receiver, to configure on Authentik: `<origin>/auth/backchannel-logout`

**Why this lives in the Node service, not FastAPI:** it owns the `better_auth` schema and
the pool. Reaching into that schema from a second language is exactly the drift
`db.resolve_user_by_id` was written to keep visible.

**Why it needs no new configuration:** the expected issuer, audience, algorithms and JWKS
are read off the provider `genericOAuth` already built (`index.mjs:104-118`). One source of
truth, no second discovery fetch, and the receiver cannot drift from the sign-in path.

- [ ] **Step 1: Declare `jose`**

It is already installed as a transitive dependency of better-auth (6.2.10) and is what
better-auth itself uses for JWKS. Declaring it makes the import legal rather than lucky.

In `auth/package.json`, add to `dependencies`, keeping the list alphabetical:

```json
    "jose": "^6.2.10",
```

Run: `cd auth && npm install`
Expected: `package-lock.json` updated, `jose` promoted to a direct dependency.

- [ ] **Step 2: Write the failing test**

In `auth/src/sso.test.js`, extend the two existing import statements at the **top** of the
file — ES imports hoist, so an import beside the tests below would work, but it would also
be the only one in the codebase that does:

```js
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

import {
  LOGOUT_EVENT,
  PROVIDER_ID,
  mapProfileToUser,
  ssoConfig,
  ssoDiscoveryUrl,
  ssoPlugins,
  usernameFor,
  verifyLogoutToken,
} from "./sso.js";
```

Then append the tests themselves:

```js
// ---------------------------------------------------------------------------
// Back-channel logout
// ---------------------------------------------------------------------------

const ISSUER = "https://door.thuradev.qzz.io/application/o/mygist/";
const AUDIENCE = "mygist-client-id";

/** A provider shaped exactly as genericOAuth builds one, but with a LOCAL key
 *  set -- so these tests never touch the network and never need Authentik. */
async function localProvider() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  return {
    privateKey,
    provider: {
      id: PROVIDER_ID,
      idToken: {
        jwks: createLocalJWKSet({ keys: [jwk] }),
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ["RS256"],
      },
    },
  };
}

async function logoutToken(privateKey, claims = {}) {
  return new SignJWT({
    events: { [LOGOUT_EVENT]: {} },
    sub: "authentik-user-uuid",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setJti("unique-token-id")
    .sign(privateKey);
}

test("a well-formed logout token names the subject to sign out", async () => {
  const { privateKey, provider } = await localProvider();
  const claims = await verifyLogoutToken(provider, await logoutToken(privateKey));
  assert.equal(claims.sub, "authentik-user-uuid");
});

test("an unsigned token is refused", async () => {
  const { provider } = await localProvider();
  // alg:none, the oldest JWT trick there is.
  const unsigned =
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url") +
    "." +
    Buffer.from(
      JSON.stringify({ iss: ISSUER, aud: AUDIENCE, sub: "x" }),
    ).toString("base64url") +
    ".";
  await assert.rejects(() => verifyLogoutToken(provider, unsigned));
});

test("a token from the wrong issuer is refused", async () => {
  const { privateKey, provider } = await localProvider();
  const token = await new SignJWT({
    events: { [LOGOUT_EVENT]: {} },
    sub: "authentik-user-uuid",
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer("https://evil.example/")
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .sign(privateKey);
  await assert.rejects(() => verifyLogoutToken(provider, token));
});

test("a token for a different audience is refused", async () => {
  const { privateKey, provider } = await localProvider();
  const token = await new SignJWT({
    events: { [LOGOUT_EVENT]: {} },
    sub: "authentik-user-uuid",
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience("some-other-app")
    .setIssuedAt()
    .sign(privateKey);
  await assert.rejects(() => verifyLogoutToken(provider, token));
});

test("an ID token replayed as a logout token is refused", async () => {
  // OIDC Back-Channel Logout 1.0 section 2.4: a logout token MUST carry the
  // logout event and MUST NOT carry a nonce. Without both checks, an id_token
  // captured from an ordinary sign-in ends that person's session on demand.
  const { privateKey, provider } = await localProvider();

  const noEvent = await new SignJWT({ sub: "authentik-user-uuid" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .sign(privateKey);
  await assert.rejects(() => verifyLogoutToken(provider, noEvent), /event/i);

  const withNonce = await logoutToken(privateKey, { nonce: "abc" });
  await assert.rejects(() => verifyLogoutToken(provider, withNonce), /nonce/i);
});

test("a logout token with no subject is refused", async () => {
  // MyGist revokes by user, so a sid-only token names nobody it can act on.
  // Accepting it and doing nothing would report success for a logout that
  // never happened.
  const { privateKey, provider } = await localProvider();
  const token = await new SignJWT({ events: { [LOGOUT_EVENT]: {} } })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .sign(privateKey);
  await assert.rejects(() => verifyLogoutToken(provider, token), /sub/i);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd auth && node --test src/sso.test.js`
Expected: FAIL — `LOGOUT_EVENT` and `verifyLogoutToken` are not exported

- [ ] **Step 4: Write the implementation**

Add to `auth/src/sso.js`'s imports:

```js
import { APIError, createAuthEndpoint } from "better-auth/api";
import { jwtVerify } from "jose";
```

Append to `auth/src/sso.js`:

```js
// ---------------------------------------------------------------------------
// Back-channel logout
// ---------------------------------------------------------------------------

/** OIDC Back-Channel Logout 1.0, section 2.4. */
export const LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

/**
 * The configured provider, from Better Auth's own context.
 *
 * Mirrors `getAwaitableValue` in context/helpers.mjs: entries may be plain
 * objects or thunks. Read rather than rebuilt so the receiver cannot drift from
 * the sign-in path -- the issuer, audience, algorithms and JWKS below are the
 * exact ones genericOAuth discovered at boot.
 */
async function findProvider(context, id) {
  for (const entry of context?.socialProviders ?? []) {
    const provider = typeof entry === "function" ? await entry() : entry;
    if (provider?.id === id) return provider;
  }
  return null;
}

/**
 * Verify a logout token and return its claims.
 *
 * Throws on anything short of a fully valid token. Signature, issuer, audience
 * and expiry are `jose`'s job; the three checks after it are the ones that
 * separate a logout token from an ID token, and skipping them turns an
 * id_token captured from an ordinary sign-in into a remote sign-out button.
 */
export async function verifyLogoutToken(provider, token) {
  const idToken = provider?.idToken;
  if (!idToken) {
    throw new Error(
      "The SSO provider has no verified ID-token configuration, so a logout " +
        "token cannot be checked. This should be unreachable: " +
        "requireIdTokenVerification refuses to register the provider without one.",
    );
  }

  const { payload } = await jwtVerify(token, idToken.jwks, {
    issuer: idToken.issuer,
    audience: idToken.audience,
    algorithms: idToken.algorithms,
  });

  if (!payload.events || typeof payload.events !== "object") {
    throw new Error("logout token has no events claim");
  }
  if (!(LOGOUT_EVENT in payload.events)) {
    throw new Error("logout token does not carry the back-channel logout event");
  }
  // Section 2.4 again: a nonce is what makes a token an ID token. Its presence
  // means this is a replayed id_token, not a logout notification.
  if ("nonce" in payload) {
    throw new Error("logout token must not carry a nonce");
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("logout token has no sub, so it names nobody to sign out");
  }

  return payload;
}

/**
 * The receiver Authentik posts to when a session ends there.
 *
 * Unauthenticated by necessity -- the caller is Authentik, not a browser with a
 * cookie -- so the token IS the authentication, and nothing in it is trusted
 * until verifyLogoutToken returns.
 *
 * Revokes BROWSER SESSIONS ONLY. Opaque API tokens and MCP connections are left
 * alone on purpose: Authentik sends this on an ordinary session end, and
 * killing long-lived credentials that sit in config files on other machines
 * would break every MCP client with no way to tell them why. An account-disable
 * path that also revokes tokens is a separate mechanism, if it is ever wanted.
 *
 * Configure the URL on the Authentik provider as:
 *     <your public origin>/auth/backchannel-logout
 */
export function backchannelLogoutPlugin() {
  return {
    id: "mygist-sso-logout",

    endpoints: {
      backchannelLogout: createAuthEndpoint(
        "/backchannel-logout",
        { method: "POST" },
        async (ctx) => {
          // Authentik posts application/x-www-form-urlencoded; better-call
          // parses that into ctx.body (better-call/dist/utils.mjs:33).
          const token = ctx.body?.logout_token;
          if (!token) {
            throw new APIError("BAD_REQUEST", { message: "logout_token is required" });
          }

          const provider = await findProvider(ctx.context, PROVIDER_ID);
          if (!provider) {
            throw new APIError("NOT_FOUND", { message: "No SSO provider configured." });
          }

          let claims;
          try {
            claims = await verifyLogoutToken(provider, token);
          } catch (error) {
            // Logged, because a provider misconfiguration is silent otherwise:
            // Authentik retries, gets 400, and neither side says why.
            ctx.context.logger.warn(
              `[sso] rejected a back-channel logout token: ${error?.message ?? error}`,
            );
            throw new APIError("BAD_REQUEST", { message: "Invalid logout token." });
          }

          // `iss` IS the stored account issuer: genericOAuth namespaces a
          // federated account by the DISCOVERED issuer (index.mjs:143), and
          // OIDC requires a logout token's iss to be that same value.
          const owner = await ctx.context.internalAdapter.findAccountOwnerByKey({
            issuer: claims.iss,
            accountId: claims.sub,
          });

          // 200 for an unknown subject, deliberately. A different answer would
          // tell whoever holds a valid token for another tenant which subjects
          // have MyGist accounts, and there is nothing for the caller to do
          // about it either way.
          if (owner?.kind === "owned") {
            await ctx.context.internalAdapter.deleteUserSessions(owner.user.id);
          }

          // Section 2.8: 200 with no body, and no caching.
          ctx.setHeader("Cache-Control", "no-store");
          return ctx.json({});
        },
      ),
    },
  };
}
```

Then extend `ssoPlugins` so the receiver comes and goes with the provider — it is
meaningless without one:

```js
export function ssoPlugins(env = process.env) {
  if (!ssoDiscoveryUrl(env)) return [];
  return [
    genericOAuth({ config: [ssoConfig(env)] }),
    backchannelLogoutPlugin(),
  ];
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd auth && node --test src/sso.test.js`
Expected: PASS, 13 tests

- [ ] **Step 6: Run the whole auth suite**

Run: `cd auth && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add auth/src/sso.js auth/src/sso.test.js auth/package.json auth/package-lock.json
git commit -m "feat(auth): receive Authentik's back-channel logout, browser sessions only"
```

---

### Task 4: The API — advertise SSO, and close the second password door

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_instance_endpoint.py`
- Test: `backend/tests/test_auth_routes.py`

**Interfaces:**
- Consumes: the `AUTH_OIDC_DISCOVERY_URL` convention from Task 2.
- Produces, for Tasks 5-7: `GET /api/instance` returns `{"invite_only":…, "mcp_oauth":…, "commit":…, "sso": bool}`.

**Why the API 403s rather than the SPA hiding a form:** `/api/auth/login` calls
`db.verify_password` in Python and mints an opaque token, gated on nothing but rate
limiting. It is a second password path that a `curl` reaches whatever the SPA renders.
Detached and CLI users sign in through Authentik in a browser and mint a token from
Account → API tokens, which already exists.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_instance_endpoint.py`:

```python
def test_sso_is_off_unless_a_discovery_url_is_set(monkeypatch):
    monkeypatch.delenv("AUTH_OIDC_DISCOVERY_URL", raising=False)
    assert main.sso_configured() is False


def test_sso_is_on_when_a_discovery_url_is_set(monkeypatch):
    monkeypatch.setenv(
        "AUTH_OIDC_DISCOVERY_URL",
        "https://door.example/application/o/mygist/.well-known/openid-configuration",
    )
    assert main.sso_configured() is True


def test_blank_is_not_configured(monkeypatch):
    # A variable declared in compose and left empty is the DEFAULT state, not
    # an opt-in. Reading it as on would show a button on every instance that
    # merely pulled the new compose file.
    monkeypatch.setenv("AUTH_OIDC_DISCOVERY_URL", "   ")
    assert main.sso_configured() is False


def test_the_endpoint_actually_reports_it(client, monkeypatch):
    # The helper being right is not the same as the endpoint being wired to it,
    # and the SPA reads the endpoint. This is the assertion that would catch a
    # field dropped from the dict.
    monkeypatch.delenv("AUTH_OIDC_DISCOVERY_URL", raising=False)
    assert client.get("/api/instance").json()["sso"] is False

    monkeypatch.setenv(
        "AUTH_OIDC_DISCOVERY_URL",
        "https://door.example/application/o/mygist/.well-known/openid-configuration",
    )
    assert client.get("/api/instance").json()["sso"] is True
```

`test_instance_endpoint.py` currently imports `main` and takes no fixtures; the two new
`client` tests need the same `client` fixture `test_invite_codes.py` uses for its own
`/api/instance` assertions.

Append to `backend/tests/test_auth_routes.py`:

```python
def test_login_is_closed_when_sso_is_configured(client, monkeypatch):
    # The legacy endpoint is a SECOND password path: it verifies a bcrypt hash
    # in Python and mints an opaque token, reachable by curl whatever the SPA
    # renders. On an instance whose identity provider is Authentik, that is a
    # way around the gateway.
    monkeypatch.setenv(
        "AUTH_OIDC_DISCOVERY_URL",
        "https://door.example/application/o/mygist/.well-known/openid-configuration",
    )
    response = client.post(
        "/api/auth/login", json={"username": "someone", "password": "whatever"}
    )
    assert response.status_code == 403
    assert "single sign-on" in response.json()["detail"]


def test_register_is_closed_when_sso_is_configured(client, monkeypatch):
    monkeypatch.setenv(
        "AUTH_OIDC_DISCOVERY_URL",
        "https://door.example/application/o/mygist/.well-known/openid-configuration",
    )
    response = client.post(
        "/api/auth/register", json={"username": "someone", "password": "whatever123"}
    )
    assert response.status_code == 403


def test_login_is_refused_before_the_password_is_checked(client, monkeypatch):
    # The refusal must not double as an oracle: an unknown username and a real
    # one have to answer identically, and neither may cost a rate-limit slot.
    monkeypatch.setenv(
        "AUTH_OIDC_DISCOVERY_URL",
        "https://door.example/application/o/mygist/.well-known/openid-configuration",
    )
    import db

    calls = []
    monkeypatch.setattr(db, "verify_password", lambda *a: calls.append(a))
    monkeypatch.setattr(db, "login_retry_after", lambda *a: calls.append(a))

    client.post("/api/auth/login", json={"username": "someone", "password": "x"})
    assert calls == []


def test_both_endpoints_still_work_without_sso(client, monkeypatch):
    monkeypatch.delenv("AUTH_OIDC_DISCOVERY_URL", raising=False)
    response = client.post(
        "/api/auth/register", json={"username": "openinstance", "password": "hunter22"}
    )
    assert response.status_code == 200
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && pytest tests/test_instance_endpoint.py tests/test_auth_routes.py -v`
Expected: FAIL — `AttributeError: module 'main' has no attribute 'sso_configured'`, and the
403 tests return 200/401.

- [ ] **Step 3: Write the implementation**

In `backend/main.py`, immediately after the `invite_only()` function:

```python
def sso_configured() -> bool:
    """Whether this instance federates sign-in to an identity provider.

    Read from the same AUTH_OIDC_DISCOVERY_URL the auth service gates its whole
    SSO surface on -- the "set it on both containers" rule AUTH_MCP_RESOURCE
    already teaches. This container never sees the client secret: all it does
    with the value is answer this question.

    Blank counts as unset. A variable declared in compose and left empty is the
    default state, not an opt-in.
    """
    return bool(os.getenv("AUTH_OIDC_DISCOVERY_URL", "").strip())
```

In the `/api/instance` handler, add to the returned dict:

```python
        "sso": sso_configured(),
```

and add to its docstring, after the `mcp_oauth` paragraph:

```
    `sso` says whether sign-in is federated to an identity provider. The SPA
    reads it to decide whether to lead with a redirect button or with the
    password form, and it is the one field on this endpoint that changes what a
    stranger is asked for rather than merely what they are told.
```

In `register`, immediately after the docstring and **before** the `invite_only()` check:

```python
    # Closed outright when this instance federates sign-in. This mints a MyGist
    # password; on an SSO instance the identity provider owns credentials, and a
    # second place to create one is a second place to attack.
    if sso_configured():
        raise HTTPException(
            status_code=403,
            detail="this instance uses single sign-on; sign in through its web app",
        )
```

In `login`, immediately after the docstring and **before** the `db.login_retry_after` call:

```python
    # Before the rate limiter and before the password check, so the refusal
    # costs no attempt slot and reveals nothing about whether the account
    # exists. This is a second password path -- it verifies a bcrypt hash in
    # Python and mints an opaque token, reachable by curl whatever the SPA
    # renders -- so hiding the form would not have closed it.
    #
    # Detached and CLI users sign in through the provider in a browser and mint
    # a token from Account -> API tokens, which already exists.
    if sso_configured():
        raise HTTPException(
            status_code=403,
            detail="this instance uses single sign-on; sign in through its web app",
        )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && pytest tests/test_instance_endpoint.py tests/test_auth_routes.py -v`
Expected: PASS

- [ ] **Step 5: Run the whole backend suite**

Run: `cd backend && pytest -q`
Expected: PASS, no regressions (1114+ passed). Watch `tests/test_invite_codes.py`, which
asserts on `/api/instance`'s body.

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/tests/test_instance_endpoint.py backend/tests/test_auth_routes.py
git commit -m "feat(api): report sso on /api/instance, and close the legacy password path"
```

---

### Task 5: Session helpers for the SPA

**Files:**
- Modify: `frontend/src/lib/session.js`
- Modify: `frontend/src/lib/api.js`
- Create: `frontend/src/lib/session-sso.test.js`

**Interfaces:**
- Consumes: the core Better Auth routes proxied at `/auth` — `POST /sign-in/social`,
  `POST /link-social`, `GET /list-accounts`, `POST /unlink-account`.
- Produces, for Tasks 6 and 7:
  - `SSO_PROVIDER_ID: "authentik"`, `SSO_LABEL: "TDev Door"`
  - `startSsoSignIn({ callbackURL, newUserCallbackURL, errorCallbackURL }) => Promise<void>` — navigates
  - `startSsoLink({ callbackURL, errorCallbackURL }) => Promise<void>` — navigates
  - `listAccounts() => Promise<Array<{ id, providerId, issuer, accountId, createdAt }>>`
  - `unlinkAccount(accountId) => Promise<object>`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/session-sso.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  SSO_LABEL,
  SSO_PROVIDER_ID,
  listAccounts,
  startSsoLink,
  startSsoSignIn,
  unlinkAccount,
} from "./session.js";

let assign;

beforeEach(() => {
  // window.location.href is not writable in jsdom, and the module assigns to
  // it. Replacing the object is the supported way to observe that.
  assign = vi.fn();
  delete window.location;
  window.location = { origin: "https://mygist.test", assign, href: "" };
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ok = (body) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

describe("starting an SSO sign-in", () => {
  it("posts to the CORE social route, not a plugin route", async () => {
    // better-auth 1.7's genericOAuth registers no endpoints of its own: the
    // provider rides /sign-in/social. Posting to /sign-in/oauth2 -- which the
    // 1.6 docs describe -- 404s.
    global.fetch.mockReturnValue(ok({ url: "https://door.test/authorize?x=1" }));

    await startSsoSignIn({ callbackURL: "/" });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/auth/sign-in/social");
    expect(JSON.parse(options.body).provider).toBe(SSO_PROVIDER_ID);
    expect(options.credentials).toBe("include");
  });

  it("sends the caller where to come back to", async () => {
    global.fetch.mockReturnValue(ok({ url: "https://door.test/authorize" }));

    await startSsoSignIn({
      callbackURL: "/auth/oauth2/authorize?client_id=abc",
      newUserCallbackURL: "/#/onboarding/welcome",
      errorCallbackURL: "/sign-in?client_id=abc",
    });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.callbackURL).toBe("/auth/oauth2/authorize?client_id=abc");
    // A brand-new account lands on onboarding rather than an empty Profile.
    // With a redirect flow there is no onSuccess callback to decide that in,
    // so the provider is told up front.
    expect(body.newUserCallbackURL).toBe("/#/onboarding/welcome");
    expect(body.errorCallbackURL).toBe("/sign-in?client_id=abc");
  });

  it("hands the browser to the provider", async () => {
    global.fetch.mockReturnValue(ok({ url: "https://door.test/authorize?x=1" }));
    await startSsoSignIn({ callbackURL: "/" });
    expect(window.location.href).toBe("https://door.test/authorize?x=1");
  });

  it("throws rather than navigating nowhere when no url comes back", async () => {
    // A silent no-op reads as a dead button, which is the hardest bug class to
    // report: nothing happened and nothing said why.
    global.fetch.mockReturnValue(ok({}));
    await expect(startSsoSignIn({ callbackURL: "/" })).rejects.toThrow();
    expect(window.location.href).toBe("");
  });

  it("surfaces the service's own message on a refusal", async () => {
    global.fetch.mockReturnValue(
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ message: "Provider not found" }),
      }),
    );
    await expect(startSsoSignIn({ callbackURL: "/" })).rejects.toThrow(
      "Provider not found",
    );
  });
});

describe("linking", () => {
  it("posts to /link-social with the session cookie", async () => {
    global.fetch.mockReturnValue(ok({ url: "https://door.test/authorize" }));
    await startSsoLink({ callbackURL: "/" });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/auth/link-social");
    expect(options.credentials).toBe("include");
    expect(JSON.parse(options.body).provider).toBe(SSO_PROVIDER_ID);
  });
});

describe("accounts", () => {
  it("lists them", async () => {
    global.fetch.mockReturnValue(
      ok([{ id: "1", providerId: "credential" }, { id: "2", providerId: "authentik" }]),
    );
    const accounts = await listAccounts();
    expect(global.fetch.mock.calls[0][0]).toBe("/auth/list-accounts");
    expect(accounts).toHaveLength(2);
  });

  it("answers with an empty list rather than throwing when there is no session", async () => {
    // Detached mode signs in with a bearer token and has no Better Auth
    // session at all. That is not an error, it simply has nothing to show.
    global.fetch.mockReturnValue(Promise.resolve({ ok: false, json: () => ({}) }));
    expect(await listAccounts()).toEqual([]);
  });

  it("unlinks by account id", async () => {
    global.fetch.mockReturnValue(ok({ status: true }));
    await unlinkAccount("acct-2");
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/auth/unlink-account");
    expect(JSON.parse(options.body)).toEqual({ accountId: "acct-2" });
  });

  it("passes the last-account refusal through in words", async () => {
    // Better Auth refuses to unlink the last account (FAILED_TO_UNLINK_LAST_
    // ACCOUNT). Nothing is reimplemented here; the message just has to arrive.
    global.fetch.mockReturnValue(
      Promise.resolve({
        ok: false,
        json: () =>
          Promise.resolve({ message: "You can't unlink your last account" }),
      }),
    );
    await expect(unlinkAccount("acct-2")).rejects.toThrow("last account");
  });
});

it("names the provider exactly once", () => {
  expect(SSO_PROVIDER_ID).toBe("authentik");
  expect(SSO_LABEL).toBe("TDev Door");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/session-sso.test.js`
Expected: FAIL — the named exports do not exist

- [ ] **Step 3: Write the implementation**

Append to `frontend/src/lib/session.js`:

```js
// ---------------------------------------------------------------------------
// Single sign-on
// ---------------------------------------------------------------------------

/**
 * The provider id, matching auth/src/sso.js and the Application slug on the
 * identity provider. It is stored on every linked account row, so this is not
 * a label -- changing it re-keys every link.
 */
export const SSO_PROVIDER_ID = "authentik";

/** What the button says. Not configurable: see the spec's "Not building". */
export const SSO_LABEL = "TDev Door";

/**
 * Ask the auth service for the provider's authorization URL, then go there.
 *
 * `/sign-in/social`, not `/sign-in/oauth2`. Better Auth 1.7's genericOAuth
 * plugin registers no endpoints of its own -- it injects a provider into the
 * core social-provider list, and the whole flow rides the core routes. The 1.6
 * documentation still describes plugin routes that no longer exist.
 *
 * The three callbacks are how a redirect flow says what an onSuccess handler
 * would have said: where to return to, where a BRAND-NEW account goes instead,
 * and where a failure lands. Nothing after the assignment runs.
 */
async function startProviderFlow(path, { callbackURL, newUserCallbackURL, errorCallbackURL }) {
  const res = await authFetch(path, {
    method: "POST",
    body: JSON.stringify({
      provider: SSO_PROVIDER_ID,
      callbackURL,
      ...(newUserCallbackURL ? { newUserCallbackURL } : {}),
      ...(errorCallbackURL ? { errorCallbackURL } : {}),
    }),
  });
  if (!res.ok) throw new Error(await readError(res, `Could not reach ${SSO_LABEL}`));

  const body = await res.json().catch(() => ({}));
  if (!body?.url) {
    // Never fail silently here. A button that does nothing is the hardest bug
    // to report: nothing happened, and nothing said why.
    throw new Error(`${SSO_LABEL} did not return a sign-in link.`);
  }
  window.location.href = body.url;
}

/** Begin a federated sign-in. Navigates away; nothing after this runs. */
export async function startSsoSignIn(callbacks) {
  return startProviderFlow("/sign-in/social", callbacks);
}

/**
 * Bind the provider to the account that is already signed in here.
 *
 * The session cookie is what makes this a LINK rather than a sign-in: the
 * service refuses without one, and refuses again if that subject already
 * belongs to somebody else. Auto-linking on a matching email is switched off in
 * the auth service on purpose -- see accountLinking in auth/src/auth.js.
 */
export async function startSsoLink(callbacks) {
  return startProviderFlow("/link-social", callbacks);
}

/** Every credential on this account: the password, and any linked provider.
 *
 *  An empty list rather than a throw when there is no session. Detached mode
 *  signs in with a bearer token and has no Better Auth session at all, which is
 *  not an error -- there is simply nothing to show. */
export async function listAccounts() {
  const res = await authFetch("/list-accounts");
  if (!res.ok) return [];
  const body = await res.json().catch(() => null);
  return Array.isArray(body) ? body : [];
}

/** Remove one credential.
 *
 *  Better Auth refuses to remove the last one, so nothing here re-checks it --
 *  a second implementation of that rule is a second thing to drift. The
 *  service's own message is passed through instead. */
export async function unlinkAccount(accountId) {
  const res = await authFetch("/unlink-account", {
    method: "POST",
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not unlink that."));
  return res.json();
}
```

In `frontend/src/lib/api.js`, extend `getInstance`'s offline fallback so it names every key
a caller reads:

```js
  const unknown = { invite_only: false, mcp_oauth: false, sso: false };
```

and extend the comment above it:

```js
  // Both fallbacks name every key a caller reads. `mcp_oauth: false` is the
  // safe answer when we cannot ask: recommending that a client sign in, on an
  // instance that turns out to mount no discovery routes, sends someone through
  // a flow that ends in a 404. `sso: false` is safe for the mirror-image
  // reason: showing only a redirect button, on an instance that federates
  // nothing, leaves a person with no way in at all.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/session-sso.test.js`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/session.js frontend/src/lib/api.js frontend/src/lib/session-sso.test.js
git commit -m "feat(spa): session helpers for federated sign-in and linking"
```

---

### Task 6: The sign-in screen

**Files:**
- Modify: `frontend/src/components/WelcomeAuth.jsx`
- Test: `frontend/src/components/WelcomeAuth.test.jsx`

**Interfaces:**
- Consumes: `startSsoSignIn`, `SSO_LABEL` from `frontend/src/lib/session.js` (Task 5);
  `getInstance().sso` from Task 4.
- Produces: nothing later tasks depend on.

**The three callbacks this screen passes:**

| Callback | Value | Why |
|---|---|---|
| `callbackURL` | `/auth/oauth2/authorize${oauthQuery}` in an OAuth flow, else `/` | Resumes the in-flight authorize request. `App.jsx:106` already does exactly this for a password sign-in; this is the same value, handed to the provider instead of run in an `onSuccess`. |
| `newUserCallbackURL` | `/#/onboarding/welcome` | A brand-new account lands on Welcome. With a full-page redirect there is no `onSuccess({isNew})` to decide it in (`App.jsx:605`), so the provider is told up front. |
| `errorCallbackURL` | the current `pathname + search` | Return where you started, so the banner appears in the framing the person was already in — "connect" during an OAuth flow, "app" otherwise. |

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/components/WelcomeAuth.test.jsx`:

```js
describe("WelcomeAuth with SSO configured", () => {
  beforeEach(() => {
    getInstance.mockResolvedValue({ invite_only: false, sso: true });
  });

  it("leads with the provider and hides the password form", async () => {
    render(<WelcomeAuth onSuccess={() => {}} />);

    expect(
      await screen.findByRole("button", { name: /continue with tdev door/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
  });

  it("keeps a way in for anyone who has not linked yet", async () => {
    // Not only for the migration window, when Liam must sign in with a
    // password to reach the link button at all. It permanently covers every
    // account that exists and has not linked.
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.click(
      await screen.findByRole("button", { name: /sign in with a password instead/i }),
    );
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  });

  it("sends the app's own sign-in home, and a new account to onboarding", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.click(
      await screen.findByRole("button", { name: /continue with tdev door/i }),
    );

    expect(startSsoSignIn).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackURL: "/",
        newUserCallbackURL: "/#/onboarding/welcome",
      }),
    );
  });

  it("resumes an in-flight OAuth authorize request", async () => {
    // The fiddliest path in the whole feature: MyGist is an OAuth server and an
    // OAuth client in one request. The authorize query has to survive the round
    // trip to the provider, or the MCP client that started this is dropped
    // without an answer.
    window.history.replaceState(null, "", "/sign-in?client_id=abc&state=xyz");
    const user = userEvent.setup();
    render(<WelcomeAuth intent="connect" onSuccess={() => {}} />);

    await user.click(
      await screen.findByRole("button", { name: /continue with tdev door/i }),
    );

    expect(startSsoSignIn).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackURL: "/auth/oauth2/authorize?client_id=abc&state=xyz",
      }),
    );
  });

  it("explains a failed sign-in, and points at the fix", async () => {
    // The most likely cause by far is a username collision: someone signed in
    // through the provider without linking first. Resolving that to `liam-2`
    // would hand them a second, empty account, so it fails -- and the copy has
    // to name the actual remedy, because the person reading it is the operator
    // at 11pm.
    window.history.replaceState(null, "", "/sign-in?error=unable_to_create_user");
    render(<WelcomeAuth onSuccess={() => {}} />);

    expect(await screen.findByText(/could not sign you in with tdev door/i))
      .toBeInTheDocument();
    expect(screen.getByText(/link tdev door from settings/i)).toBeInTheDocument();
    // The raw code, for the person who has to look it up.
    expect(screen.getByText(/unable_to_create_user/)).toBeInTheDocument();
  });

  it("shows nothing about SSO on an instance that does not use it", async () => {
    getInstance.mockResolvedValue({ invite_only: false, sso: false });
    render(<WelcomeAuth onSuccess={() => {}} />);

    expect(await screen.findByLabelText(/^password$/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /continue with tdev door/i }),
    ).not.toBeInTheDocument();
  });
});
```

Extend the existing `vi.mock("@/lib/session.js", …)` factory at the top of the file with:

```js
    startSsoSignIn: vi.fn(async () => {}),
```

and extend the import line below it:

```js
import {
  signIn,
  signUp,
  requestPasswordReset,
  checkInvite,
  startSsoSignIn,
} from "@/lib/session.js";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/WelcomeAuth.test.jsx`
Expected: FAIL — the button does not render

- [ ] **Step 3: Write the implementation**

In `frontend/src/components/WelcomeAuth.jsx`, extend the `@/lib/session.js` import:

```js
import {
  signIn,
  signUp,
  requestPasswordReset,
  isCompleteInvite,
  normaliseInvite,
  startSsoSignIn,
  SSO_LABEL,
} from "@/lib/session.js";
```

Add, beside `inviteFromUrl` at module scope:

```js
/** Better Auth appends `?error=<code>` when it sends a failed federated
 *  sign-in to `errorCallbackURL`. Read once at mount, like the invite code:
 *  it cannot change while the page is open. */
function ssoErrorFromUrl() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("error") || "";
}
```

Add to the component's state, beside `inviteOnly`:

```js
  // Whether this instance federates sign-in. Null until asked, so the password
  // form is not rendered and then withdrawn a moment later.
  const [sso, setSso] = useState(null);
  // The escape hatch. Shown permanently, not only during the migration window:
  // it covers everyone who has an account and has not linked yet -- which
  // includes whoever is about to link for the first time.
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [ssoError] = useState(ssoErrorFromUrl);
  const [ssoPending, setSsoPending] = useState(false);
```

In the `getInstance()` effect, set both flags:

```js
    getInstance().then((info) => {
      if (cancelled) return;
      setInviteOnly(info?.invite_only === true);
      setSso(info?.sso === true);
    });
```

and in the detached early-return of that same effect, set `setSso(false)` beside
`setInviteOnly(false)` — SSO is same-origin cookie auth, so a UI pointed at somebody
else's server cannot use it whatever that server reports.

Add below the `needsInvite` line:

```js
  // Detached mode is excluded for the same reason reset is: Better Auth is
  // same-origin only, and its session cookie cannot be set from another site.
  const ssoAvailable = sso === true && !isDetached(serverUrl) && mode !== "forgot";
  // The password form yields to the button, but never disappears.
  const passwordFormShown = !ssoAvailable || showPasswordForm;

  const handleSso = async () => {
    setFormError(null);
    setSsoPending(true);
    try {
      // /sign-in is a real, bookmarkable path that is also where an OAuth flow
      // is interrupted. client_id is what tells the two apart -- the same test
      // App.jsx makes before resuming a flow after a password sign-in.
      const query = window.location.search;
      const isOAuthRequest = new URLSearchParams(query).has("client_id");
      await startSsoSignIn({
        callbackURL: isOAuthRequest ? `/auth/oauth2/authorize${query}` : "/",
        // A brand-new account lands on Welcome rather than an empty Profile.
        // A redirect flow has no onSuccess to decide that in, so the provider
        // is told up front.
        newUserCallbackURL: "/#/onboarding/welcome",
        // Back where you started, so the banner appears in the framing the
        // person was already in.
        errorCallbackURL: `${window.location.pathname}${query}`,
      });
    } catch (err) {
      setFormError(err.message);
      setSsoPending(false);
    }
    // No `finally`: on success the browser is already leaving, and clearing the
    // spinner would flash the button back to life on the way out.
  };
```

Render the banner and the button. Inside the main `return`'s
`<div className="w-full space-y-4 text-left">`, immediately after the `AcceptedInvite`
block and **before** the `<form>`:

```jsx
        {/* A failed federated sign-in, explained where it happened. The cause
            is most often a username collision -- someone signed in through the
            provider without linking first -- and the remedy is always the
            same, so the copy names it rather than decoding the error. */}
        {ssoError && (
          <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm font-medium">
              Could not sign you in with {SSO_LABEL}.
            </p>
            <p className="text-xs text-muted-foreground">
              If you already have a MyGist account, sign in with your password
              and link {SSO_LABEL} from Settings. Signing in with {SSO_LABEL}{" "}
              first would have started a second, empty account.
            </p>
            <p className="text-xs text-muted-foreground/70">{ssoError}</p>
          </div>
        )}

        {ssoAvailable && (
          <div className="space-y-3">
            <Button
              type="button"
              className="w-full"
              onClick={handleSso}
              disabled={ssoPending}
            >
              {ssoPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                `Continue with ${SSO_LABEL}`
              )}
            </Button>

            {!showPasswordForm && (
              <p className="text-center text-xs text-muted-foreground">
                <button
                  type="button"
                  onClick={() => setShowPasswordForm(true)}
                  className="underline hover:text-foreground"
                >
                  Sign in with a password instead
                </button>
              </p>
            )}
          </div>
        )}
```

Then gate the form itself. Wrap the existing `<form onSubmit={handleSubmit} …>…</form>`
and the "Already have an account? / New to MyGist?" paragraph below it in:

```jsx
        {passwordFormShown && (
          <>
            {/* … the existing <form> … */}
            {/* … the existing <p className="text-center text-xs …"> … */}
          </>
        )}
```

Leave the server-selector row at the bottom outside that wrapper: which server you are
talking to is a question that exists whether or not a password form is on screen.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/WelcomeAuth.test.jsx`
Expected: PASS — the six new tests, and every pre-existing test in the file unchanged
(they mock `getInstance` as `{ invite_only: false }`, so `sso` is `undefined`, so
`ssoAvailable` is false and the password form renders exactly as before).

- [ ] **Step 5: Run the whole frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/WelcomeAuth.jsx frontend/src/components/WelcomeAuth.test.jsx
git commit -m "feat(spa): lead with TDev Door when the instance federates sign-in"
```

---

### Task 7: Linking and unlinking, in settings

**Files:**
- Create: `frontend/src/components/LinkedAccounts.jsx`
- Create: `frontend/src/components/LinkedAccounts.test.jsx`
- Modify: `frontend/src/components/settings/AccountPanel.jsx`
- Test: `frontend/src/components/settings/AccountPanel.test.jsx`

**Interfaces:**
- Consumes: `startSsoLink`, `unlinkAccount`, `listAccounts`, `SSO_PROVIDER_ID`, `SSO_LABEL`
  from `frontend/src/lib/session.js` (Task 5); `getInstance` from `@/lib/api.js`.
- Produces:
  - `<LinkedAccounts accounts={Array} sso={boolean} onChanged={() => {}} />`

**Why `AccountPanel` owns the fetch:** it needs the same two answers to decide whether to
offer a password change at all. Two components asking the same two questions is two
answers that can disagree.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/LinkedAccounts.test.jsx`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/session.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    startSsoLink: vi.fn(async () => {}),
    unlinkAccount: vi.fn(async () => ({ status: true })),
  };
});

import { startSsoLink, unlinkAccount } from "@/lib/session.js";
import { LinkedAccounts } from "@/components/LinkedAccounts";

const CREDENTIAL = { id: "a1", providerId: "credential" };
const AUTHENTIK = {
  id: "a2",
  providerId: "authentik",
  issuer: "https://door.thuradev.qzz.io/application/o/mygist/",
};

beforeEach(() => vi.clearAllMocks());

it("shows nothing on an instance that does not federate sign-in", () => {
  const { container } = render(
    <LinkedAccounts accounts={[CREDENTIAL]} sso={false} />,
  );
  expect(container).toBeEmptyDOMElement();
});

it("offers to link when the account has no provider yet", async () => {
  const user = userEvent.setup();
  render(<LinkedAccounts accounts={[CREDENTIAL]} sso />);

  await user.click(screen.getByRole("button", { name: /link tdev door/i }));

  // Comes back here afterwards, not to the app root: the person was in
  // Settings and expects to still be in Settings.
  expect(startSsoLink).toHaveBeenCalledWith(
    expect.objectContaining({ callbackURL: expect.stringContaining("/") }),
  );
});

it("says it is linked, and offers to undo it", async () => {
  const user = userEvent.setup();
  const onChanged = vi.fn();
  render(
    <LinkedAccounts accounts={[CREDENTIAL, AUTHENTIK]} sso onChanged={onChanged} />,
  );

  expect(screen.getByText(/tdev door is linked/i)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /unlink/i }));

  expect(unlinkAccount).toHaveBeenCalledWith("a2");
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});

it("warns before removing the only way in", async () => {
  // Unlinking the last account is refused by the service, but the person
  // should learn that before they click, not after. An account with a linked
  // provider and NO password is the real case: unlink and it is unreachable.
  render(<LinkedAccounts accounts={[AUTHENTIK]} sso />);
  expect(
    screen.getByText(/set a password first|only way to sign in/i),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /unlink/i })).toBeDisabled();
});

it("shows the service's own refusal rather than inventing one", async () => {
  const user = userEvent.setup();
  unlinkAccount.mockRejectedValueOnce(new Error("You can't unlink your last account"));
  render(<LinkedAccounts accounts={[CREDENTIAL, AUTHENTIK]} sso />);

  await user.click(screen.getByRole("button", { name: /unlink/i }));
  expect(await screen.findByText(/last account/i)).toBeInTheDocument();
});
```

Append to `frontend/src/components/settings/AccountPanel.test.jsx`:

```js
describe("AccountPanel with SSO", () => {
  it("stops offering a password change to an account that has no password", async () => {
    // Nothing here can set the FIRST password on an SSO-only account -- the
    // form posts a change, and there is nothing to change. Offering it is
    // offering a control that cannot work.
    getInstance.mockResolvedValue({ sso: true });
    listAccounts.mockResolvedValue([{ id: "a2", providerId: "authentik" }]);

    render(<AccountPanel isOpen username="liam" />);

    await waitFor(() =>
      expect(screen.queryByText(/change password/i)).not.toBeInTheDocument(),
    );
  });

  it("keeps offering it while a password still exists", async () => {
    getInstance.mockResolvedValue({ sso: true });
    listAccounts.mockResolvedValue([
      { id: "a1", providerId: "credential" },
      { id: "a2", providerId: "authentik" },
    ]);

    render(<AccountPanel isOpen username="liam" />);
    expect(await screen.findByText(/change password/i)).toBeInTheDocument();
  });

  it("is unchanged on an instance without SSO", async () => {
    getInstance.mockResolvedValue({ sso: false });
    listAccounts.mockResolvedValue([]);

    render(<AccountPanel isOpen username="liam" />);
    expect(await screen.findByText(/change password/i)).toBeInTheDocument();
  });
});
```

Add the two mocks this needs to the top of `AccountPanel.test.jsx`, following whatever
mocking style that file already uses for `@/lib/api.js` and `@/lib/session.js`:
`getInstance` from `@/lib/api.js`, and `listAccounts` from `@/lib/session.js`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/LinkedAccounts.test.jsx src/components/settings/AccountPanel.test.jsx`
Expected: FAIL — `Failed to resolve import "@/components/LinkedAccounts"`

- [ ] **Step 3: Write the component**

Create `frontend/src/components/LinkedAccounts.jsx`:

```jsx
/**
 * The identity provider, linked or not.
 *
 * Linking is always explicit and always starts from a signed-in session. The
 * auth service will not link a provider to an account by matching email --
 * `disableImplicitLinking` in auth/src/auth.js -- because the provider cannot
 * truthfully assert that an address is verified, and auto-linking on a claim
 * nobody can vouch for is a known takeover class.
 *
 * So this panel is not a convenience. It is the only way an account that
 * already exists ever gets a linked provider, which makes it the whole
 * migration path for every account that predates SSO.
 *
 * Presentational plus its two actions: AccountPanel owns the fetch, because it
 * needs the same two answers to decide whether a password change is worth
 * offering, and two components asking the same question is two answers that can
 * disagree.
 */
import { useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  SSO_LABEL,
  SSO_PROVIDER_ID,
  startSsoLink,
  unlinkAccount,
} from "@/lib/session.js";

export function LinkedAccounts({ accounts = [], sso = false, onChanged = () => {} }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  // Nothing to say on an instance that federates nothing. Not a disabled
  // control: a control for a feature this instance does not have is a question
  // nobody asked.
  if (!sso) return null;

  const linked = accounts.find((a) => a.providerId === SSO_PROVIDER_ID);
  const hasPassword = accounts.some((a) => a.providerId === "credential");
  // Better Auth refuses to unlink the last account, but the person should
  // learn that before the click rather than from a red message after it.
  const isOnlyWayIn = Boolean(linked) && !hasPassword;

  const handleLink = async () => {
    setError(null);
    setPending(true);
    try {
      // Back to where they are standing. Somebody in Settings expects to still
      // be in Settings when the provider is done with them.
      const here = `${window.location.pathname}${window.location.search}`;
      await startSsoLink({ callbackURL: here, errorCallbackURL: here });
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
    // No `finally`: on success the browser is already leaving.
  };

  const handleUnlink = async () => {
    setError(null);
    setPending(true);
    try {
      await unlinkAccount(linked.id);
      onChanged();
    } catch (err) {
      // The service's own words. Re-implementing its rule here would be a
      // second copy of it, free to drift.
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 text-sm">
            {linked ? (
              <ShieldCheck className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="truncate font-medium">
              {linked ? `${SSO_LABEL} is linked` : SSO_LABEL}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {isOnlyWayIn
              ? `This is the only way to sign in to this account. Set a password first if you want to unlink it.`
              : linked
                ? `You can sign in to MyGist with ${SSO_LABEL}.`
                : `Link it and you can sign in with ${SSO_LABEL} instead of a password.`}
          </p>
        </div>

        {linked ? (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={handleUnlink}
            disabled={pending || isOnlyWayIn}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unlink"}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={handleLink}
            disabled={pending}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Link ${SSO_LABEL}`}
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Wire it into `AccountPanel`**

In `frontend/src/components/settings/AccountPanel.jsx`, extend the imports:

```js
import { clearConfig, getInstance, setPassword } from "@/lib/api.js";
import { listAccounts, signOut } from "@/lib/session.js";
import { LinkedAccounts } from "@/components/LinkedAccounts";
```

Add to state, beside `onboardingDismissed`:

```js
  // Fetched here rather than inside LinkedAccounts, because the password form
  // below needs the same two answers -- and two components asking the same
  // question is two answers free to disagree.
  const [sso, setSso] = useState(false);
  const [accounts, setAccounts] = useState([]);
```

Add a loader, and call it from the existing `isOpen` effect:

```js
  const loadAccounts = useCallback(async () => {
    const [instance, list] = await Promise.all([
      getInstance().catch(() => null),
      listAccounts().catch(() => []),
    ]);
    setSso(instance?.sso === true);
    setAccounts(list);
  }, []);
```

(Add `useCallback` to the `react` import.) Inside the existing `useEffect(() => {…}, [isOpen])`,
after the `getOnboarding()` chain:

```js
    loadAccounts();
```

and add `loadAccounts` to that effect's dependency array.

Render it below `<EmailSettings />`:

```jsx
      <LinkedAccounts accounts={accounts} sso={sso} onChanged={loadAccounts} />
```

Gate the password block. Add above the return:

```js
  // An account with a linked provider and no password has nothing to change,
  // and this form cannot set a first one. Offering it would be offering a
  // control that cannot work.
  const hasPassword = accounts.some((a) => a.providerId === "credential");
  const offerPasswordChange = !sso || hasPassword;
```

and wrap the whole `<div className="border-t pt-4">…</div>` password block in
`{offerPasswordChange && ( … )}`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/LinkedAccounts.test.jsx src/components/settings/AccountPanel.test.jsx`
Expected: PASS

- [ ] **Step 6: Run the whole frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/LinkedAccounts.jsx frontend/src/components/LinkedAccounts.test.jsx \
        frontend/src/components/settings/AccountPanel.jsx frontend/src/components/settings/AccountPanel.test.jsx
git commit -m "feat(spa): link and unlink TDev Door from account settings"
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs-site/content/docs/run/self-hosting.mdx`
- Modify: `docs-site/content/docs/run/troubleshooting.mdx`

**Interfaces:**
- Consumes: the variable names and semantics from Tasks 2 and 4.
- Produces: nothing.

**Verification note:** `npm run check:links` in `docs-site` passes against a **stale**
`out/`, so a green run proves nothing about new content. Build first. And a colon in MDX
frontmatter kills the build — keep it out of any title added here.

- [ ] **Step 1: Add the variables to the self-hosting table**

In `docs-site/content/docs/run/self-hosting.mdx`, in the "Auth service" table, after the
`INVITE_ONLY` row:

```mdx
| `AUTH_OIDC_DISCOVERY_URL` | **Both containers, or neither.** The OpenID Connect discovery document of your identity provider, e.g. `https://door.example.com/application/o/mygist/.well-known/openid-configuration`. Unset — the default — nothing changes: no provider, no button, and password sign-in is the only way in. Set, the auth container federates sign-in and the API container reports `"sso": true` on `/api/instance`, which is what makes the button appear. Set on the API alone and the button appears and every press 404s; set on the auth service alone and sign-in works but nothing offers it. |
| `AUTH_OIDC_CLIENT_ID` | **Auth container only.** The client id of the OAuth2/OIDC provider you created for MyGist. Required whenever `AUTH_OIDC_DISCOVERY_URL` is set; without it the auth service refuses to boot rather than showing a button that fails inside a browser redirect. |
| `AUTH_OIDC_CLIENT_SECRET` | **Auth container only.** Its client secret. Never set this on the API container — it has no use for it, and a secret in a second place is a second place to leak it. |
```

- [ ] **Step 2: Add the setup section**

Add a new `###` section to the same file, immediately after the "Auth service" table's
existing `AUTH_MCP_RESOURCE` callout:

```mdx
### Federated sign-in (optional)

MyGist can hand sign-in to an OpenID Connect provider — Authentik, Keycloak,
Auth0, anything that publishes a discovery document. It stays optional: unset,
every instance behaves exactly as it did before this existed.

On the provider, create one OAuth2/OIDC application:

- **Confidential** client, **authorization code** grant.
- **Redirect URI:** `https://your-instance/auth/callback/authentik` — note there
  is no `oauth2` segment. Better Auth serves federated callbacks on its core
  `/callback/:providerId` route.
- **Scopes:** `openid profile email`. The email scope is not optional — sign-in
  fails outright without an address.
- **Subject mode: the user's ID or UUID.** Set it the same way on every
  application you ever add. It is what identifies an account here, so changing
  it later re-keys every linked account in every app.
- **Bind a group to the application.** That binding *is* the access control:
  an application with no policy bound is open to every account on the provider.
  MyGist deliberately does not check group claims itself — access policy belongs
  at the gateway, in one place.
- **Back-channel logout URL:** `https://your-instance/auth/backchannel-logout`.
  Optional. Set it and ending a session at the provider ends the MyGist browser
  session too. API tokens and MCP connections are left alone on purpose — they
  live in config files on other machines, and killing them would break every
  connected client with no way to tell it why.

Then set `AUTH_OIDC_DISCOVERY_URL` on **both** containers, and
`AUTH_OIDC_CLIENT_ID` / `AUTH_OIDC_CLIENT_SECRET` on the auth container only.

<Callout type="warn">
The auth container **fetches the discovery document at startup and will not boot
while your provider is unreachable** — including for password sign-in.

That is deliberate. The alternatives are accepting ID tokens without verifying
them, or starting with single sign-on quietly switched off; a security feature
that disables itself is worse than one that fails in a deployment log, which is
where somebody is already looking.
</Callout>

<Callout>
**Linking is explicit, and only ever from a signed-in session.** Signing in
through the provider with an address that matches an existing MyGist account
does **not** adopt that account — it starts a new, empty one, and fails if the
username is taken.

That is on purpose: linking on a matching email is a known account-takeover
class, and no provider can truthfully assert that an address is verified.
Existing accounts link from **Settings → Account → Link**, which requires the
password first. Set `AUTH_OIDC_*` after you have linked, not before.
</Callout>
```

- [ ] **Step 3: Correct the invite-only claim**

`INVITE_ONLY` does not gate a federated sign-in — that flow never reaches
`/sign-up/email` — so an operator can turn invite-only on for an SSO instance and believe
they are protected by something that is not running.

In `docs-site/content/docs/run/self-hosting.mdx`, append to the `INVITE_ONLY` row's cell:

```
 It does **not** gate single sign-on: a federated sign-in never reaches the sign-up form it guards. On an instance with `AUTH_OIDC_DISCOVERY_URL` set, the group you bind to the provider's application is the gate — and a stricter one, since a code can be forwarded and an account on your provider cannot.
```

In `docs-site/content/docs/run/troubleshooting.mdx`, in the "Sign-up is open when it should
be closed" accordion, before the `/api/instance` line:

```mdx
`INVITE_ONLY` does not gate single sign-on. A federated sign-in never reaches
the sign-up form it guards, so on an instance with `AUTH_OIDC_DISCOVERY_URL` set
the gate is the group bound to your provider's application, not this variable.
```

- [ ] **Step 4: Add a troubleshooting entry**

Add a new `<Accordion>` to `docs-site/content/docs/run/troubleshooting.mdx`, inside the
same `<Accordions>` block:

```mdx
<Accordion title="Signing in with the identity provider starts a second empty account">

That is the designed behaviour, not a bug. Linking is explicit: an unknown
subject always creates a new account and never adopts an existing one, because
adopting on a matching email is an account-takeover class and no provider can
truthfully assert that an address is verified.

If the username was free you now have two accounts, and the persona data is on
the first. If it was taken, the sign-in failed with
"Could not sign you in" — which is the safe outcome, since resolving the clash to
`liam-2` would have handed you an empty account that reads as "my data is gone".

The fix in both cases is the same: sign in with your **password**, then
**Settings → Account → Link**. Delete the stray account afterwards if one was
created.

</Accordion>

<Accordion title="The auth container will not start, and the log names the discovery URL">

It fetches `AUTH_OIDC_DISCOVERY_URL` at startup and refuses to serve if it
cannot, by design — see the callout in [self-hosting](/docs/run/self-hosting).

Three causes, in order of likelihood:

1. The provider is down, or not reachable **from inside the container**. A URL
   that resolves on your laptop may not resolve on the container network.
2. The document is missing `issuer` or `jwks_uri`. Both are required: without
   them ID tokens could only be decoded, not verified, and MyGist refuses to
   register a provider on those terms.
3. `AUTH_OIDC_CLIENT_ID` or `AUTH_OIDC_CLIENT_SECRET` is unset. All three
   variables travel together.

To get back in while you fix it, unset `AUTH_OIDC_DISCOVERY_URL` on both
containers and restart. Password sign-in returns immediately and nothing is
lost — links stay in the database and come back with the variable.

</Accordion>
```

- [ ] **Step 5: Build the docs and check the links**

Run: `cd docs-site && npm run build && npm run check:links`
Expected: build succeeds, link check passes. A link check without the build first passes
against a stale `out/` and proves nothing.

- [ ] **Step 6: Commit**

```bash
git add docs-site/content/docs/run/self-hosting.mdx docs-site/content/docs/run/troubleshooting.mdx
git commit -m "docs: how to federate sign-in, and what invite-only does not cover"
```

---

## Manual verification — before merging

None of these is unit-testable, and the first and last are the two that have actually
broken in comparable work. Run against a preview with `AUTH_OIDC_*` set.

1. **The migration path.** Existing account signs in with a password → Settings → Link
   → sign out → "Continue with TDev Door" → lands on the **same** account, with its
   persona data. This is the one that matters: everything else can be rebuilt, an
   account that forks in two cannot.
2. **A new person.** An Authentik user with no MyGist account signs in → a new account,
   onboarding runs, and the handle is `preferred_username` (check
   `select username from public.users order by created_at desc limit 1`).
3. **The gate holds.** An Authentik user *not* in the bound group is refused by
   Authentik and never reaches MyGist at all.
4. **Provisioning really populated it.** `select id, username from public.users` and
   `select id, username, "displayUsername" from better_auth."user"` agree for the account
   from (2). A null here means `mapProfileToUser` did not reach the create path.
5. **Back-channel logout.** End the session in Authentik → the MyGist browser session is
   gone on the next request → **an MCP client's token still works**. The second half is
   the assertion; the first is the feature.
6. **The OAuth resume path.** MCP client → `/auth/oauth2/authorize` → not signed in →
   Authentik → back → **the authorize request resumes** and reaches consent. This is the
   fiddliest path in the project: MyGist is an OAuth server and an OAuth client in the
   same request, and `callbackURL` is the only thing preserving the in-flight authorize.
7. **The escape hatch.** With SSO on, "Sign in with a password instead" still signs in an
   account that has a password. This is what makes (1) possible at all.
8. **The legacy door is shut.**
   `curl -X POST https://<host>/api/auth/login -d '{"username":"…","password":"…"}' -H 'content-type: application/json'`
   → **403**, on a real username with a real password.

## Rollback

Unset `AUTH_OIDC_DISCOVERY_URL` on both containers and restart. Password sign-in returns
immediately, the button disappears, and the legacy endpoints reopen. No migration was run
and no rows were rewritten, so linked accounts survive in `better_auth.account` and come
back when the variable does.
