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

/**
 * Whether an identifier should be treated as an email address.
 *
 * Stricter than "contains an @" on purpose. MyGist's username rule only
 * requires a non-empty string, so `weird@name` is a username someone could
 * already hold; requiring a dotted domain routes that to username sign-in where
 * it belongs, and costs nothing for real addresses.
 *
 * The residual case -- a username that is itself a well-formed email address --
 * would be indistinguishable from an email by any rule, and is not worth a
 * second round trip that would also double what a mistyped password costs
 * against the rate limiter.
 */
export function looksLikeEmail(identifier) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(identifier ?? "").trim());
}

// Word for word what the service returns for a bad email sign-in, so a
// rejection made here is indistinguishable from one made there.
const INVALID_EMAIL_OR_PASSWORD = "Invalid email or password";

/**
 * Sign in with a username OR an email address, and a password.
 *
 * Which endpoint is used follows from the identifier's shape: Better Auth has
 * two, and neither accepts the other's identifier. Existing accounts work
 * unchanged either way -- the service verifies their original bcrypt hash.
 */
export async function signIn(identifier, password) {
  const trimmed = String(identifier ?? "").trim();
  const byEmail = looksLikeEmail(trimmed);

  // A placeholder is not an address anyone was ever given -- the UI goes out of
  // its way never to show one -- so nobody types it by accident. It is a real
  // row in the email column though, and would otherwise sign someone in on an
  // identifier we invented for them rather than one they chose.
  if (byEmail && isPlaceholderEmail(trimmed)) {
    throw new Error(INVALID_EMAIL_OR_PASSWORD);
  }

  const res = await authFetch(byEmail ? "/sign-in/email" : "/sign-in/username", {
    method: "POST",
    body: JSON.stringify(
      byEmail ? { email: trimmed, password } : { username: trimmed, password },
    ),
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

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/** Reserved by RFC 2606, so it can never resolve and can never be posted to.
 *  Seeding and registration both use it for accounts with no real address. */
export const PLACEHOLDER_DOMAIN = "mygist.invalid";

/** Whether an address is a stand-in rather than somewhere a person reads mail.
 *
 *  The UI must never show one of these as if it were the user's email, and
 *  must never offer to send to it. Checking the domain rather than the whole
 *  address matters: the local part is the username, which changes case and
 *  spelling between accounts. */
export function isPlaceholderEmail(email) {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${PLACEHOLDER_DOMAIN}`);
}

/** The signed-in user, or null.
 *
 *  Separate from `getJwt` because the JWT answers "may I call the API" while
 *  this answers "who is this and can we reach them" -- the second needs
 *  `email` and `emailVerified`, which the token does not carry. */
export async function getSession() {
  const res = await authFetch("/get-session");
  if (!res.ok) return null;

  const body = await res.json().catch(() => null);
  return body?.user ? body : null;
}

/** Set the account's email address.
 *
 *  For every existing account this is how an email is ADDED, not changed: they
 *  were seeded with a placeholder, so there is always an address in the column
 *  and never a real one. The service permits this without confirming from the
 *  old address precisely because a placeholder is unverified -- see
 *  `updateEmailWithoutVerification` in auth/src/auth.js.
 *
 *  Verification is then sent to the new address automatically. */
export async function changeEmail(newEmail) {
  const res = await authFetch("/change-email", {
    method: "POST",
    body: JSON.stringify({
      newEmail,
      callbackURL: verifiedCallbackUrl(),
    }),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not save that email"));
  return res.json();
}

/** Send (or re-send) the verification email for an address already on file. */
export async function sendVerificationEmail(email) {
  const res = await authFetch("/send-verification-email", {
    method: "POST",
    body: JSON.stringify({ email, callbackURL: verifiedCallbackUrl() }),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not send that email"));
  return res.json();
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/** Where the verification link lands once the address is confirmed. */
function verifiedCallbackUrl() {
  return `${window.location.origin}/?verified=1`;
}

/** Where the reset link lands. `reset=1` is ours; Better Auth appends `token`.
 *
 *  Marking it explicitly rather than keying on `token` alone keeps a bare
 *  `?token=` in the URL from being mistaken for a reset -- that name is far too
 *  generic to claim. */
export function resetCallbackUrl() {
  return `${window.location.origin}/?reset=1`;
}

/** Ask for a reset email.
 *
 *  `redirectTo` is not optional in practice. Better Auth builds the emailed
 *  link as /reset-password/<token>?callbackURL=<this>, and its handler rejects
 *  the request outright when callbackURL is empty -- so omitting this produces
 *  a link that fails when opened, long after anyone would connect the two.
 *
 *  The service answers the same way whether or not the address exists, so a
 *  stranger cannot use this to learn who has an account. The UI must not
 *  improve on that by saying more than the response does. */
export async function requestPasswordReset(email) {
  const res = await authFetch("/request-password-reset", {
    method: "POST",
    body: JSON.stringify({ email, redirectTo: resetCallbackUrl() }),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not send that email"));
  return res.json();
}

/** Set a new password using the token from a reset link.
 *
 *  Every other session is revoked by the service as this completes, so a reset
 *  prompted by "someone else may have my password" actually ends their access.
 *  This one is not signed in either -- the caller sends the user to sign in. */
export async function resetPassword(newPassword, token) {
  const res = await authFetch("/reset-password", {
    method: "POST",
    body: JSON.stringify({ newPassword, token }),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not reset your password"));
  cachedJwt = null;
  return res.json();
}
