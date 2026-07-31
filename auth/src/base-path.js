/**
 * The path Better Auth is mounted at, matching what FastAPI forwards.
 *
 * Pulled out on its own so that auth.js and the OAuth wiring (auth.js's call
 * into oauth.js, and oauth.test.js) all derive Better Auth's effective base URL
 * -- baseURL + this path -- from the same literal, rather than repeating
 * "/auth" in multiple places that could drift apart. That drift is exactly how
 * Task 5's review found `validAudiences` missing the auth base entirely: the
 * wiring passed the bare origin where Better Auth's own `ctx.context.baseURL`
 * is origin + basePath, and the test hid it by hand-writing the already-joined
 * URL instead of deriving it.
 */
export const AUTH_BASE_PATH = "/auth";
