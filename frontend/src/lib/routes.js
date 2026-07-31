/**
 * Hash routes.
 *
 * MyGist is served as a static bundle from one origin, and `#/profile` needs no
 * server-side fallback to work -- a real path like `/profile` would need every
 * unknown URL to serve index.html, which is a rule that has to live in FastAPI,
 * in the Dockerfile's static mount, and in anything anyone puts in front of it.
 * Hash routing keeps that promise of "one upstream, one port" intact.
 *
 * Two families:
 *
 *   #/profile, #/review, ...   sections of the app, one per tab
 *   #/signin, #/signup, ...    the auth screens
 *
 * They never appear at once, because one is what you see with a credential and
 * the other is what you see without.
 */

/** Auth screens. The names match WelcomeAuth's modes exactly, which is what
 *  lets a mode be read from and written to the URL without a mapping table. */
export const AUTH_ROUTES = ["signin", "signup", "forgot"];

export const DEFAULT_AUTH_ROUTE = "signin";

/** The current route, without its `#/`. Empty string when there is none. */
export function readRoute() {
  if (typeof window === "undefined") return "";
  return window.location.hash.replace(/^#\/?/, "");
}

export function isAuthRoute(route) {
  return AUTH_ROUTES.includes(route);
}

/**
 * Put a route in the address bar.
 *
 * `replace` is for corrections nobody navigated to -- normalising an unknown
 * route, or following a redirect. Those must not become history entries, or the
 * back button walks through states the user never chose. Deliberate moves
 * (sign in -> create an account) push, so back does the obvious thing.
 *
 * Query parameters are preserved: `?invite=` and `?reset=` live there, and a
 * route change must not drop the thing that brought someone here.
 */
export function goToRoute(route, { replace = false } = {}) {
  if (typeof window === "undefined") return;
  if (readRoute() === route) return;

  const url = `${window.location.pathname}${window.location.search}#/${route}`;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}
