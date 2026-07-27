# Single-Container Merge and Public Docs Site — Design

**Date:** 2026-07-26
**Status:** Draft for review

## Goal

Collapse the two deployed services (frontend nginx container, backend
uvicorn container) into one image serving the SPA, the REST API, the MCP
endpoint, and a new public documentation site — all from one origin. One
service in Coolify, one URL, one deploy.

## Problems being solved

1. **Two services, two URLs.** `mygist.thuradev.qzz.io` (SPA) and
   `mygist-api.thuradev.qzz.io` (API/MCP) are separate Coolify services with
   separate deploys, requiring a CORS allowlist (`main.py:81-97`) and a
   hardcoded cross-origin API base (`frontend/src/lib/api.js:7`).
2. **No user-facing documentation.** Everything lives in a 563-line README:
   install, usage, tool reference, self-hosting and maintenance interleaved
   with no navigation or search. `docs/` holds internal specs only.

## Decisions made with the user

- **FastAPI serves the static files** (option A), rather than nginx+uvicorn
  under a supervisor (B) or two services behind Traefik path routing (C).
  Rationale: Cloudflare already handles edge caching, self-hosters get a
  single `docker run`, and a solo maintainer gains nothing from independent
  deploy cadence. Reversible later if traffic or contributors change.
- **Fumadocs on Next.js**, statically exported. Chosen over Astro Starlight
  after weighing both: Starlight is the lower-maintenance option, but
  Fumadocs matches the app's Radix/Tailwind/lucide idiom and customises in
  React rather than Astro. Next.js over Fumadocs' React Router adapter
  because it is the primary supported target — the React Router setup docs
  do not cover prerendering, so static output there is a thinly-travelled
  path. Next is a build-time dependency only; no Next runtime ships.
- **Both hostnames stay attached** to the merged service so existing Claude
  Desktop configs pointing at `mygist-api.thuradev.qzz.io/mcp` keep working.
- **Merge ships before docs**, so docs are written against the final URL
  layout.

## Constraints discovered

- **`app.mount("/", mcp_app)` (`main.py:447`) owns the root path.** FastAPI
  matches routes in registration order, so every static route must be
  registered *before* it. The MCP mount itself is not touched — the comment
  at `main.py:45-48` documents why it is mounted at root (exact `/mcp`
  resolution without a 307), and that behaviour must survive.
- **`/docs` collides with FastAPI's Swagger UI.** `main.py:52` omits
  `docs_url`, so the default `/docs` and `/redoc` are live. Swagger moves to
  `/api/docs`, ReDoc to `/api/redoc`, OpenAPI to `/api/openapi.json`.
  Moving them under `/api` puts them behind the auth middleware, which
  guards every path starting `/api` — they were previously public at
  `/docs`. All three (plus `/api/docs/oauth2-redirect`) are therefore added
  to the middleware's public-path list, so the move does not silently change
  who can read the API surface. Locking them down is a separate decision.
- **The SPA has no client-side router.** Confirmed: no `react-router`, no
  `pushState`. Static surface is `index.html`, `/assets/*`, `favicon.svg`,
  `logo.svg`. No catch-all fallback is needed, which is what lets static
  routes coexist with the MCP root mount.
- **Cloudflare proxies both hostnames** (resolving to `172.67.159.203` /
  `104.21.89.134`; origin `147.79.18.20`). Nothing in the repo references
  it — dashboard-only state, so it must be written down in the docs.

---

## Part 1 — Single container

### Root `Dockerfile` (new)

Multi-stage; the Node stage is discarded, so the final image is the existing
Python image plus static files.

```
FROM node:20-alpine AS web
  build frontend/        -> frontend/dist
  build docs-site/       -> docs-site/out        (added in Phase 2)

FROM python:3.11-slim
  pip install -r backend/requirements.txt
  COPY backend/ .
  COPY --from=web .../frontend/dist   ./static
  COPY --from=web .../docs-site/out   ./static/docs   (added in Phase 2)
  CMD uvicorn main:app --host 0.0.0.0 --port 8000
```

Phase 1 ships the frontend build and copy only. The `docs-site` build and
its `COPY` are added in Phase 2, once `docs-site/` exists — a `COPY` from a
missing directory fails the build, so the two must land together.

`APP_COMMIT` / `SOURCE_COMMIT` build args pass through to the Node stage —
`vite.config.js:6-19` reads them and falls back to a `git rev-parse` probe
that is absent in the build container (already wrapped in try/catch, so it
degrades to `"dev"` rather than failing).

`backend/Dockerfile` is retained for API-only local builds;
`backend/docker-compose.yml` is unchanged (it builds the backend alone
against `test-db`).

### `backend/main.py` changes

All additions land **before** `app.mount("/", mcp_app)` at line 447.

1. `FastAPI(...)` gains `docs_url="/api/docs"`, `redoc_url="/api/redoc"`,
   `openapi_url="/api/openapi.json"`.
2. `GZipMiddleware(minimum_size=1000)` — so a direct-to-origin request is
   compressed without relying on Cloudflare.
3. `STATIC_DIR = Path(__file__).parent / "static"`, guarded by
   `if STATIC_DIR.is_dir():` so a backend-only checkout (no frontend build)
   still boots — this is the normal local-dev path.
4. Routes:
   - `GET /` → `FileResponse(index.html)` with `Cache-Control: no-cache`
   - `mount /assets` → `StaticFiles` subclass setting
     `Cache-Control: public, max-age=31536000, immutable` (safe: Vite
     content-hashes these filenames)
   - `GET /favicon.svg`, `GET /logo.svg` → `FileResponse`
   - `mount /docs` → `StaticFiles(html=True)` (Part 2)

The auth middleware (`main.py:58-78`) needs no change: it only demands a
bearer token for paths starting `/api` or `/mcp`, so static paths fall
through public, which is correct.

### `frontend/src/lib/api.js`

`CLOUD_API_URL` (line 7) becomes `https://mygist.thuradev.qzz.io/api` — the
merged hosted instance. It stays absolute rather than `/api` because the
constant is the "cloud" preset offered to self-hosters running the UI
elsewhere (`WelcomeAuth.jsx:26`, `ConnectionSettings.jsx:71`), where a
relative path would resolve against the wrong origin.

`getApiBase()` (line 31-46) is unchanged — it already falls back to
same-origin `/api`.

### CORS (`main.py:81-97`)

The browser is now same-origin, so the allowlist only serves external
clients and local dev. Keep the localhost/dev origins and the hosted origin;
drop the bare VPS IP `147.79.18.20` (line 91), which is unreachable behind
Cloudflare anyway.

### `frontend/vite.config.js`

Add `/mcp` and `/docs` to the dev proxy (line 36-41) alongside the existing
`/api` entry, so local dev matches production shape.

### Coolify

Manual steps, recorded here because they are not version-controlled:

1. Backend service: build context → repo root, Dockerfile → `./Dockerfile`.
2. Attach **both** `mygist.thuradev.qzz.io` and
   `mygist-api.thuradev.qzz.io` to it.
3. Stop and remove the frontend service once the merged one is verified.

Health check is unchanged (`/health`, public per `main.py:63`).

---

## Part 2 — Docs site

### Stack

`docs-site/` at repo root — Next.js App Router with `fumadocs-ui`,
`fumadocs-core`, `fumadocs-mdx`. Kept out of the existing `docs/`, which
remains internal specs and plans and is not published.

`next.config.mjs`: `output: "export"`, `basePath: "/docs"`,
`trailingSlash: true`, `images: { unoptimized: true }`. Build output is
`docs-site/out/`.

**Static search must be wired explicitly.** Fumadocs is server-first by
default; the static path requires installing `@orama/orama`, configuring
static mode on the search server, and swapping `fetchClient` for
`oramaStaticClient` in the search component. Four coupled pieces — the main
ongoing maintenance cost of this choice, and re-verified on every upgrade.

Any route not reachable from the UI must be added to the prerender list by
hand or it is silently absent from the output.

**Tailwind 4** is required by Fumadocs. `docs-site/` has its own
`package.json` and `node_modules`, so this coexists with the app's Tailwind
3.4 without conflict — the two never share a config. Upgrading the app is
out of scope here (see Follow-up work).

Theming targets visual consistency with the app: Fumadocs' CSS layer is set
to MyGist's palette from `frontend/src/globals.css` and the Geist / Geist
Mono faces already loaded in `frontend/index.html:20-24`.

Dependency versions are pinned exactly — no carets, lockfile committed,
`node:20-alpine` base image pinned — so the site still builds untouched in a
year. `docs-site/` is treated as frozen and upgraded only deliberately.

### Information architecture

Content as MDX under `docs-site/content/docs/`:

- **Getting started** — what MyGist is · quick start (register → token →
  Claude Desktop) · connecting other MCP clients
- **Using MyGist** — concepts (persona, sections, entities, ids) · reading
  (`get_context` scopes, `search_context` → `get_entity` lean pattern,
  titles mode, topic filtering) · writing (`persona_modify`,
  `persona_batch`, aliases) · smart capture and why MCP tools are passive ·
  relations · the web editor · reference tables (tools, scopes, entities)
- **Self-hosting** — requirements · `docker run` with the merged image ·
  environment variables (`DATABASE_URL`, `PORT`, `HOST`, `DEBUG`,
  `MCP_TRANSPORT`, `EMBEDDING_*`) · Postgres + pgvector and the FTS-only
  fallback · reverse proxy notes
- **Maintaining** — importing legacy `mygist_data/` JSON · search-index
  backfill including the `--recreate` + server-restart gotcha
  (README:520-525) · adding a section pack (links `CONTRIBUTING-PACKS.md`) ·
  the Cloudflare + Coolify layer · troubleshooting

### Content accuracy fixes

Carried in during the port, not copied forward:

- README describes Neon as the production database throughout
  (README:51-53, 64, 475-478). Production is self-hosted Postgres with
  pgvector on the Coolify VPS; Neon becomes one managed option among several.
- URL examples standardise on `https://mygist.thuradev.qzz.io` for hosted
  and `127.0.0.1:8000` for local, with the API at `/api` on the same origin.
- `README.md` shrinks to an overview plus a link to `/docs`, so there is one
  source of truth.

---

## Error handling

- Missing `static/` directory → static routes are not registered; API and
  MCP serve normally. Covers backend-only dev and API-only image builds.
- Missing `static/docs/` → same, `/docs` simply absent.
- Node build failure → image build fails; nothing half-deployed ships. This
  is the accepted cost of coupled builds.

## Testing

Extends the existing suite; all current tests must still pass.

- `/mcp` still resolves without redirect (regression guard on the root mount)
- `/api/health` public; `/api/*` still 401s without a bearer token
- `GET /` returns `index.html` when `static/` exists, and is absent when not
- `/assets/*` carries the immutable cache header; `/` does not
- `/docs/` serves the exported index
- OpenAPI schema reachable at `/api/openapi.json`, not `/openapi.json`

## Verification

Local, against the built image:

```
curl -i localhost:8000/                     # index.html, no-cache
curl -i localhost:8000/assets/<hashed>.js   # immutable
curl -s localhost:8000/api/health           # {"status":"ok"}
curl -i localhost:8000/mcp                  # no 307
curl -s localhost:8000/docs/ | head         # docs index
```

Post-deploy, repeat against both hostnames to confirm the old MCP URL still
answers.

## Non-goals

- Splitting static to a CDN or object storage.
- CI workflows — Coolify rebuilds on push.
- Changing the MCP mount strategy, section packs, or any persona logic.
- Migrating the app to Next.js or Tailwind 4. The SPA stays Vite/React on
  Tailwind 3.4; Next exists only to build the docs and never runs in
  production.
- A CMS or authoring UI for the docs. Content is MDX edited in-repo; an
  "Edit this page on GitHub" link covers edits away from a checkout.
- Introducing Zod or changing the validation layer. Schemas live in Python
  (`jsonschema` for pack manifests, Pydantic for request bodies); Zod is not
  applicable and the current split is sound.

## Follow-up work (separate branches)

- **Tailwind 3.4 → 4 in `frontend/`.** Measured surface across 32 files:
  222 `space-*`, 60 `ring*`, 25 `flex-shrink-`, 12 `outline-none`, 9
  `animate-in/out`, 4 renamed scale utilities, plus config-to-CSS migration
  and replacing `tailwindcss-animate` with `tw-animate-css`.
  `npx @tailwindcss/upgrade` covers most of it; the rest is visual QA.
  Trigger: wanting shared design tokens between app and docs.
- Authenticating the docs site — it is public.

## Implementation order

**Phase 1 — merge.** Root Dockerfile (frontend stage only), `main.py`
static routes and Swagger relocation, `api.js` constant, CORS trim, vite
proxy. Verify locally, deploy, attach both domains, retire the frontend
service.

**Phase 2 — docs.** Scaffold `docs-site/` and **prove the static export plus
static search on an empty site first** — that is the risky part, and it
should fail on a scaffold rather than after porting 563 lines of README.
Then port and correct the content, add the docs build stage and the `/docs`
mount, and shrink the README. Deploy.

Phase 1 stands alone and is independently shippable.
