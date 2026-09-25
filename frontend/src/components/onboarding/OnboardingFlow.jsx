/**
 * The standalone stepped flow. No app shell -- no header, no rail.
 *
 * That absence is the design, not an oversight: this screen is what someone
 * sees before they have any reason to care what the rail contains, and putting
 * the whole navigation around four questions was the version that got reversed.
 *
 * The flow owns its own load and its own save. It writes through the same
 * `PUT /api/files/{key}` the editor uses, debounced by the same 1500 ms, so
 * there is no onboarding-specific write path to keep in step -- and leaving
 * mid-step costs nothing, because there is no "finish" to abandon.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api.js";
import { getOnboarding, saveOnboarding } from "@/lib/onboarding.js";
import {
  ONBOARDING_STEPS,
  isStorableStep,
  normaliseStep,
  nextStep,
  prevStep,
} from "@/lib/onboardingSteps.js";
import { getAt, setAt } from "@/renderers/paths";

import { StepConnect } from "./StepConnect";
import { StepAboutYou } from "./StepAboutYou";
import { StepHowYouLike } from "./StepHowYouLike";
import { StepComplete } from "./StepComplete";

// Every step counts, Complete included as the destination -- a progress bar
// that never fills reads as unfinished work.
const COUNTED_STEPS = ONBOARDING_STEPS;

// The editor's debounce, from App.jsx. The same number on purpose: a reader who
// learns the app's saving rhythm here should find it unchanged afterwards.
const SAVE_DELAY_MS = 1500;

export default function OnboardingFlow({ step, onNavigate, onLeave }) {
  const current = normaliseStep(step);

  const [data, setData] = useState(null);
  const [packs, setPacks] = useState([]);
  const [disabledSections, setDisabledSections] = useState([]);
  const [progress, setProgress] = useState({ dismissed: false, steps: {} });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api("/all").catch(() => ({ data: {} })),
      api("/settings").catch(() => ({ packs: [], disabled_sections: [] })),
      getOnboarding().catch(() => ({ dismissed: false, steps: {} })),
    ]).then(([all, settings, saved]) => {
      if (cancelled) return;
      setData(all?.data || {});
      setPacks(settings?.packs || []);
      setDisabledSections(settings?.disabled_sections || []);
      setProgress(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // `flush` and `append` run from event handlers and need the latest data
  // without being rebuilt on every keystroke, which would re-run anything
  // depending on them.
  const dataRef = useRef(data);
  dataRef.current = data;

  // One timer per section key. Editing profile and then preferences must not
  // have the second edit cancel the first section's pending write -- a single
  // shared timer would do exactly that, and the loss would be silent.
  const timers = useRef({});
  useEffect(
    () => () => {
      for (const t of Object.values(timers.current)) clearTimeout(t);
    },
    [],
  );

  const write = useCallback((key, next) => {
    setData((prev) => ({ ...(prev || {}), [key]: next }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      delete timers.current[key];
      api(`/files/${key}`, { method: "PUT", body: JSON.stringify({ data: next }) }).catch(
        () => {
          // Deliberately quiet. There is no toaster on this screen and no
          // action to offer: the next keystroke schedules another write, and
          // the fields are still on screen either way.
        },
      );
    }, SAVE_DELAY_MS);
  }, []);

  // Flush anything still waiting before the step changes, so moving on cannot
  // outrun the debounce and lose the last thing typed.
  const flush = useCallback(() => {
    for (const [key, timer] of Object.entries(timers.current)) {
      clearTimeout(timer);
      delete timers.current[key];
      const payload = dataRef.current?.[key];
      if (payload === undefined) continue;
      api(`/files/${key}`, { method: "PUT", body: JSON.stringify({ data: payload }) }).catch(
        () => {},
      );
    }
  }, []);

  // An optional extra from Complete. Prepends, matching what the list editor
  // does, and goes through `write` so it is saved by the same debounce as
  // everything else on this screen -- there is no second write path.
  const append = useCallback(
    (key, path, item) => {
      const section = dataRef.current?.[key] || {};
      const list = getAt(section, path);
      write(key, setAt(section, path, [item, ...(Array.isArray(list) ? list : [])]));
    },
    [write],
  );

  const markStep = useCallback(
    (key, status) => {
      // The server stores a status for the two steps that collect fields and
      // rejects anything else with a 400. `connect` is derived from whether a
      // token or grant exists, so sending one here would be a write that could
      // only ever fail -- silently, since the failure is swallowed below.
      if (!isStorableStep(key)) return;
      setProgress((prev) => {
        const next = { ...prev, steps: { ...prev.steps, [key]: status } };
        saveOnboarding(next, disabledSections).catch(() => {
          // A lost status costs the reader a card that reappears, which is a
          // far smaller failure than a blocked step.
        });
        return next;
      });
    },
    [disabledSections],
  );

  const go = useCallback(
    (to) => {
      flush();
      if (to) onNavigate(to);
      else onLeave();
    },
    [flush, onNavigate, onLeave],
  );

  if (data === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const countedAt = COUNTED_STEPS.indexOf(current);

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-10 sm:py-16">
        {countedAt >= 0 && (
          // The bar alone. A "Step 1 of 3" label above it said the same thing
          // twice; the words stay for screen readers.
          <div className="mb-8">
            <span className="sr-only">
              Step {countedAt + 1} of {COUNTED_STEPS.length}
            </span>
            <div className="flex gap-1.5" aria-hidden="true">
              {COUNTED_STEPS.map((key, i) => (
                <span
                  key={key}
                  className={`h-1 flex-1 rounded-full ${
                    i <= countedAt ? "bg-primary" : "bg-muted"
                  }`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Not flex-1 on Connect: pinned to the foot of the window, "Skip for
            now" floated a screen-height away from the choice it is the third
            answer to. */}
        <div className={current === "connect" ? undefined : "flex-1"}>
          {current === "connect" && (
            <StepConnect
              // Handing the work over is a real answer, not an abandonment:
              // both field steps are recorded as deliberately skipped, and the
              // reader goes straight to the end. Complete then reads correctly
              // -- nothing was filled in, and that was the plan.
              onDelegate={() => {
                markStep("about-you", "skipped");
                markStep("how-you-like", "skipped");
                go("complete");
              }}
              onFillManually={() => go("about-you")}
            />
          )}

          {current === "about-you" && (
            <StepAboutYou
              packs={packs}
              data={data.profile || {}}
              onChange={(next) => write("profile", next)}
              onOfferAssistant={() => go("connect")}
            >
              <StepHowYouLike
                packs={packs}
                data={data.preferences || {}}
                onChange={(next) => write("preferences", next)}
              />
            </StepAboutYou>
          )}

          {current === "complete" && (
            <StepComplete data={data} onAdd={append} onDone={() => go(null)} />
          )}
        </div>

        {/* Connect ends in its own two-way choice and Complete has its own
            single way out, so neither takes the standard footer -- a Continue
            beside "I'll fill it in myself" would be two buttons for one
            decision. Connect is first now, so it owes a way out, not back. */}
        {current === "connect" && (
          <div className="mt-10">
            <Button variant="ghost" onClick={() => go(null)}>
              Skip for now
            </Button>
          </div>
        )}

        {current === "about-you" && (
          <div className="mt-10 flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => go(prevStep(current))}>
              Back
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  // Both halves of the page, each stored under its own key.
                  markStep("about-you", "skipped");
                  markStep("how-you-like", "skipped");
                  go(nextStep(current));
                }}
              >
                Skip this step
              </Button>
              <Button
                onClick={() => {
                  markStep("about-you", "done");
                  markStep("how-you-like", "done");
                  go(nextStep(current));
                }}
              >
                Continue
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
