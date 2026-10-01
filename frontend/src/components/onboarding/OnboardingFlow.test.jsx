import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const apiMock = vi.hoisted(() => vi.fn());
const getOnboardingMock = vi.hoisted(() => vi.fn());
const saveOnboardingMock = vi.hoisted(() => vi.fn());
const listTokensMock = vi.hoisted(() => vi.fn());
const listConnectedAppsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: apiMock,
    listTokens: listTokensMock,
    listConnectedApps: listConnectedAppsMock,
    mcpUrl: () => "https://example.test/mcp",
    getInstance: () => Promise.resolve({ mcp_oauth: true }),
  };
});
vi.mock("@/lib/watchtower.js", () => ({
  useWatchtower: () => null,
  atStart: (n, f = "your assistant") => {
    const s = n || f;
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
}));
vi.mock("@/lib/guide.js", () => ({ startTour: vi.fn(async () => false) }));
vi.mock("@/lib/onboarding.js", () => ({
  getOnboarding: getOnboardingMock,
  saveOnboarding: saveOnboardingMock,
  EMPTY_ONBOARDING: { dismissed: false, steps: {} },
}));

const OnboardingFlow = (await import("./OnboardingFlow")).default;
const packsFixture = (await import("@/__fixtures__/packs.json")).default;

beforeEach(() => {
  sessionStorage.clear();
  apiMock.mockReset();
  getOnboardingMock.mockReset();
  saveOnboardingMock.mockReset();
  getOnboardingMock.mockResolvedValue({ dismissed: false, steps: {} });
  saveOnboardingMock.mockResolvedValue(undefined);
  listTokensMock.mockReset().mockResolvedValue([]);
  listConnectedAppsMock.mockReset().mockResolvedValue([]);
  apiMock.mockImplementation((path) => {
    if (path === "/all") {
      return Promise.resolve({ data: { profile: {}, preferences: {} } });
    }
    if (path === "/settings") {
      return Promise.resolve({ disabled_sections: [], packs: [] });
    }
    return Promise.resolve({});
  });
});

describe("OnboardingFlow", () => {
  it("opens on the choice of assistant, with nothing chosen", async () => {
    render(<OnboardingFlow step="assistant" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Which assistant do you use?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^something else/i })).toBeInTheDocument();
  });

  it("choosing an assistant remembers it and moves on", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<OnboardingFlow step="assistant" onNavigate={onNavigate} onLeave={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: /^cursor/i }));
    expect(onNavigate).toHaveBeenCalledWith("connect");
    expect(sessionStorage.getItem("mygist_onboarding_client")).toBe("cursor");
  });

  it("a step that needs an assistant shows the choice when none is chosen", async () => {
    render(<OnboardingFlow step="handover" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Which assistant do you use?" })).toBeInTheDocument();
  });

  it("keeps the chosen assistant across a reload", async () => {
    sessionStorage.setItem("mygist_onboarding_client", "codex");
    render(<OnboardingFlow step="connect" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    await screen.findByText(/step 1 of 3/i);
    expect(screen.queryByRole("heading", { name: "Which assistant do you use?" })).not.toBeInTheDocument();
  });

  it("corrects an unknown step to the first rather than rendering blank", async () => {
    render(<OnboardingFlow step="nonsense" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Which assistant do you use?" })).toBeInTheDocument();
  });

  it("Skip for now leaves, and I'll type it myself goes to About you", async () => {
    const onLeave = vi.fn();
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<OnboardingFlow step="assistant" onNavigate={onNavigate} onLeave={onLeave} />);
    await user.click(await screen.findByRole("button", { name: "I'll type it myself" }));
    expect(onNavigate).toHaveBeenCalledWith("about-you");
    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onLeave).toHaveBeenCalled();
  });

  it("says which step of three, to screen readers, beside a bar", async () => {
    render(<OnboardingFlow step="about-you" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    const label = await screen.findByText(/step 2 of 3/i);
    expect(label.className).toContain("sr-only");
  });

  it("puts How you like answers on the About you page", async () => {
    apiMock.mockImplementation((path) => {
      if (path === "/all") return Promise.resolve({ data: { profile: {}, preferences: {} } });
      if (path === "/settings") return Promise.resolve({ disabled_sections: [], packs: packsFixture });
      return Promise.resolve({});
    });
    render(<OnboardingFlow step="about-you" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: /about you/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /how you like answers/i, level: 2 })).toBeInTheDocument();
  });

  it("saves what was typed before moving on, and stores no step status", async () => {
    apiMock.mockImplementation((path) => {
      if (path === "/all") return Promise.resolve({ data: { profile: {}, preferences: {} } });
      if (path === "/settings") return Promise.resolve({ disabled_sections: [], packs: packsFixture });
      return Promise.resolve({});
    });
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<OnboardingFlow step="about-you" onNavigate={onNavigate} onLeave={vi.fn()} />);
    await user.type(await screen.findByLabelText("Name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(apiMock).toHaveBeenCalledWith("/files/profile", {
      method: "PUT",
      body: JSON.stringify({ data: { name: "Ada" } }),
    });
    expect(onNavigate).toHaveBeenCalledWith("complete");
    // The card works "basics done" out from the fields now.
    expect(saveOnboardingMock).not.toHaveBeenCalled();
  });

  it("Back from About you goes to the choice when no assistant was chosen", async () => {
    const onNavigate = vi.fn();
    render(<OnboardingFlow step="about-you" onNavigate={onNavigate} onLeave={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Back" }));
    expect(onNavigate).toHaveBeenCalledWith("assistant");
  });

  it("leaves only once the last save has landed, so the editor reloads what was typed", async () => {
    let land;
    apiMock.mockImplementation((path, opts) => {
      if (path === "/all") return Promise.resolve({ data: { profile: {}, preferences: {} } });
      if (path === "/settings") return Promise.resolve({ disabled_sections: [], packs: packsFixture });
      if (opts?.method === "PUT") return new Promise((resolve) => { land = resolve; });
      return Promise.resolve({});
    });
    const onLeave = vi.fn();
    const user = userEvent.setup();
    render(<OnboardingFlow step="about-you" onNavigate={vi.fn()} onLeave={onLeave} />);
    await user.type(await screen.findByLabelText("Name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Finish later" }));
    expect(onLeave).not.toHaveBeenCalled();
    land({});
    await waitFor(() => expect(onLeave).toHaveBeenCalled());
  });

  it("renders no app shell at all", async () => {
    render(<OnboardingFlow step="assistant" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    await screen.findByRole("heading", { name: "Which assistant do you use?" });
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });
});
