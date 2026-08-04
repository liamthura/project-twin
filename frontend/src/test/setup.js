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
