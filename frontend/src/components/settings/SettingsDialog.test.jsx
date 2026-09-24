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

  it("lands on the tab a caller asked for, under its new name", async () => {
    // "Review access" in the review queue still asks for "apps"; it lives in
    // Connections now.
    render(
      <SettingsDialog isOpen onClose={vi.fn()} initialTab="apps" disabledSections={[]} />,
    );
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Connections" }))
        .toHaveAttribute("aria-selected", "true"));
    expect(listConnectedApps).toHaveBeenCalled();
  });

  it("offers three tabs: Account, Connections, Data", async () => {
    open();
    await screen.findByRole("tablist");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Account",
      "Connections",
      "Data",
    ]);
  });

  it("opens Data with the server settings expanded when asked for Server", async () => {
    render(
      <SettingsDialog isOpen onClose={vi.fn()} initialTab="server" disabledSections={[]} />,
    );
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Data" }))
        .toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("button", { name: /Advanced: server/ }))
      .toHaveAttribute("aria-expanded", "true");
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

    await user.click(screen.getByRole("tab", { name: "Connections" }));
    await waitFor(() => expect(listTokens).toHaveBeenCalled());
    expect(listConnectedApps).toHaveBeenCalled();
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

  it("shows the server settings, which are all it can offer", async () => {
    open();
    await waitFor(() => expect(whoami).toHaveBeenCalled());
    expect(await screen.findByText(/This instance/i)).toBeInTheDocument();
  });

  it("shows no tabs, since every one of them needs a credential", async () => {
    open();
    expect(await screen.findByText(/This instance/i)).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
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
    expect(await screen.findByText(/This instance/i)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Account" })).not.toBeInTheDocument();
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
