import assert from "node:assert/strict";
import { test } from "node:test";

import { oauthProvider } from "@better-auth/oauth-provider";

import { SCOPES, canonicalResource, mcpResource, oauthOptions, registrationScopes } from "./oauth.js";

const ORIGIN = "https://mygist.example";

// What AUTH_MCP_RESOURCE holds, on both containers.
const RESOURCE = `${ORIGIN}/mcp`;

test("a resource URI is canonicalised, trailing slash and all", () => {
  // An audience is an exact string match, so `.../mcp/` and `.../mcp` are two
  // different resources to every client that follows the spec -- and the
  // trailing slash is the operator's to type wrong.
  assert.equal(canonicalResource("https://mygist.example/mcp"), "https://mygist.example/mcp");
  assert.equal(canonicalResource("  https://mygist.example/mcp/  "), "https://mygist.example/mcp");
  assert.equal(canonicalResource(undefined), "");
});

test("the OAuth surface is gated on AUTH_MCP_RESOURCE", () => {
  // Unset, this container must not register /oauth2/register -- which anyone
  // may post to unauthenticated. An instance that never opted in should not
  // acquire an authorization server by upgrading.
  assert.equal(mcpResource({}), "");
  assert.equal(mcpResource({ AUTH_MCP_RESOURCE: "" }), "");
  assert.equal(
    mcpResource({ AUTH_MCP_RESOURCE: "https://mygist.example/mcp/" }),
    RESOURCE,
  );
});

test("the MCP resource is a configured resource, or every authorize 400s", () => {
  // 1.7 replaced `validAudiences` with `resources`, which are seeded as rows
  // rather than matched from a list. An unconfigured one comes back
  // `invalid_target` at /oauth2/authorize -- in the browser, on the callback,
  // long after anything could have caught it at boot.
  const options = oauthOptions({ mcpResource: RESOURCE });
  assert.deepEqual(options.resources, ["https://mygist.example/mcp"]);

  // And off, because 1.7 defaults it on and every client registered before
  // this upgrade has no oauthClientResource row. See oauth.js.
  assert.equal(options.enforcePerClientResources, false);
});

test("all three persona scopes are offered", () => {
  const options = oauthOptions({ mcpResource: RESOURCE });
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
  const provider = oauthProvider(oauthOptions({ mcpResource: RESOURCE }));
  assert.ok(!provider.options.grantTypes.includes("client_credentials"));
  assert.deepEqual(provider.options.grantTypes, ["authorization_code", "refresh_token"]);
});

test("registration is rate limited", () => {
  const options = oauthOptions({ mcpResource: RESOURCE });
  assert.equal(options.rateLimit.register.max, 5);
});

test("access tokens are short lived so revocation bites quickly", () => {
  const options = oauthOptions({ mcpResource: RESOURCE });
  // Seconds as numbers, not time-span strings: the plugin adds these onto a
  // unix timestamp, so a string silently produces an Invalid Date and a 500
  // from Postgres on the very last step of the handshake.
  assert.equal(options.accessTokenExpiresIn, 600);
  assert.equal(options.refreshTokenExpiresIn, 2592000);
  assert.equal(typeof options.accessTokenExpiresIn, "number");
  assert.equal(typeof options.refreshTokenExpiresIn, "number");
});

// Registration scopes. The bug these cover was found on the first real
// connection from Claude Code, not by any test: our resource metadata omits
// offline_access (the MCP spec says a resource server SHOULD NOT advertise it),
// the client registered with the list it read there, and /oauth2/authorize
// validates against the REGISTERED client's scopes -- so asking for a refresh
// token came back `invalid_scope`.

test("a registration that omits offline_access has it added", () => {
  assert.equal(
    registrationScopes("persona:read persona:propose persona:write"),
    "persona:read persona:propose persona:write offline_access",
  );
});

test("a registration that already asked for it is left alone", () => {
  assert.equal(registrationScopes("persona:read offline_access"), undefined);
});

test("a scope-less registration is left to the plugin's own default", () => {
  // The plugin defaults an absent scope to the full `scopes` option, which
  // already contains offline_access. Rewriting it here would replace a list
  // that adapts to the server's config with a frozen copy.
  assert.equal(registrationScopes(undefined), undefined);
  assert.equal(registrationScopes(""), undefined);
});

test("the requested scopes survive, and are not replaced", () => {
  assert.equal(
    registrationScopes("persona:read"),
    "persona:read offline_access",
  );
});
