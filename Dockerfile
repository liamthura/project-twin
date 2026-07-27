# MyGist -- one image serving the SPA, the REST API, the MCP endpoint and
# (from Phase 2) the docs site.
#
# The build context is the REPO ROOT, not backend/, so the frontend can be
# built here and copied in. In Coolify: base directory "/", dockerfile
# "./Dockerfile".
#
# Build:  docker build -t mygist .
# Run:    docker run -p 8000:8000 -e DATABASE_URL=<postgres-url> mygist
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

# --- Stage 2: the service ---------------------------------------------------
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# main.py serves these; see register_static_routes(). The Node stage itself is
# discarded, so only the built output lands in the final image.
COPY --from=web /build/frontend/dist ./static

EXPOSE 8000

# start-period matches backend/docker-compose.yml, and is what makes a deploy
# go healthy promptly: during the start period Docker probes at --start-interval
# (5s by default) instead of waiting a full --interval. Measured on this image,
# with a local database: healthy at ~10s with it, 31s without (a single probe at
# 30s). That difference is a window where a working container is still reported
# unhealthy, and an orchestrator gating routing on health answers 502 throughout.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Migrations run before the app binds, not from application code: schema
# changes should not race startup, and a failed migration should stop the
# deploy rather than leave a half-migrated database serving traffic. `exec`
# hands PID 1 to uvicorn so it still receives stop signals directly.
CMD ["sh", "-c", "alembic upgrade head && exec python -m uvicorn main:app --host 0.0.0.0 --port 8000"]
