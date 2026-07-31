/**
 * Revoking a connection, against a real Postgres.
 *
 * The bug this exists to stop is invisible in a stub: `/oauth2/delete-consent`
 * removes the consent row and the refresh grant never looks at it, so the
 * connection carries on refreshing. Only rows can show that -- an assertion
 * about which statement was issued would just be the statement written twice.
 *
 * Same arrangement as invite.test.js: the tables are Alembic's (migration
 * 0006), created here with `if not exists` so this suite is runnable on its
 * own. That is not a second definition competing with the migration -- these
 * statements do nothing at all wherever the migration has run, which is every
 * environment the Python suite has touched, so what is exercised there is the
 * real schema. They list only the columns this test needs, not the full table.
 *
 * One thing to know if this file ever fails with `duplicate key value violates
 * unique constraint "pg_type_typname_nsp_index"`, or with a table that plainly
 * exists reported as missing: nothing here is wrong. TEST_DATABASE_URL defaults
 * to the same mygist_test that backend/tests/conftest.py uses, and that suite
 * drops and rebuilds the whole schema -- `drop schema better_auth cascade`
 * included -- before EVERY test. Run the two suites at once and they fight over
 * the same catalog. CI is unaffected: the auth job gets its own Postgres
 * service container. Locally, run them one after the other, or point
 * TEST_DATABASE_URL at a database of this suite's own.
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import pg from "pg";

import { poolConfig } from "./db-config.js";
import { revokeConnection } from "./oauth.js";

const DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://mygist:mygist@localhost:5433/mygist_test";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";
const CLIENT_ID = "client-under-test";

let pool;

before(async () => {
  pool = new pg.Pool(poolConfig(DATABASE_URL));
  await pool.query("create schema if not exists better_auth");
  await pool.query(`
    create table if not exists better_auth."user" (
        "id"            text primary key,
        "name"          text        not null,
        "email"         text        not null,
        "emailVerified" boolean     not null,
        "createdAt"     timestamptz not null,
        "updatedAt"     timestamptz not null
    );
  `);
  await pool.query(`
    create table if not exists better_auth."oauthClient" (
        "id"           text primary key,
        "clientId"     text not null unique,
        "redirectUris" jsonb not null
    );
  `);
  await pool.query(`
    create table if not exists better_auth."oauthRefreshToken" (
        "id"        text primary key,
        "token"     text not null unique,
        "clientId"  text not null,
        "userId"    text not null,
        "expiresAt" timestamptz not null,
        "createdAt" timestamptz not null,
        "revoked"   timestamptz,
        "scopes"    jsonb not null
    );
  `);
  await pool.query(`
    create table if not exists better_auth."oauthAccessToken" (
        "id"        text primary key,
        "token"     text not null unique,
        "clientId"  text not null,
        "userId"    text,
        "expiresAt" timestamptz not null,
        "createdAt" timestamptz not null,
        "scopes"    jsonb not null
    );
  `);
  await pool.query(`
    create table if not exists better_auth."oauthConsent" (
        "id"        text primary key,
        "clientId"  text not null,
        "userId"    text,
        "scopes"    jsonb not null,
        "createdAt" timestamptz not null,
        "updatedAt" timestamptz not null
    );
  `);
});

after(async () => {
  await pool?.end();
});

beforeEach(async () => {
  await pool.query(`delete from better_auth."oauthConsent"`);
  await pool.query(`delete from better_auth."oauthAccessToken"`);
  await pool.query(`delete from better_auth."oauthRefreshToken"`);
  await pool.query(`delete from better_auth."oauthClient"`);
  await pool.query(`delete from better_auth."user"`);

  for (const id of [USER_ID, OTHER_USER_ID]) {
    await pool.query(
      `insert into better_auth."user"
         ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       values ($1, $1, $1 || '@mygist.invalid', false, now(), now())`,
      [id],
    );
  }
  await pool.query(
    `insert into better_auth."oauthClient" ("id", "clientId", "redirectUris")
     values ($1, $1, '[]'::jsonb)`,
    [CLIENT_ID],
  );
});

async function grant({ consentId, userId = USER_ID, clientId = CLIENT_ID }) {
  const scopes = JSON.stringify(["persona:read", "offline_access"]);
  await pool.query(
    `insert into better_auth."oauthConsent"
       ("id", "clientId", "userId", "scopes", "createdAt", "updatedAt")
     values ($1, $2, $3, $4::jsonb, now(), now())`,
    [consentId, clientId, userId, scopes],
  );
  await pool.query(
    `insert into better_auth."oauthRefreshToken"
       ("id", "token", "clientId", "userId", "expiresAt", "createdAt", "scopes")
     values ($1, $1, $2, $3, now() + interval '30 days', now(), $4::jsonb)`,
    [`refresh-${consentId}`, clientId, userId, scopes],
  );
  await pool.query(
    `insert into better_auth."oauthAccessToken"
       ("id", "token", "clientId", "userId", "expiresAt", "createdAt", "scopes")
     values ($1, $1, $2, $3, now() + interval '10 minutes', now(), $4::jsonb)`,
    [`access-${consentId}`, clientId, userId, scopes],
  );
}

const revokedAt = async (id) => {
  const { rows } = await pool.query(
    `select "revoked" from better_auth."oauthRefreshToken" where "id" = $1`,
    [id],
  );
  return rows[0]?.revoked ?? null;
};

test("the refresh token is revoked, not just the consent row", async () => {
  // The whole finding in one assertion: the refresh grant validates this row
  // and never reads oauthConsent, so a revoke that leaves `revoked` null is a
  // connection that keeps working for thirty more days.
  await grant({ consentId: "consent-1" });

  const result = await revokeConnection(pool, {
    consentId: "consent-1",
    userId: USER_ID,
  });

  assert.equal(result.clientId, CLIENT_ID);
  assert.equal(result.refreshTokensRevoked, 1);
  assert.notEqual(await revokedAt("refresh-consent-1"), null);
});

test("stored access tokens go too, and the consent row with them", async () => {
  await grant({ consentId: "consent-1" });

  const result = await revokeConnection(pool, {
    consentId: "consent-1",
    userId: USER_ID,
  });

  assert.equal(result.accessTokensDeleted, 1);
  const { rowCount: consents } = await pool.query(
    `select 1 from better_auth."oauthConsent" where "id" = 'consent-1'`,
  );
  assert.equal(consents, 0);
});

test("another user's connection is untouched, and reported as not found", async () => {
  await grant({ consentId: "theirs", userId: OTHER_USER_ID });

  const result = await revokeConnection(pool, {
    consentId: "theirs",
    userId: USER_ID,
  });

  assert.equal(result, null);
  assert.equal(await revokedAt("refresh-theirs"), null);
  const { rowCount } = await pool.query(
    `select 1 from better_auth."oauthConsent" where "id" = 'theirs'`,
  );
  assert.equal(rowCount, 1);
});

test("only the revoked client's tokens die, not every connection the user has", async () => {
  // Revoking one application must not sign the person out of the others --
  // the tokens are keyed by {clientId, userId}, and getting only the userId
  // half right would disconnect everything at once.
  await pool.query(
    `insert into better_auth."oauthClient" ("id", "clientId", "redirectUris")
     values ('other-client', 'other-client', '[]'::jsonb)`,
  );
  await grant({ consentId: "consent-1" });
  await grant({ consentId: "consent-2", clientId: "other-client" });

  await revokeConnection(pool, { consentId: "consent-1", userId: USER_ID });

  assert.notEqual(await revokedAt("refresh-consent-1"), null);
  assert.equal(await revokedAt("refresh-consent-2"), null);
});

test("an already-revoked token is not re-stamped with a later time", async () => {
  // `revoked` is a timestamp the plugin compares against, so overwriting it on
  // a second revoke would move the cutoff forwards. The `revoked is null`
  // guard in the UPDATE is what prevents that.
  await grant({ consentId: "consent-1" });
  await pool.query(
    `update better_auth."oauthRefreshToken"
        set "revoked" = now() - interval '1 day' where "id" = 'refresh-consent-1'`,
  );
  const before = await revokedAt("refresh-consent-1");

  const result = await revokeConnection(pool, {
    consentId: "consent-1",
    userId: USER_ID,
  });

  assert.equal(result.refreshTokensRevoked, 0);
  assert.deepEqual(await revokedAt("refresh-consent-1"), before);
});
