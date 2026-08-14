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
  it("shows Welcome, with the delegate offer above the buttons", async () => {
    render(<OnboardingFlow step="welcome" onNavigate={vi.fn()} onLeave={vi.fn()} />);

    expect(
      await screen.findByRole("heading", { name: /welcome to mygist/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/don't have to type any of it/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /get started/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skip for now/i })).toBeInTheDocument();
  });

  it("Get started goes to Connect, so the offer Welcome makes is honoured next", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<OnboardingFlow step="welcome" onNavigate={onNavigate} onLeave={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /get started/i }));
    expect(onNavigate).toHaveBeenCalledWith("connect");
  });

  it("draws the diagram on Welcome, and hides it from screen readers", async () => {
    render(<OnboardingFlow step="welcome" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    await screen.findByRole("heading", { name: /welcome to mygist/i });

    // Everything it says is said in the prose beside it, so announcing it adds
    // nothing a listener can act on.
    const svg = document.querySelector("svg[aria-hidden='true']");
    expect(svg).toBeInTheDocument();
    // The motion is CSS, which is what makes globals.css's reduced-motion block
    // cover it. A JS loop would keep running for someone who asked it not to.
    expect(svg.querySelectorAll(".animate-dash-flow").length).toBeGreaterThan(0);
  });

  it("Skip for now leaves, and does not pretend a step was done", async () => {
    const onLeave = vi.fn();
    const user = userEvent.setup();
    render(<OnboardingFlow step="welcome" onNavigate={vi.fn()} onLeave={onLeave} />);

    await user.click(await screen.findByRole("button", { name: /skip for now/i }));
    expect(onLeave).toHaveBeenCalled();
    expect(saveOnboardingMock).not.toHaveBeenCalled();
  });

  it("corrects an unknown step to welcome rather than rendering blank", async () => {
    render(<OnboardingFlow step="nonsense" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    expect(
      await screen.findByRole("heading", { name: /welcome to mygist/i }),
    ).toBeInTheDocument();
  });

  it("shows which step of how many, and Welcome is not counted as work", async () => {
    render(<OnboardingFlow step="connect" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    expect(await screen.findByText(/step 1 of 4/i)).toBeInTheDocument();
  });

  it("gives Connect a way back but not a second Continue", async () => {
    // The step ends in its own two-way choice; a Continue beside "I'll fill it
    // in myself" would be two buttons for one decision.
    render(<OnboardingFlow step="connect" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    await screen.findByRole("heading", { name: /connect an assistant/i });

    expect(screen.getByRole("button", { name: /^back$/i })).toBeInTheDocument();
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
    await screen.findByRole("heading", { name: /connect an assistant/i });

    await user.click(screen.getByRole("button", { name: /fill it in myself/i }));
    for (const [state] of saveOnboardingMock.mock.calls) {
      expect(Object.keys(state.steps)).not.toContain("connect");
    }
  });

  it("records a skipped step as skipped, not as done", async () => {
    const user = userEvent.setup();
    render(<OnboardingFlow step="about-you" onNavigate={vi.fn()} onLeave={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /skip this step/i }));
    expect(saveOnboardingMock).toHaveBeenCalledWith(
      expect.objectContaining({ steps: { "about-you": "skipped" } }),
      [],
    );
  });

  it("renders no app shell at all", async () => {
    render(<OnboardingFlow step="welcome" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    await screen.findByRole("heading", { name: /welcome to mygist/i });
    // The whole point of the standalone flow. The rail and the header are the
    // two things that must not be here.
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });
});
