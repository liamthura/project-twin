// The three rules the toast store holds, named directly rather than through a
// render: one toast at a time, a close leaves it standing while it animates
// out, and a removal timer can only ever remove the toast it was scheduled for.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast, useToast } from "./use-toast";

// Module state, so a toast left standing by one case is visible to the next.
// Each case closes what it raises and lets the delay elapse.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => vi.runAllTimers());
  vi.useRealTimers();
});

function setup() {
  const { result } = renderHook(() => useToast());
  return {
    toasts: () => result.current.toasts,
    raise: (props) => act(() => toast(props)),
    close: () => act(() => result.current.toasts[0].onOpenChange(false)),
    wait: (ms) => act(() => vi.advanceTimersByTime(ms)),
  };
}

describe("the toast store", () => {
  it("raises one, and a second replaces it rather than queueing", () => {
    const t = setup();

    t.raise({ title: "Saved" });
    expect(t.toasts()).toHaveLength(1);
    expect(t.toasts()[0]).toMatchObject({ title: "Saved", open: true });

    t.raise({ title: "Failed", variant: "destructive" });
    expect(t.toasts()).toHaveLength(1);
    expect(t.toasts()[0]).toMatchObject({ title: "Failed", variant: "destructive" });
  });

  it("keeps a closed toast mounted until the exit delay is up", () => {
    const t = setup();
    t.raise({ title: "Saved" });

    t.close();
    expect(t.toasts()[0]).toMatchObject({ title: "Saved", open: false });

    t.wait(3000);
    expect(t.toasts()).toHaveLength(0);
  });

  it("does not let a stale timer remove the toast that replaced it", () => {
    const t = setup();
    t.raise({ title: "First" });
    t.close();

    t.raise({ title: "Second" });
    t.wait(3000); // First's removal timer fires here.

    expect(t.toasts()).toHaveLength(1);
    expect(t.toasts()[0]).toMatchObject({ title: "Second", open: true });
  });
});
