// @vitest-environment node
//
// fieldMeta.js derives control choices from a pack spec. It imports two modules
// that live in component files, but only for their exported constants -- no
// component is rendered here, so jsdom is dead weight. See paths.test.js.
import { describe, expect, it } from "vitest";

import { buildFieldMeta } from "./fieldMeta";
import { LONG_TEXT_FIELDS } from "./ScalarField";
import { v1Shape } from "./v2Node";
import parity from "@/__fixtures__/shim-parity.json";

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

// A descriptor-shaped node -- `node.element.fields` present, the shape
// v2Node.js's shim now passes through additively -- takes an entirely
// different path through buildFieldMeta: every value below comes from the
// field's own descriptor, and `entity` is never consulted. These pin that
// path down the same way the suite above pins the old one, field by field
// rather than by trusting one big fixture.
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
    // `label`. v1Shape lifts it into `node.children` instead of this node's
    // own row, and ListRenderer spreads `meta.array_fields` wholesale into its
    // search index -- a leaked entry here would make the parent list search a
    // field it draws no control for.
    const meta = buildFieldMeta(node([
      { name: "highlights", type: "strings", label: "Highlights", placeholder: "e.g. ..." },
    ]));
    expect(meta.array_fields).toEqual([]);
    expect(meta.field_placeholders).toEqual({});
  });

  it("withholds a write_only field and a pinned field the same way v1Shape does", () => {
    const meta = buildFieldMeta(node([
      { name: "hidden", type: "strings", write_only: true },
      { name: "primary", type: "bool", pin: { title: "Primary", empty: "None", noun: "primary" } },
    ]));
    expect(meta.array_fields).toEqual([]);
    expect(meta.bool_fields).toEqual([]);
  });

  it("takes this path over the old one even when the node also carries flat v1 arrays", () => {
    // The shape v1Shape actually hands renderers post-shim: both the
    // descriptor and the flat arrays it was expanded into are present on the
    // same node. The descriptor wins outright -- there is one source now --
    // so a stale or mismatched flat array is never consulted.
    const shimmed = {
      kind: "list", path: ["xs"], entity: "x",
      element: { entity: "x", identifier: "n", fields: [{ name: "status", type: "enum", values: ["fresh"] }] },
      enum: { status: ["stale"] },
    };
    const meta = buildFieldMeta(shimmed, { valid_values: { status: ["stale-entity"] } });
    expect(meta.valid_values).toEqual({ status: ["fresh"] });
  });
});

// The regression this section exists to catch: `fromDescriptors` reads
// `long_text` off exactly ONE signal, `type === "longtext"` on the field --
// it deliberately does not re-add ScalarField.jsx's LONG_TEXT_FIELDS name
// fallback (see the comment at the top of this file and at
// `_LONG_TEXT_NAME_HEURISTIC` in backend/tools/manifest_v1_to_v2.py for why a
// name heuristic here would be a second, silently-overriding source of
// truth). That makes this file's correctness depend entirely on the
// CONVERTER having resolved the heuristic into `type: "longtext"` at
// conversion time. Ten shipped fields relied on the v1 fallback and declared
// no `long_text` key at all -- a converter that forgot even one of them
// would silently turn a textarea into a one-line input, and neither the
// frozen field census nor the v2Node parity fixtures would catch it, because
// both record field NAMES, not control types. This walks every real node of
// every real pack (via `shim-parity.json`, the same frozen fixture
// `v2Node.test.js` compares against) and asserts what ScalarField actually
// receives: `buildFieldMeta(node, entity).long_text.has(field)` agrees with
// the pre-conversion v1 rule -- declared `long_text` if the node has one,
// else the notes/why/description heuristic -- for every field the node
// renders.
describe("long_text agrees with the pre-conversion v1 render, for every shipped field", () => {
  const isLongTextV1 = (v1Node, field) =>
    v1Node.long_text
      ? v1Node.long_text.includes(field)
      : ["notes", "why", "description"].includes(field);

  // Recorded rather than assumed, so the "confirm all ten" claim below is
  // checked, not asserted by fiat -- a future pack could add an eleventh
  // heuristic field or remove one of these, and this list would drift out
  // of sync with reality if it were hand-maintained instead of collected.
  const foundLongTextFields = [];

  // Walks the SHIMMED tree, not the raw v2 one -- a nested list/strings field
  // has no separate "v2 form" of its own to re-shim (childNode in v2Node.js
  // already built it in v1 shape), so `shimmed.children`/`shimmed.sections`
  // are what the next level down actually is. This mirrors exactly how
  // v2Node.test.js's own "resolves the same vocabulary..." test recurses.
  function walk(v1Node, shimmed, entities, trail) {
    const label = `${trail}${v1Node.title ?? v1Node.path?.join(".") ?? "?"}`;
    const entity = entities[v1Node.entity] ?? null;
    const meta = buildFieldMeta(shimmed, entity);
    const rendered = [
      v1Node.title_field,
      ...(v1Node.detail_fields ?? v1Node.fields ?? []),
      ...(v1Node.badges ?? []),
      ...(v1Node.display_fields ?? []),
    ].filter(Boolean);

    for (const field of new Set(rendered)) {
      const expected = isLongTextV1(v1Node, field);
      if (expected) foundLongTextFields.push(`${label}.${field}`);
      expect({ field: `${label}.${field}`, longText: meta.long_text.has(field) }).toEqual({
        field: `${label}.${field}`,
        longText: expected,
      });
    }

    const kids = shimmed.children ?? [];
    (v1Node.children ?? []).forEach(
      (child, i) => kids[i] && walk(child, kids[i], entities, `${label} > `)
    );
    const subs = shimmed.sections ?? [];
    (v1Node.sections ?? []).forEach(
      (sub, i) => subs[i] && walk(sub, subs[i], entities, `${label} > `)
    );
  }

  for (const [key, pack] of Object.entries(parity)) {
    it(`draws a textarea for exactly the fields that were textareas before, in ${key}`, () => {
      pack.v1.forEach((node, i) => walk(node, v1Shape(pack.v2[i]), pack.entities, ""));
    });
  }

  it("confirms the ten shipped fields the name heuristic used to cover are still textareas", () => {
    // One assertion per node named in the coordinator's report, so a future
    // regression names exactly which one broke instead of failing the walk
    // above at whichever field happens to iterate first. Not an exhaustive
    // list of every long-text field in every pack -- `foundLongTextFields`
    // also collects the ones that were ALREADY declared via `long_text` in
    // v1 (circle, learning_log, preferences, profile, projects), which never
    // depended on the heuristic and were never at risk from this bug.
    const expected = [
      "goals.why", "goals.notes",
      "Hobbies & Activities.notes",
      "Hobbies & Activities > References & URLs.notes",
      "Interests.notes",
      "items.notes", // media
      "Styles.notes", // aesthetics
      "Skills & Domains > References.notes", // knowledge
      "Mental Tabs > References.notes", // knowledge
      "Projects > References.notes",
    ];
    for (const name of expected) {
      expect(foundLongTextFields, `expected ${name} among the fields found long-text`).toContain(
        name
      );
    }
  });
});
