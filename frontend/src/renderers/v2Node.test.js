// @vitest-environment node
import { describe, expect, it } from "vitest";
import parity from "@/__fixtures__/shim-parity.json";
import { v1Shape } from "./v2Node";

// A v2 `list` node with one of everything, so each mapping below reads as a
// single claim instead of a diff.
const KITCHEN_SINK = {
  kind: "list",
  path: ["things"],
  title: "Things",
  search: true,
  facets: ["status"],
  sort: { field: "when", dir: "desc" },
  element: {
    entity: "thing",
    identifier: "name",
    actions: ["add", "update", "remove"],
    description: "an MCP-facing sentence the UI must never show",
    fields: [
      { name: "name", role: "title", required: true, placeholder: "Name it",
        suggestions: ["Alpha", "Beta"] },
      { name: "notes", type: "longtext", placeholder: "Longer..." },
      { name: "status", type: "enum", values: ["a", "b"], default: "a",
        show: ["form", "badge"], off_contract: ["values", "default"] },
      { name: "when", type: "date", show: ["row"], format: "datetime" },
      { name: "done", type: "bool" },
      { name: "at", type: "time" },
      { name: "tags", type: "strings", show: ["form", "count"],
        element: { entity: "thing_tag", identifier: "tag", parent: "thing_name" } },
      { name: "hidden", write_only: true },
    ],
  },
};

describe("v1Shape", () => {
  const shimmed = v1Shape(KITCHEN_SINK);

  it("hoists the element's entity onto the node, and leaves its prose behind", () => {
    // renderNode does `entities?.[node.entity]`, so the name has to be here.
    expect(shimmed.entity).toBe("thing");
    // `element.description` is the MCP contract's sentence. SectionRenderer
    // draws `node.description`, so leaking it would put tool-facing copy on
    // screen -- the exact collision that put `element` on `fields` nodes.
    expect(shimmed.description).toBeUndefined();
    // Task 8 turns the shim additive: fieldMeta.buildFieldMeta reads
    // `element.fields` directly for a descriptor-shaped node, so it has to
    // survive the shim rather than being deleted alongside `description`.
    expect(shimmed.element).toBe(KITCHEN_SINK.element);
  });

  it("renames search to searchable and passes the rest of the node through", () => {
    expect(shimmed.searchable).toBe(true);
    expect(shimmed.search).toBeUndefined();
    expect(shimmed.kind).toBe("list");
    expect(shimmed.path).toEqual(["things"]);
    expect(shimmed.title).toBe("Things");
    expect(shimmed.facets).toEqual(["status"]);
    expect(shimmed.sort).toEqual({ field: "when", dir: "desc" });
  });

  it("takes title_field from role, not from the identifier", () => {
    expect(shimmed.title_field).toBe("name");
  });

  it("splits show into the four position arrays", () => {
    // `form` is the default, so every field without a `show` lands in the form.
    expect(shimmed.detail_fields).toEqual(["name", "notes", "status", "done", "at", "tags"]);
    expect(shimmed.badges).toEqual(["status"]);
    expect(shimmed.display_fields).toEqual(["when"]);
    expect(shimmed.count_badges).toEqual(["tags"]);
  });

  it("groups the fields by type into the arrays each control keys off", () => {
    expect(shimmed.array_fields).toEqual(["tags"]);
    expect(shimmed.long_text).toEqual(["notes"]);
    expect(shimmed.date_fields).toEqual(["when"]);
    expect(shimmed.time_fields).toEqual(["at"]);
    expect(shimmed.bool_fields).toEqual(["done"]);
  });

  it("collects the per-field maps by storage key", () => {
    expect(shimmed.enum).toEqual({ status: ["a", "b"] });
    expect(shimmed.field_defaults).toEqual({ status: "a" });
    expect(shimmed.field_placeholders).toEqual({ name: "Name it", notes: "Longer..." });
    expect(shimmed.suggestions).toEqual({ name: ["Alpha", "Beta"] });
    expect(shimmed.display_formats).toEqual({ when: "datetime" });
  });

  it("omits a write_only field from every rendered position", () => {
    const everywhere = [
      shimmed.detail_fields, shimmed.badges, shimmed.display_fields,
      shimmed.count_badges, shimmed.array_fields,
    ].flat();
    expect(everywhere).not.toContain("hidden");
    expect(shimmed.field_placeholders).not.toHaveProperty("hidden");
  });

  it("omits an empty array rather than shipping one", () => {
    // ListRenderer reads `node.badges || []`, so [] and absent behave alike --
    // but the parity gate below compares against manifests that simply have no
    // key, and a shim that invents `badges: []` everywhere would fail it.
    const element = { entity: "x", identifier: "n", fields: [{ name: "n", role: "title" }] };
    const bare = v1Shape({ kind: "list", path: ["xs"], element });
    expect(bare).toEqual({
      kind: "list", path: ["xs"], entity: "x",
      title_field: "n", detail_fields: ["n"],
      // The shim is additive now (Task 8): `element` rides along unchanged
      // beside the arrays this test is actually about, rather than being
      // deleted.
      element,
    });
  });

  it("turns a labelled array field back into a child node", () => {
    const parent = v1Shape({
      kind: "list", path: ["entries"],
      element: {
        entity: "entry", identifier: "topic",
        fields: [
          { name: "topic", role: "title" },
          { name: "decisions", type: "strings", label: "Key Decisions", show: [],
            placeholder: "One per line", control: "input",
            element: { entity: "decision", identifier: "decision", parent: "entry_topic" } },
          { name: "refs", type: "list", label: "References", show: ["count"],
            element: {
              entity: "ref", identifier: "name", parent: "entry_topic",
              fields: [{ name: "name", role: "title" }, { name: "url" }],
            } },
        ],
      },
    });
    expect(parent.children).toEqual([
      // No `entity`: StringsRenderer takes none, and v1's strings children named
      // none. Half of them have no entity to name at all -- a bare array on a
      // parent row is written by the parent's own update, not by a tool of its own.
      {
        kind: "strings", path: ["decisions"],
        title: "Key Decisions", placeholder: "One per line", item_control: "input",
      },
      {
        kind: "list", path: ["refs"], entity: "ref", title: "References",
        title_field: "name", detail_fields: ["name", "url"],
      },
    ]);
    // The block and the row are independent: `show: []` keeps `decisions` out of
    // the form, `show: ["count"]` still earns `refs` its chip. Neither joins
    // `array_fields` -- that array is the inline chips control, which is the
    // other way a v1 node could render a string array, and a block is not it.
    expect(parent.detail_fields).toEqual(["topic"]);
    expect(parent.array_fields).toBeUndefined();
    expect(parent.count_badges).toEqual(["refs"]);
  });

  it("hoists a fields node's element the same way, and recurses through a group", () => {
    const element = {
      entity: "sleep", identifier: "day_type",
      fields: [{ name: "bedtime", type: "time" }, { name: "wakeup", type: "time" }],
    };
    const group = v1Shape({
      kind: "group",
      title: "Wellness",
      sections: [{ kind: "fields", path: ["sleep"], title: "Sleep", element }],
    });
    expect(group.sections[0]).toEqual({
      kind: "fields", path: ["sleep"], title: "Sleep", entity: "sleep",
      fields: ["bedtime", "wakeup"], time_fields: ["bedtime", "wakeup"],
      // Additive, same as above: fieldMeta needs this node's `element` intact.
      element,
    });
  });

  it("leaves a v1 node exactly as it found it", () => {
    // The shim lands before the packs convert, so for one commit every node
    // reaching it is still v1.
    const v1 = {
      kind: "list", path: ["goals"], entity: "goal", title: "Goals",
      title_field: "title", detail_fields: ["title", "status"], searchable: true,
    };
    expect(v1Shape(v1)).toEqual(v1);
    expect(v1Shape(v1)).not.toBe(v1); // ...but never handed back by reference
  });
});

describe("the shim's parity with what shipped", () => {
  // The whole point of Task 5: every node of every pack, converted and shimmed,
  // against the v1 node the renderers read today. `shim-parity.json` freezes
  // both sides, so this compares the shim to what shipped and not to itself.
  //
  // Six keys are normalised away first, each because the renderers cannot tell
  // the difference -- and three, `enum`/`field_defaults`/`long_text`, are
  // compared separately and more strictly below.
  const IGNORED = new Set([
    "$comment", // authoring prose, read by nobody
    // Backend-only: v1's cross-check used it to excuse a field the entity did
    // not declare. Nothing in frontend/src reads it.
    "fields_outside_entity",
    // Compared as EFFECTIVE values below rather than structurally. v1 let a node
    // restate its entity's vocabulary or defaults; v2 states each once, on the
    // field, so which of the two places held a given key is exactly the
    // duplication being removed.
    "enum",
    "field_defaults",
    // The shim is additive now (Task 8): v1 never had this key, and the v2
    // side always does, so a structural diff would fail on presence alone
    // for every node in every pack. `element`'s own contents (vocabulary,
    // defaults, placeholders) are exactly what `enum`/`field_defaults` above
    // already compare as effective values in the test below.
    "element",
    // Also EFFECTIVE, not structural, and for the same reason as `enum` --
    // except here the two sides can name the SAME field and still disagree on
    // paper: ten v1 nodes render a textarea for `notes`/`why`/`description`
    // via ScalarField.jsx's LONG_TEXT_FIELDS fallback while declaring no
    // `long_text` key at all, so the converter now states `type: "longtext"`
    // on those fields outright (see `_LONG_TEXT_NAME_HEURISTIC` in
    // manifest_v1_to_v2.py) and the shimmed v2 side carries a `long_text` key
    // the v1 side never had. Structurally that is a diff; on screen it is the
    // same textarea it always was, which is exactly what the effective check
    // below asserts instead.
    "long_text",
  ]);

  // v1 named the title field in `detail_fields` in some packs and not others,
  // and ListRenderer prepends it either way -- see its comment at the
  // `bodyEditFields` line, which names goals, media and aesthetics as the three
  // that omitted it. So its presence in the form array is not observable; its
  // position among the REST of the form still is, and still compared.
  const withoutTitle = (node) => {
    const key = "detail_fields" in node ? "detail_fields" : "fields";
    if (!node[key] || !node.title_field) return node;
    return { ...node, [key]: node[key].filter((f) => f !== node.title_field) };
  };

  // The single rendered difference in the whole conversion, and the only reason
  // this comparison is not byte-exact. v1's Education node stacked its blocks
  // Highlights-then-Coursework and chipped its counts Coursework-then-Highlights;
  // one v2 field list cannot hold both orders, and the blocks won (see
  // `_ORDER_CONFLICTS` in the converter). So those two chips swap. Compared as a
  // set here; the swap itself is asserted outright below.
  const ORDER_YIELDS = { Education: "count_badges" };

  const strip = (node) =>
    Object.fromEntries(
      Object.entries(withoutTitle(node))
        .map(([k, v]) =>
          ORDER_YIELDS[node.title] === k ? [k, [...v].sort()] : [k, v]
        )
        // `badges: []` in _template and an absent `badges` are the same thing to
        // every reader (`node.badges || []`), and the shim ships the absence.
        .filter(([k, v]) => !IGNORED.has(k) && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => [k, k === "children" || k === "sections" ? v.map(strip) : v])
    );

  for (const [key, pack] of Object.entries(parity)) {
    it(`reproduces every ${key} node`, () => {
      expect(pack.v2.map(v1Shape).map(strip)).toEqual(pack.v1.map(strip));
    });

    it(`resolves the same vocabulary, defaults and long-text control for every ${key} field`, () => {
      // The precedence `fieldMeta` and `ListRenderer` apply: a node-level key
      // replaces the entity's outright. What has to hold is that every field a
      // control is drawn for resolves to the same options and the same seeded
      // default as before -- not that the value was written in the same place.
      const walk = (v1Node, shimmed) => {
        const entity = pack.entities[v1Node.entity] ?? {};
        const rendered = [
          shimmed.title_field,
          ...(shimmed.detail_fields ?? shimmed.fields ?? []),
          ...(shimmed.badges ?? []),
          ...(shimmed.display_fields ?? []),
        ].filter(Boolean);
        for (const field of new Set(rendered)) {
          expect({ field, values: (shimmed.enum ?? {})[field] }).toEqual({
            field,
            values: (v1Node.enum ?? entity.valid_values ?? {})[field],
          });
          expect({ field, default: (shimmed.field_defaults ?? {})[field] }).toEqual({
            field,
            default: (v1Node.field_defaults ?? entity.field_defaults ?? {})[field],
          });
          // Same shape as the two above, but the v1 side of the comparison is
          // ScalarField.jsx's OWN fallback rule rather than a second declared
          // value: `node.long_text ? new Set(node.long_text) : LONG_TEXT_FIELDS`.
          // A v1 node that declares `long_text` (even `[]`) uses ONLY that list;
          // one that declares nothing gets the name heuristic. The v2 side
          // never has a heuristic to fall back on -- the converter already
          // resolved it into `type: "longtext"` -- so this is the check that
          // catches a converter regression on exactly the ten fields that
          // motivated `_LONG_TEXT_NAME_HEURISTIC`.
          const isLongTextV1 = v1Node.long_text
            ? v1Node.long_text.includes(field)
            : ["notes", "why", "description"].includes(field);
          expect({ field, longText: (shimmed.long_text ?? []).includes(field) }).toEqual({
            field,
            longText: isLongTextV1,
          });
        }
        const kids = shimmed.children ?? [];
        (v1Node.children ?? []).forEach((child, i) => kids[i] && walk(child, kids[i]));
        const subs = shimmed.sections ?? [];
        (v1Node.sections ?? []).forEach((sub, i) => subs[i] && walk(sub, subs[i]));
      };
      pack.v1.forEach((node, i) => walk(node, v1Shape(pack.v2[i])));
    });
  }

  it("swaps Education's two count chips, and changes nothing else on screen", () => {
    const education = parity.profile.v2.map(v1Shape).find((n) => n.title === "Education");
    // Was ["coursework", "highlights"]. Now the field order decides, and the
    // field order is the one the blocks under the row need.
    expect(education.count_badges).toEqual(["highlights", "coursework"]);
    expect(education.children.map((c) => c.title)).toEqual([
      "Highlights",
      "Coursework / Modules",
      "Clubs & Societies",
    ]);
  });
});
