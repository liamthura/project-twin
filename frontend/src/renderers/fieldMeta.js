// The `meta` object ScalarField reads, resolved once for every node renderer
// that has fields to draw -- ListRenderer (per row) and FieldsRenderer (per
// section). Extracted from ListRenderer when the second caller arrived, so the
// precedence rules below live in one place rather than in two copies that
// drift.
//
// The rule throughout: a NODE-level key wins over the entity's vocabulary. A
// section whose manifest field names are not its storage keys declares the
// difference on the node, and that override is the whole reason ScalarField
// takes a pre-resolved meta instead of an entity.
import { SEGMENTED_MAX } from "@/components/controls";
import { LONG_TEXT_FIELDS } from "./ScalarField";

export function buildFieldMeta(node, entity) {
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
