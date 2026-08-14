/**
 * The screen a reset link lands on.
 *
 * The property worth guarding here is what does NOT happen: a successful reset
 * must not sign anyone in. The service revokes every session as the password
 * changes -- that is the point of resetting one you think somebody else knows —
 * and quietly signing this browser back in would re-open exactly what was just
 * closed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/session.js", () => ({
  resetPassword: vi.fn(),
  signIn: vi.fn(),
}));

import { resetPassword, signIn } from "@/lib/session.js";
import { ResetPassword } from "@/components/ResetPassword";

const open = (onDone = () => {}) =>
  render(<ResetPassword token="tok-123" onDone={onDone} />);

const fill = async (user, password, confirm = password) => {
  await user.type(screen.getByLabelText(/new password/i), password);
  await user.type(screen.getByLabelText(/confirm password/i), confirm);
  await user.click(screen.getByRole("button", { name: /set new password/i }));
};

beforeEach(() => vi.clearAllMocks());

describe("setting a new password", () => {
  it("sends the token from the link", async () => {
    resetPassword.mockResolvedValue({ status: true });
    const user = userEvent.setup();
    open();

    await fill(user, "a-good-password");

    expect(resetPassword).toHaveBeenCalledWith("a-good-password", "tok-123");
  });

  it("does not sign in on success", async () => {
    resetPassword.mockResolvedValue({ status: true });
    const user = userEvent.setup();
    open();

    await fill(user, "a-good-password");

    await screen.findByText(/password changed/i);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("says the other sessions are gone, because they are", async () => {
    resetPassword.mockResolvedValue({ status: true });
    const user = userEvent.setup();
    open();

    await fill(user, "a-good-password");

    expect(await screen.findByText(/signed out/i)).toBeInTheDocument();
  });
});

describe("before anything is sent", () => {
  it("rejects a password shorter than the server's minimum", async () => {
    const user = userEvent.setup();
    open();

    await fill(user, "short");

    expect(resetPassword).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it("rejects a mismatched confirmation", async () => {
    const user = userEvent.setup();
    open();

    await fill(user, "a-good-password", "a-different-password");

    expect(resetPassword).not.toHaveBeenCalled();
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
  });
});

describe("when the token is no good", () => {
  it("shows the reason instead of a blank success", async () => {
    // Expired and already-used both arrive as an invalid token, and both mean
    // the same thing to whoever is holding the link: ask for another.
    resetPassword.mockRejectedValue(new Error("invalid token"));
    const user = userEvent.setup();
    open();

    await fill(user, "a-good-password");

    expect(await screen.findByText(/invalid token/i)).toBeInTheDocument();
    expect(screen.queryByText(/password changed/i)).toBeNull();
  });

  it("leaves the form usable", async () => {
    resetPassword.mockRejectedValue(new Error("invalid token"));
    const user = userEvent.setup();
    open();

    await fill(user, "a-good-password");

    await screen.findByText(/invalid token/i);
    expect(screen.getByRole("button", { name: /set new password/i })).toBeEnabled();
  });
});

describe("leaving the screen", () => {
  it("hands back after a successful reset", async () => {
    resetPassword.mockResolvedValue({ status: true });
    const onDone = vi.fn();
    const user = userEvent.setup();
    open(onDone);

    await fill(user, "a-good-password");
    await user.click(await screen.findByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("hands back from the form, for someone who opened the link by mistake", async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    open(onDone);

    await user.click(screen.getByRole("button", { name: /back to sign in/i }));

    expect(onDone).toHaveBeenCalled();
  });
});

describe("the fields say what is wrong before the button is pressed", () => {
  it("is silent until a field is left", () => {
    open();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("holds the new password to the minimum on blur", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/new password/i), "short");
    await user.tab();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Password must be at least 8 characters.",
    );
  });

  it("shows the mismatch under Confirm, not above the button", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/new password/i), "a-good-password");
    await user.type(screen.getByLabelText(/confirm password/i), "a-good-passwerd");
    await user.tab();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Passwords do not match.");
    // Under Confirm specifically -- the field the correction goes into.
    expect(screen.getByLabelText(/confirm password/i)).toHaveAttribute(
      "aria-describedby",
      alert.id,
    );
  });

  it("stops saying they differ once they do not", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/new password/i), "a-good-password");
    await user.type(screen.getByLabelText(/confirm password/i), "a-good-passwerd");
    await user.tab();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/confirm password/i));
    await user.type(screen.getByLabelText(/confirm password/i), "a-good-password");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not submit a form it has already found fault with", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/new password/i), "short");
    await user.type(screen.getByLabelText(/confirm password/i), "short");
    await user.click(screen.getByRole("button", { name: /set new password/i }));

    expect(resetPassword).not.toHaveBeenCalled();
  });
});
