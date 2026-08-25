# Better Auth 1.7 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `better-auth` and `@better-auth/oauth-provider` from 1.6.25 to 1.7.1 with the schema changes applied as hand-written Alembic migrations, leaving the MCP OAuth surface working.

**Architecture:** Phase 1 of `docs/superpowers/specs/2026-08-25-authentik-sso-design.md`. No SSO in this branch. The order is fixed by the 1.7 upgrade guide: prepare data, apply schema migrations, then deploy the packages. Alembic stays the only thing that writes DDL; `@better-auth/cli` is used at development time to *generate* SQL for a human to fold into a revision, exactly as migration 0003 documents.

**Tech Stack:** Node 22 + Better Auth (service in `auth/`), FastAPI + Alembic + psycopg (`backend/`), Postgres 16 with pgvector.

## Global Constraints

- `better-auth` and `@better-auth/oauth-provider` move **together** to `1.7.1`. They share a schema; a mismatch is not a supported configuration.
- `@better-auth/cli` is versioned **independently** and lags — `latest` is `1.4.22`. Do not pin it to 1.7.1; that version does not exist.
- The CLI's `generate` requires a **live database** to introspect. It will exit with `ECONNREFUSED` without one.
- Alembic is the only thing that writes DDL in any environment. CLI output is a draft for a human, never applied directly.
- Next Alembic revision number is **0010**; current head is `0009_history_and_reads`.
- Every migration statement must be idempotent and safe against the live production database — the convention `0001_baseline` established and `rerun_migrations` enforces.
- Node tests: `cd auth && npm test`. Python tests: `cd backend && docker compose up -d && python -m pytest -q`.
- **No SSO code in this branch.** No `genericOAuth`, no `AUTH_OIDC_*`, no frontend changes.

## Already true, do not "fix"

Two things the 1.7 upgrade guide flags that **do not apply here** — confirmed by reading the code, not assumed:

- **`oauthApplication` → `oauthClient` does not apply.** Migration `0006_oauth_and_token_scopes.py:38` already creates `better_auth."oauthClient"`, along with `oauthRefreshToken`, `oauthAccessToken` and `oauthConsent`. `@better-auth/oauth-provider` 1.6.25 already used the new naming. There is no client-data move.
- **The account backfill is one `UPDATE`.** `backend/scripts/seed_better_auth.py:49,170` writes credential accounts as `providerId = 'credential'`, `accountId = user_id`. That is exactly the shape the guide expects (`issuer = 'local:credential'`, `accountId = user.id`), and collisions are impossible because `accountId` is a UUID primary key.

## File Structure

- **Modify** `auth/package.json` — dependency versions only.
- **Create** `backend/migrations/versions/0010_better_auth_17.py` — the whole 1.7 schema delta in one revision.
- **Create** `backend/tests/test_migration_0010.py` — backfill correctness and the unique index.
- **Modify** `docs/superpowers/plans/notes/better_auth_1.7_fields.txt` — generated reference, committed so the next person can see what the revision was derived from.

---

### Task 1: Capture the real 1.7 schema delta

> **DONE — but not by the method below.** `@better-auth/cli` cannot generate a
> correct 1.7 delta: it hard-pins its own `better-auth` dependency (latest is
> 1.4.22 → `better-auth@1.4.22`) and imports the diff engine by bare specifier,
> so plugin tables come out right and core tables come from the stale copy.
> `account.issuer` was silently absent. The artifact was produced from the
> public `getAuthTables` API instead — see
> `docs/superpowers/plans/notes/README.md` for the exact snippet and the full
> reasoning. Steps below are kept for the record; do not re-run them.

Generating the schema beats reading a changelog: the revision is written from what the library actually declares for *this* plugin set, not from a summary table.

**Files:**
- Create: `docs/superpowers/plans/notes/better_auth_1.7_fields.txt`

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/superpowers/plans/notes/better_auth_1.7_fields.txt`, the generated 1.7 schema. Task 2 reads it to write the migration.

- [ ] **Step 1: Bring up the local database and migrate it to 1.6.25 head**

OrbStack or Docker Desktop must be running first.

```bash
cd backend && docker compose up -d
python -m alembic upgrade head
```

Expected: `0009_history_and_reads` applied, no errors.

- [ ] **Step 2: Build a scratch copy of the auth service on 1.7.1**

Do not install 1.7.1 into `auth/` yet — the packages are deployed *after* the migration, and a half-upgraded working tree makes a failing test ambiguous.

```bash
S=/tmp/ba17 && rm -rf $S && mkdir -p $S
cd /Users/khantthura/Documents/ProjectL/project-twin/auth
cp -r src package.json .env $S/
cd $S
npm pkg set dependencies.better-auth=1.7.1 dependencies.@better-auth/oauth-provider=1.7.1
npm install --no-audit --no-fund
node -e "console.log(require('./node_modules/better-auth/package.json').version)"
```

Expected: prints `1.7.1`.

- [ ] **Step 3: Generate the schema**

`AUTH_MCP_RESOURCE` must be set or the OAuth plugins are not registered and their tables will be missing from the output — that gating is deliberate, see `auth/src/auth.js`.

```bash
cd /tmp/ba17
set -a; . ./.env; set +a
export AUTH_MCP_RESOURCE="${AUTH_MCP_RESOURCE:-https://mygist.local/mcp}"
npx --yes @better-auth/cli@latest generate --config src/auth.js --output ./ba17.sql -y
```

Expected: `ba17.sql` written. If it exits with `ECONNREFUSED` on port 5433, Step 1 did not leave Postgres running.

- [ ] **Step 4: Confirm the delta is real and contains the account identity change**

```bash
grep -c . /tmp/ba17/ba17.sql
grep -i "issuer" /tmp/ba17/ba17.sql
```

Expected: non-empty file, and at least one line mentioning `issuer`. If `issuer` is absent, stop — the CLI introspected a database that was not at `0009` head, and the delta is wrong.

- [ ] **Step 5: Commit the generated reference**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
mkdir -p docs/superpowers/plans/notes
cp /tmp/ba17/ba17.sql docs/superpowers/plans/notes/better_auth_1.7_fields.txt
git add docs/superpowers/plans/notes/better_auth_1.7_fields.txt
git commit -m "chore: capture the better-auth 1.7 schema delta this migration is written from"
```

---

### Task 2: Migration 0010 — the 1.7 schema delta

**Files:**
- Create: `backend/migrations/versions/0010_better_auth_17.py`
- Test: `backend/tests/test_migration_0010.py`
- Read: `docs/superpowers/plans/notes/better_auth_1.7_fields.txt` (from Task 1)

**Interfaces:**
- Consumes: the generated delta from Task 1.
- Produces: Alembic revision `0010_better_auth_17`, chained off `0009_history_and_reads`. Task 3 deploys packages against it.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_migration_0010.py`:

```python
"""The 1.7 account identity change, over data that already exists.

The backfill is the whole risk here. Better Auth 1.7 keys an account on
(issuer, accountId) rather than (providerId, accountId), and the generated
migration cannot choose issuers for you -- on MySQL it silently backfills
empty strings. On Postgres a missed row fails the NOT NULL instead, which is
why this asserts the value rather than merely that the column exists.
"""
import sys
import uuid
from pathlib import Path

import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402

CREDENTIAL_ISSUER = "local:credential"


def _make_credential_account(user_id):
    """A credential account in the shape seed_better_auth.py writes."""
    account_id = str(uuid.uuid4())
    with db.get_pool().connection() as conn:
        conn.execute(
            'insert into better_auth."user"'
            ' ("id", "name", "email", "emailVerified", "updatedAt", "username")'
            " values (%s, %s, %s, false, now(), %s)",
            (str(user_id), "Test", f"{user_id}@mygist.invalid", str(user_id)[:8]),
        )
        conn.execute(
            'insert into better_auth."account"'
            ' ("id", "accountId", "providerId", "userId", "password",'
            ' "createdAt", "updatedAt", "issuer")'
            " values (%s, %s, 'credential', %s, 'x', now(), now(), %s)",
            (account_id, str(user_id), str(user_id), CREDENTIAL_ISSUER),
        )
    return account_id


def test_credential_accounts_are_backfilled_with_the_local_issuer(
    rerun_migrations, fresh_schema
):
    user_id = uuid.uuid4()
    _make_credential_account(user_id)

    # Put the row back into its pre-1.7 shape. Inserting it that way is not
    # possible -- the column is NOT NULL once the migration has run -- and
    # without this the backfill's `where "issuer" is null` matches nothing and
    # the test passes without exercising anything.
    with db.get_pool().connection() as conn:
        conn.execute(
            'alter table better_auth."account" alter column "issuer" drop not null'
        )
        conn.execute(
            'update better_auth."account" set "issuer" = null where "userId" = %s',
            (str(user_id),),
        )

    rerun_migrations()

    with db.get_pool().connection() as conn:
        row = conn.execute(
            'select "issuer" from better_auth."account" where "userId" = %s',
            (str(user_id),),
        ).fetchone()
    assert row["issuer"] == CREDENTIAL_ISSUER


def test_issuer_and_account_id_are_unique_together():
    user_id = uuid.uuid4()
    _make_credential_account(user_id)

    # Same (issuer, accountId) as the row above -- the pair Better Auth 1.7
    # now treats as the identity, so a second one must be refused.
    with pytest.raises(psycopg.errors.UniqueViolation):
        with db.get_pool().connection() as conn:
            conn.execute(
                'insert into better_auth."account"'
                ' ("id", "accountId", "providerId", "userId",'
                ' "createdAt", "updatedAt", "issuer")'
                " values (%s, %s, 'credential', %s, now(), now(), %s)",
                (str(uuid.uuid4()), str(user_id), str(user_id), CREDENTIAL_ISSUER),
            )
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && python -m pytest tests/test_migration_0010.py -v
```

Expected: FAIL — `psycopg.errors.UndefinedColumn: column "issuer" of relation "account" does not exist`.

- [ ] **Step 3: Write the migration**

Create `backend/migrations/versions/0010_better_auth_17.py`. Add any *additional* additive columns and indexes found in `docs/superpowers/plans/notes/better_auth_1.7_fields.txt` alongside the account block below, following the same `if not exists` style. Do **not** copy the CLI's output wholesale — it emits full `create table` statements for tables that already exist.

```python
"""Better Auth 1.7's schema changes.

Derived from `@better-auth/cli generate` against better-auth 1.7.1 with this
project's plugin set -- the generated output is committed at
docs/superpowers/plans/notes/better_auth_1.7_fields.txt. Regenerate rather than
hand-edit if the plugin set changes.

The account identity change is the only one with a data step. 1.7 keys an
account on (issuer, accountId) instead of (providerId, accountId), and the
generated migration deliberately refuses to choose issuers for you. Every
account this database has today is a credential account written by
scripts/seed_better_auth.py or by sign-up, so there is exactly one issuer to
assign and no collision to resolve: accountId is a uuid primary key.

Add nullable, backfill, then constrain. Adding the column NOT NULL in one step
would fail against any database that already has rows -- which is every
database this will ever run against.

Revision ID: 0010_better_auth_17
Revises: 0009_history_and_reads
"""
from alembic import op

revision = "0010_better_auth_17"
down_revision = "0009_history_and_reads"
branch_labels = None
depends_on = None

CREDENTIAL_ISSUER = "local:credential"


def upgrade() -> None:
    op.execute(
        'alter table better_auth."account" add column if not exists "issuer" text'
    )

    # Only ever touches rows the previous run left behind, so a re-run over a
    # database that is already migrated is a no-op rather than a rewrite.
    op.execute(
        f"""
        update better_auth."account"
           set "issuer" = '{CREDENTIAL_ISSUER}'
         where "issuer" is null
           and "providerId" = 'credential'
        """
    )

    # Anything that is not a credential account has no issuer this migration
    # can invent. There are none today; failing loudly beats inventing one.
    op.execute(
        """
        do $$
        begin
          if exists (select 1 from better_auth."account" where "issuer" is null) then
            raise exception 'account rows with no issuer remain; backfill them before upgrading';
          end if;
        end $$
        """
    )

    op.execute(
        'alter table better_auth."account" alter column "issuer" set not null'
    )
    op.execute(
        'create unique index if not exists "account_issuer_accountId_uidx"'
        ' on better_auth."account" ("issuer", "accountId")'
    )


def downgrade() -> None:
    op.execute('drop index if exists better_auth."account_issuer_accountId_uidx"')
    op.execute('alter table better_auth."account" drop column if exists "issuer"')
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && python -m pytest tests/test_migration_0010.py -v
```

Expected: both tests PASS.

- [ ] **Step 5: Run the full backend suite for regressions**

```bash
cd backend && python -m pytest -q
```

Expected: all pass. `test_seed_better_auth.py` is the one to watch — it inserts account rows and will now hit the NOT NULL.

If it fails, `backend/scripts/seed_better_auth.py:170` needs `"issuer"` added to its insert with the value `local:credential`. Fix it there, in the insert, not by relaxing the constraint.

- [ ] **Step 6: Verify the migration is re-runnable**

```bash
cd backend && python -m alembic downgrade -1 && python -m alembic upgrade head && python -m alembic upgrade head
```

Expected: no errors on any of the three. The second `upgrade head` is the idempotency check.

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/versions/0010_better_auth_17.py backend/tests/test_migration_0010.py backend/scripts/seed_better_auth.py
git commit -m "feat(db): better-auth 1.7 schema, with the account issuer backfilled"
```

---

### Task 3: Move the packages to 1.7.1

Migration first, packages second — the order the upgrade guide specifies. A 1.7 service against a 1.6 schema fails at runtime in ways that look like application bugs.

**Files:**
- Modify: `auth/package.json`
- Modify: `auth/package-lock.json` (generated)

**Interfaces:**
- Consumes: revision `0010_better_auth_17` applied.
- Produces: `auth/` running better-auth 1.7.1. Task 4 verifies it end to end.

- [ ] **Step 1: Bump both packages together**

```bash
cd auth
npm install better-auth@1.7.1 @better-auth/oauth-provider@1.7.1
node -e "console.log(require('better-auth/package.json').version, require('@better-auth/oauth-provider/package.json').version)"
```

Expected: `1.7.1 1.7.1`.

- [ ] **Step 2: Run the auth service test suite**

```bash
cd auth && npm test
```

Expected: all pass. `oauth-flow.test.js`, `oauth.test.js` and `oauth-revoke.test.js` cover the surface most likely to have moved.

- [ ] **Step 3: Fix whatever broke, one failure at a time**

Do not batch fixes. If `oauth.js` needs changes for a renamed option, make that change, re-run, commit. The 1.7 breaking changes that could plausibly reach this codebase: database joins config moved from `experimental.joins` to `advanced.database.joins`; adapters now require `incrementOne` and `consumeOne` (built-in adapters already have them, so this only bites if a custom adapter appears).

- [ ] **Step 4: Boot the service and confirm it starts clean**

```bash
cd auth && npm start
```

Expected: starts without throwing, and the boot log reports invite mode as it did before. Ctrl-C when confirmed.

- [ ] **Step 5: Commit**

```bash
git add auth/package.json auth/package-lock.json auth/src
git commit -m "chore(auth): better-auth and oauth-provider to 1.7.1"
```

---

### Task 4: MCP OAuth regression against a running preview

The exit criterion for the whole branch. None of it is covered by unit tests, and it is the surface most likely to have broken: the OAuth provider plugin moved a minor version and its tables are the ones the migration touched.

**Files:** none — this is verification.

**Interfaces:**
- Consumes: Tasks 2 and 3 merged into the working tree.
- Produces: a pass/fail gate on merging the branch.

- [ ] **Step 1: Bring the full stack up**

```bash
./scripts/local-preview.sh
```

- [ ] **Step 2: Walk the flow, recording each result**

Follow `~/.claude/projects/.../memory/verify-mcp-against-running-preview.md` — mint a token in-container, JSON-RPC over SSE to `/mcp`. The three traps recorded there give false failures if skipped.

Each of these must pass:

1. Register a new OAuth client via `/auth/oauth2/register`, and confirm it is stored **with** `offline_access` in its scopes (the `oauthRegistrationScopePlugin` case — without it, the refresh grant fails later with `invalid_scope`).
2. Authorize → consent → token, as a fresh client.
3. Refresh the access token using the refresh token.
4. Call `/mcp` with the resulting access token and get a real tool response.
5. Revoke the connection from Account → Connected apps, and confirm the refresh grant now fails.
6. **A client registered before the upgrade still works.** Register one on 1.6.25 first if the database has none — this is the only check that exercises the migration against pre-existing OAuth rows.
7. Sign in to the web app and confirm the SPA still exchanges its session cookie for a JWT at `/auth/token`.

- [ ] **Step 3: Record the result in the PR body**

List all seven with their outcome. A regression pass that is not written down did not happen.

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "chore: better-auth 1.7.1" \
  --body "$(printf 'Phase 1 of the Authentik SSO design. No SSO code in this branch.\n\n## MCP OAuth regression\n\n1. Client registration with offline_access: \n2. Authorize -> consent -> token: \n3. Refresh: \n4. Tool call over /mcp: \n5. Revoke connection: \n6. Pre-upgrade client still works: \n7. SPA session -> JWT exchange: \n')"
```

Fill each line with the outcome before opening it, not after.

---

## Done when

- `0010_better_auth_17` is applied, re-runnable, and reversible.
- `cd auth && npm test` and `cd backend && python -m pytest -q` both green.
- All seven MCP OAuth checks pass and are recorded in the PR.
- No SSO code in the diff.
