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
import { SettingsPage } from "./SettingsPage";

const PACKS = [
  { key: "profile", title: "Profile", core: true, enabled: true },
  { key: "goals", title: "Goals", core: false, enabled: true, description: "What you're working toward" },
  { key: "media", title: "Media", core: false, enabled: false },
];

const page = (props = {}) =>
  render(<SettingsPage tab="account" onTabChange={vi.fn()} packs={PACKS} {...props} />);

beforeEach(() => {
  vi.clearAllMocks();
  whoami.mockResolvedValue({ user_id: "u-1", username: "Liam" });
});

describe("SettingsPage", () => {
  it("has four tabs: Account, Connections, Sections, Data", async () => {
    page();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Account",
      "Connections",
      "Sections",
      "Data",
    ]);
  });

  it("opens on Account, and names who is signed in", async () => {
    page();
    expect(await screen.findByText(/Liam/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Account" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows the tab it is given, including an old id under its new name", async () => {
    // "Review access" still asks for "apps"; it lives in Connections now.
    page({ tab: "apps" });
    expect(screen.getByRole("tab", { name: "Connections" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(listConnectedApps).toHaveBeenCalled());
    expect(listTokens).toHaveBeenCalled();
  });

  it("reports a tab change rather than keeping it, since the tab is the route", async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    page({ onTabChange });
    await user.click(screen.getByRole("tab", { name: "Data" }));
    expect(onTabChange).toHaveBeenCalledWith("data");
  });

  it("does not fetch a panel until its tab is shown", async () => {
    page();
    await waitFor(() => expect(whoami).toHaveBeenCalled());
    expect(listTokens).not.toHaveBeenCalled();
    expect(listConnectedApps).not.toHaveBeenCalled();
  });

  it("offers a way to sign out", async () => {
    page();
    expect(await screen.findByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("keeps the server setting under Data, collapsed", async () => {
    page({ tab: "data" });
    expect(screen.getByRole("button", { name: /Advanced: server/ }))
      .toHaveAttribute("aria-expanded", "false");
  });
});

describe("the Sections tab", () => {
  it("lists only the sections that can be switched off, each with its state", () => {
    page({ tab: "sections" });
    expect(screen.getByRole("switch", { name: "Goals" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Media" })).not.toBeChecked();
    expect(screen.queryByRole("switch", { name: "Profile" })).not.toBeInTheDocument();
    expect(screen.getByText(/Always on: Profile/)).toBeInTheDocument();
  });

  it("says what switching one off does to AI clients, not just to the menu", () => {
    page({ tab: "sections" });
    expect(screen.getByText(/AI clients can no longer read or change it/)).toBeInTheDocument();
  });

  it("switches a section on or off through the app", async () => {
    const onTogglePack = vi.fn();
    const user = userEvent.setup();
    page({ tab: "sections", onTogglePack });
    await user.click(screen.getByRole("switch", { name: "Media" }));
    expect(onTogglePack).toHaveBeenCalledWith("media", true);
  });
});
