import { describe, it, expect } from "vitest";
import { getAt, setAt, removeAt, normalizeUi } from "./paths";

describe("getAt", () => {
  it("reads a nested value", () => {
    expect(getAt({ a: { b: { c: 1 } } }, ["a", "b", "c"])).toBe(1);
  });
  it("returns undefined for a missing branch instead of throwing", () => {
    expect(getAt({ a: {} }, ["a", "b", "c"])).toBeUndefined();
    expect(getAt(undefined, ["a"])).toBeUndefined();
  });
  it("returns the object itself for an empty path", () => {
    const o = { a: 1 };
    expect(getAt(o, [])).toBe(o);
  });
});

describe("setAt", () => {
  it("does not mutate its input", () => {
    const before = { a: { b: 1 }, keep: [1, 2] };
    const frozen = structuredClone(before);
    Object.freeze(before);
    Object.freeze(before.a);
    const after = setAt(before, ["a", "b"], 2);
    expect(before).toEqual(frozen);
    expect(after.a.b).toBe(2);
  });
  it("structurally shares branches off the path", () => {
    const before = { a: { b: 1 }, other: { deep: {} } };
    const after = setAt(before, ["a", "b"], 2);
    expect(after.other).toBe(before.other);
  });
  it("creates intermediate objects", () => {
    expect(setAt({}, ["x", "y"], 3)).toEqual({ x: { y: 3 } });
  });
  it("replaces the whole object for an empty path", () => {
    expect(setAt({ a: 1 }, [], { b: 2 })).toEqual({ b: 2 });
  });
});

describe("removeAt", () => {
  it("deletes the key without mutating", () => {
    const before = { a: { b: 1, c: 2 } };
    Object.freeze(before);
    Object.freeze(before.a);
    const after = removeAt(before, ["a", "b"]);
    expect(after).toEqual({ a: { c: 2 } });
    expect(before.a.b).toBe(1);
  });
  it("is a no-op when the path is absent", () => {
    expect(removeAt({ a: 1 }, ["nope", "deep"])).toEqual({ a: 1 });
  });
});

describe("normalizeUi", () => {
  const legacyPack = {
    entities: { goal: { identifier: "title" } },
    ui: { goals: { title_field: "title", badges: ["status"], detail_fields: ["notes"] } },
  };

  it("converts the legacy flat map to a sections array", () => {
    const { sections } = normalizeUi(legacyPack);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      kind: "list",
      path: ["goals"],
      entity: "goal",
      title_field: "title",
      badges: ["status"],
      detail_fields: ["notes"],
    });
  });

  it("resolves the entity by its declared list key", () => {
    const pack = {
      entities: { media_item: { list: "items" }, other: { list: "elsewhere" } },
      ui: { items: { title_field: "title" } },
    };
    expect(normalizeUi(pack).sections[0].entity).toBe("media_item");
  });

  it("passes an explicit sections array through untouched", () => {
    const pack = { entities: {}, ui: { sections: [{ kind: "list", path: ["x"], entity: "e" }] } };
    expect(normalizeUi(pack).sections).toEqual([{ kind: "list", path: ["x"], entity: "e" }]);
  });

  it("returns no sections for a pack without a ui block", () => {
    expect(normalizeUi({ entities: {} }).sections).toEqual([]);
  });
});
