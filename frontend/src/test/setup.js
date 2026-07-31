import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

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
