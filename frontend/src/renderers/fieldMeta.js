// The `meta` object ScalarField reads, resolved once for every node renderer
// that has fields to draw -- ListRenderer (per row) and FieldsRenderer (per
// section). Extracted from ListRenderer when the second caller arrived, so the
// precedence rules below live in one place rather than in two copies that
// drift.
//
// Two paths, because two vintages of node describe a field's properties
// differently.
//
// A descriptor-shaped node (`node.element.fields` present) has exactly ONE
// source for everything below: the field's own descriptor. There is no entity to
// fall back to and no node-level override to prefer, because v2 states a field's
// vocabulary, default and placeholder once, on the field, and nowhere else --
// the whole point of the format change was deleting the second copy.
// `fromDescriptors` below reads that one place, and it is the branch every
// shipped node takes.
//
// The other branch is for a hand-built v1 node, of which this file's own tests
// construct many, and its precedence still needs documenting: a NODE-level key
// wins over the entity's vocabulary, which is the whole reason ScalarField takes
// a pre-resolved meta instead of an entity. Nothing in the manifests, in
// `normalizeUi` or in any renderer produces such a node any more -- the shim
// that did was deleted with the parallel arrays it rebuilt -- so this branch and
// the node keys that feed it (`enum`, `long_text`, `optional`, `bool_fields`)
// are Task 10's to remove.
import { SEGMENTED_MAX } from "@/components/controls";
import { LONG_TEXT_FIELDS } from "./ScalarField";
import { isBlockField } from "./elementShape";

export function buildFieldMeta(node, entity) {
  if (node.element?.fields) return fromDescriptors(node.element.fields);
  return {
    valid_values: node.enum ?? entity?.valid_values,
    optional: node.optional ?? entity?.optional ?? [],
    array_fields: node.array_fields || [],
    // A node-declared long_text (schema: array of storage keys) takes
    // precedence over the entity-agnostic default set, same as enum and
    // field_defaults -- normalised to a Set once here so every caller and
    // ScalarField's own (defensive) normalising agree on what "long text"
    // means for this node.
    long_text: node.long_text ? new Set(node.long_text) : LONG_TEXT_FIELDS,
    // Opt-in per node rather than inferred from the field name: `period` on
    // profile.education and `bedtime` on lifestyle.sleep read like dates and
    // are not, so a name heuristic would turn free text into a lossy picker.
    date_fields: node.date_fields ?? [],
    time_fields: node.time_fields ?? [],
    bool_fields: node.bool_fields ?? [],
    // Per-field placeholder text. Node-only, with no entity fallback: a
    // placeholder is a presentation choice about one binding, not part of the
    // tool contract -- the same field on two nodes can want different hints.
    field_placeholders: node.field_placeholders ?? {},
  };
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

  for (const field of fields) {
    if (field.write_only || field.pin) continue;
    const isChild = isBlockField(field);

    if (!isChild) {
      if ("values" in field) valid_values[field.name] = field.values;
      if ("default" in field) field_defaults[field.name] = field.default;
      if ("placeholder" in field) field_placeholders[field.name] = field.placeholder;
      if (field.type === "longtext") long_text.add(field.name);
      if (field.type === "date") date_fields.push(field.name);
      if (field.type === "time") time_fields.push(field.name);
      if (field.type === "bool") bool_fields.push(field.name);
      if (field.type === "strings") array_fields.push(field.name);
    }
    if (field.allow_custom) allow_custom.push(field.name);
  }

  return {
    valid_values, field_defaults, field_placeholders,
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
