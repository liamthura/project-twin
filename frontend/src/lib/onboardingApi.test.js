import { describe, it, expect, vi, beforeEach } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: apiMock };
});

const { getOnboarding, saveOnboarding, markSeen, primeOnboarding, forgetOnboarding } =
  await import("./onboarding.js");
// The real one: the mock above spreads every actual export and replaces only
// `api`, and mcpUrl derives from getApiBase and localStorage rather than from
// any request.
const { mcpUrl, docsUrl } = await import("./api.js");

beforeEach(() => {
  apiMock.mockReset();
  forgetOnboarding();
});

// Progress rides on the settings response, which is large, so it is read once
// and kept current by the writes rather than fetched for every card that shows it.
describe("what is held between reads", () => {
  const settings = { disabled_sections: [], onboarding: { dismissed: false, steps: {}, seen: [] } };

  it("reads settings once, however many ask at once", async () => {
    apiMock.mockResolvedValue(settings);
    await Promise.all([getOnboarding(), getOnboarding()]);
    await getOnboarding();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("answers from a primed state without a request", async () => {
    primeOnboarding(Promise.resolve({ dismissed: true, steps: { connect: "done" } }));
    await expect(getOnboarding()).resolves.toEqual({ dismissed: true, steps: { connect: "done" }, seen: [] });
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("keeps what it holds current through a save and a seen guide", async () => {
    apiMock.mockResolvedValue(settings);
    await getOnboarding();
    await saveOnboarding({ dismissed: true, steps: { "about-you": "done" } }, []);
    await markSeen("guide:editor");
    await expect(getOnboarding()).resolves.toEqual({
      dismissed: true, steps: { "about-you": "done" }, seen: ["guide:editor"],
    });
    // One read, then the two writes; no second read.
    expect(apiMock.mock.calls.filter(([path, opts]) => path === "/settings" && !opts)).toHaveLength(1);
  });

  it("reads again once forgotten, and after a failed read", async () => {
    apiMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(settings);
    await expect(getOnboarding()).rejects.toThrow("offline");
    await getOnboarding();
    forgetOnboarding();
    await getOnboarding();
    expect(apiMock).toHaveBeenCalledTimes(3);
  });
});

describe("getOnboarding", () => {
  it("returns the stored state", async () => {
    apiMock.mockResolvedValue({
      disabled_sections: [],
      onboarding: { dismissed: true, steps: { "about-you": "done" }, seen: ["guide:editor"] },
    });
    await expect(getOnboarding()).resolves.toEqual({
      dismissed: true,
      steps: { "about-you": "done" },
      seen: ["guide:editor"],
    });
  });

  it("defaults when the server sends no onboarding key at all", async () => {
    // A backend that predates the settings change, or a detached instance
    // pointed at an older server. A missing key is not a broken page.
    apiMock.mockResolvedValue({ disabled_sections: [] });
    await expect(getOnboarding()).resolves.toEqual({ dismissed: false, steps: {}, seen: [] });
  });
});

describe("markSeen", () => {
  it("remembers a guide on the server", async () => {
    apiMock.mockResolvedValue({ seen: ["guide:editor"] });
    await markSeen("guide:editor");
    expect(apiMock).toHaveBeenCalledWith("/onboarding/seen", {
      method: "POST",
      body: JSON.stringify({ key: "guide:editor" }),
    });
  });
});

describe("saveOnboarding", () => {
  it("sends the sections it was given, not an empty list", async () => {
    // disabled_sections is required by SettingsUpdate. Sending [] would turn
    // every section the reader had switched off back on.
    apiMock.mockResolvedValue({ status: "saved" });
    await saveOnboarding({ dismissed: true, steps: {} }, ["circle", "media"]);

    expect(apiMock).toHaveBeenCalledWith("/settings", {
      method: "PUT",
      body: JSON.stringify({
        disabled_sections: ["circle", "media"],
        onboarding: { dismissed: true, steps: {} },
      }),
    });
  });
});

describe("mcpUrl", () => {
  beforeEach(() => {
    localStorage.removeItem("mygist_config");
  });

  it("resolves a relative base against this origin", async () => {
    // A client pastes this into a config file on its own machine, where a path
    // with no host means nothing.
    expect(mcpUrl()).toBe(`${window.location.origin}/mcp`);
  });

  it("puts /mcp beside /api on a configured server, not under it", async () => {
    // FastAPI mounts the MCP app at /mcp -- a SIBLING of /api, not a child.
    localStorage.setItem(
      "mygist_config",
      JSON.stringify({ serverUrl: "https://example.test/api" }),
    );
    expect(mcpUrl()).toBe("https://example.test/mcp");
  });

  it("tolerates a trailing slash on the configured base", async () => {
    localStorage.setItem(
      "mygist_config",
      JSON.stringify({ serverUrl: "https://example.test/api/" }),
    );
    expect(mcpUrl()).toBe("https://example.test/mcp");
  });
});

describe("docsUrl", () => {
  beforeEach(() => {
    localStorage.removeItem("mygist_config");
  });

  it("defaults to the docs root on this origin", () => {
    expect(docsUrl()).toBe(`${window.location.origin}/docs/`);
  });

  it("follows a configured server, so the docs match the thing being connected to", () => {
    localStorage.setItem(
      "mygist_config",
      JSON.stringify({ serverUrl: "https://example.test/api" }),
    );
    expect(docsUrl("/use/clients/")).toBe("https://example.test/docs/use/clients/");
  });
});
