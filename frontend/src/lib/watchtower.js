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

export function getWatchtower() {
  return api("/watchtower");
}

/** A name that opens a sentence: a token labelled "my assistant" reads "My assistant". */
export function atStart(name, fallback = "your assistant") {
  const n = (name || "").trim() || fallback;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/**
 * The latest report. While `active`, asks every 3 s, then every 10 s after two
 * minutes, and not at all while the tab is hidden. Not active, it asks once.
 */
export function useWatchtower({ active = false } = {}) {
  const [report, setReport] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let timer;
    const started = Date.now();
    const tick = async () => {
      if (document.visibilityState !== "hidden") {
        try {
          const next = await getWatchtower();
          if (!cancelled) setReport(next);
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
  }, [active]);
  return report;
}
