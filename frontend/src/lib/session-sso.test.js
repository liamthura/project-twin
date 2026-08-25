import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  SSO_LABEL,
  SSO_PROVIDER_ID,
  listAccounts,
  startSsoLink,
  startSsoSignIn,
  unlinkAccount,
} from "./session.js";

let assign;

beforeEach(() => {
  // window.location.href is not writable in jsdom, and the module assigns to
  // it. Replacing the object is the supported way to observe that.
  assign = vi.fn();
  delete window.location;
  window.location = { origin: "https://mygist.test", assign, href: "" };
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ok = (body) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

describe("starting an SSO sign-in", () => {
  it("posts to the CORE social route, not a plugin route", async () => {
    // better-auth 1.7's genericOAuth registers no endpoints of its own: the
    // provider rides /sign-in/social. Posting to /sign-in/oauth2 -- which the
    // 1.6 docs describe -- 404s.
    global.fetch.mockReturnValue(ok({ url: "https://door.test/authorize?x=1" }));

    await startSsoSignIn({ callbackURL: "/" });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/auth/sign-in/social");
    expect(JSON.parse(options.body).provider).toBe(SSO_PROVIDER_ID);
    expect(options.credentials).toBe("include");
  });

  it("sends the caller where to come back to", async () => {
    global.fetch.mockReturnValue(ok({ url: "https://door.test/authorize" }));

    await startSsoSignIn({
      callbackURL: "/auth/oauth2/authorize?client_id=abc",
      newUserCallbackURL: "/#/onboarding/welcome",
      errorCallbackURL: "/sign-in?client_id=abc",
    });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.callbackURL).toBe("/auth/oauth2/authorize?client_id=abc");
    // A brand-new account lands on onboarding rather than an empty Profile.
    // With a redirect flow there is no onSuccess callback to decide that in,
    // so the provider is told up front.
    expect(body.newUserCallbackURL).toBe("/#/onboarding/welcome");
    expect(body.errorCallbackURL).toBe("/sign-in?client_id=abc");
  });

  it("hands the browser to the provider", async () => {
    global.fetch.mockReturnValue(ok({ url: "https://door.test/authorize?x=1" }));
    await startSsoSignIn({ callbackURL: "/" });
    expect(window.location.href).toBe("https://door.test/authorize?x=1");
  });

  it("throws rather than navigating nowhere when no url comes back", async () => {
    // A silent no-op reads as a dead button, which is the hardest bug class to
    // report: nothing happened and nothing said why.
    global.fetch.mockReturnValue(ok({}));
    await expect(startSsoSignIn({ callbackURL: "/" })).rejects.toThrow();
    expect(window.location.href).toBe("");
  });

  it("surfaces the service's own message on a refusal", async () => {
    global.fetch.mockReturnValue(
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ message: "Provider not found" }),
      }),
    );
    await expect(startSsoSignIn({ callbackURL: "/" })).rejects.toThrow(
      "Provider not found",
    );
  });
});

describe("linking", () => {
  it("posts to /link-social with the session cookie", async () => {
    global.fetch.mockReturnValue(ok({ url: "https://door.test/authorize" }));
    await startSsoLink({ callbackURL: "/" });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/auth/link-social");
    expect(options.credentials).toBe("include");
    expect(JSON.parse(options.body).provider).toBe(SSO_PROVIDER_ID);
  });
});

describe("accounts", () => {
  it("lists them", async () => {
    global.fetch.mockReturnValue(
      ok([{ id: "1", providerId: "credential" }, { id: "2", providerId: "authentik" }]),
    );
    const accounts = await listAccounts();
    expect(global.fetch.mock.calls[0][0]).toBe("/auth/list-accounts");
    expect(accounts).toHaveLength(2);
  });

  it("answers with an empty list rather than throwing when there is no session", async () => {
    // Detached mode signs in with a bearer token and has no Better Auth
    // session at all. That is not an error, it simply has nothing to show.
    global.fetch.mockReturnValue(Promise.resolve({ ok: false, json: () => ({}) }));
    expect(await listAccounts()).toEqual([]);
  });

  it("unlinks by account id", async () => {
    global.fetch.mockReturnValue(ok({ status: true }));
    await unlinkAccount("acct-2");
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/auth/unlink-account");
    expect(JSON.parse(options.body)).toEqual({ accountId: "acct-2" });
  });

  it("passes the last-account refusal through in words", async () => {
    // Better Auth refuses to unlink the last account (FAILED_TO_UNLINK_LAST_
    // ACCOUNT). Nothing is reimplemented here; the message just has to arrive.
    global.fetch.mockReturnValue(
      Promise.resolve({
        ok: false,
        json: () =>
          Promise.resolve({ message: "You can't unlink your last account" }),
      }),
    );
    await expect(unlinkAccount("acct-2")).rejects.toThrow("last account");
  });
});

it("names the provider exactly once", () => {
  expect(SSO_PROVIDER_ID).toBe("authentik");
  expect(SSO_LABEL).toBe("TDev Door");
});
