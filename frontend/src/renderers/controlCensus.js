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
// `controlFor` below mirrors ScalarField's branch ORDER rather than its markup,
// and the order is load-bearing: an enum wins over everything, and a field that
// is both `date` and long text renders a picker. That mirroring is a hand-written
// copy, so it is the one thing here that can rot, and a copy compared only
// against itself proves nothing -- an earlier version of this comment claimed a
// render-based check that did not exist, and a review found it by reversing the
// chain and watching every test stay green.
//
// `controlCensus.render.test.jsx` is the real check: it renders ScalarField,
// reads the control kind back out of the DOM by markup alone, and asserts the two
// agree -- including for metas that match TWO branches at once, which is what
// makes the order observable. No shipped field is ambiguous like that, which is
// why the ambiguous cases have to be constructed.
//
// The value-dependent fallbacks in ScalarField are deliberately NOT modelled: a
// `date` field holding "next spring" renders a text input instead of a picker,
// which is a fact about stored data, not about the manifest. This census
// describes what the manifest asks for.
import { LONG_TEXT_FIELDS } from "./ScalarField";
import { buildFieldMeta } from "./fieldMeta";
import { elementShape, blockNode } from "./elementShape";
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
// about. The title field leads because ListRenderer prepends it whether or not
// it declares the `form` position -- see the comment at its `bodyEditFields`.
// Takes the shape rather than the node so a caller that already has one does not
// pay for a second pass, and so the census can be asked about a block node built
// by `blockNode`.
export function controlledFields(shape) {
  return [...new Set([shape.titleField, ...shape.form, ...shape.badges].filter(Boolean))];
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
      const shape = elementShape(node);
      // A `strings` node stores bare strings, so it has no named keys to draw
      // controls for and no `meta` to consult -- its one presentation choice
      // (chips or rows) is the node's `control`, not a field's.
      if (node.kind !== "strings") {
        const meta = buildFieldMeta(node, pack.entities?.[node.element?.entity]);
        out[label] = Object.fromEntries(
          controlledFields(shape).map((f) => [f, controlFor(meta, f)])
        );
      }
      visit(shape.blocks.map(blockNode), `${label} > `);
    }
  };
  visit(normalizeUi(pack).sections, "");
  return out;
}

export { LONG_TEXT_FIELDS };
