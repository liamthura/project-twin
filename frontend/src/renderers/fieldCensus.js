// Which fields each node would draw, per pack. The point of comparison for "the
// UI did not change": 13 field names in the manifests are declared for MCP and
// rendered by nothing, so a conversion that treated declaration as visibility
// would put about a dozen controls on screen. This is what would catch that.
//
// Reads the field descriptors, through the same `elementShape` pass the
// renderers read -- so this census cannot bless a node the renderers would draw
// differently, which is the one way a census of a SECOND derivation could go
// wrong. What it deliberately does not check is which CONTROL each of these
// names renders: that is controlCensus.js, added after six fields quietly
// stopped being textareas under a green field-name census.
import { normalizeUi } from "./paths";
import { elementShape, blockNode } from "./elementShape";

export function fieldCensus(pack) {
  const out = {};
  const visit = (nodes, trail) => {
    for (const node of nodes || []) {
      const label = `${trail}${node.title ?? node.path?.join(".") ?? "?"}`;
      if (node.kind === "group") {
        visit(node.sections, `${label} > `);
        continue;
      }
      const shape = elementShape(node);
      out[label] = fieldsOf(shape);
      // A labelled array field renders as its own titled block under the row,
      // which is a node in its own right and gets its own census entry --
      // exactly as v1's `children` did, and under the same label, since the
      // block's title is the field's `label`.
      visit(shape.blocks.map(blockNode), `${label} > `);
    }
  };
  visit(normalizeUi(pack).sections, "");
  return out;
}

// Union of every position a field can appear in, deduped, in the order a reader
// meets them: the form first, then the collapsed row's own affordances.
//
// v1 also unioned in `array_fields`, which no longer has an entry here and needs
// none: it was a second, type-shaped way of naming fields that were already in a
// position (a `strings` field draws its chips in the form), so it could only ever
// have contributed a name for a field with a type but NO position -- which
// renders nothing, and which the schema does not permit outside the `ui_only`
// case. Checked against `field-census-v1.json` rather than reasoned about: the
// frozen record is byte-identical without it.
function fieldsOf(shape) {
  const seen = [];
  const add = (names) => {
    for (const n of names || []) if (!seen.includes(n)) seen.push(n);
  };
  add(shape.titleField ? [shape.titleField] : []);
  add(shape.form);
  add(shape.badges);
  add(shape.row);
  add(shape.count);
  return seen;
}
