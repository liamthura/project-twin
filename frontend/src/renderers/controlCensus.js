// Which CONTROL each field renders, per node, per pack.
//
// Task 1 of the format-v2 migration froze which field NAMES each pack renders,
// and that fixture caught several conversion mistakes. It could not catch one:
// six fields quietly stopped being textareas and became one-line inputs, because
// the old code chose a textarea from a name heuristic (`LONG_TEXT_FIELDS`) that
// the new code, reading a declared `type`, did not reproduce. Every gate stayed
// green -- a census of names cannot see the difference between an <Input> and a
// <Textarea> for the same name.
//
// So this is the missing half of that freeze. It records the CHOICE, not the
// name, for exactly the fields a form draws a control for.
//
// It mirrors ScalarField's branch ORDER rather than its markup, and the order is
// load-bearing: an enum wins over everything, and a field that is both `date`
// and long text renders a picker. Keeping the order here in step with
// ScalarField is the one maintenance cost, and `controlCensus.test.js` renders
// real packs through the real component to prove they still agree.
//
// The value-dependent fallbacks in ScalarField are deliberately NOT modelled: a
// `date` field holding "next spring" renders a text input instead of a picker,
// which is a fact about stored data, not about the manifest. This census
// describes what the manifest asks for.
import { LONG_TEXT_FIELDS } from "./ScalarField";
import { buildFieldMeta } from "./fieldMeta";
import { normalizeUi } from "./paths";

// ScalarField's branches, in the order it tests them.
export function controlFor(meta, field) {
  if (meta.valid_values?.[field]) {
    return (meta.allow_custom || []).includes(field) ||
      (meta.optional || []).includes(`custom_${field}`)
      ? "enum+custom"
      : "enum";
  }
  if ((meta.array_fields || []).includes(field)) return "array";
  if ((meta.bool_fields || []).includes(field)) return "bool";
  if ((meta.time_fields || []).includes(field)) return "time";
  if ((meta.date_fields || []).includes(field)) return "date";
  const longText =
    meta.long_text instanceof Set ? meta.long_text : new Set(meta.long_text ?? []);
  if (longText.has(field)) return "longtext";
  return "text";
}

// Every field a node draws a control for, which is what `meta` is consulted
// about. `title_field` leads because ListRenderer prepends it whether or not the
// node names it in the form -- see the comment at its `bodyEditFields`.
export function controlledFields(node) {
  const names = [
    node.title_field,
    ...(node.detail_fields ?? node.fields ?? []),
    ...(node.badges ?? []),
  ].filter(Boolean);
  return [...new Set(names)];
}

export function controlCensus(pack) {
  const out = {};
  const visit = (nodes, trail) => {
    for (const node of nodes || []) {
      const label = `${trail}${node.title ?? node.path?.join(".") ?? "?"}`;
      if (node.kind === "group") {
        visit(node.sections, `${label} > `);
        continue;
      }
      if (node.kind !== "strings") {
        const meta = buildFieldMeta(node, pack.entities?.[node.entity]);
        out[label] = Object.fromEntries(
          controlledFields(node).map((f) => [f, controlFor(meta, f)])
        );
      }
      visit(node.children, `${label} > `);
    }
  };
  visit(normalizeUi(pack).sections, "");
  return out;
}

export { LONG_TEXT_FIELDS };
