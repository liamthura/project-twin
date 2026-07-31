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
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    whoami: vi.fn(),
    listTokens: vi.fn(async () => []),
    getConfig: vi.fn(() => ({ serverUrl: "/api" })),
    createToken: vi.fn(async () => ({ id: "t1", label: "mcp", token: "mg_test" })),
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

import { whoami, listTokens, createToken } from "@/lib/api.js";
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

describe("minting a token with a narrowed scope", () => {
  // The chain under test: the switches in the tokens tab build a scope
  // array (Task 11) that has to survive unmodified through to the
  // createToken call -- api.js forwards it, and the backend stores it. This
  // covers only the frontend half; backend/tests/test_token_scopes.py
  // covers the rest (POST /api/auth/tokens -> db.create_token storage).
  //
  // Nothing here asserts on the *implication* rule (write forces propose
  // back on) -- that's Consent.jsx's onWriteChange/onProposeChange logic,
  // reused verbatim as onTokenWriteChange/onTokenProposeChange, and already
  // covered by Consent.test.jsx. This is purely "does the toggled selection
  // reach createToken intact."
  beforeEach(() => {
    localStorage.setItem("mygist_config", JSON.stringify({ serverUrl: "/api" }));
    whoami.mockResolvedValue({ user_id: "u-1", username: "Liam" });
  });

  it("passes exactly the toggled scopes to createToken, with write deselected", async () => {
    open();
    await waitFor(() => expect(whoami).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /api tokens/i }));
    await waitFor(() => expect(listTokens).toHaveBeenCalled());

    // Read has no control (it's the floor, not a choice -- see the disabled
    // switch), so only write is switched off here. Propose is left at its
    // default (on).
    fireEvent.click(screen.getByLabelText(/Change your persona directly/i));
    fireEvent.click(screen.getByRole("button", { name: /generate token/i }));

    await waitFor(() => expect(createToken).toHaveBeenCalled());

    const [label, requestedScopes] = createToken.mock.calls[0];
    expect(label).toBe("mcp");
    expect(requestedScopes).toEqual(["persona:read", "persona:propose"]);
    expect(requestedScopes).toContain("persona:read");
    expect(requestedScopes).not.toContain("persona:write");
  });
});
