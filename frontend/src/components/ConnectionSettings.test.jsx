/**
 * Signed-in state in the account dialog.
 *
 * These exist because a real user hit the gap they cover. The dialog decided
 * "signed in" from `!!config?.token`, which was a fair proxy while every
 * signed-in account had a token in localStorage. A Better Auth session is an
 * HttpOnly cookie that JavaScript cannot see, so that test reported signed OUT
 * for everyone who signed in through it -- hiding the account details,
 * disabling the tokens and data tabs, and hiding the sign-out button, which
 * left no way to sign out at all.
 *
 * The whole frontend suite passed throughout: it covered which credential a
 * request uses, and never what the UI concluded from one being absent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    whoami: vi.fn(),
    listTokens: vi.fn(async () => []),
    getConfig: vi.fn(() => ({ serverUrl: "/api" })),
  };
});

// EmailSettings renders inside the signed-in block and reaches for the session
// on mount. Stubbed to "no session", which is the render-nothing branch, so
// these tests stay about what they were about.
vi.mock("@/lib/session.js", () => ({
  signOut: vi.fn(async () => {}),
  getSession: vi.fn(async () => null),
  isPlaceholderEmail: vi.fn(() => false),
}));

import { whoami } from "@/lib/api.js";
import { ConnectionSettings } from "@/components/ConnectionSettings";

const open = () =>
  render(<ConnectionSettings isOpen={true} onClose={() => {}} onConnectionChange={() => {}} />);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("a cookie-only session", () => {
  beforeEach(() => {
    // Exactly the Better Auth case: a working session, and no token anywhere
    // for JavaScript to find.
    localStorage.setItem("mygist_config", JSON.stringify({ serverUrl: "/api" }));
    whoami.mockResolvedValue({ user_id: "u-1", username: "Liam" });
  });

  it("is recognised as signed in", async () => {
    open();
    // The server is the authority on this, not localStorage.
    await waitFor(() => expect(whoami).toHaveBeenCalled());
    expect(await screen.findByText(/Liam/)).toBeInTheDocument();
  });

  it("offers a way to sign out", async () => {
    open();
    // The bug: with no token, the sign-out control was never rendered, so a
    // signed-in user had no way back out.
    expect(await screen.findByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });
});

describe("no credential at all", () => {
  it("is recognised as signed out", async () => {
    localStorage.setItem("mygist_config", JSON.stringify({ serverUrl: "/api" }));
    whoami.mockRejectedValue(new Error("Unauthorized"));

    open();

    await waitFor(() => expect(whoami).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("treats a token the server rejects as signed out", async () => {
    // The old check called this signed in purely because a string was present.
    localStorage.setItem(
      "mygist_config",
      JSON.stringify({ serverUrl: "/api", token: "revoked-token" }),
    );
    whoami.mockRejectedValue(new Error("Unauthorized"));

    open();

    await waitFor(() => expect(whoami).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });
});
