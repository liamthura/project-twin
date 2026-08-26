import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    whoami: vi.fn(),
    getConfig: vi.fn(() => null),
    getApiBase: vi.fn(() => "/api"),
    listTokens: vi.fn(async () => []),
    listConnectedApps: vi.fn(async () => []),
  };
});

vi.mock("@/lib/session.js", () => ({
  signOut: vi.fn(async () => {}),
  getSession: vi.fn(async () => null),
  isPlaceholderEmail: vi.fn(() => false),
  // AccountPanel (rendered inside this dialog) now fetches accounts, and
  // LinkedAccounts underneath it needs these too -- this mock is a full
  // replacement rather than a partial one built on importOriginal.
  listAccounts: vi.fn(async () => []),
  SSO_PROVIDER_ID: "authentik",
  SSO_LABEL: "TDev Door",
  startSsoLink: vi.fn(async () => {}),
  unlinkAccount: vi.fn(async () => ({})),
}));

vi.mock("@/lib/onboarding.js", () => ({
  getOnboarding: vi.fn(async () => ({ dismissed: false, steps: {} })),
  saveOnboarding: vi.fn(async () => {}),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { whoami, listTokens, listConnectedApps } from "@/lib/api.js";
import { SettingsDialog } from "./SettingsDialog";

const open = () =>
  render(
    <SettingsDialog
      isOpen
      onClose={vi.fn()}
      onConnectionChange={vi.fn()}
      disabledSections={[]}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("signed in", () => {
  beforeEach(() => whoami.mockResolvedValue({ user_id: "u-1", username: "Liam" }));

  it("opens on Account", async () => {
    open();
    expect(await screen.findByText(/Liam/)).toBeInTheDocument();
  });

  it("offers all five tabs, enabled", async () => {
    open();
    await waitFor(() => expect(whoami).toHaveBeenCalled());
    for (const label of ["Account", "Server", "Tokens", "Connected apps", "Data"]) {
      expect(screen.getByRole("tab", { name: label })).toBeEnabled();
    }
  });

  it("does not fetch a panel until its tab is opened", async () => {
    // Radix TabsContent would mount all five and fire every fetch at once.
    // ProposalsPanel renders its panels itself for the same reason.
    //
    // userEvent rather than fireEvent: a Radix tab activates on focus, and a
    // bare click in jsdom moves nothing.
    const user = userEvent.setup();
    open();
    await waitFor(() => expect(whoami).toHaveBeenCalled());
    expect(listTokens).not.toHaveBeenCalled();
    expect(listConnectedApps).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "Tokens" }));
    await waitFor(() => expect(listTokens).toHaveBeenCalled());
    expect(listConnectedApps).not.toHaveBeenCalled();
  });

  it("offers a way to sign out", async () => {
    // The bug the whoami check exists for: with no token in localStorage, the
    // sign-out control was never rendered, so a signed-in user had no way out.
    open();
    expect(
      await screen.findByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
  });
});

describe("signed out", () => {
  beforeEach(() => {
    // mockImplementation, not mockRejectedValue: the latter builds its rejected
    // promise at setup time, before anything has a catch attached, and the
    // unhandled rejection fails every test in the block.
    whoami.mockImplementation(() => Promise.reject(new Error("Unauthorized")));
  });

  it("opens on Server, which is the only tab that would render", async () => {
    open();
    await waitFor(() => expect(whoami).toHaveBeenCalled());
    expect(await screen.findByText(/This instance/i)).toBeInTheDocument();
  });

  it("disables the four that need a credential", async () => {
    open();
    await waitFor(() => expect(whoami).toHaveBeenCalled());
    for (const label of ["Account", "Tokens", "Connected apps", "Data"]) {
      expect(screen.getByRole("tab", { name: label })).toBeDisabled();
    }
    expect(screen.getByRole("tab", { name: "Server" })).toBeEnabled();
  });

  it("offers no way to sign out, because there is nothing to sign out of", async () => {
    open();
    await waitFor(() => expect(whoami).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: /sign out/i }),
    ).not.toBeInTheDocument();
  });

  it("treats a token the server rejects as signed out", async () => {
    // The check this replaces called this signed in purely because a string was
    // present in localStorage.
    localStorage.setItem(
      "mygist_config",
      JSON.stringify({ serverUrl: "/api", token: "revoked-token" }),
    );
    open();
    await waitFor(() => expect(whoami).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: "Account" })).toBeDisabled();
  });
});

describe("the tab row", () => {
  it("is a real tablist, not styled buttons", async () => {
    // The row it replaces was <button> elements with no role, so the app's main
    // settings surface had no tablist semantics and no arrow-key navigation.
    whoami.mockResolvedValue({ user_id: "u-1", username: "Liam" });
    open();
    expect(await screen.findByRole("tablist")).toBeInTheDocument();
  });
});
