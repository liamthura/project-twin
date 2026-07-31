/**
 * The browser session and how the API client chooses a credential.
 *
 * These are the seams where Phase 2 can break silently rather than loudly: a
 * stale token quietly outranking a live session, or an expired JWT surfacing as
 * "authentication failed" instead of refreshing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as session from "./session.js";
import { api, saveConfig, clearConfig } from "./api.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  clearConfig();
  session.forgetJwt();
  vi.restoreAllMocks();
});

afterEach(() => {
  clearConfig();
  session.forgetJwt();
});

describe("deriving a JWT from the session cookie", () => {
  it("sends credentials so the cookie actually travels", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ token: "jwt-1" }));

    await session.getJwt();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/auth/token");
    // Without credentials:"include" the cookie is neither sent nor stored, and
    // every call would 401 with nothing obviously wrong.
    expect(options.credentials).toBe("include");
  });

  it("caches, so one JWT serves many API calls", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ token: "jwt-1" }));

    expect(await session.getJwt()).toBe("jwt-1");
    expect(await session.getJwt()).toBe("jwt-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when there is no session, rather than throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 401));
    expect(await session.getJwt()).toBeNull();
  });

  it("re-derives after forgetJwt", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ token: "jwt-1" }))
      .mockResolvedValueOnce(jsonResponse({ token: "jwt-2" }));

    expect(await session.getJwt()).toBe("jwt-1");
    session.forgetJwt();
    expect(await session.getJwt()).toBe("jwt-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("which credential an API call uses", () => {
  it("prefers a stored token, so accounts signed in before this change keep working", async () => {
    saveConfig({ serverUrl: "/api", token: "legacy-opaque-token" });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ ok: true }));

    await api("/files");

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer legacy-opaque-token");
    // The session must not even be consulted: a thirty-day token still in
    // localStorage is a working credential, and reaching for /auth/token would
    // sign the user out of a session they never started.
    expect(fetchMock.mock.calls.every(([url]) => url !== "/auth/token")).toBe(true);
  });

  it("falls back to the session JWT when no token is stored", async () => {
    saveConfig({ serverUrl: "/api" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (url === "/auth/token") return jsonResponse({ token: "jwt-1" });
      return jsonResponse({ ok: true });
    });

    await api("/files");

    const apiCall = fetchMock.mock.calls.find(([url]) => url !== "/auth/token");
    expect(apiCall[1].headers.Authorization).toBe("Bearer jwt-1");
  });
});

describe("an expired JWT", () => {
  it("is refreshed once and the call retried", async () => {
    saveConfig({ serverUrl: "/api" });
    let issued = 0;
    let apiCalls = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (url === "/auth/token") {
        issued += 1;
        return jsonResponse({ token: `jwt-${issued}` });
      }
      apiCalls += 1;
      // First call rejects the stale JWT; the refreshed one is accepted.
      return apiCalls === 1 ? jsonResponse({}, 401) : jsonResponse({ ok: true });
    });

    await expect(api("/files")).resolves.toEqual({ ok: true });
    expect(issued).toBe(2);
    expect(apiCalls).toBe(2);
  });

  it("gives up after one retry rather than looping", async () => {
    saveConfig({ serverUrl: "/api" });
    let apiCalls = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (url === "/auth/token") return jsonResponse({ token: "jwt" });
      apiCalls += 1;
      return jsonResponse({ detail: "Unauthorized" }, 401);
    });

    await expect(api("/files")).rejects.toThrow();
    // Two attempts, not an unbounded retry storm against a dead session.
    expect(apiCalls).toBe(2);
  });

  it("does not retry a stored token, which will not improve on a second try", async () => {
    saveConfig({ serverUrl: "/api", token: "stale-token" });
    let apiCalls = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      apiCalls += 1;
      return jsonResponse({ detail: "Unauthorized" }, 401);
    });

    await expect(api("/files")).rejects.toThrow();
    expect(apiCalls).toBe(1);
  });
});

describe("signing out", () => {
  it("tells the service, because the cookie is HttpOnly", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ ok: true }));

    await session.signOut();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/auth/sign-out");
    expect(options.method).toBe("POST");
  });

  it("still clears local state when the service is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ token: "jwt-1" }));
    await session.getJwt();

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    // Must not throw: leaving someone in a signed-in-looking UI because the
    // sign-out request failed is worse than the request failing.
    await expect(session.signOut()).resolves.toBeUndefined();
  });
});
