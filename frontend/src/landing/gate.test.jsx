import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// A visitor has no credential, so every data call fails. That is the state the
// landing page exists for -- previously it dropped straight to a sign-in form,
// which told someone who had never heard of MyGist to sign in to it.
vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: vi.fn(() => Promise.reject(new Error("401 Unauthorized"))),
    getAuthToken: vi.fn(() => null),
  };
});

vi.mock("@/lib/session.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, hasSession: vi.fn(() => Promise.resolve(false)) };
});

import App from "@/App";

beforeAll(() => {
  window.matchMedia =
    window.matchMedia ||
    (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  window.ResizeObserver =
    window.ResizeObserver ||
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("The no-credential gate", () => {
  it("shows a visitor the landing page, not a sign-in form", async () => {
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Explain yourself once.", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Welcome to MyGist")).not.toBeInTheDocument();
  });

  it("hands over to the auth screen when sign in is chosen", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Explain yourself once.", level: 1 });
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Welcome to MyGist")).toBeInTheDocument();
    // goToRoute uses pushState, which fires no hashchange -- the route has to
    // reach App by the setter at the call site, and this is what proves it.
    expect(window.location.hash).toBe("#/signin");
  });

  it("goes straight to the auth screen for a deep link to #/signin", async () => {
    window.history.replaceState(null, "", "/#/signin");
    render(<App />);

    expect(await screen.findByText("Welcome to MyGist")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Explain yourself once." }),
      ).not.toBeInTheDocument(),
    );
  });
});
