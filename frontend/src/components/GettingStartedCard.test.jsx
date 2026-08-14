import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const listTokensMock = vi.hoisted(() => vi.fn());
const listConnectedAppsMock = vi.hoisted(() => vi.fn());
const getOnboardingMock = vi.hoisted(() => vi.fn());
const saveOnboardingMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listTokens: listTokensMock,
    listConnectedApps: listConnectedAppsMock,
  };
});
vi.mock("@/lib/onboarding.js", () => ({
  getOnboarding: getOnboardingMock,
  saveOnboarding: saveOnboardingMock,
  EMPTY_ONBOARDING: { dismissed: false, steps: {} },
}));

const { GettingStartedCard } = await import("./GettingStartedCard");

beforeEach(() => {
  listTokensMock.mockReset().mockResolvedValue([]);
  listConnectedAppsMock.mockReset().mockResolvedValue([]);
  getOnboardingMock.mockReset().mockResolvedValue({ dismissed: false, steps: {} });
  saveOnboardingMock.mockReset().mockResolvedValue(undefined);
});

const renderCard = (props = {}) =>
  render(
    <GettingStartedCard
      disabledSections={[]}
      onStart={vi.fn()}
      onOpenSettings={vi.fn()}
      {...props}
    />,
  );

describe("GettingStartedCard", () => {
  it("shows three steps and how many are done", async () => {
    renderCard();
    expect(await screen.findByText(/getting started/i)).toBeInTheDocument();
    expect(screen.getByText(/0 of 3/)).toBeInTheDocument();
  });

  it("waits on a token that has never been called", async () => {
    listTokensMock.mockResolvedValue([
      { id: "t1", label: "Claude Desktop", last_used_at: null, scopes: ["persona:propose"] },
    ]);
    renderCard();
    expect(await screen.findByText(/waiting for first call/i)).toBeInTheDocument();
  });

  it("names the client once a token has actually been used", async () => {
    listTokensMock.mockResolvedValue([
      {
        id: "t1",
        label: "Claude Desktop",
        last_used_at: "2026-08-12T09:00:00Z",
        scopes: ["persona:propose"],
      },
    ]);
    renderCard();
    expect(await screen.findByText(/connected · Claude Desktop/i)).toBeInTheDocument();
    expect(screen.queryByText(/waiting for first call/i)).not.toBeInTheDocument();
  });

  it("never claims a grant made a call", async () => {
    listConnectedAppsMock.mockResolvedValue([
      { id: "g1", clientId: "c1", clientName: "Claude", scopes: ["persona:propose"] },
    ]);
    renderCard();
    expect(await screen.findByText(/connected · Claude/i)).toBeInTheDocument();
    expect(screen.queryByText(/waiting for first call/i)).not.toBeInTheDocument();
  });

  it("offers no copy button when the connection cannot propose, and says why", async () => {
    // mcp_scopes.py HIDES out-of-scope tools rather than failing them, so the
    // pasted prompt would do nothing at all, with no error anywhere. Silence is
    // the failure this branch exists to prevent.
    listTokensMock.mockResolvedValue([
      { id: "t1", label: "Read only", last_used_at: null, scopes: ["persona:read"] },
    ]);
    renderCard();
    await screen.findByText(/waiting for first call/i);
    expect(screen.queryByRole("button", { name: /copy prompt/i })).not.toBeInTheDocument();
    expect(screen.getByText(/can only read/i)).toBeInTheDocument();
  });

  it("offers the prompt when the connection can propose", async () => {
    listTokensMock.mockResolvedValue([
      { id: "t1", label: "Claude", last_used_at: null, scopes: ["persona:propose"] },
    ]);
    renderCard();
    expect(await screen.findByRole("button", { name: /copy prompt/i })).toBeInTheDocument();
  });

  it("Start routes rather than collecting", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    renderCard({ onStart });
    await user.click(await screen.findByRole("button", { name: /^start$/i }));
    expect(onStart).toHaveBeenCalled();
  });

  it("dismissing hides the card and records it", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: /dismiss getting started/i }));

    await waitFor(() =>
      expect(saveOnboardingMock).toHaveBeenCalledWith(
        expect.objectContaining({ dismissed: true }),
        [],
      ),
    );
    expect(screen.queryByText(/getting started/i)).not.toBeInTheDocument();
  });

  it("renders nothing at all when it was already dismissed", async () => {
    getOnboardingMock.mockResolvedValue({ dismissed: true, steps: {} });
    const { container } = renderCard();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("stays usable when the token list is forbidden", async () => {
    // listTokens throws for a read-scoped credential -- an OAuth grant, or a
    // token minted without write. That is not a broken page.
    listTokensMock.mockRejectedValue(new Error("read access only"));
    listConnectedAppsMock.mockResolvedValue([
      { id: "g1", clientId: "c1", clientName: "Claude", scopes: ["persona:read"] },
    ]);
    renderCard();
    expect(await screen.findByText(/connected · Claude/i)).toBeInTheDocument();
  });
});
