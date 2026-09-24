// @vitest-environment node
import { describe, it, expect } from "vitest";
import { SETTINGS_TABS, defaultTab, resolveTab } from "./settingsTabs.js";

describe("the tabs", () => {
  it("are Account, Connections and Data", () => {
    expect(SETTINGS_TABS.map((t) => t.id)).toEqual(["account", "connections", "data"]);
  });

  it("open on Account", () => {
    expect(defaultTab()).toBe("account");
  });
});

describe("resolveTab", () => {
  it("sends the old Tokens and Connected apps ids to Connections", () => {
    expect(resolveTab("tokens")).toEqual({ tab: "connections", advanced: false });
    expect(resolveTab("apps")).toEqual({ tab: "connections", advanced: false });
  });

  it("opens Data with Advanced expanded for the old Server id", () => {
    expect(resolveTab("server")).toEqual({ tab: "data", advanced: true });
  });

  it("opens the default for anything it does not know, and for nothing", () => {
    expect(resolveTab("nope").tab).toBe("account");
    expect(resolveTab(null).tab).toBe("account");
  });

  it("passes current ids straight through", () => {
    expect(resolveTab("data")).toEqual({ tab: "data", advanced: false });
  });
});
