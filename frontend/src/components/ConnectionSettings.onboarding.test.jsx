import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getOnboardingMock = vi.hoisted(() => vi.fn());
const saveOnboardingMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/onboarding.js", () => ({
  getOnboarding: getOnboardingMock,
  saveOnboarding: saveOnboardingMock,
  EMPTY_ONBOARDING: { dismissed: false, steps: {} },
}));

const { ConnectionSettings } = await import("./ConnectionSettings");

beforeEach(() => {
  getOnboardingMock.mockReset().mockResolvedValue({ dismissed: true, steps: {} });
  saveOnboardingMock.mockReset().mockResolvedValue(undefined);
});

describe("ConnectionSettings, getting-started restore", () => {
  it("offers to bring the card back once it has been dismissed", async () => {
    render(
      <ConnectionSettings
        isOpen
        onClose={vi.fn()}
        onConnectionChange={vi.fn()}
        disabledSections={["circle"]}
      />,
    );
    expect(
      await screen.findByRole("button", { name: /show getting started/i }),
    ).toBeInTheDocument();
  });

  it("offers nothing while the card is still showing", async () => {
    getOnboardingMock.mockResolvedValue({ dismissed: false, steps: {} });
    render(<ConnectionSettings isOpen onClose={vi.fn()} onConnectionChange={vi.fn()} />);
    await waitFor(() => expect(getOnboardingMock).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: /show getting started/i }),
    ).not.toBeInTheDocument();
  });

  it("restores it, keeping the sections the reader had disabled", async () => {
    const user = userEvent.setup();
    render(
      <ConnectionSettings
        isOpen
        onClose={vi.fn()}
        onConnectionChange={vi.fn()}
        disabledSections={["circle"]}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /show getting started/i }));
    await waitFor(() =>
      expect(saveOnboardingMock).toHaveBeenCalledWith(
        expect.objectContaining({ dismissed: false }),
        ["circle"],
      ),
    );
    // The offer goes as soon as it is taken -- there is nothing to say to
    // someone whose card is back on screen.
    expect(
      screen.queryByRole("button", { name: /show getting started/i }),
    ).not.toBeInTheDocument();
  });
});
