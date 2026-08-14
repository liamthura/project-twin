import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: apiMock,
    getAuthToken: () => "test-token",
    listTokens: () => Promise.resolve([]),
    listConnectedApps: () => Promise.resolve([]),
  };
});
// Partial: session.js also exports INVITE_ALPHABET, which InviteGate reads at
// module scope. A whole-module mock takes that with it and the import throws
// before a single test runs.
vi.mock("@/lib/session.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, hasSession: () => Promise.resolve(true) };
});
vi.mock("@/lib/onboarding.js", () => ({
  getOnboarding: () => Promise.resolve({ dismissed: false, steps: {} }),
  saveOnboarding: () => Promise.resolve(),
  EMPTY_ONBOARDING: { dismissed: false, steps: {} },
}));

const App = (await import("./App")).default;

// jsdom implements neither, and App constructs both unconditionally -- the
// theme effect calls matchMedia and the tab strip's edge fade builds a
// ResizeObserver. Without these, rendering throws before any assertion runs.
// Same stubs as App.test.jsx.
beforeAll(() => {
  window.matchMedia =
    window.matchMedia ||
    (() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  window.ResizeObserver =
    window.ResizeObserver ||
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path) => {
    if (path === "/all") {
      return Promise.resolve({ data: { profile: {}, preferences: {} } });
    }
    if (path === "/settings") {
      return Promise.resolve({
        disabled_sections: [],
        packs: [
          { key: "profile", title: "Profile", core: true, enabled: true, sections: [] },
        ],
        onboarding: { dismissed: false, steps: {} },
      });
    }
    if (path === "/proposals/count") {
      return Promise.resolve({ entity: 0, note: 0, total: 0 });
    }
    return Promise.resolve({});
  });
});

afterEach(() => {
  window.location.hash = "";
});

describe("App on an onboarding route", () => {
  it("renders the flow with no shell around it", async () => {
    window.location.hash = "#/onboarding/welcome";
    render(<App />);

    await screen.findByRole("heading", { name: /welcome to mygist/i });
    // The two things the shell always draws. Their absence IS the feature.
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("renders the shell on a normal section, so the branch is not sticky", async () => {
    window.location.hash = "#/profile";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("banner")).toBeInTheDocument());
  });

  it("corrects an unknown step in the address bar, without a history entry", async () => {
    window.location.hash = "#/onboarding/nonsense";
    const replace = vi.spyOn(window.history, "replaceState");
    const push = vi.spyOn(window.history, "pushState");
    render(<App />);

    await screen.findByRole("heading", { name: /welcome to mygist/i });
    await waitFor(() => {
      expect(replace).toHaveBeenCalled();
      expect(window.location.hash).toBe("#/onboarding/welcome");
    });
    expect(push).not.toHaveBeenCalled();
    replace.mockRestore();
    push.mockRestore();
  });

  it("does not send an onboarding route through the section validator", async () => {
    // The section-validation effect rewrites any section not in the enabled set
    // to profile. Without an exemption it would evict the flow the moment
    // settings resolved -- which is the failure this test exists to catch.
    window.location.hash = "#/onboarding/about-you";
    render(<App />);

    await screen.findByRole("heading", { name: /about you/i });
    await new Promise((r) => setTimeout(r, 50));
    expect(window.location.hash).toBe("#/onboarding/about-you");
  });

  it("puts the getting-started card on Profile and nowhere else", async () => {
    window.location.hash = "#/profile";
    const { unmount } = render(<App />);
    expect(await screen.findByText(/getting started/i)).toBeInTheDocument();
    unmount();

    window.location.hash = "#/sections";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("banner")).toBeInTheDocument());
    expect(screen.queryByText(/getting started/i)).not.toBeInTheDocument();
  });
});
