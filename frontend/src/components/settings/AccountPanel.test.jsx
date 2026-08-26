import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    setPassword: vi.fn(async () => ({})),
    clearConfig: vi.fn(),
    // Default to an instance with no SSO, so every pre-existing test keeps
    // seeing the password form it always saw.
    getInstance: vi.fn(async () => ({ sso: false })),
  };
});

// EmailSettings reaches for the session on mount. Stubbed to "no session",
// which is its render-nothing branch, so these tests stay about this panel.
vi.mock("@/lib/session.js", () => ({
  signOut: vi.fn(async () => {}),
  getSession: vi.fn(async () => null),
  isPlaceholderEmail: vi.fn(() => false),
  listAccounts: vi.fn(async () => []),
  // LinkedAccounts renders under this panel and needs these too -- this mock
  // is a full replacement rather than a partial one built on importOriginal.
  SSO_PROVIDER_ID: "authentik",
  SSO_LABEL: "TDev Door",
  startSsoLink: vi.fn(async () => {}),
  unlinkAccount: vi.fn(async () => ({})),
}));

vi.mock("@/lib/onboarding.js", () => ({
  getOnboarding: vi.fn(async () => ({ dismissed: false, steps: {} })),
  saveOnboarding: vi.fn(async () => {}),
}));

// Hoisted so tests can assert on it. A fresh vi.fn() per useToast() call
// would be unreachable from here.
const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

import { getInstance, setPassword } from "@/lib/api.js";
import { listAccounts, signOut } from "@/lib/session.js";
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
  // Same reasoning as getOnboarding above: a per-test override (SSO on, an
  // authentik account) must not leak into the next test via a mock that
  // clearAllMocks leaves in place.
  getInstance.mockResolvedValue({ sso: false });
  listAccounts.mockResolvedValue([]);
  // The panel reads `?error=` off the URL on mount, so a test that puts one
  // there must not leak it into the next one.
  window.history.replaceState(null, "", "/");
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
  const openForm = async () => {
    open();
    // The button is gated behind the account fetch now (it must not offer a
    // password change before that fetch says a password is actually
    // possible), so it is no longer present on the very first render.
    fireEvent.click(await screen.findByRole("button", { name: /change password/i }));
  };

  it("refuses a mismatch without a round trip", async () => {
    await openForm();
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
    await openForm();
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
    await openForm();
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
    await openForm();
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
    await openForm();
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

describe("AccountPanel with SSO", () => {
  it("stops offering a password change to an account that has no password", async () => {
    // Nothing here can set the FIRST password on an SSO-only account -- the
    // form posts a change, and there is nothing to change. Offering it is
    // offering a control that cannot work.
    getInstance.mockResolvedValue({ sso: true });
    listAccounts.mockResolvedValue([{ id: "a2", providerId: "authentik" }]);

    render(<AccountPanel isOpen username="liam" />);

    await waitFor(() =>
      expect(screen.queryByText(/change password/i)).not.toBeInTheDocument(),
    );
  });

  it("keeps offering it while a password still exists", async () => {
    getInstance.mockResolvedValue({ sso: true });
    listAccounts.mockResolvedValue([
      { id: "a1", providerId: "credential" },
      { id: "a2", providerId: "authentik" },
    ]);

    render(<AccountPanel isOpen username="liam" />);
    expect(await screen.findByText(/change password/i)).toBeInTheDocument();
  });

  it("is unchanged on an instance without SSO", async () => {
    getInstance.mockResolvedValue({ sso: false });
    listAccounts.mockResolvedValue([]);

    render(<AccountPanel isOpen username="liam" />);
    expect(await screen.findByText(/change password/i)).toBeInTheDocument();
  });

  it("does not show the password change control before accounts have loaded", async () => {
    // sso/accounts start at their no-SSO values (false/[]), so reading them
    // before the fetch resolves would show "Change password" for a frame and
    // then withdraw it once the truth -- SSO-only, no password -- arrives.
    // That is the control this task exists to keep off screen; it must never
    // flash on even for an instant.
    let resolveInstance;
    getInstance.mockReturnValue(
      new Promise((resolve) => {
        resolveInstance = resolve;
      }),
    );
    listAccounts.mockResolvedValue([{ id: "a2", providerId: "authentik" }]);

    render(<AccountPanel isOpen username="liam" />);
    expect(screen.queryByText(/change password/i)).not.toBeInTheDocument();

    resolveInstance({ sso: true });
    // The linked row is what proves the fetch actually landed and the panel
    // re-rendered on it. Waiting on `listAccounts` having been called does not:
    // it was already true at mount, so that assertion passes before the resolve
    // is anywhere near the DOM and only re-checks the line above.
    await screen.findByText(/TDev Door is linked/i);
    expect(screen.queryByText(/change password/i)).not.toBeInTheDocument();
  });
});

describe("a link attempt that came back with an error", () => {
  // A link is a full redirect away from Settings, so the dialog is gone by the
  // time Better Auth sends the failure back with `?error=<code>`. Only
  // WelcomeAuth read that parameter, and only when signed out, so a signed-in
  // person got nothing at all.
  it("says what went wrong, and takes the code off the URL", async () => {
    window.history.replaceState(
      null,
      "",
      "/?error=account_already_linked_to_different_user",
    );
    open();

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    const [arg] = toastSpy.mock.calls[0];
    expect(arg.variant).toBe("destructive");
    expect(arg.title).toMatch(/could not link/i);
    expect(arg.description).toMatch(/account_already_linked_to_different_user/);

    // Left in place it would fire again on every visit to this panel, and would
    // read as a failed SIGN-IN on the welcome screen after signing out.
    expect(window.location.search).toBe("");
  });

  it("says nothing when the URL carries no error", async () => {
    open();
    await waitFor(() => expect(listAccounts).toHaveBeenCalled());
    expect(toastSpy).not.toHaveBeenCalled();
  });
});
