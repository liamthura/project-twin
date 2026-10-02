/**
 * Reading and writing onboarding progress.
 *
 * A separate file from api.js rather than two more functions in it: api.js
 * already carries every credential rule in the app, and these two are
 * onboarding's own. They are the only place that knows onboarding progress
 * rides on the settings endpoint.
 */
import { api } from "./api.js";

export const EMPTY_ONBOARDING = { dismissed: false, steps: {}, seen: [] };

function normalise(state) {
  if (!state || typeof state !== "object") return { ...EMPTY_ONBOARDING };
  return {
    dismissed: !!state.dismissed,
    steps: state.steps && typeof state.steps === "object" ? state.steps : {},
    seen: Array.isArray(state.seen) ? state.seen : [],
  };
}

// Progress once read, as a promise so two readers at once share one request.
// It rides on the settings response, which carries every section's manifest
// and is large, so it is read once per session -- App primes it from its own
// settings call -- and the writes below keep it current. In memory only, and
// forgotten whenever App reloads the persona, sign-out included.
let held = null;

/** Seed from a settings request already made: `raw` is its `onboarding`, or a promise of it. */
export function primeOnboarding(raw) {
  held = Promise.resolve(raw).then(normalise);
  // Marked handled here; a reader still sees the failure, and refetches.
  held.catch(() => {});
}

export function forgetOnboarding() {
  held = null;
}

export async function getOnboarding() {
  held ??= api("/settings").then((settings) => normalise(settings?.onboarding));
  try {
    const state = await held;
    return { ...state, steps: { ...state.steps }, seen: [...state.seen] };
  } catch (err) {
    held = null;
    throw err;
  }
}

// After a write lands, so a failed one leaves the last known state standing.
async function update(change) {
  if (!held) return;
  const state = await held.catch(() => null);
  if (state) held = Promise.resolve(change(state));
}

/**
 * A guide or hint has been shown (lib/guide.js). Its own endpoint rather than
 * a field on PUT /settings, which needs the current disabled_sections and would
 * re-enable every section the reader turned off if a guide sent a stale list.
 */
export async function markSeen(key) {
  await api("/onboarding/seen", { method: "POST", body: JSON.stringify({ key }) });
  await update((state) => (state.seen.includes(key) ? state : { ...state, seen: [...state.seen, key] }));
}

/**
 * `disabledSections` is not optional and must be the CURRENT value.
 *
 * SettingsUpdate requires `disabled_sections`, and the endpoint writes whatever
 * it is sent -- so passing `[]` for convenience would re-enable every section
 * the reader had turned off, as a side effect of finishing a step.
 */
export async function saveOnboarding(state, disabledSections) {
  await api("/settings", {
    method: "PUT",
    body: JSON.stringify({
      disabled_sections: disabledSections,
      onboarding: { dismissed: !!state.dismissed, steps: state.steps || {} },
    }),
  });
  await update((current) => ({ ...current, dismissed: !!state.dismissed, steps: state.steps || {} }));
}
