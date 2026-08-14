import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, setPassword: vi.fn(async () => ({})), clearConfig: vi.fn() };
});

// EmailSettings reaches for the session on mount. Stubbed to "no session",
// which is its render-nothing branch, so these tests stay about this panel.
vi.mock("@/lib/session.js", () => ({
  signOut: vi.fn(async () => {}),
  getSession: vi.fn(async () => null),
  isPlaceholderEmail: vi.fn(() => false),
}));

vi.mock("@/lib/onboarding.js", () => ({
  getOnboarding: vi.fn(async () => ({ dismissed: false, steps: {} })),
  saveOnboarding: vi.fn(async () => {}),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { setPassword } from "@/lib/api.js";
import { signOut } from "@/lib/session.js";
import { getOnboarding, saveOnboarding } from "@/lib/onboarding.js";
import { AccountPanel } from "./AccountPanel";

const open = (props = {}) =>
  render(
    <AccountPanel
      isOpen
      username="Liam"
      isAutosaveEnabled
      onAutosaveChange={vi.fn()}
      disabledSections={[]}
      onSignedOut={vi.fn()}
      {...props}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  getOnboarding.mockResolvedValue({ dismissed: false, steps: {} });
});

describe("who you are", () => {
  it("names the account", () => {
    open();
    expect(screen.getByText(/Liam/)).toBeInTheDocument();
  });

  it("signs out through the service, not by clearing localStorage", async () => {
    // The session cookie is HttpOnly. Clearing storage alone would look signed
    // out and sign you back in on reload.
    const onSignedOut = vi.fn();
    open({ onSignedOut });
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(onSignedOut).toHaveBeenCalled();
  });
});

describe("the auto-save preference", () => {
  it("shows the switch on, when saving as you type is enabled", () => {
    open({ isAutosaveEnabled: true });
    expect(screen.getByRole("switch", { name: "Auto-save" })).toBeChecked();
  });

  it("shows the switch off, when it is not", () => {
    open({ isAutosaveEnabled: false });
    expect(screen.getByRole("switch", { name: "Auto-save" })).not.toBeChecked();
  });

  it("reports a change upward rather than holding the state itself", () => {
    // App owns it. A dialog that is closed most of the time must not be the
    // source of truth for how the app saves.
    const onAutosaveChange = vi.fn();
    open({ onAutosaveChange });
    fireEvent.click(screen.getByRole("switch", { name: "Auto-save" }));
    expect(onAutosaveChange).toHaveBeenCalledWith(false);
  });

  it("says what happens rather than naming the mechanism", () => {
    // "Auto-save" alone does not tell you what the alternative is. The copy has
    // to mention the button that appears when you turn this off.
    open();
    expect(screen.getByText(/Save as you type/i)).toBeInTheDocument();
    expect(screen.getByText(/Save now button/i)).toBeInTheDocument();
  });

  it("defaults to on when the prop is absent", () => {
    render(
      <AccountPanel isOpen username="Liam" disabledSections={[]} onSignedOut={vi.fn()} />,
    );
    expect(screen.getByRole("switch", { name: "Auto-save" })).toBeChecked();
  });
});

describe("the getting-started restore", () => {
  it("is offered only once the card has been dismissed", async () => {
    getOnboarding.mockResolvedValue({ dismissed: true, steps: {} });
    open();
    expect(
      await screen.findByRole("button", { name: /show getting started/i }),
    ).toBeInTheDocument();
  });

  it("says nothing to someone whose card is already showing", async () => {
    open();
    await waitFor(() => expect(getOnboarding).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: /show getting started/i }),
    ).not.toBeInTheDocument();
  });

  it("offers nothing when the state cannot be read", async () => {
    // A control that might do nothing is worse than no control.
    getOnboarding.mockRejectedValue(new Error("offline"));
    open();
    await waitFor(() => expect(getOnboarding).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: /show getting started/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the current disabled sections when restoring", async () => {
    // SettingsUpdate requires disabled_sections and writes what it is sent, so
    // [] here would re-enable every section the reader turned off.
    getOnboarding.mockResolvedValue({ dismissed: true, steps: {} });
    open({ disabledSections: ["media"] });

    fireEvent.click(await screen.findByRole("button", { name: /show getting started/i }));

    await waitFor(() =>
      expect(saveOnboarding).toHaveBeenCalledWith({ dismissed: false, steps: {} }, [
        "media",
      ]),
    );
  });

  it("asks nothing while its tab is closed", () => {
    open({ isOpen: false });
    expect(getOnboarding).not.toHaveBeenCalled();
  });
});

describe("changing the password", () => {
  const openForm = () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
  };

  it("refuses a mismatch without a round trip", async () => {
    openForm();
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: "longenough1" },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: "different1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("refuses one shorter than eight characters", async () => {
    openForm();
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("sends the current password when one was given", async () => {
    openForm();
    fireEvent.change(screen.getByLabelText(/Current password/i), {
      target: { value: "oldpassword" },
    });
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: "longenough1" },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: "longenough1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() =>
      expect(setPassword).toHaveBeenCalledWith("longenough1", "oldpassword"),
    );
  });

  it("omits the current password when the field was left empty", async () => {
    // An account seeded before Better Auth has no password to confirm, and the
    // endpoint takes current_password as optional.
    openForm();
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: "longenough1" },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: "longenough1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() =>
      expect(setPassword).toHaveBeenCalledWith("longenough1", undefined),
    );
  });

  it("shows what the server said when it refuses", async () => {
    setPassword.mockRejectedValueOnce(new Error("Current password is wrong."));
    openForm();
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: "longenough1" },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: "longenough1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByText(/Current password is wrong/)).toBeInTheDocument();
  });
});
