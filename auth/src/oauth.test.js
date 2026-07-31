import assert from "node:assert/strict";
import { test } from "node:test";

import { MCP_RESOURCE, SCOPES, oauthOptions } from "./oauth.js";

const BASE = "https://mygist.example/auth";
const ORIGIN = "https://mygist.example";

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
  const options = oauthOptions({ baseURL: BASE, publicOrigin: ORIGIN });
  assert.ok(!(options.grantTypes ?? []).includes("client_credentials"));
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
