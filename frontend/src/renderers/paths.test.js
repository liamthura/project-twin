// @vitest-environment node
//
// paths.js documents itself as "no React import, no DOM access, no side
// effects", and it imports nothing. Building a jsdom environment for it costs
// roughly 900ms of the suite's time and buys nothing -- measured at 14ms of
// actual test time against ~700ms of environment setup. If this file ever needs
// a DOM, the honest fix is to move that test to a file that renders something.
import { describe, it, expect } from "vitest";
import { getAt, setAt, removeAt, normalizeUi, slugify, outline } from "./paths";

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
  it("writes through an array index without converting the array to an object", () => {
    const before = { list: [1, 2, 3] };
    const after = setAt(before, ["list", 1], 99);
    expect(Array.isArray(after.list)).toBe(true);
    expect(after.list).toEqual([1, 99, 3]);
    expect(before.list).toEqual([1, 2, 3]);
  });
  it("writes a nested path inside an array element, preserving the array and sharing untouched siblings", () => {
    const before = { items: [{ id: 1, notes: "a" }, { id: 2, notes: "b" }] };
    const after = setAt(before, ["items", 0, "notes"], "x");
    expect(Array.isArray(after.items)).toBe(true);
    expect(after.items[0]).toEqual({ id: 1, notes: "x" });
    expect(after.items[1]).toBe(before.items[1]);
  });
  it("creates a missing intermediate as a plain object, never guessing array-ness from a numeric key", () => {
    const result = setAt({}, ["a", 0], 1);
    expect(Array.isArray(result.a)).toBe(false);
    expect(result).toEqual({ a: { 0: 1 } });
  });

  it("throws on a non-index key written onto an array, rather than silently producing a value JSON.stringify drops", () => {
    // Before this fix, setAt(["a"], ["goals"], [1]) returned ["a"] carrying
    // a stray own property "goals" -- Array's own enumerable-key semantics
    // mean JSON.stringify(["a"]) is just `["a"]`, silently dropping it.
    // Unreachable through today's three generic packs (their paths never
    // cross an array), but reachable as soon as a `fields` or `children`
    // path does in waves 4-6.
    expect(() => setAt(["a"], ["goals"], [1])).toThrow(/non-index key/);
  });

  it("throws when the non-index key is \"length\", rather than silently truncating the array", () => {
    expect(() => setAt(["a", "b", "c"], ["length"], 0)).toThrow(/non-index key/);
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
  it("deletes a key inside an array element, preserving the array", () => {
    const before = { items: [{ id: 1, note: "a" }, { id: 2, note: "b" }] };
    const after = removeAt(before, ["items", 0, "note"]);
    expect(Array.isArray(after.items)).toBe(true);
    expect(after.items).toEqual([{ id: 1 }, { id: 2, note: "b" }]);
    expect(after.items[1]).toBe(before.items[1]);
  });
  it("removes an array element itself by splicing (shortening the array, not leaving a hole)", () => {
    const before = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    const after = removeAt(before, ["items", 1]);
    expect(Array.isArray(after.items)).toBe(true);
    expect(after.items).toEqual([{ id: 1 }, { id: 3 }]);
    expect(after.items).toHaveLength(2);
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

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Code Style", 0)).toBe("code-style");
  });
  it("drops ampersands rather than transliterating them", () => {
    expect(slugify("Contact & Links", 0)).toBe("contact-links");
  });
  it("strips apostrophes instead of turning them into separators", () => {
    // "when-i-m-feeling" is what a naive non-alphanumeric replace produces, and
    // it reads as three words where there are two.
    expect(slugify("When I'm feeling...", 0)).toBe("when-im-feeling");
    expect(slugify("When I’m feeling", 0)).toBe("when-im-feeling");
  });
  it("collapses an em dash and its spaces to one hyphen", () => {
    expect(slugify("Sleep — weekdays", 0)).toBe("sleep-weekdays");
  });
  it("strips diacritics rather than dropping the letter", () => {
    expect(slugify("Café Notes", 0)).toBe("cafe-notes");
  });
  it("falls back to the index when nothing slug-worthy survives", () => {
    expect(slugify("...", 3)).toBe("band-3");
    expect(slugify("", 0)).toBe("band-0");
    expect(slugify(undefined, 7)).toBe("band-7");
  });
});

describe("outline", () => {
  it("returns one entry per titled top-level child, whatever its kind", () => {
    const pack = {
      ui: {
        sections: [
          {
            kind: "group",
            path: [],
            title: "Code Style",
            sections: [{ kind: "strings", path: ["a"] }],
          },
          { kind: "list", path: ["likes_dislikes"], title: "Likes & Dislikes" },
        ],
      },
    };
    expect(outline(pack)).toEqual([
      { id: "code-style", label: "Code Style", kind: "group", index: 0 },
      { id: "likes-dislikes", label: "Likes & Dislikes", kind: "list", index: 1 },
    ]);
  });

  it("omits untitled children, and keeps the unfiltered index on the rest", () => {
    // The index is the position among ALL top-level children, so giving the
    // first one a title later does not renumber this one.
    const pack = {
      ui: {
        sections: [
          { kind: "list", path: ["entries"] },
          { kind: "list", path: ["other"], title: "Other" },
        ],
      },
    };
    expect(outline(pack)).toEqual([
      { id: "other", label: "Other", kind: "list", index: 1 },
    ]);
  });

  it("returns nothing for a section whose only child is untitled", () => {
    // learning_log's shape: the Card's own header already names it, so the rail
    // item correctly has no children.
    expect(outline({ ui: { sections: [{ kind: "list", path: ["entries"] }] } })).toEqual([]);
  });

  it("never descends into a group -- a card heading is not a rail destination", () => {
    const pack = {
      ui: {
        sections: [
          {
            kind: "group",
            path: [],
            title: "G",
            sections: [{ kind: "list", path: ["x"], title: "Inner" }],
          },
        ],
      },
    };
    expect(outline(pack).map((b) => b.id)).toEqual(["g"]);
  });

  it("suffixes a duplicate title deterministically, by order", () => {
    const pack = {
      ui: {
        sections: [
          { kind: "list", path: ["a"], title: "Notes" },
          { kind: "list", path: ["b"], title: "Notes" },
          { kind: "list", path: ["c"], title: "Notes" },
        ],
      },
    };
    expect(outline(pack).map((b) => b.id)).toEqual(["notes", "notes-2", "notes-3"]);
  });

  it("returns nothing for a pack with no ui block", () => {
    expect(outline({})).toEqual([]);
  });

  it("reads through normalizeUi, so a legacy flat-map pack works too", () => {
    const pack = {
      entities: { goal: { list: "goals" } },
      ui: { goals: { title_field: "title" } },
    };
    // The legacy branch synthesises nodes with no `title`, so there are no
    // bands -- which matches how those packs render: one untitled main list.
    expect(outline(pack)).toEqual([]);
  });
});
