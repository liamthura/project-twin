// Signing out of a Better Auth session. The session is a cookie, so App
// learns it is signed in from hasSession() rather than a stored token -- and
// it has to learn it is signed OUT too, or the first request after sign-out
// fails and reads as the server being unreachable.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import packsFixture from "@/__fixtures__/packs.json";

const auth = vi.hoisted(() => ({ signedIn: true }));

vi.mock("@/lib/api.js", async (importOriginal) => ({
  ...(await importOriginal()),
  api: vi.fn(async (endpoint) => {
    if (!auth.signedIn) {
      throw Object.assign(new Error("Authentication failed. Check your API token."), { status: 401 });
    }
    if (endpoint === "/all") return { data: { profile: {} } };
    if (endpoint === "/settings") return { disabled_sections: [], packs: packsFixture };
    if (endpoint === "/proposals/count") return { entity: 0, note: 0, total: 0 };
    return {};
  }),
  getAuthToken: vi.fn(() => null),
  whoami: vi.fn(async () => ({ user_id: "u-1", username: "liam" })),
  getInstance: vi.fn(async () => ({ invite_only: false, sso: false })),
}));
vi.mock("@/lib/session.js", async (importOriginal) => ({
  ...(await importOriginal()),
  hasSession: vi.fn(async () => auth.signedIn),
  getSession: vi.fn(async () => (auth.signedIn ? { user: { email: "liam@example.com" } } : null)),
  signOut: vi.fn(async () => {
    auth.signedIn = false;
  }),
}));

const { default: App } = await import("@/App");

beforeAll(() => {
  window.matchMedia =
    window.matchMedia || (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  window.ResizeObserver =
    window.ResizeObserver ||
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});

describe("signing out", () => {
  it("lands on sign in, not on Couldn't reach MyGist", async () => {
    window.location.hash = "#/profile";
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Account" }));
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }));

    expect(await screen.findByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't reach MyGist")).not.toBeInTheDocument();
  });
});
