// @vitest-environment node
//
// fieldMeta.js derives control choices from a pack spec. It imports two modules
// that live in component files, but only for their exported constants -- no
// component is rendered here, so jsdom is dead weight. See paths.test.js.
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

// A descriptor-shaped node -- `node.element.fields` present, which is every node
// in every shipped pack -- takes an entirely different path through
// buildFieldMeta: every value below comes from the field's own descriptor, and
// `entity` is never consulted. These pin that path down the same way the suite
// above pins the old one, field by field rather than by trusting one big
// fixture.
describe("buildFieldMeta with a descriptor-shaped node", () => {
  const node = (fields) => ({ kind: "list", path: ["xs"], element: { entity: "x", identifier: "n", fields } });

  it("takes valid_values from each field's `values`, ignoring the entity entirely", () => {
    const meta = buildFieldMeta(
      node([{ name: "status", type: "enum", values: ["a", "b"] }]),
      { valid_values: { status: ["should", "not", "appear"] } }
    );
    expect(meta.valid_values).toEqual({ status: ["a", "b"] });
  });

  it("takes field_defaults from each field's `default`", () => {
    const meta = buildFieldMeta(node([{ name: "status", default: "a" }]));
    expect(meta.field_defaults).toEqual({ status: "a" });
  });

  it("takes field_placeholders from each field's `placeholder`", () => {
    const meta = buildFieldMeta(node([{ name: "title", placeholder: "Name it" }]));
    expect(meta.field_placeholders).toEqual({ title: "Name it" });
  });

  it("collects long_text as a Set from fields typed `longtext`", () => {
    const meta = buildFieldMeta(node([{ name: "notes", type: "longtext" }]));
    expect(meta.long_text).toBeInstanceOf(Set);
    expect(meta.long_text.has("notes")).toBe(true);
    // Unlike the old path, there is no shared default set to fall back to --
    // a field not typed longtext is simply absent, not a member of
    // LONG_TEXT_FIELDS by name.
    expect(meta.long_text.has("why")).toBe(false);
  });

  it("sorts date, time, bool and strings fields into their own arrays", () => {
    const meta = buildFieldMeta(node([
      { name: "when", type: "date" },
      { name: "at", type: "time" },
      { name: "done", type: "bool" },
      { name: "tags", type: "strings" },
    ]));
    expect(meta.date_fields).toEqual(["when"]);
    expect(meta.time_fields).toEqual(["at"]);
    expect(meta.bool_fields).toEqual(["done"]);
    expect(meta.array_fields).toEqual(["tags"]);
  });

  it("collects allow_custom from the fields that declare it", () => {
    const meta = buildFieldMeta(node([
      { name: "type", type: "enum", values: ["a", "other"], allow_custom: true },
      { name: "status", type: "enum", values: ["a", "b"] },
    ]));
    expect(meta.allow_custom).toEqual(["type"]);
  });

  it("withholds a labelled array field's vocabulary from the parent -- it renders as a child block, not a row control", () => {
    // Same shape as profile.education's `highlights`: a `strings` field with a
    // `label`. It renders as its own titled block under the row rather than as a
    // control inside it (see isBlockField in elementShape.js), and ListRenderer
    // spreads `meta.array_fields` wholesale into its search index -- a leaked
    // entry here would make the parent list search a field it draws no control
    // for.
    const meta = buildFieldMeta(node([
      { name: "highlights", type: "strings", label: "Highlights", placeholder: "e.g. ..." },
    ]));
    expect(meta.array_fields).toEqual([]);
    expect(meta.field_placeholders).toEqual({});
  });

  it("withholds a write_only field and a pinned field, neither of which draws a control", () => {
    const meta = buildFieldMeta(node([
      { name: "hidden", type: "strings", write_only: true },
      { name: "primary", type: "bool", pin: { title: "Primary", empty: "None", noun: "primary" } },
    ]));
    expect(meta.array_fields).toEqual([]);
    expect(meta.bool_fields).toEqual([]);
  });

  it("takes this path over the old one even when the node also carries flat v1 arrays", () => {
    // A node carrying both: the descriptor AND a leftover flat array naming the
    // same field. Nothing produces this shape any more -- the shim that did is
    // deleted -- but an un-migrated `_template` or a hand-built node still can,
    // and the descriptor must win outright rather than the two being merged into
    // a vocabulary neither declares.
    const shimmed = {
      kind: "list", path: ["xs"], entity: "x",
      element: { entity: "x", identifier: "n", fields: [{ name: "status", type: "enum", values: ["fresh"] }] },
      enum: { status: ["stale"] },
    };
    const meta = buildFieldMeta(shimmed, { valid_values: { status: ["stale-entity"] } });
    expect(meta.valid_values).toEqual({ status: ["fresh"] });
  });
});

// DELETED with the shim: "long_text agrees with the pre-conversion v1 render,
// for every shipped field" -- ten `it`s, one per pack, plus a spot-check naming
// the ten fields that used to get their textarea from ScalarField's
// LONG_TEXT_FIELDS name heuristic rather than from a declaration.
//
// It walked `shim-parity.json`, which held both shapes of every shipped node
// side by side, and asserted that `buildFieldMeta(node).long_text.has(field)`
// agreed with the v1 rule -- the node's declared `long_text` if it had one, else
// the notes/why/description heuristic. The fixture and the v1 side of every node
// in it are gone, so there is nothing left to compare against.
//
// What replaced it is `frontend/src/__fixtures__/control-census-v1.json`, which
// freezes the CONTROL each field renders rather than its name, and which records
// all ten of those fields as "longtext": goals.why, goals.notes, Hobbies &
// Activities.notes, Hobbies & Activities > References & URLs.notes,
// Interests.notes, media items.notes, aesthetics Styles.notes, knowledge's two
// References.notes and Projects > References.notes. `controlCensus.test.js`
// compares the real packs against it on every run, so a textarea that quietly
// becomes a one-line input still fails a test -- which is the one thing this
// block was here to guarantee.

