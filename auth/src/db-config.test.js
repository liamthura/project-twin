/**
 * What node-postgres actually ends up doing with our DATABASE_URL.
 *
 * These assert on `new Client(config).ssl` rather than on the helpers'
 * return values, and that distinction is the whole point of the file. The
 * previous attempt at this bug tested the parser in isolation, got the right
 * answer out of it, shipped, and still failed in production with
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE -- because ConnectionParameters merges the
 * parsed connection string OVER the caller's config and threw the right answer
 * away. A test one layer short of the thing that misbehaves proves nothing.
 *
 * `Client` is constructed but never connected: the constructor resolves the
 * TLS decision, so no database is needed to observe it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import pg from "pg";

import { poolConfig, sslModeOf, withoutSslMode } from "./db-config.js";

const resolvedSsl = (url) => new pg.Client(poolConfig(url)).ssl;

test("sslmode=require encrypts without verifying, as libpq reads it", () => {
  // Production's string, and the exact failure: node-postgres verified a
  // self-signed certificate that psycopg had been happily accepting.
  assert.deepEqual(resolvedSsl("postgres://u:p@h:5432/db?sslmode=require"), {
    rejectUnauthorized: false,
  });
});

test("sslmode=verify-full verifies the chain", () => {
  assert.deepEqual(resolvedSsl("postgres://u:p@h:5432/db?sslmode=verify-full"), {
    rejectUnauthorized: true,
  });
});

test("sslmode=verify-ca verifies the chain", () => {
  assert.deepEqual(resolvedSsl("postgres://u:p@h:5432/db?sslmode=verify-ca"), {
    rejectUnauthorized: true,
  });
});

test("sslmode=disable connects in plaintext", () => {
  assert.equal(resolvedSsl("postgres://u:p@h:5432/db?sslmode=disable"), false);
});

test("no sslmode connects in plaintext, which is what an internal network offers", () => {
  // libpq's default is `prefer` -- try TLS, fall back. node-postgres cannot
  // negotiate that fallback, and asking for TLS from a server without it fails
  // outright. Plaintext is the option that works for both.
  assert.equal(resolvedSsl("postgres://u:p@h:5432/db"), false);
});

test("a keyword/value connection string is rejected, and says why", () => {
  // node-postgres does not understand this form. It does not reject it either:
  // it takes the whole string as the database name and connects to a default
  // host. An explicit error beats a connection to somewhere unintended.
  assert.throws(
    () => poolConfig("host=h port=5432 dbname=db user=u sslmode=require"),
    /must be a URI/,
  );
});

test("a URI still reaches the right database once sslmode is removed", () => {
  const params = new pg.Client(poolConfig("postgres://u:p@h:5432/db?sslmode=require"))
    .connectionParameters;
  assert.equal(params.host, "h");
  assert.equal(params.database, "db");
  assert.equal(params.user, "u");
  assert.equal(params.password, "p");
});

test("other query parameters survive the strip", () => {
  assert.match(
    withoutSslMode("postgres://u:p@h:5432/db?sslmode=require&application_name=mygist"),
    /application_name=mygist/,
  );
});

test("a string without sslmode is left exactly as it was", () => {
  const url = "postgres://u:p@h:5432/db";
  assert.equal(withoutSslMode(url), url);
});

test("sslmode is read case-insensitively", () => {
  assert.equal(sslModeOf("postgres://u:p@h:5432/db?sslmode=REQUIRE"), "require");
});

test("options still pin the search_path to the auth schema", () => {
  // Regression guard: this travels in the same object as the ssl fix, and
  // losing it would put Better Auth's generic table names in `public`.
  assert.equal(poolConfig("postgres://u:p@h/db").options, "-c search_path=better_auth");
});
