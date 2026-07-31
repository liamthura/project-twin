/**
 * The invite rule, against a real Postgres.
 *
 * These need a database because the rule IS a WHERE clause -- "revoked, or
 * expired, or spent" is four conditions that have to combine correctly, and a
 * stubbed pool would only prove that the string I wrote is the string I wrote.
 *
 * The table is created here rather than by Alembic, because this suite has no
 * Python. That leaves a seam: this DDL could drift from the migration's. The
 * seam is pinned from the other side by backend/tests/test_invite_schema.py,
 * which asserts the migrated table has exactly the columns, defaults and
 * constraints these tests assume.
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import pg from "pg";

import { poolConfig } from "./db-config.js";
import {
  ALPHABET,
  CODE_PATTERN,
  REJECTION,
  activeCount,
  check,
  inviteOnly,
  normalise,
  redeem,
} from "./invite.js";

const DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://mygist:mygist@localhost:5433/mygist_test";

let pool;

before(async () => {
  pool = new pg.Pool(poolConfig(DATABASE_URL));
  // Mirrors backend/migrations/versions/0005_invite_codes.py. Kept in the
  // `public` schema explicitly: poolConfig pins search_path to better_auth.
  await pool.query(`
    create table if not exists public.invite_codes (
        code        text primary key,
        label       text        not null,
        max_uses    integer     not null default 1,
        uses        integer     not null default 0,
        expires_at  timestamptz,
        revoked_at  timestamptz,
        created_at  timestamptz not null default now(),
        constraint invite_codes_uses_non_negative check (uses >= 0),
        constraint invite_codes_max_uses_positive check (max_uses >= 1)
    );
  `);
  await pool.query(`
    create table if not exists public.users (
        id         uuid primary key,
        username   text unique not null,
        created_at timestamptz not null default now()
    );
  `);
  await pool.query(
    `alter table public.users add column if not exists invited_with text`,
  );
});

after(async () => {
  await pool?.end();
});

beforeEach(async () => {
  await pool.query("delete from public.invite_codes");
  await pool.query("delete from public.users");
});

async function mint(code, overrides = {}) {
  const { label = "a tester", maxUses = 1, uses = 0, expiresAt = null, revokedAt = null } =
    overrides;
  await pool.query(
    `insert into public.invite_codes
       (code, label, max_uses, uses, expires_at, revoked_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [code, label, maxUses, uses, expiresAt, revokedAt],
  );
}

async function makeUser(id, username) {
  await pool.query(`insert into public.users (id, username) values ($1, $2)`, [
    id,
    username,
  ]);
}

const usesOf = async (code) =>
  (await pool.query("select uses from public.invite_codes where code = $1", [code]))
    .rows[0].uses;

// ---------------------------------------------------------------------------
// Normalisation — the trap that has already bitten this project twice
// ---------------------------------------------------------------------------

test("a lowercase code is the same code", () => {
  assert.equal(normalise("7f2k-qx91"), "7F2K-QX91");
});

test("a code typed without its separator is the same code", () => {
  assert.equal(normalise("7F2KQX91"), "7F2K-QX91");
});

test("surrounding whitespace from a copy-paste is ignored", () => {
  assert.equal(normalise("  7F2K-QX91 \n"), "7F2K-QX91");
});

test("a non-string does not throw", () => {
  assert.equal(normalise(undefined), "");
  assert.equal(normalise(null), "");
  assert.equal(normalise(42), "");
});

test("the alphabet excludes every character people mistype", () => {
  // I/1, L/1, O/0 are the confusable pairs; U follows Crockford so a code can
  // never accidentally spell a word.
  for (const excluded of ["I", "L", "O", "U"]) {
    assert.ok(!ALPHABET.includes(excluded), `${excluded} must not be mintable`);
  }
});

test("the pattern rejects a code containing an excluded character", () => {
  assert.ok(!CODE_PATTERN.test("IIII-LLLL"));
  assert.ok(CODE_PATTERN.test("7F2K-QX91"));
});

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

test("an unused code admits", async () => {
  await mint("7F2K-QX91");
  assert.deepEqual(await check(pool, "7F2K-QX91"), { ok: true, code: "7F2K-QX91" });
});

test("it admits however the tester typed it", async () => {
  await mint("7F2K-QX91");
  assert.equal((await check(pool, "7f2kqx91")).ok, true);
});

test("an unknown code is refused", async () => {
  assert.deepEqual(await check(pool, "0000-0000"), { ok: false, reason: REJECTION });
});

test("a revoked code is refused", async () => {
  await mint("7F2K-QX91", { revokedAt: new Date("2020-01-01") });
  assert.equal((await check(pool, "7F2K-QX91")).ok, false);
});

test("an expired code is refused", async () => {
  await mint("7F2K-QX91", { expiresAt: new Date("2020-01-01") });
  assert.equal((await check(pool, "7F2K-QX91")).ok, false);
});

test("a code expiring in the future still admits", async () => {
  await mint("7F2K-QX91", { expiresAt: new Date("2099-01-01") });
  assert.equal((await check(pool, "7F2K-QX91")).ok, true);
});

test("a code with no expiry admits", async () => {
  await mint("7F2K-QX91", { expiresAt: null });
  assert.equal((await check(pool, "7F2K-QX91")).ok, true);
});

test("a spent code is refused", async () => {
  await mint("7F2K-QX91", { maxUses: 1, uses: 1 });
  assert.equal((await check(pool, "7F2K-QX91")).ok, false);
});

test("a multi-use code admits until it is spent", async () => {
  await mint("3B8M-KP44", { maxUses: 3, uses: 2 });
  assert.equal((await check(pool, "3B8M-KP44")).ok, true);

  await pool.query("update public.invite_codes set uses = 3 where code = '3B8M-KP44'");
  assert.equal((await check(pool, "3B8M-KP44")).ok, false);
});

test("every refusal says the same thing", async () => {
  await mint("AAAA-AAAA", { revokedAt: new Date("2020-01-01") });
  await mint("BBBB-BBBB", { expiresAt: new Date("2020-01-01") });
  await mint("CCCC-CCCC", { maxUses: 1, uses: 1 });

  // Distinguishing them tells a guesser which codes are worth pursuing, and
  // tells a genuine tester nothing they can act on.
  const reasons = await Promise.all(
    ["AAAA-AAAA", "BBBB-BBBB", "CCCC-CCCC", "0000-0000", "nonsense"].map(async (c) =>
      (await check(pool, c)).reason,
    ),
  );
  assert.deepEqual(new Set(reasons), new Set([REJECTION]));
});

test("a malformed code never reaches the database", async () => {
  // Guards the rate-limit budget, and keeps /auth/invite/check from being a
  // cheap way to make the database work.
  const spy = { calls: 0, query: async (...a) => (spy.calls++, pool.query(...a)) };
  assert.equal((await check(spy, "not-a-code")).ok, false);
  assert.equal(spy.calls, 0);
});

// ---------------------------------------------------------------------------
// Redemption
// ---------------------------------------------------------------------------

test("redeeming counts the use and records who came in", async () => {
  await mint("7F2K-QX91");
  const id = "11111111-1111-1111-1111-111111111111";
  await makeUser(id, "sarah");

  assert.equal(await redeem(pool, "7F2K-QX91", id), true);

  assert.equal(await usesOf("7F2K-QX91"), 1);
  const { rows } = await pool.query("select invited_with from public.users where id = $1", [
    id,
  ]);
  assert.equal(rows[0].invited_with, "7F2K-QX91");
});

test("redeeming normalises too, so attribution is not split by spelling", async () => {
  await mint("7F2K-QX91");
  const id = "22222222-2222-2222-2222-222222222222";
  await makeUser(id, "typed-it-lowercase");

  await redeem(pool, "7f2kqx91", id);

  assert.equal(await usesOf("7F2K-QX91"), 1);
});

test("losing the race for the last use still records attribution", async () => {
  // The account already exists by this point -- refusing now would be worse
  // than admitting one over the limit. But the counter must not be pushed past
  // its own maximum on the way.
  await mint("7F2K-QX91", { maxUses: 1, uses: 1 });
  const id = "33333333-3333-3333-3333-333333333333";
  await makeUser(id, "lost-the-race");

  assert.equal(await redeem(pool, "7F2K-QX91", id), false);

  assert.equal(await usesOf("7F2K-QX91"), 1);
  const { rows } = await pool.query("select invited_with from public.users where id = $1", [
    id,
  ]);
  assert.equal(rows[0].invited_with, "7F2K-QX91");
});

test("a revoked code cannot be redeemed", async () => {
  await mint("7F2K-QX91", { revokedAt: new Date("2020-01-01") });
  const id = "44444444-4444-4444-4444-444444444444";
  await makeUser(id, "too-late");

  assert.equal(await redeem(pool, "7F2K-QX91", id), false);
  assert.equal(await usesOf("7F2K-QX91"), 0);
});

// ---------------------------------------------------------------------------
// The boot line
// ---------------------------------------------------------------------------

test("the active count ignores codes that cannot admit anyone", async () => {
  await mint("AAAA-AAAA");
  await mint("BBBB-BBBB", { revokedAt: new Date("2020-01-01") });
  await mint("CCCC-CCCC", { expiresAt: new Date("2020-01-01") });
  await mint("DDDD-DDDD", { maxUses: 1, uses: 1 });

  // Printed at boot precisely so that turning the mode on with nothing usable
  // -- which locks out everyone including you -- is visible in the log.
  assert.equal(await activeCount(pool), 1);
});

// ---------------------------------------------------------------------------
// The switch
// ---------------------------------------------------------------------------

test("invite-only is off unless explicitly turned on", () => {
  const previous = process.env.INVITE_ONLY;
  try {
    for (const value of [undefined, "", "false", "0", "no"]) {
      if (value === undefined) delete process.env.INVITE_ONLY;
      else process.env.INVITE_ONLY = value;
      assert.equal(inviteOnly(), false, `${JSON.stringify(value)} must not enable it`);
    }

    for (const value of ["true", "TRUE", "True"]) {
      process.env.INVITE_ONLY = value;
      assert.equal(inviteOnly(), true);
    }
  } finally {
    if (previous === undefined) delete process.env.INVITE_ONLY;
    else process.env.INVITE_ONLY = previous;
  }
});
