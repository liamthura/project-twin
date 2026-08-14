import { describe, it, expect } from "vitest";
import { findNode, nodeAt } from "./manifestNode";
import packs from "@/__fixtures__/packs.json";

describe("findNode", () => {
  it("finds a node declared at the top level", () => {
    const profile = packs.find((p) => p.key === "profile");
    const node = findNode(profile, []);
    expect(node?.kind).toBe("fields");
    expect(node?.element?.entity).toBe("basic_info");
  });

  it("finds a node nested inside a group", () => {
    // Groups hold their children under `sections`, the same key the top level
    // uses -- not `children`. A walk that only reads the top level misses every
    // one of preferences' real nodes.
    const preferences = packs.find((p) => p.key === "preferences");
    const node = findNode(preferences, ["communication", "default"]);
    expect(node?.kind).toBe("fields");
    expect(node.element.fields.map((f) => f.name)).toEqual([
      "tone",
      "locale",
      "detail_level",
    ]);
  });

  it("finds response_format, which is a strings node inside a group", () => {
    const preferences = packs.find((p) => p.key === "preferences");
    const node = findNode(preferences, ["response_format"]);
    expect(node?.kind).toBe("strings");
    expect(node.control).toBe("input");
  });

  it("returns null for a path no node declares", () => {
    const preferences = packs.find((p) => p.key === "preferences");
    expect(findNode(preferences, ["nonsense"])).toBe(null);
  });

  it("survives a pack with no sections at all", () => {
    expect(findNode({ key: "empty" }, ["anything"])).toBe(null);
    expect(findNode(null, [])).toBe(null);
  });
});

describe("nodeAt", () => {
  it("picks the pack by key first", () => {
    const node = nodeAt(packs, "preferences", ["communication", "default"]);
    expect(node?.element?.entity).toBe("communication_default");
  });

  it("returns null when the pack is absent -- a disabled section", () => {
    expect(nodeAt(packs, "not-a-pack", [])).toBe(null);
    expect(nodeAt(null, "profile", [])).toBe(null);
  });
});
