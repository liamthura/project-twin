import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const sendMock = vi.hoisted(() => vi.fn());
const shrinkMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback.js", async (importOriginal) => ({
  ...(await importOriginal()),
  sendFeedback: sendMock,
  shrinkImage: shrinkMock,
}));
vi.mock("@/lib/session.js", () => ({
  getSession: getSessionMock,
  isPlaceholderEmail: (email) => email.endsWith("@mygist.invalid"),
}));

const { FeedbackIsland } = await import("./FeedbackIsland");
const { Toaster } = await import("./ui/toaster");
const { toast } = await import("./ui/use-toast");
const { openFeedback } = await import("@/lib/feedback.js");

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({ id: 1 });
  shrinkMock.mockReset().mockResolvedValue(new Blob(["jpg"], { type: "image/jpeg" }));
  getSessionMock.mockReset().mockResolvedValue({ user: { email: "sam@example.com" } });
  URL.createObjectURL = vi.fn(() => "blob:shot");
  URL.revokeObjectURL = vi.fn();
});

const open = async (user) => {
  await user.click(screen.getByRole("button", { name: "Feedback" }));
  return screen.getByRole("textbox");
};

describe("FeedbackIsland", () => {
  it("opens, keeps a draft when closed, and clears it once sent (sent state)", async () => {
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    await user.type(await open(user), "It broke");
    await user.keyboard("{Escape}");
    expect(await open(user)).toHaveValue("It broke");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(sendMock).toHaveBeenCalledWith({ kind: "problem", message: "It broke", screenshot: undefined });
    expect(await screen.findByText("Thanks. Your feedback is in.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close feedback" }));
    expect(await open(user)).toHaveValue("");
  });

  it("follows the kind with its label and hint", async () => {
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    await open(user);
    expect(screen.getByLabelText("What happened?")).toHaveAttribute(
      "placeholder",
      "What you did, what you expected, and what happened instead.",
    );
    await user.click(screen.getByRole("button", { name: "Idea" }));
    expect(screen.getByLabelText("What's your idea?")).toHaveAttribute("placeholder", "What it would let you do.");
    await user.click(screen.getByRole("button", { name: "Something else" }));
    expect(screen.getByLabelText("What's on your mind?")).toBeInTheDocument();
  });

  it("attaches a picked image, and Remove takes it off", async () => {
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    await open(user);
    await user.upload(document.querySelector('input[type="file"]'), new File(["png"], "s.png", { type: "image/png" }));
    expect(await screen.findByAltText("Your screenshot")).toBeInTheDocument();
    expect(screen.getByText(/crop out anything you'd rather not send/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove screenshot" }));
    expect(screen.queryByAltText("Your screenshot")).not.toBeInTheDocument();
  });

  it("attaches a pasted image from clipboard items, and lets text paste as text (paste)", async () => {
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    const box = await open(user);
    const image = new File(["png"], "paste.png", { type: "image/png" });
    fireEvent.paste(box, { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => image }] } });
    expect(await screen.findByAltText("Your screenshot")).toBeInTheDocument();
    expect(shrinkMock).toHaveBeenCalledWith(image);
    shrinkMock.mockClear();
    fireEvent.paste(box, { clipboardData: { items: [{ kind: "string", type: "text/plain" }] } });
    expect(shrinkMock).not.toHaveBeenCalled();
  });

  it("says when an image cannot be read", async () => {
    shrinkMock.mockRejectedValue(new Error("unreadable"));
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    await open(user);
    await user.upload(document.querySelector('input[type="file"]'), new File(["x"], "s.heic", { type: "image/heic" }));
    expect(await screen.findByText("That image couldn't be read. Try a PNG or JPEG.")).toBeInTheDocument();
  });

  it("names where replies go, or links to Account when there is no address", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<FeedbackIsland />);
    await open(user);
    expect(await screen.findByText("Replies go to sam@example.com.")).toBeInTheDocument();
    unmount();

    getSessionMock.mockResolvedValue({ user: { email: "sam@mygist.invalid" } });
    const onAddEmail = vi.fn();
    render(<FeedbackIsland onAddEmail={onAddEmail} />);
    await open(user);
    expect(await screen.findByText(/nowhere to send a reply/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add one" }));
    expect(onAddEmail).toHaveBeenCalled();
  });

  it("keeps the message when sending fails, and says why", async () => {
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    await user.type(await open(user), "Twice");
    sendMock.mockRejectedValueOnce(Object.assign(new Error("API Error 429"), { status: 429 }));
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("That's 10 reports in the last hour. Try again later.")).toBeInTheDocument();
    sendMock.mockRejectedValueOnce(new Error("Cannot connect"));
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Couldn't send. Your message is still here, so try again.")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("Twice");
  });

  it("sends once however fast Send is pressed (sends once)", async () => {
    let finish;
    sendMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    await user.type(await open(user), "Once");
    const send = screen.getByRole("button", { name: "Send" });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    await act(async () => finish({ id: 1 }));
  });

  it("opens from a Report, as a Problem, and keeps a draft (keeps a draft)", async () => {
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    await user.type(await open(user), "My notes");
    await user.click(screen.getByRole("button", { name: "Idea" }));
    await user.keyboard("{Escape}");
    act(() => openFeedback({ kind: "problem", message: 'The app said: "Failed to save"' }));
    const box = await screen.findByRole("textbox");
    expect(box).toHaveValue('My notes\n\nThe app said: "Failed to save"\n\n');
    expect(screen.getByLabelText("What happened?")).toBeInTheDocument();
  });

  it("sends nothing while the message is empty", async () => {
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    await open(user);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("opens from an error toast's Report with focus in the box (toast)", async () => {
    // Sonner hands focus back to where it came from when it leaves a toast,
    // which used to close the panel the moment Report opened it.
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="Name" />
        <Toaster />
        <FeedbackIsland />
      </>,
    );
    await user.click(screen.getByLabelText("Name"));
    act(() => {
      toast({ variant: "destructive", title: "Failed to save", description: "Boom." });
    });
    await user.click(await screen.findByRole("button", { name: "Report this problem" }));
    const box = await screen.findByRole("textbox", { name: "What happened?" });
    await waitFor(() => expect(box).toHaveFocus());
    expect(box).toHaveValue('The app said: "Failed to save. Boom."\n\n');
  });
});
