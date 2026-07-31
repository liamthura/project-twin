import assert from "node:assert/strict";
import { test } from "node:test";

import { oauthProvider } from "@better-auth/oauth-provider";

import { AUTH_BASE_PATH } from "./base-path.js";
import { MCP_RESOURCE, SCOPES, oauthOptions } from "./oauth.js";

const ORIGIN = "https://mygist.example";

// Derived the same way auth.js derives it -- origin + AUTH_BASE_PATH -- rather
// than hand-written as an already-joined literal. A hand-written BASE here is
// exactly what let Task 5's review slip through: it matched the bug in the
// wiring (baseURL passed as the bare origin) by coincidence rather than by
// construction, so a regression there would not have failed this test.
const BASE = `${ORIGIN}${AUTH_BASE_PATH}`;

test("the MCP resource is the canonical URI, without a trailing slash", () => {
  assert.equal(MCP_RESOURCE(ORIGIN), "https://mygist.example/mcp");
  assert.equal(MCP_RESOURCE("https://mygist.example/"), "https://mygist.example/mcp");
});

test("the MCP resource is a valid audience, or every token request 400s", () => {
  const options = oauthOptions({ baseURL: BASE, publicOrigin: ORIGIN });
  assert.ok(options.validAudiences.includes("https://mygist.example/mcp"));
  assert.ok(options.validAudiences.includes(BASE));
});

test("all three persona scopes are offered", () => {
  const options = oauthOptions({ baseURL: BASE, publicOrigin: ORIGIN });
  for (const scope of SCOPES) assert.ok(options.scopes.includes(scope));
});

test("client_credentials is not enabled -- it cannot carry a user", () => {
  // Asserted against the EFFECTIVE, post-merge config -- oauthProvider's own
  // defaults include client_credentials, and it applies them with
  // `{ ...defaults, ...options }`, so a plain object-literal check on
  // oauthOptions()'s return value would pass even if this file forgot to set
  // grantTypes at all. That is exactly the false positive Task 5's review
  // caught: the grant stayed enabled server-wide despite this same assertion
  // passing, because it never looked at what the plugin actually ends up with.
  const provider = oauthProvider(oauthOptions({ baseURL: BASE, publicOrigin: ORIGIN }));
  assert.ok(!provider.options.grantTypes.includes("client_credentials"));
  assert.deepEqual(provider.options.grantTypes, ["authorization_code", "refresh_token"]);
});

test("registration is rate limited", () => {
  const options = oauthOptions({ baseURL: BASE, publicOrigin: ORIGIN });
  assert.equal(options.rateLimit.register.max, 5);
});

test("access tokens are short lived so revocation bites quickly", () => {
  const options = oauthOptions({ baseURL: BASE, publicOrigin: ORIGIN });
  assert.equal(options.accessTokenExpiresIn, "10m");
  assert.equal(options.refreshTokenExpiresIn, "30d");
});
