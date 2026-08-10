/**
 * The invite code screen.
 *
 * The property worth guarding hardest is that this is a SCREEN, not the gate.
 * It fails fast and sets expectations; the service checks again at sign-up and
 * that is what protects anything. So the tests here are about what a person
 * experiences -- not about whether anyone gets in, which is settled in
 * auth/src/invite.test.js against a real database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/session.js", async (importOriginal) => {
  const actual = await importOriginal();
  // Normalisation and the alphabet stay real: they are the rules under test in
  // half of these, and stubbing them would only confirm the test's own guess.
  return { ...actual, checkInvite: vi.fn() };
});

import { checkInvite } from "@/lib/session.js";
import { InviteGate } from "@/components/InviteGate";

const open = (props = {}) =>
  render(
    <InviteGate
      initialCode=""
      onAccepted={props.onAccepted ?? (() => {})}
      onBack={props.onBack ?? (() => {})}
      {...props}
    />,
  );

// input-otp renders one hidden input covering every slot.
const codeField = () => screen.getByLabelText(/invite code/i);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("entering a code", () => {
  it("accepts a valid one and hands it on in stored form", async () => {
    checkInvite.mockResolvedValue(true);
    const onAccepted = vi.fn();
    const user = userEvent.setup();
    open({ onAccepted });

    await user.type(codeField(), "7F2KQX91");

    // Typed without a dash; passed on with one, which is how it is stored.
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith("7F2K-QX91"));
  });

  it("accepts it however it was typed", async () => {
    checkInvite.mockResolvedValue(true);
    const onAccepted = vi.fn();
    const user = userEvent.setup();
    open({ onAccepted });

    await user.type(codeField(), "7f2kqx91");

    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith("7F2K-QX91"));
  });

  it("uppercases as you go, not just on the way out", async () => {
    // The alphabet is uppercase, so a code typed in lowercase has to LOOK
    // accepted while it is being typed. Sibling test above covers the value
    // handed on; this covers the eight slots someone is actually watching.
    const user = userEvent.setup();
    open();

    // Seven, so this lands before the auto-submit on the eighth.
    await user.type(codeField(), "7f2kqx9");

    expect(codeField()).toHaveValue("7F2KQX9");
  });

  it("refuses characters that can never appear in a code", async () => {
    // I, L, O and U are excluded because they are misread for 1, 1, 0 and each
    // other. Filtering the keystroke is kinder than accepting it and having the
    // server reject a code that never existed.
    const user = userEvent.setup();
    open();

    await user.type(codeField(), "IIIILLLL");

    expect(codeField()).toHaveValue("");
    expect(checkInvite).not.toHaveBeenCalled();
  });

  it("asks for a keyboard that has letters on it", async () => {
    // input-otp defaults inputMode to "numeric", which on a phone raises the
    // number pad -- and two thirds of the invite alphabet is letters, so the
    // code simply cannot be typed. Nothing about this is visible on a desktop.
    open();

    expect(codeField()).toHaveAttribute("inputmode", "text");
  });

  it("submits on its own once the last slot is filled", async () => {
    checkInvite.mockResolvedValue(true);
    const user = userEvent.setup();
    open();

    await user.type(codeField(), "7F2KQX91");

    // No button press: waiting for one after the final character is friction
    // with no purpose.
    await waitFor(() => expect(checkInvite).toHaveBeenCalled());
  });
});

describe("a code that is not accepted", () => {
  it("says so without saying why", async () => {
    // Unknown, expired, spent and revoked all read the same. Naming which would
    // tell a guesser where to keep looking.
    checkInvite.mockResolvedValue(false);
    const user = userEvent.setup();
    open();

    await user.type(codeField(), "0000-0000");

    expect(await screen.findByText(/isn't valid/i)).toBeInTheDocument();
    expect(screen.queryByText(/expired|already used|revoked|unknown/i)).toBeNull();
  });

  it("does not let anyone through", async () => {
    checkInvite.mockResolvedValue(false);
    const onAccepted = vi.fn();
    const user = userEvent.setup();
    open({ onAccepted });

    await user.type(codeField(), "0000-0000");

    await screen.findByText(/isn't valid/i);
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("clears the error as soon as the code is edited", async () => {
    // A rejected code leaves all eight slots filled, so correcting it starts
    // with a deletion -- typing into a full field changes nothing. The error
    // must not outlive the value it was about.
    checkInvite.mockResolvedValue(false);
    const user = userEvent.setup();
    open();

    await user.type(codeField(), "0000-0000");
    await screen.findByText(/isn't valid/i);

    await user.type(codeField(), "{backspace}");

    expect(screen.queryByText(/isn't valid/i)).toBeNull();
    expect(codeField()).toHaveValue("0000000");
  });

  it("reports a network failure rather than calling it invalid", async () => {
    checkInvite.mockRejectedValue(new Error("Could not check that code"));
    const user = userEvent.setup();
    open();

    await user.type(codeField(), "7F2KQX91");

    expect(await screen.findByText(/could not check/i)).toBeInTheDocument();
  });
});

describe("an incomplete code", () => {
  it("is not sent to the server", async () => {
    // Guards the rate-limit budget: a half-typed code is knowably wrong here.
    const user = userEvent.setup();
    open();

    await user.type(codeField(), "7F2K");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(checkInvite).not.toHaveBeenCalled();
    expect(screen.getByText(/8 characters/i)).toBeInTheDocument();
  });
});

describe("arriving from an invite link", () => {
  it("checks the code without making anyone look at this screen", async () => {
    checkInvite.mockResolvedValue(true);
    const onAccepted = vi.fn();

    open({ initialCode: "7F2K-QX91", onAccepted });

    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith("7F2K-QX91"));
    expect(checkInvite).toHaveBeenCalledTimes(1);
  });

  it("shows the form, with the code filled in, when the link is stale", async () => {
    // Landing on a blank screen with no explanation would be the worst outcome
    // for someone whose invite has since been revoked.
    checkInvite.mockResolvedValue(false);

    open({ initialCode: "7F2K-QX91" });

    expect(await screen.findByText(/isn't valid/i)).toBeInTheDocument();
    expect(codeField()).toHaveValue("7F2KQX91");
  });

  it("does not auto-submit a truncated link", async () => {
    open({ initialCode: "7F2K" });

    await waitFor(() => expect(checkInvite).not.toHaveBeenCalled());
    expect(codeField()).toHaveValue("7F2K");
  });
});

describe("someone who already has an account", () => {
  it("can get to sign-in without a code", async () => {
    // Sign-in is never gated. Only account creation passes through here.
    const onBack = vi.fn();
    const user = userEvent.setup();
    open({ onBack });

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(onBack).toHaveBeenCalled();
  });
});
