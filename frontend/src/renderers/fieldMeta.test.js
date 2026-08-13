// @vitest-environment node
//
// fieldMeta.js derives control choices from a pack spec. It imports two modules
// that live in component files, but only for their exported constants -- no
// component is rendered here, so jsdom is dead weight. See paths.test.js.
import { describe, expect, it } from "vitest";

import { buildFieldMeta } from "./fieldMeta";

// DELETED: the `describe("buildFieldMeta", ...)` block that used to sit here
// pinned the pre-v2 branch -- a hand-built node with flat arrays
// (`node.enum`, `node.optional`, `node.long_text`, `node.array_fields`,
// `node.date_fields`) and an entity argument it could fall back to or be
// overridden by. Task 10 deleted that branch: nothing in the manifests, in
// `normalizeUi` or in any renderer has produced such a node since the
// v1-parity shim was deleted, so it was dead code exercised only by these
// tests. `buildFieldMeta` no longer takes a second argument at all -- there
// is nothing left inside it that would read one. What replaced every one of
// those cases is the descriptor-path suite below, which was already the
// branch every shipped node took.

// A descriptor-shaped node -- `node.element.fields` present, which is every node
// in every shipped pack, and (as of Task 10) the only shape `buildFieldMeta`
// understands. These pin it down field by field rather than trusting one big
// fixture.
describe("buildFieldMeta", () => {
  const node = (fields) => ({ kind: "list", path: ["xs"], element: { entity: "x", identifier: "n", fields } });

  it("takes valid_values from each field's `values`", () => {
    const meta = buildFieldMeta(node([{ name: "status", type: "enum", values: ["a", "b"] }]));
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

  it("takes fields from `element.fields`, ignoring any leftover flat v1 arrays on the same node", () => {
    // A node carrying both: the descriptor AND a leftover flat array naming the
    // same field. Nothing produces this shape any more -- the shim that did is
    // deleted, and Task 10 deleted the pre-v2 branch that would have read
    // `node.enum` -- but an un-migrated `_template` or a hand-built node still
    // can, and the descriptor must win outright rather than the two being
    // merged into a vocabulary neither declares.
    const shimmed = {
      kind: "list", path: ["xs"], entity: "x",
      element: { entity: "x", identifier: "n", fields: [{ name: "status", type: "enum", values: ["fresh"] }] },
      enum: { status: ["stale"] },
    };
    const meta = buildFieldMeta(shimmed);
    expect(meta.valid_values).toEqual({ status: ["fresh"] });
  });

  it("treats a node with no `element.fields` as having zero fields, rather than falling back to flat arrays", () => {
    // The empty case of the branch Task 10 deleted: there is no second shape
    // to fall back to any more, just an empty field list.
    const meta = buildFieldMeta({});
    expect(meta.valid_values).toEqual({});
    expect(meta.field_defaults).toEqual({});
    expect(meta.array_fields).toEqual([]);
    expect(meta.long_text).toBeInstanceOf(Set);
    expect(meta.long_text.size).toBe(0);
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
