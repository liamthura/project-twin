/**
 * What is connected, and what it has done: GET /api/watchtower.
 *
 * One endpoint for every screen that asks, so onboarding, the Getting started
 * card and Review's empty state cannot disagree about whether an assistant is
 * connected. The rules are the server's (backend/watchtower.py).
 */
import { useEffect, useState } from "react";

import { api } from "./api.js";

export const FAST_MS = 3000;
export const SLOW_MS = 10000;
export const SLOW_AFTER_MS = 120000;

/** `since` is a `last_seen` this endpoint returned before (the server's own
 *  clock); `assistant` then covers only the calls after it. */
export function getWatchtower(since) {
  return api(since ? `/watchtower?since=${encodeURIComponent(since)}` : "/watchtower");
}

/** A name that opens a sentence: a token labelled "my assistant" reads "My assistant". */
export function atStart(name, fallback = "your assistant") {
  const n = (name || "").trim() || fallback;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/**
 * The latest report. While `active`, asks every 3 s, then every 10 s after two
 * minutes, and not at all while the tab is hidden. Not active, it asks once,
 * hidden or not.
 */
export function useWatchtower({ active = false, since = null } = {}) {
  // Kept with the `since` it answered, so a report asked for another one is
  // never returned: unfiltered, it would call an older assistant "connected".
  const [held, setHeld] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let timer;
    const started = Date.now();
    const tick = async () => {
      // A screen that asks once asks even from a background tab, or it would
      // show nothing (or "Connect" to someone connected) until reloaded.
      if (!active || document.visibilityState !== "hidden") {
        try {
          const next = await getWatchtower(since);
          if (!cancelled) setHeld({ since, report: next });
        } catch {
          // The next tick asks again; a screen that is waiting keeps waiting.
        }
      }
      if (cancelled || !active) return;
      timer = setTimeout(tick, Date.now() - started > SLOW_AFTER_MS ? SLOW_MS : FAST_MS);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, since]);
  return held && held.since === since ? held.report : null;
}
