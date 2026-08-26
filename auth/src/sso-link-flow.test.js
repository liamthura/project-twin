/**
 * The explicit link callback, end to end.
 *
 * This is the path nothing on this branch crossed, and the reason the headline
 * capability shipped broken: /link-social sends the browser to the provider and
 * the answer comes back to /callback/:providerId, which for a link request
 * takes a branch of its own (api/routes/callback.mjs:150) that never reaches
 * `handleOAuthUserInfo` and has its own two guards. Config assertions in
 * auth-config.test.js pin the options; only this file proves what the guards do
 * with them.
 *
 * The case under test is the only one that matters for migration, and it is the
 * COMMON one, not an edge: every MyGist account that predates SSO holds a
 * `<username>@mygist.invalid` placeholder, because Better Auth requires an
 * address and MyGist had never asked for one. The provider returns a real
 * address, and Authentik does not assert `email_verified`. Both guards fire on
 * that shape.
 *
 * Same harness as sso-logout-flow.test.js -- own scratch database, own port,
 * Authentik played by a loopback server -- plus a token endpoint, because this
 * flow actually redeems a code.
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

// Its own database and its own port, same reasoning as the other two flow
// files: `node --test` runs files in parallel and this one needs the real
// Better Auth schema. 3457 and 3458 are taken; this is the next.
const FLOW_DB = "mygist_sso_link_test";
const PORT = 3459;
const ORIGIN = `http://localhost:${PORT}`;

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

// --------------------------------------------------------------------------
// The local identity provider.
// --------------------------------------------------------------------------
const { privateKey: idpPrivateKey, publicKey: idpPublicKey } =
  await generateKeyPair("RS256");
const idpJwk = await exportJWK(idpPublicKey);
idpJwk.kid = "sso-link-test-key";
idpJwk.alg = "RS256";

let IDP_ORIGIN = "";
let IDP_ISSUER = "";

// What the next redeemed code will be answered with. Set by each test before
// it drives the callback, because the id_token has to carry the nonce Better
// Auth minted for that particular /link-social call -- verify-id-token.mjs:54
// rejects the token outright if it does not match.
let nextIdentity = null;

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });
}

const idpServer = createServer(async (req, res) => {
  const path = req.url.split("?")[0];
  res.setHeader("content-type", "application/json");

  if (path === "/.well-known/openid-configuration") {
    res.end(
      JSON.stringify({
        issuer: IDP_ISSUER,
        authorization_endpoint: `${IDP_ORIGIN}/authorize`,
        token_endpoint: `${IDP_ORIGIN}/token`,
        userinfo_endpoint: `${IDP_ORIGIN}/userinfo`,
        jwks_uri: `${IDP_ORIGIN}/jwks`,
        id_token_signing_alg_values_supported: ["RS256"],
      }),
    );
    return;
  }

  if (path === "/jwks") {
    res.end(JSON.stringify({ keys: [idpJwk] }));
    return;
  }

  if (path === "/token") {
    // Drained but not checked. A fake IdP that validated the code, the PKCE
    // verifier and the client secret would be testing better-auth's request
    // builder; what this file is for is what MyGist's own config does with the
    // answer.
    await readBody(req);
    if (!nextIdentity) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "invalid_grant" }));
      return;
    }
    const idToken = await new SignJWT({
      sub: nextIdentity.subject,
      email: nextIdentity.email,
      // False, which is what Authentik reports by default and is the whole
      // reason callback.mjs:171 needs `trustedProviders`.
      email_verified: false,
      name: nextIdentity.username,
      preferred_username: nextIdentity.username,
      nonce: nextIdentity.nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: idpJwk.kid })
      .setIssuer(IDP_ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(idpPrivateKey);
    res.end(
      JSON.stringify({
        access_token: `at-${randomBytes(8).toString("hex")}`,
        token_type: "Bearer",
        expires_in: 3600,
        id_token: idToken,
      }),
    );
    return;
  }

  res.statusCode = 404;
  res.end("{}");
});
await new Promise((resolve) => idpServer.listen(0, "127.0.0.1", resolve));
IDP_ORIGIN = `http://127.0.0.1:${idpServer.address().port}`;
IDP_ISSUER = `${IDP_ORIGIN}/application/o/mygist`;

const CLIENT_ID = "mygist-link-test-client";

// Set before importing auth.js, which reads all of these at module scope.
process.env.BETTER_AUTH_URL = ORIGIN;
process.env.BETTER_AUTH_SECRET = "sso-link-test-secret-at-least-32-chars-xx";
process.env.DATABASE_URL = DATABASE_URL;
process.env.AUTH_OIDC_DISCOVERY_URL = `${IDP_ORIGIN}/.well-known/openid-configuration`;
process.env.AUTH_OIDC_CLIENT_ID = CLIENT_ID;
process.env.AUTH_OIDC_CLIENT_SECRET = "sso-link-test-client-secret";
delete process.env.INVITE_ONLY;

const { auth, pool } = await import("./auth.js");
const { toNodeHandler } = await import("better-auth/node");

let server;

before(async () => {
  await pool.query(
    readFileSync(join(HERE, "__fixtures__", "better-auth-schema.sql"), "utf8"),
  );
  // The user-create hook provisions a row here on sign-up, so sign-up fails
  // without it. Trimmed to what this flow touches, same as the other two flow
  // files' copies.
  await pool.query(`
    create table if not exists public.users (
        id         uuid primary key,
        username   text unique not null,
        created_at timestamptz not null default now()
    );
  `);

  server = createServer(toNodeHandler(auth));
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await new Promise((resolve) => idpServer.close(resolve));
  await pool?.end();
  await withAdmin((admin) =>
    admin.query(`drop database if exists ${FLOW_DB} with (force)`),
  );
});

/**
 * An account exactly as it exists on an instance that predates SSO: a real
 * password, and a placeholder address that no provider can ever match.
 *
 * A real sign-up rather than an inserted session row, following
 * oauth-flow.test.js: it is the same three lines, and it gets the user row, the
 * credential account, the session and the signed cookie from the code that
 * actually makes them rather than from this file's idea of their shape.
 */
async function signUpWithPlaceholderEmail() {
  const username = `link${randomBytes(4).toString("hex")}`;
  const res = await fetch(`${ORIGIN}/auth/sign-up/email`, {
    method: "POST",
    // Better Auth applies its CSRF origin check to every non-GET route, and a
    // browser always sends one. Omitting it fails with MISSING_OR_NULL_ORIGIN,
    // which reads like a config problem rather than a missing header.
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({
      // RFC 2606 reserves .invalid precisely so it can never resolve. This is
      // the address backend seeding wrote for every pre-SSO account.
      email: `${username}@mygist.invalid`,
      password: "correct horse battery staple",
      name: username,
      username,
    }),
  });
  assert.equal(
    res.status,
    200,
    `sign-up failed: ${await res.text().catch(() => "")}`,
  );
  const cookie = res.headers.getSetCookie().join("; ");
  assert.ok(cookie, "sign-up returned no session cookie");
  const { rows } = await pool.query(
    `select id, email from better_auth."user" where name = $1`,
    [username],
  );
  assert.equal(rows.length, 1, "sign-up created no user row");
  assert.match(rows[0].email, /@mygist\.invalid$/);
  return { username, cookie, userId: rows[0].id };
}

/** Drive /link-social and hand back the state and nonce it minted. */
async function startLink(cookie) {
  const res = await fetch(`${ORIGIN}/auth/link-social`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: ORIGIN },
    body: JSON.stringify({
      provider: "authentik",
      callbackURL: "/",
      errorCallbackURL: "/",
      // Otherwise this answers 302 with a Location and no body.
      disableRedirect: true,
    }),
    redirect: "manual",
  });
  const body = await res.text();
  assert.equal(res.status, 200, `link-social failed: ${body}`);
  const { url } = JSON.parse(body);
  assert.ok(url, "link-social returned no authorization URL");
  const authorize = new URL(url);
  const state = authorize.searchParams.get("state");
  const nonce = authorize.searchParams.get("nonce");
  assert.ok(state, "no state in the authorization URL");
  assert.ok(nonce, "no nonce in the authorization URL");
  // The state lives in a cookie as well as the URL; both have to come back.
  const stateCookie = res.headers.getSetCookie().join("; ");
  return { state, nonce, cookie: [cookie, stateCookie].filter(Boolean).join("; ") };
}

/** Come back the way the browser does, without following the final redirect. */
function returnFromProvider(state, cookie) {
  const query = new URLSearchParams({
    code: `code-${randomBytes(8).toString("hex")}`,
    state,
  });
  return fetch(`${ORIGIN}/auth/callback/authentik?${query}`, {
    headers: { cookie },
    redirect: "manual",
  });
}

async function federatedAccountsFor(userId) {
  const { rows } = await pool.query(
    `select "accountId" from better_auth.account
      where "userId" = $1 and "providerId" = 'authentik'`,
    [userId],
  );
  return rows.map((r) => r.accountId);
}

test("an account with a placeholder email can link the provider", async () => {
  const { username, cookie, userId } = await signUpWithPlaceholderEmail();
  assert.deepEqual(
    await federatedAccountsFor(userId),
    [],
    "the account was linked before anything drove the link flow",
  );

  const link = await startLink(cookie);
  const subject = `authentik-sub-${randomUUID()}`;
  nextIdentity = {
    subject,
    username,
    // A REAL address, which is the point: it cannot equal the placeholder the
    // local account holds, so callback.mjs:175 compares two different strings.
    email: `${username}@door.example.test`,
    nonce: link.nonce,
  };

  const res = await returnFromProvider(link.state, link.cookie);

  // The callback always redirects. Which URL it chose is the answer: the error
  // path appends `?error=<code>`, and reading that is how a failure here names
  // itself instead of showing up only as a missing row.
  const location = res.headers.get("location") || "";
  assert.ok(
    !location.includes("error="),
    `the link callback refused: ${location}`,
  );

  assert.deepEqual(
    await federatedAccountsFor(userId),
    [subject],
    "no federated account row was created for the signed-in user",
  );
});

test("linking twice from the same subject does not create a second row", async () => {
  // Not a curiosity: the Link control is reachable again after a link, and a
  // second row for the same subject would make `list-accounts` report two
  // providers and break the "is this the only way in" check the panel makes.
  const { username, cookie, userId } = await signUpWithPlaceholderEmail();
  const subject = `authentik-sub-${randomUUID()}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const link = await startLink(cookie);
    nextIdentity = {
      subject,
      username,
      email: `${username}@door.example.test`,
      nonce: link.nonce,
    };
    const res = await returnFromProvider(link.state, link.cookie);
    const location = res.headers.get("location") || "";
    assert.ok(
      !location.includes("error="),
      `link attempt ${attempt + 1} refused: ${location}`,
    );
  }

  assert.deepEqual(await federatedAccountsFor(userId), [subject]);
});

test("a subject already linked to somebody else is refused", async () => {
  // The remaining real failure on this path now that the email guard is open,
  // and the one AccountPanel's toast names as the likely cause.
  const first = await signUpWithPlaceholderEmail();
  const second = await signUpWithPlaceholderEmail();
  const subject = `authentik-sub-${randomUUID()}`;

  const firstLink = await startLink(first.cookie);
  nextIdentity = {
    subject,
    username: first.username,
    email: `${first.username}@door.example.test`,
    nonce: firstLink.nonce,
  };
  const firstRes = await returnFromProvider(firstLink.state, firstLink.cookie);
  assert.ok(!(firstRes.headers.get("location") || "").includes("error="));

  const secondLink = await startLink(second.cookie);
  nextIdentity = {
    subject,
    username: second.username,
    email: `${second.username}@door.example.test`,
    nonce: secondLink.nonce,
  };
  const secondRes = await returnFromProvider(secondLink.state, secondLink.cookie);

  assert.match(
    secondRes.headers.get("location") || "",
    /error=/,
    "a subject already linked elsewhere was linked a second time",
  );
  assert.deepEqual(
    await federatedAccountsFor(second.userId),
    [],
    "a stolen subject produced an account row anyway",
  );
});
