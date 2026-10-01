import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const driverMock = vi.hoisted(() => vi.fn());
const hintsMock = vi.hoisted(() => vi.fn());
const getOnboardingMock = vi.hoisted(() => vi.fn());
const markSeenMock = vi.hoisted(() => vi.fn());
vi.mock("driver.js", () => ({ driver: driverMock }));
vi.mock("driver.js/hints", () => ({ hints: hintsMock }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("./onboarding.js", () => ({ getOnboarding: getOnboardingMock, markSeen: markSeenMock }));

const { startTour, showHint, resetSeen, visible, celebrateFirst, closeGuides } = await import("./guide.js");
const confetti = (await import("canvas-confetti")).default;

const media = (reduce) => {
  globalThis.matchMedia = vi.fn((q) => ({ matches: reduce && q.includes("reduce") }));
};

beforeEach(() => {
  resetSeen();
  // A tour that runs and is closed straight away.
  driverMock.mockReset().mockImplementation((config) => ({ drive: () => config.onDestroyed?.(), destroy: vi.fn() }));
  hintsMock.mockReset().mockImplementation(() => ({ show: vi.fn(), hide: vi.fn() }));
  closeGuides();
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

describe("placement on a phone", () => {
  it("puts a popover below its element, unless the step asks for a side", async () => {
    globalThis.matchMedia = vi.fn((q) => ({ matches: q.includes("max-width") }));
    await startTour("guide:p", [
      { element: '[data-guide="a"]', popover: { title: "A" } },
      { element: '[data-guide="a"]', popover: { title: "B", side: "top" } },
    ]);
    const [first, second] = driverMock.mock.calls[0][0].steps;
    expect(first.popover.side).toBe("bottom");
    expect(second.popover.side).toBe("top");
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

describe("closeGuides", () => {
  it("takes down an open tour and hint, so nothing floats over the next screen", async () => {
    const destroy = vi.fn();
    const hide = vi.fn();
    driverMock.mockImplementation(() => ({ drive: vi.fn(), destroy }));
    hintsMock.mockImplementation(() => ({ show: vi.fn(), hide }));
    await startTour("guide:open", steps);
    await showHint("hint:open", { element: '[data-guide="a"]', title: "T", description: "D" });
    closeGuides();
    expect(destroy).toHaveBeenCalled();
    expect(hide).toHaveBeenCalled();
    closeGuides();
    expect(destroy).toHaveBeenCalledTimes(1);
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
