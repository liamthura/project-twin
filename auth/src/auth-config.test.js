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
// Asserted below to produce no `advanced.ipAddress` at all, so it must not be
// inherited from whatever shell runs this.
delete process.env.AUTH_TRUSTED_PROXIES;

const { auth, pool, trustedProxies } = await import("./auth.js");

after(async () => {
  await pool.end();
});

test("implicit linking is switched off explicitly, not left to luck", async () => {
  // The 1.7 sign-in path DOES look up an existing user by email
  // (oauth2/link-account.mjs:63) and would link the account to it. Today it
  // refuses only because Authentik reports email_verified:false AND MyGist's
  // seeded accounts are unverified -- two contingent facts, either of which
  // could change without anyone connecting the change to a takeover.
  //
  // Auto-linking on an unverifiable email claim is a known takeover class, so
  // "explicit only" is configured rather than inferred.
  const { auth } = await import("./auth.js");
  assert.equal(
    auth.options.account.accountLinking.disableImplicitLinking,
    true,
  );
});

test("the explicit link callback can reach an account with a placeholder email", async () => {
  // Both of these are what callback.mjs:171 and :175 read, and both are needed
  // for a pre-SSO account to link at all: its email is a `@mygist.invalid`
  // placeholder that can never equal the provider's real address, and Authentik
  // does not assert email_verified. sso-link-flow.test.js drives the real
  // callback and is the test with teeth; this one pins the config it depends on.
  const { auth } = await import("./auth.js");
  const linking = auth.options.account.accountLinking;
  assert.equal(linking.allowDifferentEmails, true);
  assert.deepEqual(linking.trustedProviders, ["authentik"]);
});

test("no discovery URL means no provider and no receiver", () => {
  // The gate, asserted on the assembled config rather than on ssoPlugins in
  // isolation: this is the thing that actually decides whether a self-hosted
  // instance grows a federated sign-in surface by upgrading.
  const ids = auth.options.plugins.map((p) => p.id);
  assert.ok(!ids.includes("generic-oauth"));
  assert.ok(!ids.includes("mygist-sso-logout"));
});

// ---------------------------------------------------------------------------
// Trusted proxies
// ---------------------------------------------------------------------------

test("trusted proxies are parsed, and absent when unset", () => {
  assert.deepEqual(
    trustedProxies({ AUTH_TRUSTED_PROXIES: " 172.18.0.0/16 , ,10.0.0.5 " }),
    ["172.18.0.0/16", "10.0.0.5"],
  );
  assert.deepEqual(trustedProxies({}), []);
  assert.deepEqual(trustedProxies({ AUTH_TRUSTED_PROXIES: " , " }), []);

  // The fail-safe, and the thing a reviewer should check first:
  // AUTH_TRUSTED_PROXIES is unset for this whole file, so the assembled config
  // must carry no `ipAddress` key at all. An empty default is not a gap here --
  // backend/auth_proxy.py overwrites X-Forwarded-For with its own view of the
  // peer, so what arrives is a single entry, and the case below is what proves
  // a single entry resolves with nothing configured.
  assert.equal(auth.options.advanced.ipAddress, undefined);
});

test("one authoritative entry resolves with no trusted proxies; a chain does not", async () => {
  // Measured against the real resolver, not reasoned about -- these are the
  // lines in trustedProxies' doc comment, and this is what keeps that comment
  // honest. It matters here more than most: a confidently wrong comment about
  // library behaviour is what made the private-range default look safe.
  const { getIPFromHeader } = await import("@better-auth/core/utils/ip");

  // What the proxy actually sends: exactly one entry, written by the hop that
  // terminated the caller's connection. No configuration needed.
  assert.equal(getIPFromHeader("203.0.113.7", {}), "203.0.113.7");

  // A chain resolves to nothing with nothing configured. That is the safe
  // failure -- a shared bucket -- and it is only reachable if some hop in front
  // of the proxy appends, which is the one case AUTH_TRUSTED_PROXIES is for.
  assert.equal(getIPFromHeader("203.0.113.99, 1.1.1.1", {}), null);

  // Why the private-range default was WORSE than empty rather than better.
  // Trusting ranges makes the walk return the rightmost entry it does not
  // trust, and neither of these is private -- so the caller's own second value
  // comes back, letting them choose a rate-limit bucket per request and write
  // any address they like into session.ipAddress.
  const privateRanges = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];
  assert.equal(
    getIPFromHeader("203.0.113.99, 1.1.1.1", { trustedProxies: privateRanges }),
    "1.1.1.1",
  );
  assert.equal(
    getIPFromHeader("203.0.113.99, 8.8.8.8", { trustedProxies: privateRanges }),
    "8.8.8.8",
  );
});

test("a configured list is one Better Auth will actually accept", async () => {
  // create-context.mjs WARNS and moves on for an unparseable entry rather than
  // failing, so a typo in AUTH_TRUSTED_PROXIES is silently dropped. Pinned
  // against the same validator the boot path uses, so the format documented in
  // auth/.env.example is known to pass it.
  const { findInvalidTrustedProxies } = await import(
    "@better-auth/core/utils/ip"
  );
  assert.deepEqual(
    findInvalidTrustedProxies(trustedProxies({ AUTH_TRUSTED_PROXIES: "172.18.0.0/16,10.0.0.5" })),
    [],
  );
  assert.deepEqual(findInvalidTrustedProxies(["172.18.0/16"]), ["172.18.0/16"]);
});
