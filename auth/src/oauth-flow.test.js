/**
 * The OAuth handshake, end to end, against a real auth service and a real
 * Postgres: register -> authorize -> sign in -> consent -> token -> refresh
 * -> revoke.
 *
 * This exists because two production bugs got through unit tests and three
 * rounds of review, and both lived in the handoffs BETWEEN steps -- which is
 * precisely what a per-step test cannot see:
 *
 *   1. The consent screen dropped `offline_access` from the granted set, so no
 *      refresh token was ever issued. Every connection would have died after
 *      ten minutes and re-prompted, forever, while the docs promised thirty
 *      days.
 *
 *   2. A client that registered using the scope list from our protected-
 *      resource metadata was stored WITHOUT `offline_access` -- our metadata
 *      omits it on purpose, because the MCP specification says a resource
 *      server SHOULD NOT advertise it -- and `/oauth2/authorize` validates
 *      against the registered client's scopes rather than the server's. Asking
 *      for the refresh token it was entitled to came back `invalid_scope`.
 *      Found by Claude Code on the first real connection.
 *
 * Every OAuth test before this one minted a token by hand with a stubbed
 * signing key, which is why neither was caught. The assertions below are
 * therefore written against the OUTCOMES those bugs broke -- a refresh token
 * that exists, an authorize request that is not refused -- rather than against
 * the shape of any one step.
 *
 * The consent step deliberately mirrors what Consent.jsx actually posts,
 * including computing the granted scope set from the REGISTERED client's
 * scopes rather than from the authorize request. That is a seam: the logic is
 * duplicated here rather than shared, so a change to the component will not
 * change this test. It is mirrored rather than shared because the component is
 * React and this suite is plain Node -- worth revisiting if that logic moves
 * into a module both can import.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://mygist:mygist@localhost:5433/mygist_test";

// This file gets a database of its own, created here and dropped in `after`.
//
// `node --test` runs test FILES in parallel, and this one needs the real
// Better Auth schema while oauth-revoke.test.js builds a trimmed version of
// the same tables in the same schema and empties them between cases. Sharing
// one database means whichever file loses the race sees tables it did not
// create, or rows deleted underneath it. An extra database costs a few
// milliseconds and removes the whole class.
const FLOW_DB = "mygist_oauth_flow_test";

async function withAdmin(fn) {
  const admin = new pg.Client({ connectionString: BASE_URL });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}

await withAdmin(async (admin) => {
  // FORCE because a previous aborted run can leave a connection behind, and a
  // failed drop here would surface as a confusing "already exists" later.
  await admin.query(`drop database if exists ${FLOW_DB} with (force)`);
  await admin.query(`create database ${FLOW_DB}`);
});

const DATABASE_URL = new URL(BASE_URL).href.replace(/\/[^/]*$/, `/${FLOW_DB}`);

// Fixed, because Better Auth reads BETTER_AUTH_URL at import to build its
// cookies and redirects -- so the port has to be known before the server that
// listens on it exists. High enough not to collide with the real service.
const PORT = 3457;
const ORIGIN = `http://localhost:${PORT}`;
const MCP_RESOURCE = `${ORIGIN}/mcp`;

// Set before importing auth.js, which reads all of these at module scope.
process.env.BETTER_AUTH_URL = ORIGIN;
process.env.BETTER_AUTH_SECRET = "integration-test-secret-at-least-32-chars";
process.env.DATABASE_URL = DATABASE_URL;
process.env.AUTH_MCP_RESOURCE = MCP_RESOURCE;
delete process.env.INVITE_ONLY;

const { auth, pool } = await import("./auth.js");
const { toNodeHandler } = await import("better-auth/node");
const { READ, PROPOSE, WRITE, revokeConnection } = await import("./oauth.js");

const PERSONA_SCOPES = [READ, PROPOSE, WRITE];

let server;

before(async () => {
  await pool.query(
    readFileSync(join(HERE, "__fixtures__", "better-auth-schema.sql"), "utf8"),
  );

  // The user-create hook provisions a row here, so sign-up fails without it.
  // Mirrors migration 0001, trimmed to what this flow touches.
  await pool.query(`
    create table if not exists public.users (
        id         uuid primary key,
        username   text unique not null,
        created_at timestamptz not null default now()
    );
  `);

  const handler = toNodeHandler(auth);
  server = createServer(handler);
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await pool?.end();
  // The pool has to be closed before the database can be dropped, which is
  // why this is not a `finally` around the whole file.
  await withAdmin((admin) =>
    admin.query(`drop database if exists ${FLOW_DB} with (force)`),
  );
});

/** PKCE, S256 only -- the plugin rejects `plain`. */
function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// Origin is set on every request because Better Auth applies its CSRF origin
// check to all non-GET routes, and a browser would always send one. Omitting
// it fails with MISSING_OR_NULL_ORIGIN, which reads like a config problem
// rather than a missing header.
const api = (path, init = {}) =>
  fetch(`${ORIGIN}/auth${path}`, {
    redirect: "manual",
    ...init,
    headers: { origin: ORIGIN, ...init.headers },
  });

const json = (path, body, headers = {}) =>
  api(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

/**
 * Register the way a real MCP client does: with the scope list it read from
 * our protected-resource metadata, which does NOT include offline_access.
 *
 * That omission is the whole point. Registering with the full list would test
 * a client we do not have.
 */
async function registerClient() {
  const res = await json("/oauth2/register", {
    client_name: `flow-test-${randomUUID().slice(0, 8)}`,
    redirect_uris: ["http://localhost:9876/callback"],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    scope: PERSONA_SCOPES.join(" "),
  });
  const body = await res.json().catch(() => null);
  assert.equal(res.status, 200, `registration failed: ${JSON.stringify(body)}`);
  return body;
}

async function signUp() {
  const username = `flow${randomBytes(4).toString("hex")}`;
  const res = await json("/sign-up/email", {
    email: `${username}@example.test`,
    password: "correct horse battery staple",
    name: username,
    username,
  });
  assert.equal(res.status, 200, `sign-up failed: ${await res.text().catch(() => "")}`);
  const cookie = res.headers.getSetCookie().join("; ");
  assert.ok(cookie, "sign-up returned no session cookie");
  return { username, cookie };
}

function authorizeURL(clientId, challenge) {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "http://localhost:9876/callback",
    // offline_access is what the client asks for to get a refresh token, and
    // what finding 2 refused. It is deliberately NOT in our resource
    // metadata's scopes_supported.
    scope: [...PERSONA_SCOPES, "offline_access"].join(" "),
    resource: MCP_RESOURCE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: randomBytes(8).toString("hex"),
  });
  return `/oauth2/authorize?${query}`;
}

/** What Consent.jsx posts, computed the way Consent.jsx computes it. */
function grantedScope(clientScopes, { propose = true, write = true } = {}) {
  const asked = (s) => clientScopes.includes(s);
  return [
    ...(asked(READ) ? [READ] : []),
    ...(asked(PROPOSE) && propose ? [PROPOSE] : []),
    ...(asked(WRITE) && write ? [WRITE] : []),
    // Everything the client asked for that is not ours to decide --
    // offline_access, above all. Dropping this was finding 1.
    ...clientScopes.filter((s) => !PERSONA_SCOPES.includes(s)),
  ].join(" ");
}

/** Drive register -> authorize -> consent -> token, returning the token body. */
async function handshake({ propose = true, write = true } = {}) {
  const client = await registerClient();
  const { cookie } = await signUp();
  const { verifier, challenge } = pkce();

  const authorized = await api(authorizeURL(client.client_id, challenge), {
    headers: { cookie },
  });

  // Better Auth answers a non-browser caller with 200 and {redirect, url}
  // rather than a 302, so read whichever form arrived. Both carry the same
  // destination, and the signed query we have to hand back is in it either way.
  const location =
    authorized.headers.get("location") ??
    (await authorized.json().catch(() => ({})))?.url ??
    "";

  // The guard for finding 2: a client registered without offline_access was
  // refused here, and the refusal arrives as a redirect to the client's
  // callback carrying invalid_scope rather than as an error status.
  assert.ok(
    !location.includes("invalid_scope"),
    `authorize refused the request: ${location}`,
  );
  assert.ok(location.includes("/consent"), `expected consent, got: ${location}`);

  // Byte-for-byte, as the SPA does: the server re-derives a signature from
  // this string, so a rebuilt one would silently fail to verify.
  const oauthQuery = location.split("?")[1] ?? "";

  // The scopes the screen decides against come from THIS query string, not
  // from /oauth2/public-client (which returns only display fields). Same source
  // Consent.jsx reads, so a client that asked for less renders less.
  const clientScopes = (new URLSearchParams(oauthQuery).get("scope") || "")
    .split(" ")
    .filter(Boolean);
  assert.ok(
    clientScopes.includes("offline_access"),
    `the consent redirect dropped offline_access: ${clientScopes}`,
  );

  const consented = await json(
    "/oauth2/consent",
    {
      accept: true,
      scope: grantedScope(clientScopes, { propose, write }),
      oauth_query: oauthQuery,
    },
    { cookie },
  );
  const consentBody = await consented.json().catch(() => null);
  assert.equal(
    consented.status,
    200,
    `consent failed: ${JSON.stringify(consentBody)}`,
  );
  const callback = new URL(consentBody.url);
  const code = callback.searchParams.get("code");
  assert.ok(code, `no authorization code in ${consentBody.url}`);

  // RFC 9207. The MCP specification has this at SHOULD and says it expects to
  // raise it to MUST, so a client that validates it must not be surprised.
  assert.equal(
    callback.searchParams.get("iss"),
    `${ORIGIN}/auth`,
    "authorization response carried no issuer",
  );

  const tokened = await api("/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: "http://localhost:9876/callback",
      client_id: client.client_id,
      code_verifier: verifier,
      resource: MCP_RESOURCE,
    }),
  });
  const token = await tokened.json().catch(() => null);
  assert.equal(tokened.status, 200, `token failed: ${JSON.stringify(token)}`);
  return { client, cookie, clientScopes, token };
}

test("a client registered from our resource metadata can still refresh", async () => {
  // Finding 2, at its own step: the registration must end up holding
  // offline_access even though the client never asked for it, because our
  // metadata is the reason it did not know to.
  const client = await registerClient();
  assert.ok(
    client.scope.split(" ").includes("offline_access"),
    `registered scopes lack offline_access: ${client.scope}`,
  );
});

test("the whole handshake yields a usable access token AND a refresh token", async () => {
  const { token } = await handshake();

  assert.ok(token.access_token, "no access token");
  // Finding 1. Without this the connection dies in ten minutes, forever.
  assert.ok(token.refresh_token, "no refresh token — the connection cannot survive");
  assert.equal(token.token_type?.toLowerCase(), "bearer");

  const claims = JSON.parse(
    Buffer.from(token.access_token.split(".")[1], "base64url").toString(),
  );
  // The MCP specification's hardest requirement: a resource server must be
  // able to prove a token was issued for it specifically.
  assert.equal(claims.aud, MCP_RESOURCE);
  assert.ok(claims.sub, "no subject — nothing to scope a persona to");
  assert.ok(claims.scope.split(" ").includes(READ));
});

test("declining write keeps it out of the token, and read survives", async () => {
  const { token } = await handshake({ propose: true, write: false });
  const granted = JSON.parse(
    Buffer.from(token.access_token.split(".")[1], "base64url").toString(),
  ).scope.split(" ");

  assert.ok(granted.includes(READ));
  assert.ok(granted.includes(PROPOSE));
  assert.ok(!granted.includes(WRITE), `write was granted anyway: ${granted}`);
  assert.ok(token.refresh_token, "declining write should not cost the refresh token");
});

test("the refresh token actually refreshes", async () => {
  const { client, token } = await handshake();

  const refreshed = await api("/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      client_id: client.client_id,
      resource: MCP_RESOURCE,
    }),
  });
  const next = await refreshed.json().catch(() => null);
  assert.equal(refreshed.status, 200, `refresh failed: ${JSON.stringify(next)}`);
  assert.ok(next.access_token, "refresh returned no access token");
});

test("revoking a connection stops it refreshing", async () => {
  const { client, token } = await handshake();
  const claims = JSON.parse(
    Buffer.from(token.access_token.split(".")[1], "base64url").toString(),
  );

  // revokeConnection takes the consent id, which is what the Connected apps
  // list hands it -- so look it up the way that screen does rather than
  // reaching for the client id directly.
  const { rows } = await pool.query(
    `select "id" from better_auth."oauthConsent"
      where "clientId" = $1 and "userId" = $2`,
    [client.client_id, claims.sub],
  );
  assert.equal(rows.length, 1, "consent row missing after a completed grant");

  // The bug this guards: /oauth2/delete-consent removes only the consent row,
  // and the refresh grant never reads it -- so a revoked client kept
  // refreshing for thirty days while the UI said access had ended.
  await revokeConnection(pool, {
    consentId: rows[0].id,
    userId: claims.sub,
  });

  const refreshed = await api("/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      client_id: client.client_id,
      resource: MCP_RESOURCE,
    }),
  });
  assert.notEqual(
    refreshed.status,
    200,
    "a revoked connection refreshed successfully",
  );
});

test("session JWTs and access tokens agree on the issuer", async () => {
  // The API has ONE issuer setting and verifies both token types against it.
  // Better Auth does not agree with itself by default: the JWT plugin signs
  // `iss` as the bare origin (`options?.jwt?.issuer ?? baseURLOrigin`) while
  // the OAuth provider signs it as `ctx.context.baseURL`, origin plus
  // basePath. That mismatch cost a production outage in each direction --
  // AUTH_ISSUER set to the origin refused every MCP connection, set to
  // origin+/auth it refused every web request -- and both arrived as a bare
  // 401 naming no claim. auth.js pins the plugin so one setting is correct
  // for both; this is what stops that drifting apart again.
  const { cookie } = await signUp();
  const res = await api("/token", { headers: { cookie } });
  const exchanged = await res.json().catch(() => null);
  assert.equal(
    res.status,
    200,
    `token exchange failed: ${JSON.stringify(exchanged)}`,
  );
  const { token } = exchanged;

  const session = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString(),
  );
  const expected = `${ORIGIN}/auth`;
  assert.equal(session.iss, expected, "session JWT issuer drifted");
  assert.equal(session.aud, expected, "session JWT audience drifted");

  const { token: oauth } = await handshake();
  const access = JSON.parse(
    Buffer.from(oauth.access_token.split(".")[1], "base64url").toString(),
  );
  assert.equal(
    access.iss,
    session.iss,
    "the two token types disagree on the issuer, so no single AUTH_ISSUER can verify both",
  );
});
