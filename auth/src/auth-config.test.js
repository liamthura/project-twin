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

const { auth, pool, trustedProxies, PRIVATE_PROXY_RANGES } = await import(
  "./auth.js"
);

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

test("trusted proxies are parsed, and reach the assembled config", () => {
  // The list is what lets rate limiting resolve a client IP out of a
  // multi-entry X-Forwarded-For chain. Unresolved, every caller shares one
  // bucket and `/sign-in*` allows 3 requests per 10 seconds across all of them.
  assert.deepEqual(
    trustedProxies({ AUTH_TRUSTED_PROXIES: " 172.18.0.0/16 , ,10.0.0.5 " }),
    ["172.18.0.0/16", "10.0.0.5"],
  );

  // AUTH_TRUSTED_PROXIES is unset for this whole file, so this is the default
  // path -- and it must reach the config rather than being computed and
  // dropped. Asserting the value, not merely that the key exists: an empty
  // list here would validate fine and silently share the bucket again.
  assert.deepEqual(
    auth.options.advanced.ipAddress.trustedProxies,
    PRIVATE_PROXY_RANGES,
  );
});

// ---------------------------------------------------------------------------
// Trusted proxies
// ---------------------------------------------------------------------------

test("trusted proxies default to the private ranges, and a value replaces them", () => {
  // The default is what makes rate limiting work at all on a normal deploy:
  // this service is never published, so every hop in front of it is private.
  assert.deepEqual(trustedProxies({}), PRIVATE_PROXY_RANGES);
  assert.deepEqual(trustedProxies({ AUTH_TRUSTED_PROXIES: "  " }), PRIVATE_PROXY_RANGES);

  // REPLACES rather than extends -- an explicit value must re-list any private
  // range it still wants trusted. Asserted because the opposite is the
  // intuitive guess and getting it wrong silently stops trusting the network.
  assert.deepEqual(trustedProxies({ AUTH_TRUSTED_PROXIES: "104.24.0.0/14" }), [
    "104.24.0.0/14",
  ]);
  assert.deepEqual(
    trustedProxies({ AUTH_TRUSTED_PROXIES: " 10.0.0.0/8 , 104.24.0.0/14 " }),
    ["10.0.0.0/8", "104.24.0.0/14"],
  );
});

test("every default range is one Better Auth will actually accept", async () => {
  // create-context.mjs WARNS and moves on for an unparseable entry rather than
  // failing, so a typo here would be silently dropped and the bucket would
  // quietly go back to being shared. This is the only thing that would catch it.
  const { findInvalidTrustedProxies } = await import(
    "@better-auth/core/utils/ip"
  );
  assert.deepEqual(findInvalidTrustedProxies(PRIVATE_PROXY_RANGES), []);
});

test("the default resolves a client through private hops, and past a spoof", async () => {
  // Measured against the real resolver, not reasoned about. Each case below is
  // a line in trustedProxies' doc comment; this is what keeps that comment
  // honest, which matters on this branch more than most -- a confidently wrong
  // comment about library behaviour is what hid the linking bug.
  const { getIPFromHeader } = await import("@better-auth/core/utils/ip");
  const opts = { trustedProxies: PRIVATE_PROXY_RANGES };

  // Unchanged from no configuration at all.
  assert.equal(getIPFromHeader("203.0.113.7", opts), "203.0.113.7");

  // The case this exists for: unresolvable before, correct now.
  assert.equal(getIPFromHeader("203.0.113.7, 192.168.107.4", opts), "203.0.113.7");
  assert.equal(
    getIPFromHeader("203.0.113.7, 172.18.0.5, 192.168.1.4", opts),
    "203.0.113.7",
  );

  // Why the default is safe: the walk runs from the RIGHT and stops at the
  // first untrusted address, so a client that writes its own header is walked
  // past rather than believed.
  assert.equal(getIPFromHeader("1.2.3.4, 203.0.113.7", opts), "203.0.113.7");

  // A public CDN in front is NOT solved by the default -- it reports the CDN.
  // Asserted so the limitation is a fact in the suite rather than a caveat in
  // prose that nobody re-checks.
  assert.equal(getIPFromHeader("203.0.113.7, 104.24.1.1", opts), "104.24.1.1");
});
