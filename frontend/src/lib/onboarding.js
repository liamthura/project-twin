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

export async function getOnboarding() {
  const settings = await api("/settings");
  const state = settings?.onboarding;
  if (!state || typeof state !== "object") return { ...EMPTY_ONBOARDING };
  return {
    dismissed: !!state.dismissed,
    steps: state.steps && typeof state.steps === "object" ? state.steps : {},
    seen: Array.isArray(state.seen) ? state.seen : [],
  };
}

/**
 * A guide or hint has been shown (lib/guide.js). Its own endpoint rather than
 * a field on PUT /settings, which needs the current disabled_sections and would
 * re-enable every section the reader turned off if a guide sent a stale list.
 */
export async function markSeen(key) {
  await api("/onboarding/seen", { method: "POST", body: JSON.stringify({ key }) });
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
}
