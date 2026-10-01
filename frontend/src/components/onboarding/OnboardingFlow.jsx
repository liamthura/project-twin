/**
 * The standalone stepped flow. No app shell -- no header, no rail.
 *
 * That absence is the design, not an oversight: this screen is what someone
 * sees before they have any reason to care what the rail contains, and putting
 * the whole navigation around four questions was the version that got reversed.
 *
 * Two paths, three phases on one bar (lib/onboardingSteps.js). With an
 * assistant, the flow ends in Review on your first suggestion, which is the
 * moment the product is for; typing it yourself ends on your persona.
 *
 * The flow owns its own load and its own save. It writes through the same
 * `PUT /api/files/{key}` the editor uses, debounced by the same 1500 ms, so
 * there is no onboarding-specific write path to keep in step -- and leaving
 * mid-step costs nothing, because there is no "finish" to abandon.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Loader2 } from "lucide-react";

import { api } from "@/lib/api.js";
import { INSTALLABLE_CLIENTS } from "@/lib/clients.js";
import { NEEDS_CLIENT, PHASE_COUNT, normaliseStep, phaseOf } from "@/lib/onboardingSteps.js";
import { useWatchtower } from "@/lib/watchtower.js";
import { getAt, setAt } from "@/renderers/paths";

import { OTHER_CLIENT, StepAssistant } from "./StepAssistant";
import { StepConnect } from "./StepConnect";
import { StepHandover } from "./StepHandover";
import { StepAboutYou } from "./StepAboutYou";
import { StepHowYouLike } from "./StepHowYouLike";
import { StepComplete } from "./StepComplete";

// The editor's debounce, from App.jsx. The same number on purpose: a reader who
// learns the app's saving rhythm here should find it unchanged afterwards.
const SAVE_DELAY_MS = 1500;
// Kept for the tab, so a reload on Connect still knows which assistant.
const CLIENT_KEY = "mygist_onboarding_client";
const COMMUNICATION = ["communication", "default"];

const clientById = (id) => [...INSTALLABLE_CLIENTS, OTHER_CLIENT].find((c) => c.id === id) || null;

function browserLocale() {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(navigator.language) || null;
  } catch {
    return null;
  }
}

/**
 * What you typed in this flow: fields that differ from what was loaded and are
 * not empty, plus anything added on Complete. A default the server filled in
 * (British English) was there before you arrived, so it does not count.
 */
export function countAdded(before, after) {
  const changed = (a = {}, b = {}) =>
    Object.keys(b).filter(
      (k) => typeof b[k] !== "object" && String(b[k] ?? "").trim() && b[k] !== a[k],
    ).length;
  const grew = (a, b) => Math.max(0, (b?.length || 0) - (a?.length || 0));
  return (
    changed(before?.profile, after?.profile) +
    changed(getAt(before?.preferences || {}, COMMUNICATION), getAt(after?.preferences || {}, COMMUNICATION)) +
    grew(before?.projects?.top_of_mind, after?.projects?.top_of_mind) +
    grew(before?.goals?.goals, after?.goals?.goals)
  );
}

export default function OnboardingFlow({ step, onNavigate, onLeave }) {
  const reduce = useReducedMotion();
  const [clientId, setClientId] = useState(() => sessionStorage.getItem(CLIENT_KEY));
  const client = clientById(clientId);
  const requested = normaliseStep(step);
  const current = NEEDS_CLIENT.has(requested) && !client ? "assistant" : requested;
  const report = useWatchtower({ active: NEEDS_CLIENT.has(current) });

  const [data, setData] = useState(null);
  const [packs, setPacks] = useState([]);
  const [saveState, setSaveState] = useState(null);
  const loaded = useRef(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api("/all").catch(() => ({ data: {} })),
      api("/settings").catch(() => ({ packs: [] })),
    ]).then(([all, settings]) => {
      if (cancelled) return;
      loaded.current = all?.data || {};
      setData(all?.data || {});
      setPacks(settings?.packs || []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // `send` and `flush` run from timers and handlers and need the latest data
  // without being rebuilt on every keystroke.
  const dataRef = useRef(data);
  dataRef.current = data;

  // One timer per section key. Editing profile and then preferences must not
  // have the second edit cancel the first section's pending write -- a single
  // shared timer would do exactly that, and the loss would be silent. `failed`
  // is what Retry sends again.
  const timers = useRef({});
  const failed = useRef(new Set());
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const send = useCallback((key) => {
    const payload = dataRef.current?.[key];
    if (payload === undefined) return;
    setSaveState("saving");
    api(`/files/${key}`, { method: "PUT", body: JSON.stringify({ data: payload }) }).then(
      () => {
        failed.current.delete(key);
        setSaveState(failed.current.size ? "error" : "saved");
      },
      () => {
        failed.current.add(key);
        setSaveState("error");
      },
    );
  }, []);

  const write = useCallback(
    (key, next) => {
      dataRef.current = { ...(dataRef.current || {}), [key]: next };
      setData(dataRef.current);
      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => {
        delete timers.current[key];
        send(key);
      }, SAVE_DELAY_MS);
    },
    [send],
  );

  // Flush anything still waiting before the step changes, so moving on cannot
  // outrun the debounce and lose the last thing typed.
  const flush = useCallback(() => {
    for (const [key, timer] of Object.entries(timers.current)) {
      clearTimeout(timer);
      delete timers.current[key];
      send(key);
    }
  }, [send]);

  const retry = useCallback(() => [...failed.current].forEach(send), [send]);

  // An optional extra from Complete. Prepends, matching what the list editor
  // does, and goes through `write`, so there is no second write path.
  const append = useCallback(
    (key, path, item) => {
      const section = dataRef.current?.[key] || {};
      const list = getAt(section, path);
      write(key, setAt(section, path, [item, ...(Array.isArray(list) ? list : [])]));
    },
    [write],
  );

  const go = (to, leave) => {
    flush();
    if (to) onNavigate(to);
    else onLeave(leave);
  };

  const choose = (id) => {
    sessionStorage.setItem(CLIENT_KEY, id);
    setClientId(id);
    go("connect");
  };

  if (data === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  // The locale starts from the browser's language while it is still the
  // manifest default, and is written when you continue, so a value you saw and
  // kept is saved and one you never saw is not.
  const defaultLocale = packs.find((p) => p.key === "preferences")?.defaults?.communication?.default?.locale;
  const storedLocale = getAt(data.preferences || {}, [...COMMUNICATION, "locale"]);
  const suggested = browserLocale();
  const shownLocale =
    defaultLocale && storedLocale === defaultLocale && suggested && suggested !== defaultLocale ? suggested : null;

  const phase = phaseOf(current);
  // Typing it yourself never passes through Connect, so its segment stays empty.
  const skippedConnect = !client && phase > 0;

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-10 sm:py-16">
        {/* The bar alone. A "Step 1 of 3" label above it said the same thing
            twice; the words stay for screen readers. */}
        <div className="mb-8">
          <span className="sr-only">
            Step {phase + 1} of {PHASE_COUNT}
          </span>
          <div className="flex gap-1.5" aria-hidden="true">
            {Array.from({ length: PHASE_COUNT }, (_, i) => (
              <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className={`block h-full origin-left bg-primary transition-transform duration-300 ease-standard motion-reduce:transition-none ${
                    i <= phase && !(skippedConnect && i === 0) ? "scale-x-100" : "scale-x-0"
                  }`}
                />
              </span>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current}
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 1 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: [0.2, 0, 0, 1] }}
          >
            {current === "assistant" && (
              <StepAssistant onChoose={choose} onTypeMyself={() => go("about-you")} onSkip={() => go(null)} />
            )}
            {current === "connect" && (
              <StepConnect
                client={client}
                report={report}
                onBack={() => go("assistant")}
                onContinue={() => go("handover")}
              />
            )}
            {current === "handover" && (
              <StepHandover
                client={client}
                report={report}
                onReview={() => go(null, { to: "review" })}
                onTypeMyself={() => go("about-you")}
                onLater={() => go(null)}
              />
            )}
            {current === "about-you" && (
              <StepAboutYou
                packs={packs}
                data={data.profile || {}}
                onChange={(next) => write("profile", next)}
                saveState={saveState}
                onRetry={retry}
                onOfferAssistant={() => go("assistant")}
                onBack={() => go(client ? "handover" : "assistant")}
                onLater={() => go(null)}
                onContinue={() => {
                  if (shownLocale) {
                    write("preferences", setAt(data.preferences || {}, [...COMMUNICATION, "locale"], shownLocale));
                  }
                  go("complete");
                }}
              >
                <StepHowYouLike
                  packs={packs}
                  data={data.preferences || {}}
                  locale={shownLocale}
                  onChange={(next) => write("preferences", next)}
                />
              </StepAboutYou>
            )}
            {current === "complete" && (
              <StepComplete
                added={countAdded(loaded.current, data)}
                report={report}
                onAdd={append}
                onDone={() => go(null, { tour: true })}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
