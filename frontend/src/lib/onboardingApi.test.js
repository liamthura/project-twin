import { describe, it, expect, vi, beforeEach } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: apiMock };
});

const { getOnboarding, saveOnboarding } = await import("./onboarding.js");

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
