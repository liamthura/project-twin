/**
 * Onboarding's own vocabulary.
 *
 * A third route family, `#/onboarding/<step>`. `parseRoute` needs no change to
 * read it: the step IS the band, and `#/onboarding/about-you` already splits
 * into `{section: "onboarding", band: "about-you"}`.
 *
 * Kept out of routes.js -- which is about the address bar, and which the auth
 * screens import -- and re-exported from there, so a call site that only wants
 * routing still has one import while this stays testable on its own.
 */

// Three steps (wave 4). Welcome folded into Connect, which now opens with the
// same two sentences; How you like answers folded into About you, as its
// second half.
export const ONBOARDING_STEPS = ["connect", "about-you", "complete"];

// Steps that no longer have a page of their own, and where they went. An old
// link or bookmark lands on the step that holds what it used to show.
const RETIRED_STEPS = { welcome: "connect", "how-you-like": "about-you" };

/**
 * The steps whose status the SERVER will store.
 *
 * It mirrors `settings_store.ONBOARDING_STEP_KEYS`, which rejects anything else
 * with a 400. Only the two sets of fields qualify, now both on the about-you
 * page (how-you-like is its second half): `complete` is a page, and `connect` is derived from whether a token or grant
 * actually exists -- storing a claim about that would let it disagree with the
 * connections themselves.
 */
export const STORABLE_STEPS = ["about-you", "how-you-like"];

export function isStorableStep(step) {
  return STORABLE_STEPS.includes(step);
}

export const DEFAULT_ONBOARDING_STEP = "connect";

export function isOnboardingRoute(section) {
  return section === "onboarding";
}

/**
 * A step name we are willing to render.
 *
 * Anything unrecognised -- a typo, a stale bookmark, a null band from
 * `#/onboarding` with nothing after it -- becomes the first step rather than a
 * blank screen. The caller corrects the address bar with `replace`, because
 * nobody navigated to the wrong step and it must not become a history entry.
 */
export function normaliseStep(step) {
  if (ONBOARDING_STEPS.includes(step)) return step;
  return RETIRED_STEPS[step] ?? DEFAULT_ONBOARDING_STEP;
}

// 0 for an unknown step, so this agrees with normaliseStep rather than
// returning -1 and letting a progress indicator render "step 0 of 4".
export function stepIndex(step) {
  const at = ONBOARDING_STEPS.indexOf(step);
  return at === -1 ? 0 : at;
}

export function nextStep(step) {
  return ONBOARDING_STEPS[stepIndex(step) + 1] ?? null;
}

export function prevStep(step) {
  const at = stepIndex(step);
  return at === 0 ? null : ONBOARDING_STEPS[at - 1];
}
