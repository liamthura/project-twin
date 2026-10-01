import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const driverMock = vi.hoisted(() => vi.fn());
const hintsMock = vi.hoisted(() => vi.fn());
const getOnboardingMock = vi.hoisted(() => vi.fn());
const markSeenMock = vi.hoisted(() => vi.fn());
vi.mock("driver.js", () => ({ driver: driverMock }));
vi.mock("driver.js/hints", () => ({ hints: hintsMock }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("./onboarding.js", () => ({ getOnboarding: getOnboardingMock, markSeen: markSeenMock }));

const { startTour, showHint, resetSeen, visible, celebrateFirst } = await import("./guide.js");
const confetti = (await import("canvas-confetti")).default;

const media = (reduce) => {
  globalThis.matchMedia = vi.fn((q) => ({ matches: reduce && q.includes("reduce") }));
};

beforeEach(() => {
  resetSeen();
  // A tour that runs and is closed straight away.
  driverMock.mockReset().mockImplementation((config) => ({ drive: () => config.onDestroyed?.() }));
  hintsMock.mockReset().mockImplementation(() => ({ show: vi.fn() }));
  getOnboardingMock.mockReset().mockResolvedValue({ seen: [] });
  markSeenMock.mockReset().mockResolvedValue(undefined);
  confetti.mockClear();
  document.body.innerHTML = '<button data-guide="a">A</button>';
  // jsdom lays nothing out; say this element is on screen.
  document.querySelector('[data-guide="a"]').getClientRects = () => [{}];
  media(false);
});
afterEach(() => {
  delete globalThis.matchMedia;
});

const steps = [
  { element: '[data-guide="a"]', popover: { title: "A", description: "a" } },
  { element: '[data-guide="missing"]', popover: { title: "B", description: "b" } },
];

describe("startTour", () => {
  it("runs once, drops missing steps, and remembers it on the server", async () => {
    expect(await startTour("guide:x", steps)).toBe(true);
    expect(driverMock.mock.calls[0][0].steps).toHaveLength(1);
    await vi.waitFor(() => expect(markSeenMock).toHaveBeenCalledWith("guide:x"));
    expect(await startTour("guide:x", steps)).toBe(false);
    expect(await startTour("guide:x", steps, { force: true })).toBe(true);
  });

  it("does not start with nothing to point at", async () => {
    expect(await startTour("guide:y", [steps[1]])).toBe(false);
    expect(driverMock).not.toHaveBeenCalled();
  });

  it("does not animate under reduced motion", async () => {
    media(true);
    await startTour("guide:z", steps);
    expect(driverMock.mock.calls[0][0]).toMatchObject({ animate: false, smoothScroll: false });
  });

  it("skips a guide already seen on another device", async () => {
    getOnboardingMock.mockResolvedValue({ seen: ["guide:x"] });
    expect(await startTour("guide:x", steps)).toBe(false);
  });
});

describe("showHint", () => {
  it("shows once and is remembered when dismissed", async () => {
    expect(await showHint("hint:a", { element: '[data-guide="a"]', title: "T", description: "D" })).toBe(true);
    const config = hintsMock.mock.calls[0][0];
    expect(config.hints[0].popover).toMatchObject({ title: "T", description: "D", buttonText: "Got it" });
    config.onDismiss();
    await vi.waitFor(() => expect(markSeenMock).toHaveBeenCalledWith("hint:a"));
    expect(await showHint("hint:a", { element: '[data-guide="a"]', title: "T", description: "D" })).toBe(false);
  });
});

describe("visible", () => {
  it("points at the visible element", () => {
    document.body.innerHTML = '<nav data-guide="s" id="hidden"></nav><nav data-guide="s" id="shown"></nav>';
    document.getElementById("hidden").getClientRects = () => [];
    document.getElementById("shown").getClientRects = () => [{}];
    expect(visible('[data-guide="s"]').id).toBe("shown");
  });
});

describe("celebrateFirst", () => {
  it("fires once", async () => {
    await celebrateFirst();
    await celebrateFirst();
    expect(confetti).toHaveBeenCalledTimes(1);
  });

  it("never fires under reduced motion", async () => {
    media(true);
    await celebrateFirst();
    expect(confetti).not.toHaveBeenCalled();
  });
});
