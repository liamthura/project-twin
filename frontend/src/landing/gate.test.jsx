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
import Home from "@/Home";
import { hasSession } from "@/lib/session.js";

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
  it("shows a visitor at / the landing page, not a sign-in form", async () => {
    render(<Home />);

    expect(
      await screen.findByRole("heading", { name: "Explain yourself once.", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText("Welcome to MyGist")).not.toBeInTheDocument();
  });

  it("offers a signed-in visitor at / the app instead of sign-in", async () => {
    hasSession.mockResolvedValueOnce(true);
    render(<Home />);

    expect(await screen.findByRole("button", { name: "Open app" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("shows the sign-in form, not the landing page, at /app without a credential", async () => {
    window.history.replaceState(null, "", "/app/");
    render(<App />);

    expect(await screen.findByText("Welcome to MyGist")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Explain yourself once." }),
    ).not.toBeInTheDocument();
  });

  it("goes straight to the auth screen for a deep link to /app/#/signin", async () => {
    window.history.replaceState(null, "", "/app/#/signin");
    render(<App />);

    expect(await screen.findByText("Welcome to MyGist")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/signin");
  });
});
