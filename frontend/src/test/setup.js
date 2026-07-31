import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// input-otp keeps its drawn caret in step with the real one using timers at 0,
// 10 and 50ms. Unmounting does not always beat them, and one firing after
// vitest has torn the jsdom environment down sets React state against a window
// that no longer exists -- an unhandled error, which fails the run while every
// test still reports as passed.
//
// So the pending ones are given room to fire while the environment is still
// alive. Paid only where the control actually rendered: 60ms on every one of
// the 590 tests would add half a minute for the benefit of about thirty.
const OTP_TIMER_DRAIN_MS = 80;

afterEach(async () => {
  const hadOtp =
    typeof document !== "undefined" && !!document.querySelector("[data-input-otp]");

  cleanup();

  if (hadOtp) {
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
