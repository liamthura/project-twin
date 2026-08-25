#!/usr/bin/env bash
# Build and run the merged single container -- the same image Coolify
# deploys -- against the local pgvector, so a branch can be checked in
# something shaped like production before it is merged.
#
#   ./scripts/local-preview.sh          # build the current branch, serve on 8100
#   PORT=9000 ./scripts/local-preview.sh
#   ./scripts/local-preview.sh --stop
#
# For day-to-day UI work prefer the dev server instead: `cd frontend &&
# npm run dev` gives hot reload and proxies /api to the backend already
# running in compose. Use this script when the thing under test is the
# BUILD -- what Vite inlines, what the backend serves as static files, or
# anything that only exists after `npm run build`.
set -euo pipefail

PORT="${PORT:-8100}"
IMAGE="mygist-preview"
NAME="mygist-preview"
NETWORK="backend_default"           # created by backend/docker-compose.yml
DB_URL="postgresql://mygist:mygist@db:5432/mygist_local"

cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--stop" ]]; then
  docker rm -f "$NAME" >/dev/null 2>&1 && echo "stopped $NAME" || echo "$NAME was not running"
  exit 0
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
commit="$(git rev-parse --short HEAD)"

if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "The '$NETWORK' network is missing -- the local database stack is not up."
  echo "Start it first:  cd backend && docker compose up -d"
  exit 1
fi

echo "Building $branch ($commit) ..."
docker build -q --build-arg APP_COMMIT="$commit" -t "$IMAGE" . >/dev/null

# Teach the auth service to accept this preview's origin.
#
# Better Auth validates the browser's Origin header -- the proxy forwards it
# untouched -- against BETTER_AUTH_URL's origin, and nothing else unless it is
# told otherwise. The compose default is :1120, for the uvicorn workflow, so
# sign-in from a preview on any other port returns 403 INVALID_ORIGIN even
# though the proxy, the auth service and the database are all healthy.
#
# BETTER_AUTH_URL is deliberately NOT changed: it is what Better Auth builds
# cookies and redirects from, and repointing it here would break the :1120
# workflow instead. Both spellings of the host are listed because `localhost`
# and `127.0.0.1` are different origins, and a browser will use whichever one
# is in the address bar.
TRUSTED="${BETTER_AUTH_TRUSTED_ORIGINS:+${BETTER_AUTH_TRUSTED_ORIGINS},}"
TRUSTED="${TRUSTED}http://localhost:${PORT},http://127.0.0.1:${PORT}"
TRUSTED="${TRUSTED},http://localhost:1120,http://127.0.0.1:1120"

# Only touch the auth service if it does not already trust this origin.
#
# Recreating it is not free: BETTER_AUTH_SECRET encrypts the JWKS private key
# held in the database, so coming back with a DIFFERENT secret leaves Better
# Auth unable to decrypt its own key -- /auth/token answers 500, the SPA never
# gets a JWT, and the entire API answers 401 to a user who just signed in
# successfully. Leaving a working container alone is the safest thing this
# script can do.
want_origin="http://localhost:${PORT}"
current_trusted="$(docker exec mygist-auth printenv BETTER_AUTH_TRUSTED_ORIGINS 2>/dev/null || true)"

if [[ ",${current_trusted}," == *",${want_origin},"* ]]; then
  echo "Auth service already trusts ${want_origin}, leaving it alone."
else
  # Compose reads `.env` from ITS OWN directory (backend/), so a secret kept in
  # auth/.env is invisible to it. Resolve that file against the MAIN checkout:
  # it is gitignored, so it does not exist inside a linked worktree.
  repo_main="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
  if [[ -z "${BETTER_AUTH_SECRET:-}" && -f "$repo_main/auth/.env" ]]; then
    BETTER_AUTH_SECRET="$(sed -n 's/^BETTER_AUTH_SECRET=//p' "$repo_main/auth/.env" | head -1)"
  fi

  if [[ -z "${BETTER_AUTH_SECRET:-}" ]]; then
    echo "  no BETTER_AUTH_SECRET found (checked the environment and"
    echo "  $repo_main/auth/.env). Recreating the auth service with the compose"
    echo "  default would break JWKS decryption if its key was encrypted with a"
    echo "  different one. Export the secret and re-run, or sign in on :1120."
    exit 1
  fi

  echo "Trusting origins on :${PORT} ..."
  BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" BETTER_AUTH_TRUSTED_ORIGINS="$TRUSTED" \
    docker compose -f backend/docker-compose.yml up -d auth >/dev/null 2>&1
fi

docker rm -f "$NAME" >/dev/null 2>&1 || true

echo "Starting container ..."
docker run -d --name "$NAME" --network "$NETWORK" \
  -p "${PORT}:1120" \
  -e DATABASE_URL="$DB_URL" \
  -e EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-voyage}" \
  -e VOYAGE_API_KEY="${VOYAGE_API_KEY:-}" \
  `# Without this, auth_proxy.register() returns False and every /auth/* route` \
  `# 404s -- indistinguishable from a dead backend. The auth service is not` \
  `# published to the host on purpose, so this container reaching it over the` \
  `# compose network is the only path that works.` \
  -e AUTH_SERVICE_URL="${AUTH_SERVICE_URL:-http://auth:3001}" \
  `# Sign-in alone is not enough to use the app: the SPA exchanges its session` \
  `# for a JWT at /auth/token, and jwt_auth.py needs a key to verify it with.` \
  `# Without these two the whole REST API answers 401 to a freshly signed-in` \
  `# user -- which looks like a broken login rather than missing config.` \
  `#` \
  `# The issuer is Better Auth's EFFECTIVE base -- BETTER_AUTH_URL plus its` \
  `# basePath -- not the preview's own origin, and it is what lands in the` \
  `# token's iss/aud claims. JWKS is fetched over the compose network because` \
  `# the auth service has no host-published port.` \
  -e AUTH_JWKS_URL="${AUTH_JWKS_URL:-http://auth:3001/auth/jwks}" \
  -e AUTH_ISSUER="${AUTH_ISSUER:-${BETTER_AUTH_URL:-http://localhost:1120}/auth}" \
  `# Gates whether this container mounts OAuth discovery routes -- see` \
  `# backend/main.py and auth/src/oauth.js. Empty by default, same as the` \
  `# auth service's own copy in backend/docker-compose.yml: unset, the OAuth` \
  `# plugins never register there either, which is deliberate fail-closed` \
  `# behaviour. It does mean a preview started without it has no OAuth` \
  `# surface at all -- 404 on discovery -- so export it before running this` \
  `# script to exercise MCP OAuth locally.` \
  -e AUTH_MCP_RESOURCE="${AUTH_MCP_RESOURCE:-}" \
  `# The API needs only the gate, never the credentials: all it does with it` \
  `# is answer "sso": true on /api/instance, which is what makes the SPA show` \
  `# the button. Set on both containers or on neither -- the same rule` \
  `# AUTH_MCP_RESOURCE follows. Set here alone, the button appears and every` \
  `# press 404s; set on the auth service alone, SSO works but is invisible.` \
  -e AUTH_OIDC_DISCOVERY_URL="${AUTH_OIDC_DISCOVERY_URL:-}" \
  "$IMAGE" >/dev/null

# The entrypoint runs `alembic upgrade head` before uvicorn, so the port is
# open a little after the container is. Poll the health endpoint rather than
# sleeping a guessed interval.
printf "Waiting for health"
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    echo
    echo "Ready:  http://localhost:${PORT}"
    echo "Branch: $branch ($commit)"
    echo
    echo "Logs:   docker logs -f $NAME"
    echo "Stop:   ./scripts/local-preview.sh --stop"
    exit 0
  fi
  printf "."
  sleep 2
done

echo
echo "Did not come up within 120s. Last 40 lines:"
docker logs --tail 40 "$NAME"
exit 1
