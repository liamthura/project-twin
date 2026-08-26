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
    startSsoSignIn: vi.fn(async () => {}),
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
import {
  signIn,
  signUp,
  requestPasswordReset,
  checkInvite,
  startSsoSignIn,
} from "@/lib/session.js";
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

describe("validation arrives per field, on blur", () => {
  beforeEach(() => getInstance.mockResolvedValue({ invite_only: false }));

  const openSignIn = async () => {
    render(<WelcomeAuth onSuccess={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/username/i)).toBeInTheDocument());
  };

  it("is silent on a form nobody has touched", async () => {
    await openSignIn();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names the empty field when it is left", async () => {
    const user = userEvent.setup();
    await openSignIn();

    await user.click(screen.getByLabelText(/username/i));
    await user.tab();

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a username or email.");
  });

  it("marks that field invalid, not the form", async () => {
    const user = userEvent.setup();
    await openSignIn();

    await user.click(screen.getByLabelText(/username/i));
    await user.tab();

    expect(screen.getByLabelText(/username/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/^password/i)).not.toHaveAttribute("aria-invalid");
  });

  it("clears as the fix is typed, not on the next blur", async () => {
    // A red message under the box being corrected is the thing this rule
    // exists to prevent.
    //
    // Asserted on this field's own message rather than on any alert: tabbing
    // out of Username puts focus in Password, and coming back here leaves
    // Password blurred and empty, which correctly earns a message of its own.
    const user = userEvent.setup();
    await openSignIn();

    await user.click(screen.getByLabelText(/username/i));
    await user.tab();
    expect(screen.getByText("Enter a username or email.")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/username/i), "l");

    expect(screen.queryByText("Enter a username or email.")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).not.toHaveAttribute("aria-invalid");
  });

  it("still checks everything on a submit where nothing was blurred", async () => {
    // Enter submits a form in which no field was ever left.
    const user = userEvent.setup();
    await openSignIn();

    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    const messages = screen.getAllByRole("alert").map((el) => el.textContent);
    expect(messages).toContain("Enter a username or email.");
    expect(messages).toContain("Enter a password.");
  });

  it("holds a new password to eight characters, and only when signing up", async () => {
    const user = userEvent.setup();
    await openSignIn();

    await user.type(screen.getByLabelText(/^password/i), "short");
    await user.tab();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /create an account/i }));
    await user.type(screen.getByLabelText(/^password/i), "short");
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Password must be at least 8 characters.",
    );
  });

  it("reports a mismatch under Confirm, where the correction goes", async () => {
    const user = userEvent.setup();
    await openSignIn();

    await user.click(screen.getByRole("button", { name: /create an account/i }));
    await user.type(screen.getByLabelText(/^password/i), "a-good-password");
    await user.type(screen.getByLabelText(/confirm password/i), "a-good-passwerd");
    await user.tab();

    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");
  });

  it("stops saying they differ once the first field is the one that changed", async () => {
    // Fixing Password leaves a stale mismatch under Confirm unless the pair is
    // re-checked when either side moves.
    const user = userEvent.setup();
    await openSignIn();

    await user.click(screen.getByRole("button", { name: /create an account/i }));
    await user.type(screen.getByLabelText(/^password/i), "a-good-passwerd");
    await user.type(screen.getByLabelText(/confirm password/i), "a-good-password");
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");

    await user.clear(screen.getByLabelText(/^password/i));
    await user.type(screen.getByLabelText(/^password/i), "a-good-password");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the form-level line for what the server says", async () => {
    const user = userEvent.setup();
    signIn.mockImplementation(() => Promise.reject(new Error("Invalid username or password")));
    await openSignIn();

    await user.type(screen.getByLabelText(/username/i), "liamthura");
    await user.type(screen.getByLabelText(/^password/i), "a-good-password");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() =>
      expect(screen.getByText("Invalid username or password")).toBeInTheDocument(),
    );
  });
});

describe("WelcomeAuth with SSO configured", () => {
  beforeEach(() => {
    getInstance.mockResolvedValue({ invite_only: false, sso: true });
  });

  it("leads with the provider and hides the password form", async () => {
    render(<WelcomeAuth onSuccess={() => {}} />);

    expect(
      await screen.findByRole("button", { name: /continue with tdev door/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
  });

  it("keeps a way in for anyone who has not linked yet", async () => {
    // Not only for the migration window, when Liam must sign in with a
    // password to reach the link button at all. It permanently covers every
    // account that exists and has not linked.
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.click(
      await screen.findByRole("button", { name: /sign in with a password instead/i }),
    );
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  });

  it("sends the app's own sign-in home, and a new account to onboarding", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);

    await user.click(
      await screen.findByRole("button", { name: /continue with tdev door/i }),
    );

    expect(startSsoSignIn).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackURL: "/",
        newUserCallbackURL: "/?onboarding=1",
      }),
    );
  });

  it("resumes an in-flight OAuth authorize request", async () => {
    // The fiddliest path in the whole feature: MyGist is an OAuth server and an
    // OAuth client in one request. The authorize query has to survive the round
    // trip to the provider, or the MCP client that started this is dropped
    // without an answer.
    window.history.replaceState(null, "", "/sign-in?client_id=abc&state=xyz");
    const user = userEvent.setup();
    render(<WelcomeAuth intent="connect" onSuccess={() => {}} />);

    await user.click(
      await screen.findByRole("button", { name: /continue with tdev door/i }),
    );

    const [args] = startSsoSignIn.mock.calls[0];
    expect(args.callbackURL).toBe("/auth/oauth2/authorize?client_id=abc&state=xyz");
    // And no new-user URL. callback.mjs:254 prefers it over callbackURL for a
    // sign-in that registered an account, so setting it here would send an MCP
    // client's first-ever user to onboarding and drop the authorize request.
    expect(args.newUserCallbackURL).toBeUndefined();
  });

  it("explains a failed sign-in, and points at the fix", async () => {
    // The most likely cause by far is a username collision: someone signed in
    // through the provider without linking first. Resolving that to `liam-2`
    // would hand them a second, empty account, so it fails -- and the copy has
    // to name the actual remedy, because the person reading it is the operator
    // at 11pm.
    window.history.replaceState(null, "", "/sign-in?error=unable_to_create_user");
    render(<WelcomeAuth onSuccess={() => {}} />);

    expect(await screen.findByText(/could not sign you in with tdev door/i))
      .toBeInTheDocument();
    expect(screen.getByText(/link tdev door from settings/i)).toBeInTheDocument();
    // The raw code, for the person who has to look it up.
    expect(screen.getByText(/unable_to_create_user/)).toBeInTheDocument();
  });

  it("shows nothing about SSO on an instance that does not use it", async () => {
    getInstance.mockResolvedValue({ invite_only: false, sso: false });
    render(<WelcomeAuth onSuccess={() => {}} />);

    expect(await screen.findByLabelText(/^password$/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /continue with tdev door/i }),
    ).not.toBeInTheDocument();
  });
});

describe("callback URLs Better Auth will actually accept", () => {
  // The whole reason these are query parameters and not hash routes. Better
  // Auth validates every callback against trusted-origins.mjs's relative-path
  // rule -- character class [\w\-.+/@] plus an optional `?query` -- so a `#`
  // is refused outright with "Invalid newUserCallbackURL" before any redirect
  // is built. MyGist is hash-routed, so this catches the whole class rather
  // than one URL: it is the constraint, not an example of it.
  const acceptsRelativePath = (url) =>
    /^\/(?!\/|\\|%2f|%5c)[\w\-.\+/@]*(?:\?[\w\-.\+/=&%@]*)?$/.test(url);

  it("rejects a hash route, which is why none is ever sent", () => {
    expect(acceptsRelativePath("/#/onboarding/welcome")).toBe(false);
    expect(acceptsRelativePath("/#/profile")).toBe(false);
  });

  it("accepts every URL this screen actually sends", async () => {
    getInstance.mockResolvedValue({ invite_only: false, sso: true });
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);
    await user.click(
      await screen.findByRole("button", { name: /continue with tdev door/i }),
    );

    const sent = startSsoSignIn.mock.calls[0][0];
    for (const key of ["callbackURL", "newUserCallbackURL", "errorCallbackURL"]) {
      const url = sent[key];
      if (url === undefined) continue;
      expect(
        acceptsRelativePath(url),
        `${key} ${JSON.stringify(url)} would be refused by Better Auth`,
      ).toBe(true);
    }
  });

  it("still routes a brand-new account to onboarding, via the query", async () => {
    getInstance.mockResolvedValue({ invite_only: false, sso: true });
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);
    await user.click(
      await screen.findByRole("button", { name: /continue with tdev door/i }),
    );
    expect(startSsoSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ newUserCallbackURL: "/?onboarding=1" }),
    );
  });
});

describe("the provider button carries the provider's colour", () => {
  // It names a THIRD PARTY, so it must not wear MyGist's own primary -- the
  // button is a promise about where pressing it sends you.
  it("uses the sso variant, not the default one", async () => {
    getInstance.mockResolvedValue({ invite_only: false, sso: true });
    render(<WelcomeAuth onSuccess={() => {}} />);

    const button = await screen.findByRole("button", {
      name: /continue with tdev door/i,
    });
    expect(button.className).toContain("bg-sso");
    expect(button.className).not.toContain("bg-primary");
  });

  it("keeps the password escape hatch legible beside it", async () => {
    // The brand button is visually dominant by design, but this link is the
    // ONLY route an existing account has to reach Settings and link. If it
    // ever stops being rendered, the migration path closes.
    getInstance.mockResolvedValue({ invite_only: false, sso: true });
    render(<WelcomeAuth onSuccess={() => {}} />);

    expect(
      await screen.findByRole("button", { name: /sign in with a password instead/i }),
    ).toBeInTheDocument();
  });
});
