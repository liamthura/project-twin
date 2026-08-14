import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Only the calls that touch the network are replaced. The invite helpers --
// normalisation, the alphabet, what counts as complete -- stay real, because
// they are rules the screen depends on and a stubbed rule would only ever agree
// with whatever the test assumed.
vi.mock("@/lib/session.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    signIn: vi.fn(async () => ({})),
    signUp: vi.fn(async () => ({})),
    requestPasswordReset: vi.fn(async () => ({ status: true })),
    checkInvite: vi.fn(async () => true),
  };
});

// registerAccount/loginAccount take the server URL as their first argument,
// which is the whole point of several of these tests: which server a fresh
// sign-up is sent to. Everything else in the module is kept real.
vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    saveConfig: vi.fn(),
    registerAccount: vi.fn(async () => ({ token: "t" })),
    loginAccount: vi.fn(async () => ({ token: "t" })),
    // Every test that predates invite-only expects an open instance.
    getInstance: vi.fn(async () => ({ invite_only: false })),
  };
});

import { registerAccount, loginAccount, saveConfig, getInstance, CLOUD_API_URL } from "@/lib/api.js";
import { signIn, signUp, requestPasswordReset, checkInvite } from "@/lib/session.js";
import { WelcomeAuth } from "@/components/WelcomeAuth";

// jsdom serves the page from http://localhost:3000 by default, which stands
// in for any self-hosted origin -- the case that was broken.
const ORIGIN_API = `${window.location.origin}/api`;

beforeEach(() => {
  vi.clearAllMocks();
  // The screen reads its mode from the hash and writes back to it, and jsdom
  // keeps one location for the whole file -- so without this, a test that ends
  // on #/forgot starts the next one there. A real page load never inherits the
  // previous page's URL.
  window.history.replaceState(null, "", window.location.pathname);
});

describe("WelcomeAuth server default", () => {
  it("signs in against the origin that served the page, not the cloud preset", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.type(screen.getByLabelText("Username or email"), "someone");
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
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.type(screen.getByLabelText("Username or email"), "someone");
    await user.type(screen.getByLabelText("Password"), "CorrectHorse9!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // A token left in localStorage would outrank the session in
    // resolveCredential, so a stale one would silently win over a live login.
    expect(saveConfig).toHaveBeenCalledWith({ serverUrl: ORIGIN_API });
  });

  it("registers against that same origin", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(screen.getByLabelText("Username"), "someone");
    await user.type(screen.getByLabelText("Password"), "CorrectHorse9!");
    await user.type(screen.getByLabelText("Confirm password"), "CorrectHorse9!");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    // Trailing undefined: no email is collected at sign-up, and this instance
    // is open so there is no invite code either.
    expect(signUp).toHaveBeenCalledWith("someone", "CorrectHorse9!", undefined, undefined);
    expect(registerAccount).not.toHaveBeenCalled();
  });

  it("still lets the cloud preset be chosen in one click", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

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
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: /^Server:/ }));

    expect(screen.getByDisplayValue(ORIGIN_API)).toBeInTheDocument();
  });
});

describe("forgotten password", () => {
  const openForgot = async (user) => {
    render(<WelcomeAuth onSuccess={() => {}} />);
    await user.click(screen.getByRole("button", { name: /forgot your password/i }));
  };

  it("asks for the email rather than the username", async () => {
    // Reset is addressed to an inbox. Asking for a username here would collect
    // the one identifier that cannot receive the link.
    const user = userEvent.setup();
    await openForgot(user);

    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
  });

  it("sends the request", async () => {
    const user = userEvent.setup();
    await openForgot(user);

    await user.type(screen.getByLabelText(/^email$/i), "liam@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(requestPasswordReset).toHaveBeenCalledWith("liam@example.com");
  });

  it("does not reveal whether that address has an account", async () => {
    // The service answers identically either way so a stranger cannot use this
    // to enumerate users. Saying "sent!" here would give away what the service
    // took care not to.
    const user = userEvent.setup();
    await openForgot(user);

    await user.type(screen.getByLabelText(/^email$/i), "stranger@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));

    // Conditional wording, and no claim either way. Matched on the contiguous
    // text node: the address itself sits in a nested <strong>.
    expect(await screen.findByText(/is on a mygist account/i)).toBeInTheDocument();
    expect(screen.getByText("stranger@example.com")).toBeInTheDocument();
    expect(screen.queryByText(/we sent|check your inbox|no account/i)).toBeNull();
  });

  it("does not send an empty address", async () => {
    const user = userEvent.setup();
    await openForgot(user);

    await user.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it("can go back to sign in", async () => {
    const user = userEvent.setup();
    await openForgot(user);

    await user.click(screen.getByRole("button", { name: /back to sign in/i }));

    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("is not offered while signing up, where it makes no sense", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: /create an account/i }));

    expect(
      screen.queryByRole("button", { name: /forgot your password/i }),
    ).not.toBeInTheDocument();
  });
});

describe("signing in with an email", () => {
  it("says the field takes either identifier", () => {
    render(<WelcomeAuth onSuccess={() => {}} />);
    expect(screen.getByLabelText("Username or email")).toBeInTheDocument();
  });

  it("passes an email through to the session module, which routes it", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.type(screen.getByLabelText("Username or email"), "liam@example.com");
    await user.type(screen.getByLabelText("Password"), "CorrectHorse9!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(signIn).toHaveBeenCalledWith("liam@example.com", "CorrectHorse9!");
  });

  it("still asks only for a username when creating an account", async () => {
    // Sign-up is unchanged. Offering a choice here would promise something the
    // next step does not deliver.
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Create an account" }));

    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.queryByLabelText("Username or email")).toBeNull();
  });

  it("asks only for a username in detached mode", async () => {
    // Detached mode talks to /api/auth/login, which knows only usernames. A
    // label promising email would be a lie on that path.
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: /^Server:/ }));
    await user.click(screen.getByRole("button", { name: "Cloud" }));

    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.queryByLabelText("Username or email")).toBeNull();
  });
});

describe("an invite-only instance", () => {
  beforeEach(() => {
    getInstance.mockResolvedValue({ invite_only: true });
    checkInvite.mockResolvedValue(true);
  });

  it("asks for a code before the account form", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Create an account" }));

    expect(await screen.findByLabelText(/invite code/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Confirm password")).toBeNull();
  });

  it("does not gate signing in", async () => {
    // Only account creation passes through the gate. Someone who already has an
    // account has already been invited.
    render(<WelcomeAuth onSuccess={() => {}} />);

    expect(await screen.findByLabelText("Username or email")).toBeInTheDocument();
    expect(screen.queryByLabelText(/invite code/i)).toBeNull();
  });

  it("shows the account form once a code is accepted, and which code it was", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(await screen.findByLabelText(/invite code/i), "7F2KQX91");

    expect(await screen.findByLabelText("Confirm password")).toBeInTheDocument();
    expect(screen.getByText("7F2K-QX91")).toBeInTheDocument();
  });

  it("sends the code with the registration", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(await screen.findByLabelText(/invite code/i), "7F2KQX91");

    await user.type(await screen.findByLabelText("Username"), "sarah");
    await user.type(screen.getByLabelText("Password"), "CorrectHorse9!");
    await user.type(screen.getByLabelText("Confirm password"), "CorrectHorse9!");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(signUp).toHaveBeenCalledWith("sarah", "CorrectHorse9!", undefined, "7F2K-QX91");
  });

  it("lets a wrong code be changed without losing the form", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(await screen.findByLabelText(/invite code/i), "7F2KQX91");
    await screen.findByLabelText("Confirm password");

    await user.click(screen.getByRole("button", { name: /change/i }));

    expect(await screen.findByLabelText(/invite code/i)).toBeInTheDocument();
  });
});

describe("an open instance", () => {
  it("never mentions invite codes", async () => {
    getInstance.mockResolvedValue({ invite_only: false });
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Create an account" }));

    expect(await screen.findByLabelText("Confirm password")).toBeInTheDocument();
    expect(screen.queryByLabelText(/invite code/i)).toBeNull();
  });
});

describe("the auth screens have their own routes", () => {
  const routeNow = () => window.location.hash;

  it("names itself #/signin instead of leaving a stale app route up", async () => {
    // The bug: the tab sync wrote #/profile while the sign-in form was on
    // screen, so the address bar named a page you could not reach without
    // signing in first.
    render(<WelcomeAuth onSuccess={() => {}} />);

    await waitFor(() => expect(routeNow()).toBe("#/signin"));
  });

  it("moves to #/signup when an account is being created", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Create an account" }));

    await waitFor(() => expect(routeNow()).toBe("#/signup"));
  });

  it("moves to #/forgot for a password reset", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.click(screen.getByRole("button", { name: /forgot your password/i }));

    await waitFor(() => expect(routeNow()).toBe("#/forgot"));
  });

  it("opens straight onto the form a deep link names", async () => {
    window.history.replaceState(null, "", "#/signup");

    render(<WelcomeAuth onSuccess={() => {}} />);

    expect(await screen.findByLabelText("Confirm password")).toBeInTheDocument();
  });

  it("falls back to sign-in for a route that means nothing here", async () => {
    // #/profile is a real route -- just not one this screen can show. Landing
    // on a blank page would be the alternative.
    window.history.replaceState(null, "", "#/profile");

    render(<WelcomeAuth onSuccess={() => {}} />);

    expect(await screen.findByLabelText("Username or email")).toBeInTheDocument();
    await waitFor(() => expect(routeNow()).toBe("#/signin"));
  });

  it("follows the back button between screens", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await waitFor(() => expect(routeNow()).toBe("#/signup"));

    // Deliberate moves push, so this lands back on sign-in rather than skipping
    // past it to wherever the tab was open before.
    window.history.back();

    expect(await screen.findByLabelText("Username or email")).toBeInTheDocument();
  });

  it("keeps an invite link's query when the route changes", async () => {
    // ?invite= is what brought someone here. Rewriting the hash must not drop
    // it, or the code is lost the moment the screen names itself.
    window.history.replaceState(null, "", "/?invite=7F2K-QX91");

    render(<WelcomeAuth onSuccess={() => {}} />);

    await waitFor(() => expect(window.location.search).toBe("?invite=7F2K-QX91"));
  });

  it("starts an invite link on sign-up, not sign-in", async () => {
    window.history.replaceState(null, "", "/?invite=7F2K-QX91");

    render(<WelcomeAuth onSuccess={() => {}} />);

    await waitFor(() => expect(routeNow()).toBe("#/signup"));
  });
  it("drops a spent invite code from the address bar", async () => {
    // It has done its job by then, and a code left in the URL is one that gets
    // copied out of a screenshot and passed to somebody it will not work for.
    getInstance.mockResolvedValue({ invite_only: true });
    checkInvite.mockResolvedValue(true);
    window.history.replaceState(null, "", "/?invite=7F2K-QX91");

    render(<WelcomeAuth onSuccess={() => {}} />);

    await screen.findByLabelText("Confirm password");
    await waitFor(() => expect(window.location.search).toBe(""));
    // The route it navigated to is untouched by the cleanup.
    expect(window.location.hash).toBe("#/signup");
  });
});

describe("what the sign-in screen no longer offers", () => {
  // Per the prototype's change 5: Better Auth supersedes the pasted token.
  // Asserted rather than assumed because deleting it also cost the first-run
  // route to the token field -- see the auth slice spec's correction section.
  // If that decision is ever revisited, this test is where it surfaces.
  it("does not offer a pasted access token", async () => {
    render(<WelcomeAuth onSuccess={() => {}} />);

    await waitFor(() => expect(screen.getByLabelText(/username/i)).toBeInTheDocument());
    expect(screen.queryByText(/access token/i)).not.toBeInTheDocument();
  });

  it("still lets the server be changed, which shared that row", async () => {
    render(<WelcomeAuth onSuccess={() => {}} />);

    await waitFor(() => expect(screen.getByLabelText(/username/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^Server:/ })).toBeInTheDocument();
  });
});

describe("the card's heading is part of its state", () => {
  // The heading used to be App's, set at the point WelcomeAuth was mounted, so
  // it could not change when the form did: "Welcome to MyGist -- Sign in or
  // create an account to get started" sat above the forgot-password form, and
  // above the invite gate.
  const heading = () => screen.getByRole("heading", { level: 1 }).textContent;
  const waitForForm = () =>
    waitFor(() => expect(screen.getByLabelText(/username/i)).toBeInTheDocument());

  // Stated rather than inherited. clearAllMocks() empties the call log but
  // leaves implementations in place, so an earlier block's
  // mockResolvedValue({ invite_only: true }) is still in force here.
  beforeEach(() => getInstance.mockResolvedValue({ invite_only: false }));

  it("welcomes on sign-in", async () => {
    render(<WelcomeAuth onSuccess={() => {}} />);

    await waitForForm();
    expect(heading()).toMatch(/Welcome to MyGist/i);
  });

  it("changes when an account is being created", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await waitForForm();
    await user.click(screen.getByRole("button", { name: /create an account/i }));
    expect(heading()).toMatch(/Create your account/i);
  });

  it("changes again for a password reset", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await waitForForm();
    await user.click(screen.getByRole("button", { name: /forgot your password/i }));
    expect(heading()).toMatch(/Reset your password/i);
  });

  it("says what the sign-in is for when a client is waiting", async () => {
    render(<WelcomeAuth intent="connect" onSuccess={() => {}} />);

    await waitForForm();
    expect(heading()).toMatch(/Sign in to connect/i);
  });

  it("names the gate rather than the welcome on an invite-only instance", async () => {
    getInstance.mockResolvedValue({ invite_only: true });
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await waitForForm();
    await user.click(screen.getByRole("button", { name: /create an account/i }));
    await screen.findByLabelText(/invite code/i);
    expect(heading()).toMatch(/You need an invite/i);
  });
});
