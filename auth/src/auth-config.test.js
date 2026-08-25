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
