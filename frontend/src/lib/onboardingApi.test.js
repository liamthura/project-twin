import { describe, it, expect, vi, beforeEach } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: apiMock };
});

const { getOnboarding, saveOnboarding } = await import("./onboarding.js");
// The real one: the mock above spreads every actual export and replaces only
// `api`, and mcpUrl derives from getApiBase and localStorage rather than from
// any request.
const { mcpUrl } = await import("./api.js");

beforeEach(() => {
  apiMock.mockReset();
});

describe("getOnboarding", () => {
  it("returns the stored state", async () => {
    apiMock.mockResolvedValue({
      disabled_sections: [],
      onboarding: { dismissed: true, steps: { "about-you": "done" } },
    });
    await expect(getOnboarding()).resolves.toEqual({
      dismissed: true,
      steps: { "about-you": "done" },
    });
  });

  it("defaults when the server sends no onboarding key at all", async () => {
    // A backend that predates the settings change, or a detached instance
    // pointed at an older server. A missing key is not a broken page.
    apiMock.mockResolvedValue({ disabled_sections: [] });
    await expect(getOnboarding()).resolves.toEqual({ dismissed: false, steps: {} });
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
