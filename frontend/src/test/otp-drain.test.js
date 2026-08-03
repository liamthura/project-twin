/**
 * The rule that decides whether a test waits for `input-otp`'s stray timers.
 *
 * Worth its own tests because the version this replaced looked correct and was
 * wrong in one case only -- a control that is mounted and then removed before
 * teardown -- which is exactly the case that leaks, and which fails at random
 * on a loaded machine rather than reproducibly on a fast one.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { OTP_SELECTOR, OTP_TIMER_DRAIN_MS, recordsContainOtp } from "./otp-drain.js";

let root;
let observer;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  observer?.disconnect();
  observer = null;
  root.remove();
});

/** Run `mutate`, then hand back the records it produced, synchronously. */
function recordsFor(mutate) {
  observer = new MutationObserver(() => {});
  observer.observe(document.documentElement, { childList: true, subtree: true });
  mutate();
  return observer.takeRecords();
}

function otpControl() {
  const input = document.createElement("input");
  input.setAttribute("data-input-otp", "true");
  return input;
}

describe("noticing that the OTP control was on screen", () => {
  it("sees it added on its own", () => {
    const records = recordsFor(() => root.appendChild(otpControl()));
    expect(recordsContainOtp(records)).toBe(true);
  });

  it("sees it added inside a subtree", () => {
    // How it actually arrives: React mounts a screen, and the control is
    // somewhere within it rather than being the added node itself.
    const records = recordsFor(() => {
      const screen = document.createElement("form");
      screen.appendChild(document.createElement("label"));
      screen.appendChild(otpControl());
      root.appendChild(screen);
    });
    expect(recordsContainOtp(records)).toBe(true);
  });

  it("still sees it when it is gone again by the time anyone looks", () => {
    // THE regression. Two WelcomeAuth tests mount the gate, accept a code and
    // move to the next screen, so at teardown the control is no longer in the
    // DOM -- while the timers it scheduled are still pending. The predicate
    // that replaced this one asked the live DOM and answered "no", skipping
    // the drain for the only tests that needed it.
    const records = recordsFor(() => {
      const control = otpControl();
      root.appendChild(control);
      control.remove();
    });

    expect(document.querySelector(OTP_SELECTOR)).toBeNull();
    expect(recordsContainOtp(records)).toBe(true);
  });

  it("is not fooled by other elements or by text", () => {
    const records = recordsFor(() => {
      root.appendChild(document.createElement("input"));
      root.appendChild(document.createTextNode("8 characters"));
    });
    expect(recordsContainOtp(records)).toBe(false);
  });

  it("says no when nothing was added at all", () => {
    expect(recordsContainOtp([])).toBe(false);
  });
});

describe("how long the drain waits", () => {
  it("outlasts the longest timer input-otp leaves behind", () => {
    // input-otp schedules at 0, 10 and 50ms and cancels none of them. Nothing
    // schedules more once the tree is unmounted, and timers fire in due order
    // however loaded the machine is -- so this is a margin over a real bound.
    expect(OTP_TIMER_DRAIN_MS).toBeGreaterThan(50);
  });
});
