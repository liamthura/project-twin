/**
 * The back-channel logout receiver, end to end: a real HTTP POST against a
 * real Postgres, with Authentik played by a local, loopback-only IdP.
 *
 * sso.test.js covers `verifyLogoutToken` thoroughly, but never drives the
 * ENDPOINT -- form-body parsing, `findProvider`, `findAccountOwnerByKey`,
 * `deleteUserSessions`, `setHeader` -- so a typo in any of the handoffs
 * between those calls has zero automated coverage. `oauth-flow.test.js`'s own
 * header documents two production bugs that got through unit tests for
 * exactly that reason: they lived between steps, not inside one.
 *
 * The assertion that matters most is "does not touch machine credentials"
 * (test 2). Opaque API tokens in `public.tokens` live in config files on
 * other people's machines; the whole design of this receiver rests on a
 * routine session-end at the IdP never being able to kill one of those.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SignJWT, exportJWK, generateKeyPair } from "jose";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://mygist:mygist@localhost:5433/mygist_test";

// Its own database, same reasoning as oauth-flow.test.js: `node --test` runs
// files in parallel, and this file needs the real Better Auth schema while
// other files build trimmed or emptied versions of the same tables. A
// dedicated database removes the whole race rather than hoping timing works
// out.
const FLOW_DB = "mygist_sso_logout_test";

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
  await admin.query(`drop database if exists ${FLOW_DB} with (force)`);
  await admin.query(`create database ${FLOW_DB}`);
});

const DATABASE_URL = new URL(BASE_URL).href.replace(/\/[^/]*$/, `/${FLOW_DB}`);

// Fixed, same reason as oauth-flow.test.js: Better Auth reads BETTER_AUTH_URL
// at import to build its cookies and redirects. 3457 already belongs to that
// file; this one takes the next number.
const PORT = 3458;
const ORIGIN = `http://localhost:${PORT}`;

// --------------------------------------------------------------------------
// The local identity provider. genericOAuth's own `init` fetches the
// discovery document (and, on first verification, the JWKS), so Authentik has
// to be played by something reachable on loopback -- reaching a real one
// would violate the no-outbound-network rule this suite runs under, and
// wouldn't be reproducible in CI regardless.
// --------------------------------------------------------------------------
const { privateKey: idpPrivateKey, publicKey: idpPublicKey } =
  await generateKeyPair("RS256");
const idpJwk = await exportJWK(idpPublicKey);
idpJwk.kid = "sso-logout-test-key";
idpJwk.alg = "RS256";

let IDP_ORIGIN = "";
let IDP_ISSUER = "";

const idpServer = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/.well-known/openid-configuration") {
    res.end(
      JSON.stringify({
        issuer: IDP_ISSUER,
        authorization_endpoint: `${IDP_ORIGIN}/authorize`,
        token_endpoint: `${IDP_ORIGIN}/token`,
        userinfo_endpoint: `${IDP_ORIGIN}/userinfo`,
        jwks_uri: `${IDP_ORIGIN}/jwks`,
        // What makes better-auth treat this as OIDC rather than a bare OAuth2
        // provider -- see generic-oauth/index.mjs's `isOidc` check.
        id_token_signing_alg_values_supported: ["RS256"],
      }),
    );
    return;
  }
  if (req.url === "/jwks") {
    res.end(JSON.stringify({ keys: [idpJwk] }));
    return;
  }
  res.statusCode = 404;
  res.end("{}");
});
await new Promise((resolve) => idpServer.listen(0, "127.0.0.1", resolve));
IDP_ORIGIN = `http://127.0.0.1:${idpServer.address().port}`;
// Deliberately not the bare origin -- a realistic issuer, and what this
// receiver namespaces the seeded account under below.
IDP_ISSUER = `${IDP_ORIGIN}/application/o/mygist`;

const CLIENT_ID = "mygist-logout-test-client";

// Set before importing auth.js, which (via ssoPlugins/ssoConfig) reads all of
// these at module scope, and whose genericOAuth plugin fetches discovery
// during its own init.
process.env.BETTER_AUTH_URL = ORIGIN;
process.env.BETTER_AUTH_SECRET = "sso-logout-test-secret-at-least-32-chars";
process.env.DATABASE_URL = DATABASE_URL;
process.env.AUTH_OIDC_DISCOVERY_URL = `${IDP_ORIGIN}/.well-known/openid-configuration`;
process.env.AUTH_OIDC_CLIENT_ID = CLIENT_ID;
process.env.AUTH_OIDC_CLIENT_SECRET = "sso-logout-test-client-secret";
delete process.env.INVITE_ONLY;

const { auth, pool } = await import("./auth.js");
const { toNodeHandler } = await import("better-auth/node");
const { LOGOUT_EVENT } = await import("./sso.js");

let server;

before(async () => {
  await pool.query(
    readFileSync(join(HERE, "__fixtures__", "better-auth-schema.sql"), "utf8"),
  );

  // The user-create hook provisions a row here on real sign-up; nothing here
  // signs up, but public.users.id is still the identity public.tokens'
  // foreign key and every "same user" assertion below rest on. Mirrors
  // migration 0001, trimmed to what this flow touches -- same as
  // oauth-flow.test.js's copy of this table.
  await pool.query(`
    create table if not exists public.users (
        id         uuid primary key,
        username   text unique not null,
        created_at timestamptz not null default now()
    );
  `);

  // public.tokens is NOT part of better-auth-schema.sql -- it is MyGist's
  // own table, not Better Auth's, and this suite has no Python migration
  // runner. Trimmed the same way, to the columns test 2 inserts and reads
  // back. Mirrors backend/migrations/versions/0001_baseline.py's `tokens`
  // table; 0002_token_expiry.py's `expires_at` and
  // 0006_oauth_and_token_scopes.py's `scopes` are both omitted because
  // nothing here reads them.
  await pool.query(`
    create table if not exists public.tokens (
        id         uuid primary key default gen_random_uuid(),
        user_id    uuid not null references public.users(id),
        token_hash text unique not null,
        label      text not null default 'token',
        created_at timestamptz not null default now()
    );
  `);

  const handler = toNodeHandler(auth);
  server = createServer(handler);
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await new Promise((resolve) => idpServer.close(resolve));
  await pool?.end();
  // The pool has to be closed before the database can be dropped.
  await withAdmin((admin) =>
    admin.query(`drop database if exists ${FLOW_DB} with (force)`),
  );
});

/**
 * Insert a linked account directly rather than driving a real OAuth
 * callback. The point of this file is the logout path; a full
 * authorization-code dance would test better-auth rather than MyGist, and
 * oauth-flow.test.js already covers that dance.
 *
 * Also seeds an unrelated user with one live session, so tests can assert
 * that a logout for ONE user leaves everyone else alone.
 */
async function seedLinkedAccount() {
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const subject = `authentik-sub-${randomUUID()}`;
  const inHour = new Date(Date.now() + 60 * 60 * 1000);

  for (const [id, username] of [
    [userId, `sso${randomBytes(4).toString("hex")}`],
    [otherUserId, `sso${randomBytes(4).toString("hex")}`],
  ]) {
    await pool.query(
      `insert into public.users (id, username) values ($1, $2)`,
      [id, username],
    );
    await pool.query(
      `insert into better_auth."user"
         (id, name, email, "emailVerified")
       values ($1, $2, $3, true)`,
      [id, username, `${username}@example.test`],
    );
  }

  // The join key the receiver looks up on: `issuer` is the DISCOVERED
  // issuer, not anything this test invents, because genericOAuth namespaces
  // a federated account by that value and OIDC requires a logout token's
  // `iss` to match it.
  await pool.query(
    `insert into better_auth.account
       (id, "accountId", "providerId", "userId", issuer, "updatedAt")
     values ($1, $2, 'authentik', $3, $4, now())`,
    [randomUUID(), subject, userId, IDP_ISSUER],
  );

  // Two sessions for the account under test, so test 1 can prove ALL of a
  // user's sessions go, not just one -- and one for a different user, so it
  // can prove the logout did not reach past its target.
  const sessionA = { id: randomUUID(), token: randomBytes(16).toString("hex") };
  const sessionB = { id: randomUUID(), token: randomBytes(16).toString("hex") };
  const otherSession = {
    id: randomUUID(),
    token: randomBytes(16).toString("hex"),
  };
  for (const [session, owner] of [
    [sessionA, userId],
    [sessionB, userId],
    [otherSession, otherUserId],
  ]) {
    await pool.query(
      `insert into better_auth.session
         (id, "expiresAt", token, "updatedAt", "userId")
       values ($1, $2, $3, now(), $4)`,
      [session.id, inHour, session.token, owner],
    );
  }

  return {
    userId,
    otherUserId,
    subject,
    sessionIds: [sessionA.id, sessionB.id],
    otherSessionId: otherSession.id,
  };
}

async function sessionIdsFor(userId) {
  const { rows } = await pool.query(
    `select id from better_auth.session where "userId" = $1`,
    [userId],
  );
  return rows.map((r) => r.id);
}

async function accountExists(userId) {
  const { rows } = await pool.query(
    `select 1 from better_auth.account where "userId" = $1`,
    [userId],
  );
  return rows.length > 0;
}

async function insertToken(userId) {
  const id = randomUUID();
  await pool.query(
    `insert into public.tokens (id, user_id, token_hash)
     values ($1, $2, $3)`,
    [id, userId, randomBytes(16).toString("hex")],
  );
  return id;
}

/** Mirrors the helper in sso.test.js -- events, sub, iss, aud, iat, jti. */
async function logoutToken(privateKey, { sub, kid = idpJwk.kid, ...claims } = {}) {
  return new SignJWT({
    events: { [LOGOUT_EVENT]: {} },
    ...(sub !== undefined ? { sub } : {}),
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(IDP_ISSUER)
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setJti(randomUUID())
    .sign(privateKey);
}

function postLogout(token) {
  return fetch(`${ORIGIN}/auth/backchannel-logout`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(token === undefined ? {} : { logout_token: token }),
  });
}

test("a valid logout token ends every browser session for that user, and nothing else", async () => {
  const { userId, otherUserId, subject, otherSessionId } =
    await seedLinkedAccount();
  const token = await logoutToken(idpPrivateKey, { sub: subject });

  const res = await postLogout(token);
  assert.equal(res.status, 200, `logout failed: ${await res.text().catch(() => "")}`);

  assert.deepEqual(
    await sessionIdsFor(userId),
    [],
    "the user's sessions survived a valid logout",
  );
  assert.deepEqual(
    await sessionIdsFor(otherUserId),
    [otherSessionId],
    "a DIFFERENT user's session was deleted by someone else's logout",
  );
  // A logout is not an unlink: the next sign-in should still find the same
  // linked account rather than provisioning a second one.
  assert.ok(
    await accountExists(userId),
    "the linked account row was removed by a mere session logout",
  );
});

test("a valid logout token does not touch machine credentials", async () => {
  // This is the assertion the whole design rests on: killing a token that
  // lives in a config file on someone else's machine would break every
  // connected MCP client with no way to tell them why.
  const { userId, subject } = await seedLinkedAccount();
  const tokenId = await insertToken(userId);
  const logout = await logoutToken(idpPrivateKey, { sub: subject });

  const res = await postLogout(logout);
  assert.equal(res.status, 200, `logout failed: ${await res.text().catch(() => "")}`);

  const { rows } = await pool.query(
    `select id from public.tokens where id = $1`,
    [tokenId],
  );
  assert.equal(rows.length, 1, "back-channel logout deleted an opaque API token");
});

test("a token signed by the wrong key is refused, and changes nothing", async () => {
  const { userId, subject, sessionIds } = await seedLinkedAccount();
  const wrongKeys = await generateKeyPair("RS256");
  const forged = await logoutToken(wrongKeys.privateKey, { sub: subject });

  const res = await postLogout(forged);
  assert.ok(
    res.status >= 400,
    // The exact code is better-auth's to choose, but SOME refusal is not.
    `a token signed by the wrong key was not refused: ${res.status}`,
  );
  assert.deepEqual(
    (await sessionIdsFor(userId)).sort(),
    [...sessionIds].sort(),
    "a forged logout token deleted real sessions",
  );
});

test("an unknown subject answers 200 and deletes nothing", async () => {
  // OIDC Back-Channel Logout 1.0 section 2.8 mandates 200 here, deliberately
  // -- there is nothing the caller could do differently with a 404, and this
  // is what stops someone "fixing" it to one later.
  const { userId, sessionIds } = await seedLinkedAccount();
  const token = await logoutToken(idpPrivateKey, { sub: "no-such-subject" });

  const res = await postLogout(token);
  assert.equal(res.status, 200, `logout failed: ${await res.text().catch(() => "")}`);
  assert.deepEqual(
    (await sessionIdsFor(userId)).sort(),
    [...sessionIds].sort(),
    "an unknown subject's logout token deleted a real user's sessions",
  );
});

test("a request with no logout_token field is refused", async () => {
  const res = await postLogout(undefined);
  assert.ok(res.status >= 400, `a missing logout_token was not refused: ${res.status}`);
});
