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
DB_URL="postgresql://mygist:mygist@test-db:5432/mygist_local"

cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--stop" ]]; then
  docker rm -f "$NAME" >/dev/null 2>&1 && echo "stopped $NAME" || echo "$NAME was not running"
  exit 0
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
commit="$(git rev-parse --short HEAD)"

if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "The '$NETWORK' network is missing -- the local database stack is not up."
  echo "Start it first:  cd backend && docker compose up -d test-db"
  exit 1
fi

echo "Building $branch ($commit) ..."
docker build -q --build-arg APP_COMMIT="$commit" -t "$IMAGE" . >/dev/null

docker rm -f "$NAME" >/dev/null 2>&1 || true

echo "Starting container ..."
docker run -d --name "$NAME" --network "$NETWORK" \
  -p "${PORT}:8000" \
  -e DATABASE_URL="$DB_URL" \
  -e DEBUG=true \
  -e EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-voyage}" \
  -e VOYAGE_API_KEY="${VOYAGE_API_KEY:-}" \
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
