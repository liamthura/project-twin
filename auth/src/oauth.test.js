import assert from "node:assert/strict";
import { test } from "node:test";

import { oauthProvider } from "@better-auth/oauth-provider";

import {
  SCOPES,
  canonicalResource,
  mcpResource,
  oauthOptions,
  registrationApplicationType,
} from "./oauth.js";

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

  // And left unset, so 1.7's `true` stands -- the per-client check of RFC 8707
  // section 3. Pre-upgrade clients are linked by backfillClientResources in
  // preflight.js; asserted as `undefined` rather than as the effective `true`
  // because it is this file NOT setting it that is the decision. See oauth.js.
  assert.equal(options.enforcePerClientResources, undefined);

  // New clients are linked at registration. Without this the plugin links a
  // dynamic registration to nothing, and the check above then refuses it at
  // its first authorize -- one step after the step that returned 201.
  assert.deepEqual(options.clientRegistrationDefaultResources, [RESOURCE]);
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

// Registration application type. The bug this covers is 1.7's: an omitted
// `application_type` means "web" per RFC 7591, a web client may not redirect
// to loopback, and every MCP client omits the field and redirects to loopback.
// Registration is refused before a browser ever opens.

const register = (uris, extra = {}) => ({ redirect_uris: uris, ...extra });

test("a client with only loopback callbacks is native, and may register", () => {
  assert.equal(
    registrationApplicationType(register(["http://127.0.0.1:9876/callback"])),
    "native",
  );
  assert.equal(
    registrationApplicationType(register(["http://localhost:9876/callback"])),
    "native",
  );
  assert.equal(
    registrationApplicationType(register(["http://[::1]:9876/callback"])),
    "native",
  );
});

test("a client that named its own application_type is left alone", () => {
  // Self-asserted metadata is the client's to state. Overriding it would
  // refuse the https callback a web client with a local listener actually uses.
  assert.equal(
    registrationApplicationType(
      register(["http://127.0.0.1:9876/callback"], { application_type: "web" }),
    ),
    undefined,
  );
});

test("anything not purely loopback is left to Better Auth to judge", () => {
  // Including the mixed case: one loopback callback does not make a client
  // with an https callback native.
  for (const uris of [
    ["https://app.example.com/callback"],
    ["http://192.168.1.50:9876/callback"],
    ["http://0.0.0.0:9876/callback"],
    ["myapp://oauth/callback"],
    ["http://127.0.0.1:9876/callback", "https://app.example.com/callback"],
    ["not a url"],
    [],
  ]) {
    assert.equal(registrationApplicationType(register(uris)), undefined, uris.join(" "));
  }
});
