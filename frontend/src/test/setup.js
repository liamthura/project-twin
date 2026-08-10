import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import {
  OTP_SELECTOR,
  OTP_TIMER_DRAIN_MS,
  recordsContainOtp,
} from "./otp-drain.js";

// `input-otp` schedules caret timers it never cancels, and one firing after the
// environment is torn down fails the whole run while every test still reports as
// passed. They are given room to finish while jsdom is still alive. See
// ./otp-drain.js for why this is watched rather than queried at teardown.
let sawOtpControl = false;
let watcher = null;

function watchForOtpControl() {
  if (watcher || typeof MutationObserver === "undefined") return;
  // One observer per file rather than per test: the jsdom document outlives
  // every test in a file, and 600 observers would be 600 more things to unwind.
  watcher = new MutationObserver((records) => {
    sawOtpControl = sawOtpControl || recordsContainOtp(records);
  });
  watcher.observe(document.documentElement, { childList: true, subtree: true });
}

beforeEach(() => {
  sawOtpControl = false;
  watchForOtpControl();
});

afterEach(async () => {
  // takeRecords first: the callback runs a microtask behind the mutation, and
  // this must not depend on having been given that tick.
  if (watcher) sawOtpControl = sawOtpControl || recordsContainOtp(watcher.takeRecords());

  // Kept as a floor under the observer. If anything ever renders the control
  // without a mutation this can see, the drain still happens.
  const present =
    typeof document !== "undefined" && !!document.querySelector(OTP_SELECTOR);

  cleanup();

  if (sawOtpControl || present) {
    await new Promise((resolve) => setTimeout(resolve, OTP_TIMER_DRAIN_MS));
  }
});

// Two jsdom gaps that `input-otp` relies on. It draws its own caret, because
// one real input spans all eight slots, and it needs layout to place it -- so
// it observes the container and asks what is under the pointer. jsdom does no
// layout and implements neither call.
//
// Both throw from inside a timer rather than from render, so the tests all
// PASS and the run still fails: vitest counts them as unhandled errors and
// exits non-zero. That is how this reached CI green-looking locally -- worth
// knowing before trusting a "581 passed" line again.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof document !== "undefined" && !document.elementFromPoint) {
  // Nothing is under the pointer in a layout-less DOM, and null is the answer
  // the real API gives for exactly that.
  document.elementFromPoint = () => null;
}

// A third set of jsdom gaps, from Radix Select -- reached the moment a test
// actually OPENS one rather than only asserting on its closed trigger, which
// is what the sort control's tests do.
//
// Radix tracks pointer capture so a press-drag-release over the list selects
// in one gesture, and scrolls the active option into view when the list opens.
// jsdom implements neither, and `hasPointerCapture` throws from inside Radix's
// own pointerdown handler -- so the failure surfaces as an unhandled exception
// with a stack inside node_modules, not as a readable assertion failure.
//
// Element.prototype, not a per-test spy: any Radix Select in any future test
// hits the same three calls, and the alternative is this block copied into
// every file that opens one.
if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    // No pointer is captured in a DOM with no pointer, and `false` is what the
    // real API answers for exactly that.
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  // Layout-less, so there is nothing to scroll and nowhere to scroll it.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
}

// A fourth jsdom gap, from the marketing page's section entrances: Magic UI's
// blur-fade uses motion's `useInView`, which constructs an IntersectionObserver
// on mount. jsdom does no layout and does not implement it.
//
// The stub reports the element as intersecting straight away, which is the
// state that matters for a test: content behind a scroll-triggered entrance is
// present and assertable rather than waiting for a scroll that never happens in
// jsdom. A stub that never fires would hide the whole page from every query.
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      this._callback = callback;
    }
    observe(target) {
      this._callback(
        [{ isIntersecting: true, intersectionRatio: 1, target }],
        this,
      );
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
}
