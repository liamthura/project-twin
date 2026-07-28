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
