# MyGist auth service — Better Auth, human sign-in only.
#
# Build:  docker build -t mygist-auth ./auth
# Run:    docker run -p 3001:3001 -e DATABASE_URL=... -e BETTER_AUTH_SECRET=... \
#             -e BETTER_AUTH_URL=https://your-instance mygist-auth
#
# Not published directly. FastAPI proxies /auth/* here over the internal
# network (backend/auth_proxy.py), so this listens on the compose network only
# and the deployment still presents one upstream and one port to the outside.
FROM node:22-alpine

WORKDIR /app

# Dependencies first, so a source change does not reinstall them. No build step
# to run afterwards: the service is plain ESM JavaScript, deliberately.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --prefer-offline

COPY src/ ./src/

# curl for the healthcheck; alpine ships without it.
RUN apk add --no-cache curl

# node:22-alpine already provides an unprivileged `node` user. The service
# writes nothing to disk -- all state is in Postgres -- so it needs no
# ownership changes beyond this.
USER node

EXPOSE 3001

# Matches the API image's 10-second start period, and for the same reason: a
# platform that gates routing on health answers 502 for the whole window before
# the first successful probe.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "src/server.js"]
