import { describe, expect, it } from "vitest";

import { buildFieldMeta } from "./fieldMeta";
import { LONG_TEXT_FIELDS } from "./ScalarField";

// Every assertion here pins a precedence rule that already shipped in
// ListRenderer. The point of the extraction is that FieldsRenderer resolves
// these identically -- so a change that "simplifies" one of these rules must
// break a test here rather than silently diverge one renderer from the other.
describe("buildFieldMeta", () => {
  describe("valid_values", () => {
    it("comes from the entity when the node declares no enum", () => {
      const meta = buildFieldMeta({}, { valid_values: { status: ["a", "b"] } });
      expect(meta.valid_values).toEqual({ status: ["a", "b"] });
    });

    it("takes a node-level enum over the entity's", () => {
      const meta = buildFieldMeta(
        { enum: { status: ["x"] } },
        { valid_values: { status: ["a", "b"] } }
      );
      expect(meta.valid_values).toEqual({ status: ["x"] });
    });

    it("is undefined when neither declares one, so ScalarField falls through", () => {
      expect(buildFieldMeta({}, {}).valid_values).toBeUndefined();
    });
  });

  describe("optional", () => {
    it("takes a node-level list over the entity's", () => {
      const meta = buildFieldMeta({ optional: ["a"] }, { optional: ["b"] });
      expect(meta.optional).toEqual(["a"]);
    });

    it("defaults to an empty array so callers can always spread it", () => {
      expect(buildFieldMeta({}, {}).optional).toEqual([]);
    });

    it("keeps a node's empty list rather than falling through to the entity", () => {
      // ?? not ||: an explicit [] is a real declaration ("this node has no
      // optional fields"), not an absent one. || would silently substitute
      // the entity's list and re-enable custom_* inputs the node turned off.
      expect(buildFieldMeta({ optional: [] }, { optional: ["b"] }).optional).toEqual([]);
    });
  });

  describe("long_text", () => {
    it("falls back to the shared default set", () => {
      expect(buildFieldMeta({}, {}).long_text).toBe(LONG_TEXT_FIELDS);
    });

    it("normalises a node-declared array into a Set", () => {
      // The manifest schema declares long_text as a JSON array; every reader
      // calls .has() on it.
      const { long_text } = buildFieldMeta({ long_text: ["summary"] }, {});
      expect(long_text).toBeInstanceOf(Set);
      expect(long_text.has("summary")).toBe(true);
    });

    it("replaces the default set rather than adding to it", () => {
      const { long_text } = buildFieldMeta({ long_text: ["summary"] }, {});
      expect(long_text.has("notes")).toBe(false);
    });
  });

  describe("array_fields and date_fields", () => {
    it("passes both through from the node", () => {
      const meta = buildFieldMeta({ array_fields: ["tags"], date_fields: ["due"] }, {});
      expect(meta.array_fields).toEqual(["tags"]);
      expect(meta.date_fields).toEqual(["due"]);
    });

    it("defaults both to empty arrays", () => {
      const meta = buildFieldMeta({}, {});
      expect(meta.array_fields).toEqual([]);
      expect(meta.date_fields).toEqual([]);
    });

    it("never reads either from the entity", () => {
      // Both are presentation choices, not vocabulary. An entity that happens
      // to carry these keys must not turn a plain input into a date picker.
      const meta = buildFieldMeta({}, { array_fields: ["tags"], date_fields: ["due"] });
      expect(meta.array_fields).toEqual([]);
      expect(meta.date_fields).toEqual([]);
    });
  });

  it("survives a null entity, which is what a node with no `entity` gets", () => {
    const meta = buildFieldMeta({}, null);
    expect(meta.valid_values).toBeUndefined();
    expect(meta.optional).toEqual([]);
  });
});
