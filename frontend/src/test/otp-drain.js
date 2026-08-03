/**
 * Deciding when a test has to let `input-otp`'s timers finish.
 *
 * `input-otp` keeps its drawn caret in step with the real one using timers at
 * 0, 10 and 50ms, scheduled from an effect that returns no cleanup -- so
 * unmounting never cancels them. When one fires it reads `selectionStart` off
 * a ref that unmount has set to null, gets `undefined`, and `undefined !== null`
 * is true, so it calls setState anyway. Harmless while jsdom is alive; an
 * unhandled `window is not defined` once the environment has been torn down,
 * which fails the run while every test still reports as passed.
 *
 * The fix is to let them fire before the environment goes. That only needs
 * knowing whether the control was on screen -- and the obvious way to ask,
 * `document.querySelector` at teardown, answers the wrong question. A test that
 * types a code and then moves to the next screen has already removed the
 * control by then, so the check says no and the timers it scheduled are exactly
 * the ones left pending. That was the real bug: two tests in WelcomeAuth, five
 * timers and two, surviving into whatever ran next.
 *
 * So the question is "was it ever mounted", and MutationObserver records answer
 * it. They have to be read as records rather than by re-querying the DOM from
 * inside the callback: the callback runs a microtask later, by which point a
 * control that was added and removed in the same tick is already gone, and
 * re-querying would miss precisely the case this exists for.
 */

export const OTP_SELECTOR = "[data-input-otp]";

/**
 * How long to wait. The last timer any of these schedules is due 50ms after the
 * scheduling, nothing schedules more once the tree is unmounted, and timers fire
 * in due order regardless of how loaded the machine is -- so this is a margin
 * over a real bound, not a guess that a fast machine will win a race.
 *
 * Paid only where the control actually rendered. 80ms on every test in the
 * suite would add most of a minute for the benefit of about twenty.
 */
export const OTP_TIMER_DRAIN_MS = 80;

/** Whether any of these MutationRecords added the OTP control. */
export function recordsContainOtp(records) {
  for (const record of records) {
    for (const node of record.addedNodes) {
      // Text nodes have no matches/querySelector; ELEMENT_NODE is 1.
      if (node.nodeType !== 1) continue;
      if (node.matches?.(OTP_SELECTOR) || node.querySelector?.(OTP_SELECTOR)) {
        return true;
      }
    }
  }
  return false;
}
