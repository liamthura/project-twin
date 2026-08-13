// The `meta` object ScalarField reads, resolved once for every node renderer
// that has fields to draw -- ListRenderer (per row) and FieldsRenderer (per
// section). Extracted from ListRenderer when the second caller arrived, so the
// precedence rules below live in one place rather than in two copies that
// drift.
//
// One path: v2 states a field's vocabulary, default and placeholder once, on
// the field itself, in `node.element.fields` -- and nowhere else, which was
// the whole point of the format change. `fromDescriptors` below reads that one
// place, and it is the branch every shipped node takes, and (as of Task 10)
// the only one this file has.
//
// Until Task 10 there was a second branch, for a hand-built v1 node that
// carried the same information as flat arrays on the node itself
// (`node.enum`, `node.long_text`, `node.optional`, `node.bool_fields`, ...),
// with a node-level key winning over the entity's own vocabulary -- which was
// the whole reason ScalarField took a pre-resolved `meta` instead of an
// entity. Nothing in the manifests, in `normalizeUi` or in any renderer had
// produced such a node since the v1-parity shim was deleted (a few commits
// before this one), so the branch was dead: every shipped node already took
// the descriptor path, and the `entity` argument that branch alone consulted
// was never read by the other. Task 10 deleted it along with the node keys
// that fed it. `buildFieldMeta` therefore no longer takes an `entity`
// argument either -- there is nothing left inside it that would read one.
import { SEGMENTED_MAX } from "@/components/controls";
import { isBlockField } from "./elementShape";

export function buildFieldMeta(node) {
  return fromDescriptors(node.element?.fields ?? []);
}

// One field descriptor can describe a control this node does not draw at all: a
// labelled `strings`/`list` field (`{name: "highlights", type: "strings",
// label: "Highlights", ...}`) is lifted into its own titled block under the row
// instead of an inline chip control inside it -- see `isBlockField` and
// `blockNode` in elementShape.js, which own that rule so this file and the
// renderers cannot answer it differently. Such a field's vocabulary, default and
// placeholder belong to the BLOCK, which gets them back through the node
// `blockNode` builds; they must not also reach the parent row's `meta`.
//
// Getting this wrong is not cosmetic: ListRenderer spreads `meta.array_fields`
// wholesale into its search index (`searchFields`), so a leaked "highlights"
// would make profile's Education list search inside a field it renders nowhere
// near the row.
//
// `write_only` and a pinned field are excluded for the same reason -- neither
// renders a control here (write_only renders nowhere at all; a pinned field is
// drawn as the star that claims the slot), so neither should seed one through a
// stray lookup either.
function fromDescriptors(fields) {
  const valid_values = {};
  const field_defaults = {};
  const field_placeholders = {};
  // A Set for the reason documented at ScalarField.jsx:42 -- every reader of
  // `long_text` calls `.has()`, ScalarField's own defensive normalisation
  // included, so building anything else here would just move that work into
  // every caller instead of doing it once.
  const long_text = new Set();
  const date_fields = [];
  const time_fields = [];
  const bool_fields = [];
  const array_fields = [];
  // Which fields earn the free-text overflow box below their enum control.
  // Replaces the `custom_<field>` naming convention `optional` used to carry
  // for this purpose -- see the meta_schema.json `$comment` on `allow_custom`
  // and the comment in ScalarField.jsx where this is read.
  const allow_custom = [];
  // meta_schema.json's `label` promises a title-cased `name` as the DEFAULT,
  // to be overridden only where that reads wrong -- but until now only a block
  // field's own title (`blockNode`, elementShape.js) ever read `label`; a
  // scalar field's was accepted by the schema and then silently dropped on the
  // floor by both renderers, which title-cased `name` unconditionally. Withheld
  // from a block for the same reason its placeholder and default are: a
  // block's `label` is already spoken for as the heading over its own titled
  // control (see fromDescriptors' comment above), so it must not also compete
  // to relabel a parent-row control that field never draws.
  const field_labels = {};

  for (const field of fields) {
    if (field.write_only || field.pin) continue;
    const isChild = isBlockField(field);

    if (!isChild) {
      if ("values" in field) valid_values[field.name] = field.values;
      if ("default" in field) field_defaults[field.name] = field.default;
      if ("placeholder" in field) field_placeholders[field.name] = field.placeholder;
      if (field.label) field_labels[field.name] = field.label;
      if (field.type === "longtext") long_text.add(field.name);
      if (field.type === "date") date_fields.push(field.name);
      if (field.type === "time") time_fields.push(field.name);
      if (field.type === "bool") bool_fields.push(field.name);
      if (field.type === "strings") array_fields.push(field.name);
    }
    if (field.allow_custom) allow_custom.push(field.name);
  }

  return {
    valid_values, field_defaults, field_placeholders, field_labels,
    long_text, date_fields, time_fields, bool_fields, array_fields, allow_custom,
  };
}

// Which fields need the whole row rather than one of the two grid columns.
// Derived from the same `meta`, and shared by every renderer that lays fields
// out in that grid -- a field that wraps in ListRenderer's edit form wraps
// identically in FieldsRenderer, because the column width is the same.
//
// On a 1152px desktop a column is only ~386px wide: 1152 - 32 (page px-4)
// - 192 (tab sidebar) - 24 (gap-6) - 48 (card p-6) - 72 (grid sm:px-9), then
// halved less the 12px gap. A four-option segmented control needs roughly
// 400px, so it wrapped after three options while the column beside it sat
// empty. Giving it the full row is the same treatment long text and array
// inputs already get.
//
// Only segmented enums qualify: more than SEGMENTED_MAX options renders a
// ~170px dropdown instead, which fits a column comfortably. Three or fewer
// options also fit, and stretching those across the row would just leave a
// gap where the neighbouring field used to be.
export function needsFullRow(meta, field) {
  if (meta.long_text.has(field) || meta.array_fields.includes(field)) return true;
  const options = meta.valid_values?.[field];
  return Boolean(options) && options.length > 3 && options.length <= SEGMENTED_MAX;
}
