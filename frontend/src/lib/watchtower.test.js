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

  it("fetches its one report even in a tab opened in the background", async () => {
    visibility("hidden");
    renderHook(() => useWatchtower());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("asks only about calls after `since` when given one", async () => {
    renderHook(() => useWatchtower({ since: "2026-10-01T10:00:00+00:00" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(apiMock).toHaveBeenCalledWith("/watchtower?since=2026-10-01T10%3A00%3A00%2B00%3A00");
  });

  it("never answers with a report asked for a different `since`", async () => {
    apiMock.mockResolvedValueOnce({ assistant: { called: true } });
    const { result, rerender } = renderHook((props) => useWatchtower(props), { initialProps: {} });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.assistant.called).toBe(true);
    let land;
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { land = resolve; }));
    rerender({ since: "2026-10-01T10:00:00+00:00" });
    // The unfiltered report would read as "connected" for an older assistant.
    expect(result.current).toBe(null);
    await act(async () => land({ assistant: { called: false } }));
    expect(result.current.assistant.called).toBe(false);
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
