// @vitest-environment node
import { describe, it, expect } from "vitest";
import { SETTINGS_TABS, defaultTab, resolveTab } from "./settingsTabs.js";

describe("the tabs", () => {
  it("are Account, Connections, Sections and Data", () => {
    expect(SETTINGS_TABS.map((t) => t.id)).toEqual(["account", "connections", "sections", "data"]);
  });

  it("open on Account", () => {
    expect(defaultTab()).toBe("account");
  });
});

describe("resolveTab", () => {
  it("sends the old Tokens and Connected apps ids to Connections", () => {
    expect(resolveTab("tokens")).toBe("connections");
    expect(resolveTab("apps")).toBe("connections");
  });

  it("sends the old Server id to Data, where the server now lives", () => {
    expect(resolveTab("server")).toBe("data");
  });

  it("opens the default for anything it does not know, and for nothing", () => {
    expect(resolveTab("nope")).toBe("account");
    expect(resolveTab(null)).toBe("account");
  });

  it("passes current ids straight through", () => {
    expect(resolveTab("sections")).toBe("sections");
  });
});
