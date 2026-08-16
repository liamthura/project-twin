# MyGist -- one image serving the SPA, the REST API, the MCP endpoint and the
# docs site.
#
# The build context is the REPO ROOT, not backend/, so the frontend can be
# built here and copied in. In Coolify: base directory "/", dockerfile
# "./Dockerfile".
#
# Build:  docker build -t mygist .
# Run:    docker run -p 1120:1120 -e DATABASE_URL=<postgres-url> mygist
#
# backend/Dockerfile is kept for API-only builds (it uses backend/ as its
# context and produces an image with no static assets).

# --- Stage 1: build the web assets ------------------------------------------
# Node 20 went EOL in April 2026. 22 is LTS and clears Vite's >=22.12 floor
# with room to spare, so the tag can keep floating for security patches.
FROM node:22-alpine AS web

WORKDIR /build/frontend

# Dependencies first so this layer caches until the lockfile changes.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --prefer-offline

COPY frontend/ ./

# vite.config.js stamps a version label from APP_COMMIT / SOURCE_COMMIT
# (Coolify injects the latter), falling back to a git probe that is absent in
# this stage -- it already degrades to "dev" on its own.
ARG APP_COMMIT
ARG SOURCE_COMMIT
ENV APP_COMMIT=$APP_COMMIT
ENV SOURCE_COMMIT=$SOURCE_COMMIT

RUN npm run build

# --- Stage 2: build the docs site -------------------------------------------
# A separate stage from the SPA, not a second command in the one above: they
# have different lockfiles and different Tailwind majors (the app is on 3.4,
# Fumadocs requires 4), so sharing a node_modules would break both. Neither
# stage survives into the final image -- only its output is copied.
#
# Pinned to node:22-alpine on purpose. docs-site/ is treated as frozen: exact
# dependency versions, committed lockfile, and a base image that will not move
# under it. It is upgraded deliberately or not at all.
FROM node:22-alpine AS docs

WORKDIR /build/docs-site

# Dependencies first so this layer caches until the lockfile changes.
#
# --ignore-scripts is required, not tidiness: this package's `postinstall` runs
# `fumadocs-mdx`, which reads source.config.ts to generate the `.source`
# collection -- and at this point only the two manifests have been copied, so it
# exits with ERR_MODULE_NOT_FOUND and fails the build. The generation step moves
# below, after the source is in place.
COPY docs-site/package.json docs-site/package-lock.json ./
RUN npm ci --prefer-offline --ignore-scripts

COPY docs-site/ ./

# `fumadocs-mdx` first (the skipped postinstall), then the export. `output:
# export` with basePath "/docs" produces a directory of static files that
# expects to be served AT /docs, which is where register_static_routes mounts it.
RUN npx fumadocs-mdx && npm run build

# --- Stage 3: the service ---------------------------------------------------
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# The same stamp the web stage bakes into the UI's version label, carried into
# the runtime environment so /api/instance can report it without a credential.
# ARG does not cross a FROM, so this pair is declared again rather than reused.
ARG APP_COMMIT
ARG SOURCE_COMMIT
ENV APP_COMMIT=$APP_COMMIT
ENV SOURCE_COMMIT=$SOURCE_COMMIT

# main.py serves these; see register_static_routes(). The Node stages are
# discarded, so only the built output lands in the final image.
COPY --from=web /build/frontend/dist ./static

# The docs export goes inside the SPA's static dir, because that is where the
# mount looks: static/docs -> /docs. Copied second so it cannot be clobbered by
# the SPA's own output.
COPY --from=docs /build/docs-site/out ./static/docs

EXPOSE 1120

# start-period matches backend/docker-compose.yml, and is what makes a deploy
# go healthy promptly: during the start period Docker probes at --start-interval
# (5s by default) instead of waiting a full --interval. Measured on this image,
# with a local database: healthy at ~10s with it, 31s without (a single probe at
# 30s). That difference is a window where a working container is still reported
# unhealthy, and an orchestrator gating routing on health answers 502 throughout.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:1120/health || exit 1

# Migrations run before the app binds, not from application code: schema
# changes should not race startup, and a failed migration should stop the
# deploy rather than leave a half-migrated database serving traffic. `exec`
# hands PID 1 to uvicorn so it still receives stop signals directly.
CMD ["sh", "-c", "alembic upgrade head && exec python -m uvicorn main:app --host 0.0.0.0 --port 1120"]
