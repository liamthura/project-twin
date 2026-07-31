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
