# Codebase Review — Hand-Rolled Infrastructure Audit

**Date:** 2026-07-27
**Status:** Analysis. No decision taken.
**Question asked:** where is MyGist maintaining something by hand that a
mainstream framework or service would maintain better?

## Summary

Three findings are worth acting on soon (migrations, CI, observability), one
is a large but high-value refactor (bespoke editors), and several plausible
"replace with a framework" candidates should be left alone because the
current choice is already the mainstream one.

---

## Already on the standard — do not replace

**Postgres FTS + pgvector rather than a search service.** Keeping retrieval
in the database is the current mainstream approach. Introducing Typesense,
Meilisearch or Algolia would add a service, a synchronisation path, a new
failure mode, and would contradict the single-container direction. The
existing hybrid RRF query is the right shape.

**Raw `psycopg` rather than an ORM.** The SQL is deliberate:
`resolve_token` (`db.py:238-251`) updates `tokens.last_used_at` and
`users.last_seen_at` and returns the user in a single round-trip; the search
query is a hand-tuned reciprocal-rank fusion. An ORM would obscure both for
no gain.

**Exactly-pinned dependencies with recorded rationale**
(`requirements.txt:3-7`, noting that unpinned ranges previously drifted
production onto fastmcp 3.x / starlette 1.x). Better discipline than most
production codebases.

**`jsonschema` for pack manifests.** Language-neutral, which matters because
pack authors contribute JSON, not Python.

**The auth primitives.** bcrypt for passwords, sha256 for 256-bit random
tokens (a slow hash would buy nothing), and a deliberate timing-attack
mitigation in `verify_password` (`db.py:320-343`).

---

## Findings

### 1. Schema migrations are hand-rolled — adopt Alembic

**Evidence:** `db.py:64-107`. `ensure_schema()` issues
`create table if not exists`, then imperative `alter table ... add column if
not exists` (lines 84-85), then a data backfill (lines 101-107) that
migrates legacy single-token users and still executes on every process
start, long after it was needed.

**Cost of the status quo:**

- No version tracking — there is no way to determine what schema state a
  given database is in.
- No rollback path.
- Migrations cannot be tested in isolation from application boot.
- Two containers starting concurrently can race on DDL.
- The function only grows; nothing can ever be retired from it.

**Alternative:** Alembic — versioned, ordered, reversible migrations, run as
a deploy step rather than on every boot. Lets the legacy backfill finally be
retired.

**Effort:** ~2 days, including baselining the existing schema as the initial
revision.

**Note:** the vector DDL split across separate connections (`db.py:109-142`)
is careful, correct work and should be preserved through any migration —
an HNSW build failure must continue to degrade to FTS-only rather than
crash startup.

### 2. No CI — add GitHub Actions

**Evidence:** no `.github` directory exists.

389 tests run only when someone remembers, on one machine. Dependencies are
exact-pinned, so a scheduled run would also surface environment drift.

**Effort:** ~1 hour. pytest against a `pgvector/pgvector:pg16` service
container, on push and pull request.

This is the cheapest item here and it protects every other change.

### 3. Seven bespoke editors versus one generic one

**Evidence:** `App.jsx:626-683` hard-wires seven section editors:

| Editor | Lines |
| --- | --- |
| `ProfileEditor.jsx` | 1,446 |
| `LifestyleEditor.jsx` | 1,165 |
| `KnowledgeEditor.jsx` | 1,138 |
| `ProjectsEditor.jsx` | 1,021 |
| `PreferencesEditor.jsx` | 478 |
| `CircleEditor.jsx` | 471 |
| `LearningLogEditor.jsx` | 331 |
| **Total** | **~6,050** |

Against `GenericSectionEditor.jsx` at **282 lines**, already serving goals,
media and aesthetics from manifest `ui` hints.

`lifestyle/manifest.json` already declares `ui` hints while still using its
bespoke editor, which suggests this migration was started and not finished.

**Alternative:** not a framework — the manifest-driven pattern already built
and proven in this repo. Completing it would delete more code than every
other item here combined and make new sections genuinely manifest-only,
which is the stated goal of the section-pack design.

**Effort:** ~1 week. This is refactoring rather than infrastructure, so it
deserves deliberate scheduling rather than being squeezed alongside other
work.

### 4. No error tracking — add Sentry

**Evidence:** no references to Sentry, PostHog, OpenTelemetry or similar
anywhere in `backend/` or `frontend/src/`.

MyGist is multi-user. A 500 served to a user is currently invisible unless
they report it.

**Alternative:** Sentry free tier, backend and frontend.

**Effort:** ~2 hours.

### 5. No rate limiting on authentication

**Evidence:** no rate limiting anywhere in the backend.
`POST /api/auth/login` accepts unlimited attempts.

The timing mitigation in `verify_password` prevents username enumeration but
does nothing against brute force.

**Alternative:** `slowapi`, or a Postgres-backed attempt counter keyed on
username and client IP.

**Effort:** ~1 day with tests. See also the two other auth gaps recorded in
`2026-07-27-frontend-api-migration.md` — token expiry and the `localStorage`
token.

### 6. Manual `useEffect` data fetching — TanStack Query

**Evidence:** 9 `useEffect` call sites handling fetching across 13 stateful
files.

Genuine improvement — cache, refetch, mutation and error states handled by
the library rather than by hand — but modest at this scale. It tidies
existing code rather than solving a live problem.

**Effort:** ~2 days. Best folded into the TypeScript migration if that
happens, otherwise skip.

---

## Considered and rejected

**shadcn CLI for `components/ui/`.** shadcn is copy-paste-you-own-it by
design, so adopting the CLI gains little for 15 existing components.
Revisit only at the Tailwind 4 migration, where its v4 component versions
would save some conversion work.

**`react-hook-form`.** Only 7 `onSubmit`/`preventDefault` sites; inputs are
controlled. No pain to solve.

**`litellm` for `embeddings.py`.** 83 focused lines replaced by a large
dependency covering providers that are not used.

**Better Auth.** Assessed separately in
`2026-07-27-frontend-api-migration.md` — TypeScript-only, and the MCP server
that must verify tokens is Python.

---

## Suggested order

1. **CI** (~1 hour) — protects everything after it
2. **Alembic** (~2 days)
3. **Auth hardening** — rate limiting, token expiry, httpOnly session cookie
   (~1 week, covers finding 5 and the two related gaps)
4. **Sentry** (~2 hours)

Roughly a week and a half in total, and it materially reduces the amount of
infrastructure held only in the maintainer's head.

**Editor consolidation** (finding 3) is the largest win by volume but should
be scheduled on its own.
