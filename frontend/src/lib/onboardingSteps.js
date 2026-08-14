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

export const ONBOARDING_STEPS = ["welcome", "about-you", "how-you-like", "complete"];

export const DEFAULT_ONBOARDING_STEP = "welcome";

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
  return ONBOARDING_STEPS.includes(step) ? step : DEFAULT_ONBOARDING_STEP;
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
