/**
 * Hash routes.
 *
 * MyGist is served as a static bundle from one origin, and `#/profile` needs no
 * server-side fallback to work -- a real path like `/profile` would need every
 * unknown URL to serve index.html, which is a rule that has to live in FastAPI,
 * in the Dockerfile's static mount, and in anything anyone puts in front of it.
 * Hash routing keeps that promise of "one upstream, one port" intact.
 *
 * Three families:
 *
 *   #/profile, #/review, ...   sections of the app, one per tab
 *   #/signin, #/signup, ...    the auth screens
 *   #/onboarding/<step>        the first-run flow
 *
 * They never appear at once. One is what you see with a credential and one is
 * what you see without; the third replaces the shell while it is up, rather
 * than sitting inside it.
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

// Onboarding's routes live here too, so a call site that already imports
// `isAuthRoute` does not need a second import to ask the matching question.
// The logic itself is in ./onboardingSteps -- see that file's header.
export {
  ONBOARDING_STEPS,
  DEFAULT_ONBOARDING_STEP,
  isOnboardingRoute,
  normaliseStep,
  stepIndex,
  nextStep,
  prevStep,
} from "./onboardingSteps";

/**
 * Split a raw route -- what `readRoute()` returns -- into its two segments.
 *
 * The app grew a second level: `#/preferences/communication` names a section and
 * a band within it. This is kept separate from `readRoute()` rather than folded
 * into it, because the auth screens read that raw string and predate the second
 * segment; changing its contract would mean touching WelcomeAuth for no reason.
 *
 * `goToRoute` needs no change at all to write these: it interpolates its
 * argument into `#/${route}`, and both that and its `readRoute() === route`
 * guard already tolerate a slash.
 *
 * Pure, so it is testable without a DOM. Two deliberate leniencies:
 *   - a trailing slash reports NO band, not an empty one, which would otherwise
 *     fail band validation and cause a pointless correcting replaceState
 *   - a third segment is dropped rather than an error. The shell validates the
 *     band against `outline()` regardless, and an unknown one is already
 *     handled: replaceState back to the bare section.
 */
export function parseRoute(raw) {
  const [section = "", band] = String(raw ?? "").split("/");
  return { section, band: band || null };
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
