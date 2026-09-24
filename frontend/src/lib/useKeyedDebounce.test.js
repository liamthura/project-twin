import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyedDebounce } from "./useKeyedDebounce.js";

afterEach(() => vi.useRealTimers());

describe("useKeyedDebounce", () => {
  it("keeps the latest call for each key instead of only the last key", () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const { result } = renderHook(() => useKeyedDebounce(cb, 1500));
    result.current.schedule("profile", { name: "M" });
    result.current.schedule("preferences", { tone: "dry" });
    result.current.schedule("profile", { name: "Ma" });
    vi.advanceTimersByTime(1500);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenCalledWith("profile", { name: "Ma" });
    expect(cb).toHaveBeenCalledWith("preferences", { tone: "dry" });
  });

  it("flush runs everything waiting now, with the extra arguments, and only once", () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const { result } = renderHook(() => useKeyedDebounce(cb, 1500));
    result.current.schedule("profile", 1);
    expect(result.current.hasPending()).toBe(true);
    result.current.flush({ keepalive: true });
    expect(cb).toHaveBeenCalledWith("profile", 1, { keepalive: true });
    expect(result.current.hasPending()).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("useKeyedDebounce identity", () => {
  it("returns the same object across renders, so effects that depend on it stay put", () => {
    const { result, rerender } = renderHook(() => useKeyedDebounce(() => {}, 10));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
