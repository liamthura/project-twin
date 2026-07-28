// Picks a renderer for one ui node. Extracted from SectionRenderer's inline
// CardContent.map so a node that is NOT a direct child of the section root
// can be dispatched too: wave 4 calls this for `node.children` against a list
// item, where the path resolves against the item rather than the section.
//
// The seam is a plain function, not a component, so a caller can decide where
// its output goes -- inside a Card, inside a row, or nowhere.
import ListRenderer from "./ListRenderer";

export function renderNode({ node, value, onValue, entities, packKey, onShowConfirmation }) {
  // The kind check runs first, before anything reads node.path -- a node of
  // an unsupported kind is not guaranteed to carry a well-formed path (or any
  // path at all), and the guard exists precisely to make an unsupported node
  // harmless rather than a crash.
  if (node.kind !== "list") {
    console.error(`renderNode: unsupported node kind "${node.kind}" in pack "${packKey}"`);
    return null;
  }
  if (value !== undefined && !Array.isArray(value)) {
    console.error(
      `renderNode: expected an array at path ${JSON.stringify(node.path)} ` +
        `in pack "${packKey}", got ${typeof value} -- rendering as empty`
    );
  }
  return (
    <ListRenderer
      node={node}
      entity={entities?.[node.entity]}
      items={Array.isArray(value) ? value : []}
      onItems={onValue}
      onShowConfirmation={onShowConfirmation}
    />
  );
}
