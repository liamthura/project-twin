import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getOnboardingMock = vi.hoisted(() => vi.fn());
const saveOnboardingMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const showHintMock = vi.hoisted(() => vi.fn(async () => true));
const watch = vi.hoisted(() => ({ report: null }));

vi.mock("@/lib/onboarding.js", () => ({
  getOnboarding: getOnboardingMock,
  saveOnboarding: saveOnboardingMock,
}));
vi.mock("@/lib/session.js", () => ({
  getSession: getSessionMock,
  isPlaceholderEmail: (email) => !email || email.endsWith("@placeholder.invalid"),
}));
vi.mock("@/lib/guide.js", () => ({ showHint: showHintMock }));
vi.mock("@/lib/watchtower.js", async (importOriginal) => ({
  ...(await importOriginal()),
  useWatchtower: (opts) => {
    watch.calls.push(opts);
    return watch.report;
  },
}));

const { GettingStartedCard } = await import("./GettingStartedCard");

const report = (connection, { suggested = false, pending = 0 } = {}) => ({
  connection: { name: null, can_propose: true, ...connection },
  assistant: { suggested },
  pending: { total: pending },
});

beforeEach(() => {
  localStorage.clear();
  getOnboardingMock.mockReset().mockResolvedValue({ dismissed: false, steps: {}, seen: [] });
  saveOnboardingMock.mockReset().mockResolvedValue(undefined);
  getSessionMock.mockReset().mockResolvedValue({ user: { email: "ada@example.com" } });
  showHintMock.mockClear();
  watch.report = report({ state: "none" });
  watch.calls = [];
});

// The report is 30k on a busy account, and only the card shows it.
describe("GettingStartedCard and the connection report", () => {
  it("asks for it only while the card is on screen", async () => {
    getOnboardingMock.mockResolvedValue({ dismissed: true, steps: {}, seen: [] });
    render(<GettingStartedCard disabledSections={[]} />);
    await waitFor(() => expect(getOnboardingMock).toHaveBeenCalled());
    await waitFor(() => expect(watch.calls.at(-1)).toEqual({ enabled: false }));
    expect(watch.calls.some((o) => o?.enabled)).toBe(false);
  });

  it("asks while it is showing", async () => {
    render(<GettingStartedCard disabledSections={[]} />);
    await waitFor(() => expect(watch.calls.at(-1)).toEqual({ enabled: true }));
  });
});

const renderCard = (props = {}) =>
  render(
    <GettingStartedCard
      profile={{}}
      disabledSections={[]}
      onStart={vi.fn()}
      onReview={vi.fn()}
      onAddEmail={vi.fn()}
      onOpenSettings={vi.fn()}
      {...props}
    />,
  );

describe("GettingStartedCard", () => {
  it("ticks only what really happened", async () => {
    // A token that has never been used is waiting, not connected.
    watch.report = report({ state: "waiting", name: "my assistant" });
    renderCard({ profile: { name: "Ada" } });
    expect(await screen.findByText("1 of 3 done")).toBeInTheDocument();
    expect(screen.getByText("Waiting for my assistant…")).toBeInTheDocument();
  });

  it("marks one step as next, the first one not done", async () => {
    watch.report = report({ state: "connected", name: "Cursor" });
    renderCard();
    const next = await screen.findByRole("listitem", { current: "step" });
    expect(next).toHaveTextContent("Fill in the basics");
    expect(screen.getAllByRole("listitem").filter((li) => li.getAttribute("aria-current"))).toHaveLength(1);
  });

  it("keeps a way back to the steps while a connection is waiting", async () => {
    const onStart = vi.fn();
    watch.report = report({ state: "waiting", name: "my assistant" });
    renderCard({ onStart });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Connect" }));
    expect(onStart).toHaveBeenCalledWith("assistant");
  });

  it("sends each step to its own screen", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    renderCard({ onStart });
    await user.click(await screen.findByRole("button", { name: "Connect" }));
    await user.click(screen.getByRole("button", { name: "Fill in" }));
    expect(onStart.mock.calls).toEqual([["assistant"], ["about-you"]]);
  });

  it("says when the connection can only read, and offers to change its access", async () => {
    const onOpenSettings = vi.fn();
    watch.report = report({ state: "connected", name: "Cursor", can_propose: false });
    renderCard({ profile: { name: "Ada" }, onOpenSettings });
    expect(await screen.findByText("Cursor can only read your persona, so it can't suggest anything.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Change access" }));
    expect(onOpenSettings).toHaveBeenCalledWith("connections");
  });

  it("ends with you're set up, and a way to what is waiting", async () => {
    const onReview = vi.fn();
    watch.report = report({ state: "connected", name: "Cursor" }, { suggested: true, pending: 2 });
    renderCard({ profile: { name: "Ada" }, onReview });
    expect(await screen.findByText("You're set up")).toBeInTheDocument();
    expect(screen.getByText("Cursor reads your persona, and what it suggests waits in Review.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Review 2" }));
    expect(onReview).toHaveBeenCalled();
  });

  it("offers the prompt once connected, and says where to paste it", async () => {
    watch.report = report({ state: "connected", name: "Cursor" });
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Copy prompt" }));
    expect(showHintMock).toHaveBeenCalledWith(
      "hint:paste-prompt",
      expect.objectContaining({ title: "Paste it into Cursor" }),
    );
  });

  it("does not say copied when the browser refuses the copy", async () => {
    watch.report = report({ state: "connected", name: "Cursor" });
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Copy prompt" }));
    expect(screen.getByRole("button", { name: "Copy prompt" })).toBeInTheDocument();
    expect(showHintMock).not.toHaveBeenCalled();
  });

  it("carries the email nudge as one quiet line", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "x@placeholder.invalid" } });
    const onAddEmail = vi.fn();
    renderCard({ onAddEmail });
    expect(await screen.findByText("No recovery email yet.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Add one" }));
    expect(onAddEmail).toHaveBeenCalled();
  });

  it("leaves the nudge out once the banner was dismissed", async () => {
    localStorage.setItem("mygist_add_email_dismissed", "1");
    getSessionMock.mockResolvedValue({ user: { email: "x@placeholder.invalid" } });
    renderCard();
    await screen.findByText("0 of 3 done");
    expect(screen.queryByText("No recovery email yet.")).not.toBeInTheDocument();
  });

  it("tells the page whether it is showing, and hides when dismissed", async () => {
    const onShownChange = vi.fn();
    renderCard({ onShownChange });
    await waitFor(() => expect(onShownChange).toHaveBeenLastCalledWith(true));
    await userEvent.setup().click(screen.getByRole("button", { name: "Hide getting started" }));
    expect(onShownChange).toHaveBeenLastCalledWith(false);
    expect(saveOnboardingMock).toHaveBeenCalledWith(expect.objectContaining({ dismissed: true }), []);
  });

  it("stays hidden when its own state cannot be read", async () => {
    getOnboardingMock.mockRejectedValue(new Error("offline"));
    const { container } = renderCard();
    await waitFor(() => expect(getOnboardingMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
