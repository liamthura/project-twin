/**
 * The account email control.
 *
 * The case that matters most is the placeholder. Every account seeded from the
 * old store carries <username>@mygist.invalid, an address RFC 2606 guarantees
 * can never resolve. Showing it as though it were the user's would be a lie the
 * UI tells confidently, and offering to send verification to it would fail in a
 * way that looks like a mail problem rather than a design one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/session.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // isPlaceholderEmail is deliberately NOT mocked: it is the rule under test
    // in half of these, and a stubbed one would agree with whatever we assumed.
    getSession: vi.fn(),
    changeEmail: vi.fn(),
    sendVerificationEmail: vi.fn(),
  };
});

import { getSession, changeEmail, sendVerificationEmail } from "@/lib/session.js";
import { EmailSettings } from "@/components/EmailSettings";

const sessionWith = (email, emailVerified = false) => ({
  user: { id: "u-1", username: "liam", email, emailVerified },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("an account with a placeholder email", () => {
  beforeEach(() => {
    getSession.mockResolvedValue(sessionWith("liam@mygist.invalid"));
  });

  it("never shows the placeholder as the user's address", async () => {
    render(<EmailSettings />);

    expect(await screen.findByText(/no email added/i)).toBeInTheDocument();
    expect(screen.queryByText(/mygist\.invalid/i)).not.toBeInTheDocument();
  });

  it("offers to add one rather than to change one", async () => {
    render(<EmailSettings />);

    expect(await screen.findByRole("button", { name: /add email/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^change$/i })).not.toBeInTheDocument();
  });

  it("does not offer to verify an address that cannot receive mail", async () => {
    render(<EmailSettings />);

    await screen.findByText(/no email added/i);
    expect(
      screen.queryByRole("button", { name: /re-send verification/i }),
    ).not.toBeInTheDocument();
  });

  it("starts the form empty rather than prefilled with the placeholder", async () => {
    render(<EmailSettings />);

    await userEvent.click(await screen.findByRole("button", { name: /add email/i }));

    expect(screen.getByLabelText(/email address/i)).toHaveValue("");
  });

  it("saves a real address", async () => {
    changeEmail.mockResolvedValue({ status: true });
    render(<EmailSettings />);

    await userEvent.click(await screen.findByRole("button", { name: /add email/i }));
    await userEvent.type(screen.getByLabelText(/email address/i), "liam@example.com");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(changeEmail).toHaveBeenCalledWith("liam@example.com"));
  });

  it("shows the reason it matters", async () => {
    render(<EmailSettings />);
    expect(await screen.findByText(/cannot be reset/i)).toBeInTheDocument();
  });
});

describe("an account with a real but unverified email", () => {
  beforeEach(() => {
    getSession.mockResolvedValue(sessionWith("liam@example.com", false));
  });

  it("shows the address", async () => {
    render(<EmailSettings />);
    expect(await screen.findByText("liam@example.com")).toBeInTheDocument();
  });

  it("offers to re-send verification", async () => {
    sendVerificationEmail.mockResolvedValue({ status: true });
    render(<EmailSettings />);

    await userEvent.click(
      await screen.findByRole("button", { name: /re-send verification/i }),
    );

    await waitFor(() =>
      expect(sendVerificationEmail).toHaveBeenCalledWith("liam@example.com"),
    );
  });

  it("says it cannot reset a password yet", async () => {
    render(<EmailSettings />);
    expect(await screen.findByText(/not verified yet/i)).toBeInTheDocument();
  });
});

describe("an account with a verified email", () => {
  beforeEach(() => {
    getSession.mockResolvedValue(sessionWith("liam@example.com", true));
  });

  it("does not offer to re-send verification", async () => {
    render(<EmailSettings />);

    await screen.findByText("liam@example.com");
    expect(
      screen.queryByRole("button", { name: /re-send verification/i }),
    ).not.toBeInTheDocument();
  });

  it("offers to change it", async () => {
    render(<EmailSettings />);
    expect(await screen.findByRole("button", { name: /^change$/i })).toBeInTheDocument();
  });

  it("prefills the form with the address it already has", async () => {
    render(<EmailSettings />);

    await userEvent.click(await screen.findByRole("button", { name: /^change$/i }));

    expect(screen.getByLabelText(/email address/i)).toHaveValue("liam@example.com");
  });
});

describe("no Better Auth session", () => {
  it("renders nothing at all", async () => {
    // Detached mode: signed in with a bearer token against someone else's
    // server, where there is no session and no email to manage.
    getSession.mockResolvedValue(null);

    const { container } = render(<EmailSettings />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe("when saving fails", () => {
  it("shows why and keeps the form open", async () => {
    getSession.mockResolvedValue(sessionWith("liam@mygist.invalid"));
    changeEmail.mockRejectedValue(new Error("That email is already in use"));

    render(<EmailSettings />);
    await userEvent.click(await screen.findByRole("button", { name: /add email/i }));
    await userEvent.type(screen.getByLabelText(/email address/i), "taken@example.com");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/already in use/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });
});
