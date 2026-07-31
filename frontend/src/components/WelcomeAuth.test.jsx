import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// registerAccount/loginAccount take the server URL as their first argument,
// which is the whole point of these tests: which server a fresh sign-up is
// sent to. Everything else in the module is kept real.
vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    saveConfig: vi.fn(),
    registerAccount: vi.fn(async () => ({ token: "t" })),
    loginAccount: vi.fn(async () => ({ token: "t" })),
  };
});

vi.mock("@/lib/session.js", () => ({
  signIn: vi.fn(async () => ({})),
  signUp: vi.fn(async () => ({})),
}));

import { registerAccount, loginAccount, saveConfig, CLOUD_API_URL } from "@/lib/api.js";
import { signIn, signUp } from "@/lib/session.js";
import { WelcomeAuth } from "@/components/WelcomeAuth";

// jsdom serves the page from http://localhost:3000 by default, which stands
// in for any self-hosted origin -- the case that was broken.
const ORIGIN_API = `${window.location.origin}/api`;

beforeEach(() => vi.clearAllMocks());

describe("WelcomeAuth server default", () => {
  it("signs in against the origin that served the page, not the cloud preset", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onUseToken={() => {}} onSuccess={() => {}} />);

    await user.type(screen.getByLabelText("Username"), "someone");
    await user.type(screen.getByLabelText("Password"), "CorrectHorse9!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // Same-origin now goes through Better Auth, which sets an HttpOnly cookie.
    expect(signIn).toHaveBeenCalledWith("someone", "CorrectHorse9!");
    expect(loginAccount).not.toHaveBeenCalled();

    // The failure the original version of this test guarded against -- a
    // self-hosted instance sending its own users' credentials cross-origin to
    // the hosted deployment -- is now structurally impossible on this path,
    // because Better Auth is only ever addressed at a relative /auth on the
    // origin that served the page. Asserted anyway: the guarantee is the point,
    // not the mechanism that currently provides it.
    expect(loginAccount).not.toHaveBeenCalledWith(CLOUD_API_URL, expect.anything(), expect.anything());
  });

  it("stores no token for a same-origin sign-in, so the cookie stays authoritative", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onUseToken={() => {}} onSuccess={() => {}} />);

    await user.type(screen.getByLabelText("Username"), "someone");
    await user.type(screen.getByLabelText("Password"), "CorrectHorse9!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // A token left in localStorage would outrank the session in
    // resolveCredential, so a stale one would silently win over a live login.
    expect(saveConfig).toHaveBeenCalledWith({ serverUrl: ORIGIN_API });
  });

  it("registers against that same origin", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onUseToken={() => {}} onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(screen.getByLabelText("Username"), "someone");
    await user.type(screen.getByLabelText("Password"), "CorrectHorse9!");
    await user.type(screen.getByLabelText("Confirm password"), "CorrectHorse9!");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(signUp).toHaveBeenCalledWith("someone", "CorrectHorse9!");
    expect(registerAccount).not.toHaveBeenCalled();
  });

  it("still lets the cloud preset be chosen in one click", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onUseToken={() => {}} onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: /^Server:/ }));
    await user.click(screen.getByRole("button", { name: "Cloud" }));
    await user.type(screen.getByLabelText("Username"), "someone");
    await user.type(screen.getByLabelText("Password"), "CorrectHorse9!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // Choosing a different origin is detached mode: a cross-site cookie cannot
    // work, so this deliberately keeps the original endpoints and the stored
    // bearer token. It is the one place the old flow is still required rather
    // than merely deprecated.
    expect(loginAccount).toHaveBeenCalledWith(CLOUD_API_URL, "someone", "CorrectHorse9!");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("prefills the serving origin so the URL is visible, not guessed at", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onUseToken={() => {}} onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: /^Server:/ }));

    expect(screen.getByDisplayValue(ORIGIN_API)).toBeInTheDocument();
  });
});
