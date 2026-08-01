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
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the network calls are replaced. Everything else Consent imports from
// session.js (there is nothing else it imports) goes through this mock too,
// but nothing else in the module is called from this component.
vi.mock("@/lib/session.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getSession: vi.fn(), authFetch: vi.fn() };
});

import { getSession, authFetch } from "@/lib/session.js";
import Consent from "./Consent.jsx";

// What a full-fat MCP client asks for. `offline_access` belongs here: it is in
// every real authorize request (it is how the client gets a refresh token) and
// leaving it out of the fixture is what let a bug that silently dropped it pass
// this suite for a whole task.
const CLIENT = {
  client_name: "Claude Desktop",
  scopes: ["persona:read", "persona:propose", "persona:write", "offline_access"],
};

const jsonResponse = (body, ok = true) => ({ ok, json: async () => body });

// The query Better Auth's /oauth2/authorize redirect would have appended.
const AUTHORIZE_QUERY =
  "?client_id=abc123&scope=persona%3Aread+persona%3Apropose+persona%3Awrite+offline_access&state=xyz";

// A least-privilege client: it read scopes_supported and asked for the one
// scope it needs, plus the refresh it needs to stay connected.
const READ_ONLY_QUERY = "?client_id=abc123&scope=persona%3Aread+offline_access&state=xyz";

// The granted scope string this screen posted back, as a set.
const postedScopes = () => {
  const call = authFetch.mock.calls.find(([path]) => path === "/oauth2/consent");
  return new Set(JSON.parse(call[1].body).scope.split(" "));
};

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

  it("offers only the rows the client asked for, so Allow cannot 400", async () => {
    // Better Auth's consentEndpoint refuses any granted scope outside the
    // original request. Offering propose and write to a client that asked for
    // neither builds a grant that is rejected with nothing the person at the
    // screen can do about it.
    window.history.replaceState(null, "", `/consent${READ_ONLY_QUERY}`);
    getSession.mockResolvedValue({ user: { username: "liamthura" } });
    authFetch.mockResolvedValue(jsonResponse({ client_name: "Claude Desktop" }));

    render(<Consent />);

    expect(await screen.findByLabelText(/Read your persona/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Suggest changes/i)).toBeNull();
    expect(screen.queryByLabelText(/Change your persona directly/i)).toBeNull();
  });

  it("refuses a request that names no persona scope at all", async () => {
    // Read is NOT added back to rescue this: a scope outside the request is
    // exactly what the consent endpoint rejects. An empty form whose Allow
    // grants nothing would produce a connection that sees no tools and looks
    // like a MyGist fault, so this says what happened instead.
    window.history.replaceState(null, "", "/consent?client_id=abc123&scope=offline_access");
    getSession.mockResolvedValue({ user: { username: "liamthura" } });
    authFetch.mockResolvedValue(jsonResponse({ client_name: "Claude Desktop" }));

    render(<Consent />);

    expect(await screen.findByText(/Nothing to approve/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /allow/i })).toBeNull();
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

// The granted set posted to /oauth2/consent IS the grant: Better Auth
// overwrites the authorization query with it. Everything these assert is
// therefore about the token that comes out the far end, not about the form.
describe("Consent, the scope set it posts back", () => {
  const allow = async () => {
    await userEvent.click(screen.getByRole("button", { name: /allow/i }));
  };

  beforeEach(() => {
    window.history.replaceState(null, "", `/consent${AUTHORIZE_QUERY}`);
    getSession.mockResolvedValue({ user: { username: "liamthura" } });
    authFetch.mockResolvedValue(jsonResponse({ client_name: "Claude Desktop" }));
  });

  it("carries offline_access through, or no refresh token is ever issued", async () => {
    // The token endpoint gates refresh-token issuance on the GRANTED set
    // containing offline_access. Dropped here, every connection dies after ten
    // minutes and asks for consent again, forever.
    render(<Consent />);
    await screen.findByLabelText(/Read your persona/i);
    await allow();

    expect(postedScopes()).toEqual(
      new Set(["persona:read", "persona:propose", "persona:write", "offline_access"]),
    );
  });

  it("keeps offline_access when the optional persona scopes are declined", async () => {
    // Narrowing what an application may do to the persona must not also cut
    // off its ability to stay connected -- those are unrelated decisions, and
    // conflating them is what makes a read-only connection feel broken.
    render(<Consent />);
    await userEvent.click(await screen.findByLabelText(/Suggest changes/i));
    await allow();

    expect(postedScopes()).toEqual(new Set(["persona:read", "offline_access"]));
  });

  it("never posts a scope the client did not request", async () => {
    window.history.replaceState(null, "", `/consent${READ_ONLY_QUERY}`);
    render(<Consent />);
    await screen.findByLabelText(/Read your persona/i);
    await allow();

    expect(postedScopes()).toEqual(new Set(["persona:read", "offline_access"]));
  });
});

describe("Consent — returning to the client", () => {
  // The consent endpoint answers {redirect: true, url}. An earlier version read
  // `redirect_uri`, so neither Allow nor Deny navigated and neither threw: the
  // spinner ran forever with no way out but closing the tab. Observed in
  // production on the first real connection.
  const assign = vi.fn();
  const realLocation = window.location;

  beforeEach(() => {
    assign.mockClear();
    // jsdom's location is non-configurable, so spyOn cannot reach `assign`.
    // Replacing the whole object is the usual way round it; the original is
    // put back afterwards so nothing else in the suite inherits a stub.
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...realLocation, search: "?client_id=abc", assign },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: realLocation,
    });
  });

  it("follows the url the server returns when access is allowed", async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ redirect: true, url: "http://localhost:9876/cb?code=abc" }),
    });

    render(<Consent client={CLIENT} username="liamthura" />);
    await userEvent.click(screen.getByRole("button", { name: /allow/i }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("http://localhost:9876/cb?code=abc"),
    );
  });

  it("follows it on denial too, which is also a redirect", async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        redirect: true,
        url: "http://localhost:9876/cb?error=access_denied",
      }),
    });

    render(<Consent client={CLIENT} username="liamthura" />);
    await userEvent.click(screen.getByRole("button", { name: /deny/i }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "http://localhost:9876/cb?error=access_denied",
      ),
    );
  });

  it("surfaces an error rather than spinning forever when no target comes back", async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: true, json: async () => ({}) });

    render(<Consent client={CLIENT} username="liamthura" />);
    await userEvent.click(screen.getByRole("button", { name: /allow/i }));

    expect(await screen.findByText(/did not say where to send you back/i)).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });
});
