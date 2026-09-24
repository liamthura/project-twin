import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * A debounce with one timer per key, plus a way to run what is waiting now.
 *
 * The autosave used one timer for every section, so an edit to Preferences
 * within 1.5s of an edit to Profile cancelled the Profile write: only the last
 * section touched was ever saved. Keyed timers keep each section's latest
 * change. `flush` runs every pending call at once, for when the page is being
 * hidden or closed and waiting out the delay would lose them.
 */
export function useKeyedDebounce(callback, delay) {
  const pending = useRef(new Map()); // key -> { timer, args }
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const run = useCallback((key, extra = []) => {
    const entry = pending.current.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.current.delete(key);
    callbackRef.current(...entry.args, ...extra);
  }, []);

  const schedule = useCallback(
    (key, ...rest) => {
      const entry = pending.current.get(key);
      if (entry) clearTimeout(entry.timer);
      pending.current.set(key, {
        args: [key, ...rest],
        timer: setTimeout(() => run(key), delay),
      });
    },
    [delay, run]
  );

  // Extra arguments are appended to each waiting call, so a flush on the way
  // out can ask for a request that survives the page closing.
  const flush = useCallback(
    (...extra) => {
      for (const key of [...pending.current.keys()]) run(key, extra);
    },
    [run]
  );

  const hasPending = useCallback(() => pending.current.size > 0, []);

  useEffect(() => () => pending.current.forEach((e) => clearTimeout(e.timer)), []);

  return useMemo(() => ({ schedule, flush, hasPending }), [schedule, flush, hasPending]);
}
