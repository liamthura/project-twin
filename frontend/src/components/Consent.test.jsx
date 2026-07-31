// The consent screen. See Consent.jsx for why this is the one screen in the
// whole OAuth flow that cannot be gotten wrong: the scope decision made here
// is permanent (MCP has no per-tool step-up), and naming the account is what
// stops a grant from landing on the wrong persona.
//
// Two groups of tests. The first renders with `client`/`username` handed in
// as props, the way a props-driven unit test normally would. The second
// covers the path that actually runs in production: `<Consent />` rendered
// bare by App.jsx, which has to parse its own URL, ask `getSession()` who is
// signed in, and fetch the client's name over `authFetch` -- none of which
// the first group exercises.
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Only the network calls are replaced. Everything else Consent imports from
// session.js (there is nothing else it imports) goes through this mock too,
// but nothing else in the module is called from this component.
vi.mock("@/lib/session.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getSession: vi.fn(), authFetch: vi.fn() };
});

import { getSession, authFetch } from "@/lib/session.js";
import Consent from "./Consent.jsx";

const CLIENT = {
  client_name: "Claude Desktop",
  scopes: ["persona:read", "persona:propose", "persona:write"],
};

const jsonResponse = (body, ok = true) => ({ ok, json: async () => body });

// The query Better Auth's /oauth2/authorize redirect would have appended.
const AUTHORIZE_QUERY =
  "?client_id=abc123&scope=persona%3Aread+persona%3Apropose+persona%3Awrite&state=xyz";

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/consent");
});

describe("Consent, given the client and account directly", () => {
  it("names the client and the account, so the wrong persona cannot be granted by accident", () => {
    render(<Consent client={CLIENT} username="liamthura" />);
    expect(screen.getByText(/Claude Desktop/)).toBeInTheDocument();
    expect(screen.getByText(/liamthura/)).toBeInTheDocument();
  });

  it("shows read as always granted rather than as a choice", () => {
    render(<Consent client={CLIENT} username="liamthura" />);
    const read = screen.getByLabelText(/Read your persona/i);
    expect(read).toBeChecked();
    expect(read).toBeDisabled();
  });

  it("pre-selects propose and write, and lets them be declined", () => {
    render(<Consent client={CLIENT} username="liamthura" />);
    for (const label of [/Suggest changes/i, /Change your persona directly/i]) {
      const box = screen.getByLabelText(label);
      expect(box).toBeChecked();
      expect(box).not.toBeDisabled();
    }
  });
});

describe("Consent, fetching the client and account itself", () => {
  it("parses client_id off the URL and renders what comes back", async () => {
    window.history.replaceState(null, "", `/consent${AUTHORIZE_QUERY}`);
    getSession.mockResolvedValue({ user: { username: "liamthura" } });
    authFetch.mockResolvedValue(jsonResponse({ client_name: "Claude Desktop" }));

    render(<Consent />);

    expect(await screen.findByText(/Claude Desktop/)).toBeInTheDocument();
    expect(screen.getByText(/liamthura/)).toBeInTheDocument();
    // The public, no-ownership-required endpoint -- not /oauth2/get-client,
    // which is gated to the client's own registrant and would 401 here.
    expect(authFetch).toHaveBeenCalledWith("/oauth2/public-client?client_id=abc123");
  });

  it("shows a loading state until the session and client are both in", async () => {
    window.history.replaceState(null, "", `/consent${AUTHORIZE_QUERY}`);
    let resolveSession;
    getSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );
    authFetch.mockResolvedValue(jsonResponse({ client_name: "Claude Desktop" }));

    render(<Consent />);

    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByText(/Claude Desktop/)).toBeNull();

    resolveSession({ user: { username: "liamthura" } });

    expect(await screen.findByText(/Claude Desktop/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not silently show a consent form with no client named, when the client fetch fails", async () => {
    window.history.replaceState(null, "", `/consent${AUTHORIZE_QUERY}`);
    getSession.mockResolvedValue({ user: { username: "liamthura" } });
    authFetch.mockResolvedValue(
      jsonResponse({ error_description: "client not found" }, false),
    );

    render(<Consent />);

    expect(await screen.findByText(/client not found/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /allow/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /deny/i })).toBeNull();
    expect(screen.queryByLabelText(/Read your persona/i)).toBeNull();
  });

  it("says so, rather than showing anything to approve, when nobody is signed in", async () => {
    window.history.replaceState(null, "", `/consent${AUTHORIZE_QUERY}`);
    getSession.mockResolvedValue(null);
    authFetch.mockResolvedValue(jsonResponse({ client_name: "Claude Desktop" }));

    render(<Consent />);

    expect(await screen.findByText(/sign in to continue/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /allow/i })).toBeNull();
  });
});
