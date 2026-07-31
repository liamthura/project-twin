import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom implements no ResizeObserver, and `input-otp` observes its container to
// keep the drawn caret aligned with the real one. Without this the invite-code
// screen throws on mount and every test touching it fails for a reason that has
// nothing to do with what it was testing.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
