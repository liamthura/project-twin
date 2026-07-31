/**
 * The Phase 3 half of the session module: email and password reset.
 *
 * Separate file from session.test.js because these are a different question.
 * That one asks which credential a request carries; these ask whether the
 * requests we send are the ones the service will actually accept -- a
 * distinction that matters here, because two of these calls fail in ways that
 * only appear much later.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as session from "./session.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const bodyOf = (fetchMock, call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);

beforeEach(() => {
  session.forgetJwt();
  vi.restoreAllMocks();
});

describe("recognising a placeholder address", () => {
  it("treats the reserved domain as no email", () => {
    expect(session.isPlaceholderEmail("liam@mygist.invalid")).toBe(true);
  });

  it("ignores the local part, which differs per account", () => {
    expect(session.isPlaceholderEmail("MixedCase@mygist.invalid")).toBe(true);
    expect(session.isPlaceholderEmail("someone.else@mygist.invalid")).toBe(true);
  });

  it("is case-insensitive about the domain", () => {
    expect(session.isPlaceholderEmail("liam@MyGist.Invalid")).toBe(true);
  });

  it("does not mistake a real address for one", () => {
    expect(session.isPlaceholderEmail("liam@example.com")).toBe(false);
  });

  it("does not match a lookalike domain that merely contains it", () => {
    // A real address could legitimately be at a host whose name embeds ours.
    expect(session.isPlaceholderEmail("liam@mygist.invalid.example.com")).toBe(false);
  });

  it("survives a missing address", () => {
    expect(session.isPlaceholderEmail(undefined)).toBe(false);
    expect(session.isPlaceholderEmail(null)).toBe(false);
  });
});

describe("requesting a password reset", () => {
  it("sends redirectTo, without which the emailed link is dead on arrival", async () => {
    // Better Auth builds the link as /reset-password/<token>?callbackURL=<this>
    // and its own handler rejects the request when callbackURL is empty. Omit
    // this and everything looks fine until someone opens the email.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ status: true }));

    await session.requestPasswordReset("liam@example.com");

    expect(fetchMock.mock.calls[0][0]).toBe("/auth/request-password-reset");
    expect(bodyOf(fetchMock).redirectTo).toBeTruthy();
  });

  it("points the link back at a URL this app recognises as a reset", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ status: true }));

    await session.requestPasswordReset("liam@example.com");

    // App.jsx keys on reset=1, not on `token` alone -- that name is too
    // generic to treat as a claim about the page.
    const params = new URLSearchParams(new URL(bodyOf(fetchMock).redirectTo).search);
    expect(params.get("reset")).toBe("1");
  });

  it("uses the endpoint the service actually exposes", async () => {
    // /forget-password was the older name. Getting this wrong 404s, and the
    // failure reads as "reset is broken" rather than "reset is misspelt".
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ status: true }));

    await session.requestPasswordReset("liam@example.com");

    expect(fetchMock.mock.calls[0][0]).not.toContain("forget-password");
  });
});

describe("resetting the password", () => {
  it("sends the token from the link", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ status: true }));

    await session.resetPassword("a-new-password", "tok-123");

    expect(fetchMock.mock.calls[0][0]).toBe("/auth/reset-password");
    expect(bodyOf(fetchMock)).toEqual({
      newPassword: "a-new-password",
      token: "tok-123",
    });
  });

  it("raises the service's message when the token is spent or expired", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ message: "invalid token" }, 400),
    );

    await expect(session.resetPassword("a-new-password", "old")).rejects.toThrow(
      /invalid token/i,
    );
  });

  it("drops the cached JWT, since every session was just revoked", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ status: true }));

    await session.resetPassword("a-new-password", "tok-123");

    // A JWT held from before the reset would outlive the sessions the service
    // just killed.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 401));
    expect(await session.getJwt()).toBeNull();
  });
});

describe("changing the email", () => {
  it("asks the service to send verification back to a URL we handle", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ status: true }));

    await session.changeEmail("liam@example.com");

    expect(fetchMock.mock.calls[0][0]).toBe("/auth/change-email");
    const body = bodyOf(fetchMock);
    expect(body.newEmail).toBe("liam@example.com");
    expect(new URLSearchParams(new URL(body.callbackURL).search).get("verified")).toBe(
      "1",
    );
  });

  it("raises the service's message on rejection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ message: "Email already in use" }, 400),
    );

    await expect(session.changeEmail("taken@example.com")).rejects.toThrow(
      /already in use/i,
    );
  });
});

describe("reading the session", () => {
  it("returns the user when there is one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ user: { id: "u-1", email: "liam@example.com" } }),
    );

    const result = await session.getSession();
    expect(result.user.email).toBe("liam@example.com");
  });

  it("returns null rather than throwing when signed out", async () => {
    // The banner and the settings panel both call this on mount. A throw here
    // would surface an error to someone who is simply not signed in.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 401));

    expect(await session.getSession()).toBeNull();
  });

  it("returns null for a 200 carrying no user", async () => {
    // Better Auth answers /get-session with 200 and an empty body when there
    // is no session, so `ok` alone does not mean somebody is signed in.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(null));

    expect(await session.getSession()).toBeNull();
  });
});

describe("choosing a sign-in endpoint from what was typed", () => {
  it("treats an ordinary address as an email", () => {
    expect(session.looksLikeEmail("liam@example.com")).toBe(true);
    expect(session.looksLikeEmail("first.last+tag@sub.example.co.uk")).toBe(true);
  });

  it("treats a plain username as a username", () => {
    expect(session.looksLikeEmail("liam")).toBe(false);
    expect(session.looksLikeEmail("localdev-smoke")).toBe(false);
  });

  it("treats an @ without a dotted domain as a username", () => {
    // MyGist's username rule only requires a non-empty string, so `weird@name`
    // is a username somebody could already hold. Routing it to email sign-in
    // would lock them out with "invalid email or password".
    expect(session.looksLikeEmail("weird@name")).toBe(false);
  });

  it("survives an empty or missing identifier", () => {
    expect(session.looksLikeEmail("")).toBe(false);
    expect(session.looksLikeEmail(undefined)).toBe(false);
  });

  it("signs in by email at the email endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ token: "t" }));

    await session.signIn("liam@example.com", "a-password");

    expect(fetchMock.mock.calls[0][0]).toBe("/auth/sign-in/email");
    expect(bodyOf(fetchMock)).toEqual({ email: "liam@example.com", password: "a-password" });
  });

  it("signs in by username at the username endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ token: "t" }));

    await session.signIn("Liam", "a-password");

    expect(fetchMock.mock.calls[0][0]).toBe("/auth/sign-in/username");
    expect(bodyOf(fetchMock)).toEqual({ username: "Liam", password: "a-password" });
  });

  it("trims what was typed, because a trailing space is invisible", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ token: "t" }));

    await session.signIn("  liam@example.com  ", "a-password");

    expect(fetchMock.mock.calls[0][0]).toBe("/auth/sign-in/email");
    expect(bodyOf(fetchMock).email).toBe("liam@example.com");
  });

  it("refuses a placeholder address without asking the server", async () => {
    // Nobody is ever shown one of these, so nobody types it by accident -- but
    // it IS a real row in the email column, and would otherwise sign someone in
    // on an identifier we invented for them rather than one they chose.
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(session.signIn("liam@mygist.invalid", "a-password")).rejects.toThrow(
      /invalid email or password/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses it in words the service itself would have used", async () => {
    // Indistinguishable from a genuine rejection, so the refusal does not
    // announce that placeholders are a category worth probing for.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ message: "Invalid email or password" }, 401),
    );
    const real = await session
      .signIn("nobody@example.com", "a-password")
      .catch((e) => e.message);

    const placeholder = await session
      .signIn("liam@mygist.invalid", "a-password")
      .catch((e) => e.message);

    expect(placeholder).toBe(real);
  });

  it("still raises the service's message when credentials are wrong", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ message: "Invalid email or password" }, 401),
    );

    await expect(session.signIn("liam@example.com", "wrong")).rejects.toThrow(
      /invalid email or password/i,
    );
  });
});
