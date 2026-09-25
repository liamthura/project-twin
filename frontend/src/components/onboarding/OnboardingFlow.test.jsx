import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
  };
});
vi.mock("@/lib/onboarding.js", () => ({
  getOnboarding: getOnboardingMock,
  saveOnboarding: saveOnboardingMock,
  EMPTY_ONBOARDING: { dismissed: false, steps: {} },
}));

const OnboardingFlow = (await import("./OnboardingFlow")).default;
const packsFixture = (await import("@/__fixtures__/packs.json")).default;

beforeEach(() => {
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
  it("opens on Connect, which carries the welcome", async () => {
    // Welcome was a page of its own before Connect; wave 4 folded it in.
    render(<OnboardingFlow step="connect" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    expect(
      await screen.findByRole("heading", { name: /welcome to mygist/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skip for now/i })).toBeInTheDocument();
  });

  it("Skip for now leaves, and does not pretend a step was done", async () => {
    const onLeave = vi.fn();
    const user = userEvent.setup();
    render(<OnboardingFlow step="connect" onNavigate={vi.fn()} onLeave={onLeave} />);

    await user.click(await screen.findByRole("button", { name: /skip for now/i }));
    expect(onLeave).toHaveBeenCalled();
    expect(saveOnboardingMock).not.toHaveBeenCalled();
  });

  it("corrects an unknown step to the first rather than rendering blank", async () => {
    render(<OnboardingFlow step="nonsense" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    expect(
      await screen.findByRole("heading", { name: /welcome to mygist/i }),
    ).toBeInTheDocument();
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

  it("gives Connect a way out but not a Back or a second Continue", async () => {
    // First step, so nothing to go back to. It ends in its own two-way choice;
    // a Continue beside "I'll fill it in myself" would be two buttons for one
    // decision.
    render(<OnboardingFlow step="connect" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    await screen.findByRole("heading", { name: /welcome to mygist/i });

    expect(screen.queryByRole("button", { name: /^back$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^continue$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /skip this step/i })).not.toBeInTheDocument();
  });

  it("delegating records both field steps as skipped and jumps to the end", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    listTokensMock.mockResolvedValue([
      { id: "t1", label: "Claude", last_used_at: null, scopes: ["persona:propose"] },
    ]);
    render(<OnboardingFlow step="connect" onNavigate={onNavigate} onLeave={vi.fn()} />);

    await user.click(
      await screen.findByRole("button", { name: /my assistant will fill it in/i }),
    );

    // Skipped, not merely unvisited: handing the work over is a decision, and
    // the two are indistinguishable from the field values alone.
    expect(saveOnboardingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        steps: { "about-you": "skipped", "how-you-like": "skipped" },
      }),
      [],
    );
    expect(onNavigate).toHaveBeenCalledWith("complete");
  });

  it("never sends the server a step it would reject", async () => {
    // settings_store rejects any key outside about-you / how-you-like with a
    // 400, and saveOnboarding's failure is swallowed -- so an unguarded write
    // here would fail silently rather than loudly.
    const user = userEvent.setup();
    render(<OnboardingFlow step="connect" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    await screen.findByRole("heading", { name: /welcome to mygist/i });

    await user.click(screen.getByRole("button", { name: /fill it in myself/i }));
    for (const [state] of saveOnboardingMock.mock.calls) {
      expect(Object.keys(state.steps)).not.toContain("connect");
    }
  });

  it("records a skipped step as skipped, not as done", async () => {
    const user = userEvent.setup();
    render(<OnboardingFlow step="about-you" onNavigate={vi.fn()} onLeave={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /skip this step/i }));
    // Both halves of the page, each under its own stored key.
    expect(saveOnboardingMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ steps: { "about-you": "skipped", "how-you-like": "skipped" } }),
      [],
    );
  });

  it("renders no app shell at all", async () => {
    render(<OnboardingFlow step="connect" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    await screen.findByRole("heading", { name: /welcome to mygist/i });
    // The whole point of the standalone flow. The rail and the header are the
    // two things that must not be here.
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });
});
