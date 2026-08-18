// @vitest-environment node
import { describe, it, expect } from "vitest";
import { SETTINGS_TABS, isTabAvailable, defaultTab } from "./settingsTabs.js";

describe("the tabs", () => {
  it("are the prototype's four, plus History and Data", () => {
    expect(SETTINGS_TABS.map((t) => t.id)).toEqual([
      "account",
      "server",
      "tokens",
      "apps",
      "history",
      "data",
    ]);
  });

  it("labels Connected apps in full", () => {
    // The dialog is widened so this does not have to be shortened to "Apps".
    expect(SETTINGS_TABS.find((t) => t.id === "apps").label).toBe("Connected apps");
  });
});

describe("what a signed-out reader can reach", () => {
  it("is Server, and only Server", () => {
    // Server is where you say which instance to talk to and paste a token, so
    // it is the one panel that has to work without a credential.
    const open = SETTINGS_TABS.filter((t) => isTabAvailable(t.id, false)).map(
      (t) => t.id,
    );
    expect(open).toEqual(["server"]);
  });

  it.each(["account", "tokens", "apps", "data"])("closes %s", (id) => {
    expect(isTabAvailable(id, false)).toBe(false);
  });
});

describe("what a signed-in reader can reach", () => {
  it.each(SETTINGS_TABS.map((t) => t.id))("opens %s", (id) => {
    expect(isTabAvailable(id, true)).toBe(true);
  });
});

describe("defaultTab", () => {
  it("is Account with a credential", () => {
    expect(defaultTab(true)).toBe("account");
  });

  it("is Server without one, since it is the only one that would render", () => {
    expect(defaultTab(false)).toBe("server");
  });

  it("never names a tab the same call would then close", () => {
    for (const signedIn of [true, false]) {
      expect(isTabAvailable(defaultTab(signedIn), signedIn)).toBe(true);
    }
  });
});

describe("an id that is not a tab", () => {
  it("is not available in either state", () => {
    expect(isTabAvailable("nonsense", true)).toBe(false);
    expect(isTabAvailable("nonsense", false)).toBe(false);
  });
});
