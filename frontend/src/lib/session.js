/**
 * Browser session, backed by Better Auth.
 *
 * The durable credential is now an HttpOnly cookie that JavaScript cannot read,
 * set by the auth service at /auth. What this module holds is the short-lived
 * JWT derived from it, kept in memory only and never written to localStorage --
 * it can always be re-derived from the cookie, so persisting it would add an
 * exfiltration target for no benefit. That is a straight improvement on the
 * previous model, where a thirty-day bearer token sat in localStorage.
 *
 * /auth is same-origin: FastAPI proxies it to the auth service (see
 * backend/auth_proxy.py), so cookies are same-site and there is no CORS.
 */

// The derived JWT. Deliberately module state rather than storage: a page reload
// re-derives it from the cookie in one request.
let cachedJwt = null;

// Better Auth is mounted at /auth on the same origin as the app. Not derived
// from the API base: that can point at a remote instance in detached mode,
// where cookie auth cannot work at all and a manual token is used instead.
const AUTH_BASE = "/auth";

async function authFetch(path, options = {}) {
  return fetch(`${AUTH_BASE}${path}`, {
    ...options,
    // Without this the session cookie is neither sent nor stored.
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
}

async function readError(res, fallback) {
  const body = await res.json().catch(() => ({}));
  return body?.message || body?.error?.message || fallback;
}

/** Sign in with username and password. Existing accounts work unchanged: the
 *  service verifies their original bcrypt hash. */
export async function signIn(username, password) {
  const res = await authFetch("/sign-in/username", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await readError(res, "Sign in failed"));
  cachedJwt = null;
  return res.json();
}

/** Register a new account.
 *
 *  An email is required by the auth service even though MyGist has never asked
 *  for one, so a placeholder on the reserved .invalid TLD is used when none is
 *  given. RFC 2606 guarantees it can never resolve, so it cannot be mistaken
 *  for a deliverable address or accidentally sent to. A real address replaces
 *  it when email flows arrive. */
export async function signUp(username, password, email) {
  const res = await authFetch("/sign-up/email", {
    method: "POST",
    body: JSON.stringify({
      username,
      name: username,
      email: email || `${username}@mygist.invalid`,
      password,
    }),
  });
  if (!res.ok) throw new Error(await readError(res, "Registration failed"));
  cachedJwt = null;
  return res.json();
}

export async function signOut() {
  cachedJwt = null;
  await authFetch("/sign-out", { method: "POST" }).catch(() => {
    // A failed sign-out must not strand someone in a signed-in-looking UI.
    // The cached JWT is already gone; the cookie expires on its own.
  });
}

/** The current JWT, or null when there is no session.
 *
 *  Cached because every API call needs one and the cookie-to-JWT exchange is a
 *  round trip. Cleared by `forgetJwt` on a 401, which is what handles
 *  expiry -- cheaper and more reliable than tracking `exp` on the client and
 *  guessing at clock skew. */
export async function getJwt() {
  if (cachedJwt) return cachedJwt;

  const res = await authFetch("/token");
  if (!res.ok) return null;

  const body = await res.json().catch(() => ({}));
  cachedJwt = body?.token || null;
  return cachedJwt;
}

/** Drop the cached JWT so the next call re-derives one. */
export function forgetJwt() {
  cachedJwt = null;
}

/** Whether a Better Auth session exists right now. */
export async function hasSession() {
  return (await getJwt()) !== null;
}
