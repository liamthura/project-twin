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

// Five steps on two paths (wave 10). With an assistant: assistant, connect,
// handover, then Review. Typing it yourself: about-you, complete, then Profile.
export const ONBOARDING_STEPS = ["assistant", "connect", "handover", "about-you", "complete"];

// Steps that no longer have a page of their own, and where they went. An old
// link or bookmark lands on the step that holds what it used to show.
const RETIRED_STEPS = { welcome: "assistant", "how-you-like": "about-you" };

export const DEFAULT_ONBOARDING_STEP = "assistant";

// The progress bar's three parts: Connect, Fill in, and the end. Both paths
// read the same way, whichever steps they pass through.
const PHASE = { assistant: 0, connect: 0, handover: 1, "about-you": 1, complete: 2 };
export const PHASE_COUNT = 3;

// Steps about the assistant you chose. With none chosen they show the choice.
export const NEEDS_CLIENT = new Set(["connect", "handover"]);

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

export function phaseOf(step) {
  return PHASE[normaliseStep(step)];
}
