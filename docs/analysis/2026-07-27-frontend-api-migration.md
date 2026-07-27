# Migrating Frontend + REST API to Next.js — Analysis

**Date:** 2026-07-27
**Status:** Analysis. No decision taken.

## The proposal

Move `frontend/` and the REST `/api/*` surface to Next.js (TypeScript, Zod
for schemas). Keep the Python FastAPI service for the MCP server. Optionally
adopt Better Auth in place of the hand-rolled auth.

## Measured starting point

| Module | Lines | Serves |
| --- | --- | --- |
| `server.py` | 4,132 | MCP tools |
| `main.py` | 464 | REST `/api/*`, MCP mount, auth middleware |
| `search_index.py` | 430 | hybrid FTS + pgvector search |
| `db.py` | 343 | **shared** — pool, schema, auth, tokens |
| `persona_store.py` | 255 | **shared** — persona load/save, entity ids |
| `pack_loader.py` + `sections.py` | 216 | **shared** — section packs |
| `embeddings.py` | 83 | embedding providers |
| `settings_store.py` | 76 | per-user section toggles |
| Backend total | 6,446 | |
| Test suite | 4,886 (389 tests) | |

Frontend: 32 `.jsx`/`.js` files, zero TypeScript.

## The seam problem

The REST API is not a layer above MCP — both are consumers of the same core.

1. **Writes are shared.** `persona_store.save()` (`persona_store.py:224`)
   ends by calling `search_index.sync_index(user_id, file_type, data)`
   (line 240). Every `PUT /api/files/{type}` re-indexes that persona,
   including embedding generation. An `/api` owned by Next that does not
   reproduce this leaves UI edits invisible to `search_context`.
2. **Auth is shared.** A token minted by `POST /api/auth/tokens` is the same
   token Claude Desktop sends to `/mcp`. `main.py:68-76` resolves both
   through `db.resolve_token`.
3. **Entity ids are shared.** `persona_store` generates the stable ids that
   `get_entity`, relations, and the search index all key on.

So the proposed split cuts through `persona_store`, `db` and `search_index`
rather than around them.

## Three ways to implement it

### A. Reimplement the shared core in TypeScript

Next owns `/api` outright, with its own persona store, search-index sync,
embedding calls and auth.

- **Pro:** genuinely one language for the whole web surface; Zod schemas
  shared between route handlers and UI; Better Auth becomes available.
- **Con:** two implementations of persona writes, index sync and token
  verification against one database. Drift is not cosmetic here — it means
  silently unsearchable entries or an auth mismatch between web and MCP.
- **Con:** the 389 tests cover the Python paths. The TypeScript paths start
  at zero coverage while carrying the same invariants.

### B. Next owns `/api`, proxying to Python

Route handlers forward to the FastAPI service.

- **Pro:** no duplicated logic; type-safe client surface.
- **Con:** an extra network hop and a second service to run for no
  behavioural gain. Next is reduced to a UI framework with a proxy — which
  an SPA already gives you without the proxy.

### C. Next owns the UI only; Python keeps `/api` and `/mcp`

- **Pro:** clean, no duplication, and TypeScript arrives in the frontend.
- **Con:** this is the current architecture with Vite replaced by Next. For
  an authenticated editor behind a login, Next's advantages (SSR, RSC,
  streaming, SEO) contribute nothing, and it conflicts with the
  single-container design unless statically exported — at which point Next
  is Vite with more build steps.

## Pros of migrating, stated fairly

- **One language across UI and API.** Real cognitive saving for a solo
  maintainer; no context switch mid-feature.
- **Shared schemas.** Zod types flowing from route handler to component is
  the strongest technical argument, and it is a genuine one.
- **Auth ecosystem.** Better Auth, and the wider TS auth ecosystem, become
  usable. See the auth section.
- **Contributor pool.** More web developers write TypeScript than
  FastAPI + pgvector — for the web layer specifically.
- **Server-side rendering** becomes possible for any future public surface
  (landing page, shared persona views).

## Cons of migrating

- **Duplicated invariants.** Option A's core problem; option B's proxy
  avoids it only by making the migration pointless.
- **Search index sync must be reproduced exactly**, including embedding
  provider selection and dimension handling, or search silently degrades.
- **Auth split across two languages** against one `tokens` table.
- **Two runtimes remain regardless.** MCP stays Python, so the outcome is
  Python *and* Node — two dependency ecosystems, two upgrade paths, two sets
  of CVEs. The migration does not reduce operational surface; it increases
  it.
- **Test coverage restarts** for everything moved.
- **Conflicts with the single-container design** (see the merge spec): Next
  needs a Node runtime in production unless statically exported.
- **Timing.** Multi-month effort landing as available hours drop.

## Auth

### What exists today

Assessed as sound for its scope:

- bcrypt with per-password salt (`db.py:199-207`)
- sha256 for bearer tokens — correct, not a weakness: `secrets.token_urlsafe(32)`
  is 256 bits of entropy, so a slow hash buys nothing (`db.py:186`)
- deliberate timing-attack mitigation — every failure branch of
  `verify_password` performs exactly one bcrypt op against a precomputed
  dummy hash, so response time does not reveal whether a username exists
  (`db.py:320-343`)
- named, revocable tokens with `last_used_at`, resolved and touched in a
  single round-trip (`db.py:235-254`)
- malformed-UUID handling on revoke (`db.py:283-294`)
- password change requires the current password (`db.py:297-317`)
- the legacy single-token migration deliberately clears `users.token_hash`
  to prevent revoked tokens resurrecting on restart (`db.py:96-107`)

### Real gaps

1. **No rate limiting anywhere.** `POST /api/auth/login` accepts unlimited
   attempts. This is the most serious gap — the timing mitigation above
   guards against enumeration but nothing guards against brute force.
2. **No token expiry or rotation.** The `tokens` table has no `expires_at`.
   A leaked token is valid until manually revoked.
3. **Token stored in `localStorage`** (`frontend/src/lib/api.js:49-52`),
   readable by any XSS. An httpOnly cookie for the web session would remove
   that exposure; machine tokens for MCP legitimately stay bearer.
4. No password reset, no email verification, no 2FA, no audit log.

Items 1–3 are the ones that matter. Item 4 is scope, not weakness.

### Better Auth

Capable and well-scoped: Postgres adapters (Drizzle/Prisma), an API Key
plugin and a Bearer plugin for machine clients, rate limiting, 2FA, OAuth,
passkeys, audit logs, OIDC/SAML providers.

**The blocker is that it is TypeScript-only, and the MCP server is Python.**
Claude Desktop authenticates to `/mcp` with a bearer token, so whatever
issues tokens must be verifiable by Python. That leaves:

- **Better Auth owns tokens, Python reads its tables directly.** Couples the
  Python service to Better Auth's internal schema — which Better Auth owns
  and migrates. A framework upgrade could break MCP auth silently.
- **Dual auth systems** — Better Auth for humans in the web app, the
  existing Python implementation for machine tokens. Two sources of truth
  for identity, which is worse than one hand-rolled system.

**Conclusion: Better Auth only becomes coherent if the MCP server also moves
to TypeScript** — i.e. the full rewrite, not the partial migration. It is
not separable from that decision.

### Cheaper alternative

The three real gaps close in Python without any migration:

1. Rate limit `POST /api/auth/login` — per-username and per-IP, backed by
   Postgres or an in-process counter. Roughly a day including tests.
2. Add `expires_at` to `tokens`, default null for machine tokens, finite for
   web sessions; expire on `resolve_token`. Half a day.
3. Move the web session to an httpOnly, secure, SameSite cookie; leave
   bearer tokens for MCP clients. One to two days including frontend
   changes.

That is roughly a week, against a multi-month migration, and it addresses
every gap Better Auth would have addressed for this threat model.

## Recommendation

1. **Do not migrate the REST API.** The seam runs through shared modules,
   and every implementation route either duplicates invariants or adds a
   proxy for no gain.
2. **Do migrate the frontend to TypeScript** — but in place, on Vite. Add
   `openapi-typescript` against `/api/openapi.json` (exposed by the merge
   work) so API types are generated rather than hand-written, and use Zod at
   the boundaries where runtime validation earns its place: parsing API
   responses, validating form input.
3. **Do not adopt Better Auth.** Close the three gaps in Python instead.
4. **Revisit** if the MCP server ever moves to TypeScript, or if
   contributors arrive who work in the backend rather than in pack
   manifests.

## Decision triggers to watch

- MCP server rewritten in TypeScript → Better Auth and a unified API become
  coherent in one step.
- A public, SEO-relevant surface appears → server rendering starts to pay.
- Backend contributors arrive → language choice starts to matter for
  onboarding.
