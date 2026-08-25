/**
 * The path Better Auth is mounted at, matching what FastAPI forwards.
 *
 * Pulled out on its own so that the two places deriving Better Auth's effective
 * base URL -- baseURL + this path -- read one literal rather than repeating
 * "/auth" somewhere it could drift. Both are in auth.js: the `basePath` option
 * itself, and the jwt() plugin's pinned issuer and audience.
 *
 * The OAuth wiring was a third until 1.7, for `validAudiences`, an option that
 * version removed. Its lesson is why this file exists, so it outlives it: Task
 * 5's review found `validAudiences` missing the auth base entirely, because the
 * wiring passed the bare origin where Better Auth's own `ctx.context.baseURL`
 * is origin + basePath -- and the test hid it by hand-writing the
 * already-joined URL instead of deriving it. Two hand-written copies of a
 * joined value agreed with each other and with nothing real.
 */
export const AUTH_BASE_PATH = "/auth";
