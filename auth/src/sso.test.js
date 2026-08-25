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
