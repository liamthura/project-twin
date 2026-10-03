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
 * hidden or not. Either way it asks again when the tab is shown. Not
 * `enabled`, it asks nothing at all: the report is large on a busy account,
 * so a screen that may not show it says when it does.
 */
export function useWatchtower({ active = false, since = null, enabled = true } = {}) {
  // Kept with the `since` it answered, so a report asked for another one is
  // never returned: unfiltered, it would call an older assistant "connected".
  const [held, setHeld] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let timer;
    const started = Date.now();
    const ask = async () => {
      try {
        const next = await getWatchtower(since);
        if (!cancelled) setHeld({ since, report: next });
      } catch {
        // The next tick asks again; a screen that is waiting keeps waiting.
      }
    };
    const tick = async () => {
      // A screen that asks once asks even from a background tab, or it would
      // show nothing (or "Connect" to someone connected) until reloaded.
      if (!active || document.visibilityState !== "hidden") await ask();
      if (cancelled || !active) return;
      timer = setTimeout(tick, Date.now() - started > SLOW_AFTER_MS ? SLOW_MS : FAST_MS);
    };
    // Back on the tab, ask again: an assistant connected in another window
    // shows here without a reload.
    const onVisible = () => {
      if (document.visibilityState === "visible") ask();
    };
    tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, since, enabled]);
  return held && held.since === since ? held.report : null;
}
