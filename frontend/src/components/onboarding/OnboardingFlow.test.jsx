import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const apiMock = vi.hoisted(() => vi.fn());
const getOnboardingMock = vi.hoisted(() => vi.fn());
const saveOnboardingMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: apiMock };
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

  it("Get started asks the parent for the next step", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<OnboardingFlow step="welcome" onNavigate={onNavigate} onLeave={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /get started/i }));
    expect(onNavigate).toHaveBeenCalledWith("about-you");
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
    render(<OnboardingFlow step="about-you" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    expect(await screen.findByText(/step 1 of 3/i)).toBeInTheDocument();
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
