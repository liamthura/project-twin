/**
 * HTTP server for the Better Auth service.
 *
 * Plain node:http rather than Express, deliberately. The documented Express
 * integration carries a footgun -- `express.json()` must be mounted AFTER the
 * auth handler, or it consumes the request body and Better Auth receives
 * nothing. This service serves exactly one handler and needs no body parsing of
 * its own, so removing Express removes the trap rather than commenting on it,
 * and drops a dependency at the same time.
 *
 * Not exposed publicly. FastAPI proxies /auth/* here over the internal network;
 * see backend/auth_proxy.py for why the routing lives in code.
 */
import { createServer } from "node:http";
import { toNodeHandler } from "better-auth/node";

import { auth, pool } from "./auth.js";
import { preflight } from "./preflight.js";

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "0.0.0.0";

// Refuse to serve against a database this service cannot use. Starting anyway
// means /health says ok while every real request 500s, and the reason lives
// only in a container log -- the hardest place to reach mid-deploy.
try {
  if (!(await preflight(pool))) {
    process.exit(1);
  }
} catch (error) {
  // The preflight exists so a bad configuration is legible in a deployment
  // log. It undermines itself if it can fail with a bare stack trace, so
  // anything unexpected in it still names what to look at.
  console.error(
    "\n[preflight] Failed before it could check the database.\n" +
      `  ${error?.message ?? error}\n\n` +
      "  This is the check itself failing, not a verdict on your database.\n" +
      "  Look first at DATABASE_URL: it is read at startup, and a value the\n" +
      "  driver cannot parse fails here.\n",
  );
  process.exit(1);
}

const handler = toNodeHandler(auth);

const server = createServer((req, res) => {
  // Liveness, for the container healthcheck. Deliberately not under /auth:
  // that prefix belongs to Better Auth, and an orchestrator probe should not
  // have to travel through the auth handler to find out the process is alive.
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "mygist-auth" }));
    return;
  }

  handler(req, res);
});

server.listen(port, host, () => {
  console.log(`mygist-auth listening on ${host}:${port}`);
});

// Coolify and Docker stop containers with SIGTERM. Without this, Node ignores
// it, the platform waits out its grace period and then kills the process --
// turning every deploy into a ten-second pause and dropping in-flight sign-ins.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
