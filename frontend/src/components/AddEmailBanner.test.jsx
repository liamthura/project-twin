/**
 * The prompt to add an email.
 *
 * Two things it must not do: appear for someone who already has a real address,
 * and keep appearing after being dismissed. The first would be nagging about a
 * solved problem; the second turns a prompt into a wall, which is not what a
 * dismiss button promises.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/session.js", async (importOriginal) => {
  const actual = await importOriginal();
  // isPlaceholderEmail stays real: it is the rule that decides whether this
  // renders at all, and a stubbed one would just agree with the test.
  return { ...actual, getSession: vi.fn() };
});

import { getSession } from "@/lib/session.js";
import { AddEmailBanner } from "@/components/AddEmailBanner";

const sessionWith = (email) => ({ user: { id: "u-1", email, emailVerified: false } });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("an account with no real email", () => {
  beforeEach(() => getSession.mockResolvedValue(sessionWith("liam@mygist.invalid")));

  it("is prompted", async () => {
    render(<AddEmailBanner onAddEmail={() => {}} />);
    expect(await screen.findByText(/add an email/i)).toBeInTheDocument();
  });

  it("says why it matters rather than just asking", async () => {
    render(<AddEmailBanner onAddEmail={() => {}} />);
    expect(await screen.findByText(/reset your password/i)).toBeInTheDocument();
  });

  it("opens the settings where the email is actually added", async () => {
    const onAddEmail = vi.fn();
    const user = userEvent.setup();
    render(<AddEmailBanner onAddEmail={onAddEmail} />);

    await user.click(await screen.findByRole("button", { name: /add email/i }));

    expect(onAddEmail).toHaveBeenCalled();
  });
});

describe("dismissing it", () => {
  beforeEach(() => getSession.mockResolvedValue(sessionWith("liam@mygist.invalid")));

  it("hides it", async () => {
    const user = userEvent.setup();
    render(<AddEmailBanner onAddEmail={() => {}} />);

    await user.click(await screen.findByRole("button", { name: /dismiss/i }));

    expect(screen.queryByText(/add an email/i)).toBeNull();
  });

  it("keeps it hidden on the next visit", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AddEmailBanner onAddEmail={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /dismiss/i }));
    unmount();

    render(<AddEmailBanner onAddEmail={() => {}} />);

    // Deliberately allowing time for an async appearance, so a banner that
    // comes back late still fails this.
    await waitFor(() => expect(screen.queryByText(/add an email/i)).toBeNull());
  });

  it("does not even ask the server once dismissed", async () => {
    localStorage.setItem("mygist_add_email_dismissed", "1");

    render(<AddEmailBanner onAddEmail={() => {}} />);

    await waitFor(() => expect(getSession).not.toHaveBeenCalled());
  });
});

describe("laying out the row", () => {
  beforeEach(() => getSession.mockResolvedValue(sessionWith("liam@mygist.invalid")));

  it("centres the sentence against the button rather than top-aligning it", async () => {
    // The row holds a 20px line of text beside a 36px `size="sm"` button
    // (h-9), so items-start put the sentence 8px above the button's own label.
    // jsdom has no layout and cannot measure that, so this pins the class that
    // decides it -- and asserts the losing one is gone, which is the half that
    // catches a revert.
    render(<AddEmailBanner onAddEmail={() => {}} />);

    const row = (await screen.findByText(/add an email/i)).closest("div.flex");

    expect(row.className).toMatch(/items-center/);
    expect(row.className).not.toMatch(/items-start/);
  });

  it("leaves the icon unnudged, since centring already lines it up", async () => {
    // mt-0.5 existed to drop the icon onto the first line of text while the row
    // was top-aligned. Centred, it pushes the icon 2px low instead.
    render(<AddEmailBanner onAddEmail={() => {}} />);
    const row = (await screen.findByText(/add an email/i)).closest("div.flex");

    const icon = row.firstElementChild;

    expect(icon.tagName.toLowerCase()).toBe("svg");
    expect(icon.getAttribute("class")).not.toMatch(/mt-0\.5/);
  });
});

describe("when there is nothing to prompt about", () => {
  it("stays away from an account with a real email", async () => {
    getSession.mockResolvedValue(sessionWith("liam@example.com"));

    render(<AddEmailBanner onAddEmail={() => {}} />);

    await waitFor(() => expect(getSession).toHaveBeenCalled());
    expect(screen.queryByText(/add an email/i)).toBeNull();
  });

  it("stays away when there is no Better Auth session", async () => {
    // Detached mode, or a plain access token: there is no email to add, so
    // asking would be asking for something this UI cannot then deliver.
    getSession.mockResolvedValue(null);

    render(<AddEmailBanner onAddEmail={() => {}} />);

    await waitFor(() => expect(getSession).toHaveBeenCalled());
    expect(screen.queryByText(/add an email/i)).toBeNull();
  });

  it("stays quiet when the session cannot be read at all", async () => {
    getSession.mockRejectedValue(new Error("network"));

    render(<AddEmailBanner onAddEmail={() => {}} />);

    await waitFor(() => expect(getSession).toHaveBeenCalled());
    expect(screen.queryByText(/add an email/i)).toBeNull();
  });
});
