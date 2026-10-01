import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api.js", () => ({ api: apiMock }));
const { useWatchtower, atStart, FAST_MS, SLOW_MS, SLOW_AFTER_MS } = await import("./watchtower.js");

const visibility = (v) => Object.defineProperty(document, "visibilityState", { value: v, configurable: true });

beforeEach(() => {
  vi.useFakeTimers();
  apiMock.mockReset().mockResolvedValue({ connection: { state: "none" } });
  visibility("visible");
});
afterEach(() => vi.useRealTimers());

describe("useWatchtower", () => {
  it("fetches once when not active", async () => {
    renderHook(() => useWatchtower());
    await act(() => vi.advanceTimersByTimeAsync(FAST_MS * 3));
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith("/watchtower");
  });

  it("polls fast, then slow after two minutes", async () => {
    renderHook(() => useWatchtower({ active: true }));
    await act(() => vi.advanceTimersByTimeAsync(FAST_MS * 2));
    expect(apiMock).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(SLOW_AFTER_MS));
    const before = apiMock.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(SLOW_MS - 1));
    expect(apiMock.mock.calls.length - before).toBeLessThanOrEqual(1);
  });

  it("skips fetches while the tab is hidden", async () => {
    renderHook(() => useWatchtower({ active: true }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    visibility("hidden");
    await act(() => vi.advanceTimersByTimeAsync(FAST_MS * 3));
    expect(apiMock).toHaveBeenCalledTimes(1);
    visibility("visible");
    await act(() => vi.advanceTimersByTimeAsync(FAST_MS));
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
});

describe("atStart", () => {
  it("capitalises a name that opens a sentence, and falls back", () => {
    expect(atStart("my assistant")).toBe("My assistant");
    expect(atStart(null)).toBe("Your assistant");
    expect(atStart("Cursor")).toBe("Cursor");
  });
});
