// Which fields each node would draw, per pack. The point of comparison for "the
// UI did not change": 13 field names in the manifests are declared for MCP and
// rendered by nothing, so a conversion that treated declaration as visibility
// would put about a dozen controls on screen. This is what would catch that.
import { normalizeUi } from "./paths";

export function fieldCensus(pack) {
  const out = {};
  const visit = (nodes, trail) => {
    for (const node of nodes || []) {
      const label = `${trail}${node.title ?? node.path?.join(".") ?? "?"}`;
      if (node.kind === "group") {
        visit(node.sections, `${label} > `);
        continue;
      }
      out[label] = fieldsOf(node);
      visit(node.children, `${label} > `);
    }
  };
  visit(normalizeUi(pack).sections, "");
  return out;
}

// Union of every position a field can appear in, deduped, in the order a reader
// meets them: the form first, then the collapsed row's own affordances.
function fieldsOf(node) {
  const seen = [];
  const add = (names) => {
    for (const n of names || []) if (!seen.includes(n)) seen.push(n);
  };
  add(node.title_field ? [node.title_field] : []);
  add(node.fields);
  add(node.detail_fields);
  add(node.badges);
  add(node.display_fields);
  add(node.count_badges);
  add(node.array_fields);
  return seen;
}
