# MyGist API Server
# Build:  docker build -t mygist-api .
# Run:    docker run -p 8000:8000 -e DATABASE_URL=<postgres-url> mygist-api

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the whole backend (exclusions in .dockerignore: .env, venv, tests, ...).
# Using COPY . . so new modules (db.py, persona_store.py, ...) are always included.
COPY . .

EXPOSE 8000

# start-period matches the root Dockerfile and docker-compose.yml: without it
# the first probe waits a full interval, so a working container reports
# unhealthy for 30s after every deploy.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Migrations run before the app binds -- see the root Dockerfile for why.
CMD ["sh", "-c", "alembic upgrade head && exec python -m uvicorn main:app --host 0.0.0.0 --port 8000"]
