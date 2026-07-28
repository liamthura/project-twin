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

import { registerAccount, loginAccount, CLOUD_API_URL } from "@/lib/api.js";
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

    expect(loginAccount).toHaveBeenCalledWith(ORIGIN_API, "someone", "CorrectHorse9!");
    // The failure this replaces: a self-hosted instance sent its own users'
    // credentials cross-origin to the hosted deployment, where the browser
    // rejects the preflight and the form reports an opaque network error.
    expect(loginAccount).not.toHaveBeenCalledWith(CLOUD_API_URL, expect.anything(), expect.anything());
  });

  it("registers against that same origin", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onUseToken={() => {}} onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(screen.getByLabelText("Username"), "someone");
    await user.type(screen.getByLabelText("Password"), "CorrectHorse9!");
    await user.type(screen.getByLabelText("Confirm password"), "CorrectHorse9!");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(registerAccount).toHaveBeenCalledWith(ORIGIN_API, "someone", "CorrectHorse9!");
  });

  it("still lets the cloud preset be chosen in one click", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onUseToken={() => {}} onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: /^Server:/ }));
    await user.click(screen.getByRole("button", { name: "Cloud" }));
    await user.type(screen.getByLabelText("Username"), "someone");
    await user.type(screen.getByLabelText("Password"), "CorrectHorse9!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(loginAccount).toHaveBeenCalledWith(CLOUD_API_URL, "someone", "CorrectHorse9!");
  });

  it("prefills the serving origin so the URL is visible, not guessed at", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onUseToken={() => {}} onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: /^Server:/ }));

    expect(screen.getByDisplayValue(ORIGIN_API)).toBeInTheDocument();
  });
});
