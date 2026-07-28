// Picks a renderer for one ui node. Extracted from SectionRenderer's inline
// CardContent.map so a node that is NOT a direct child of the section root
// can be dispatched too: wave 4 calls this for `node.children` against a list
// item, where the path resolves against the item rather than the section.
//
// The seam is a plain function, not a component, so a caller can decide where
// its output goes -- inside a Card, inside a row, or nowhere.
//
// A "list" node with no valid `path` array logs loudly and renders nothing,
// rather than silently falling back to an empty, unwritable list -- see the
// guard below. This is one deliberate departure from pure byte-parity with
// the pre-extraction SectionRenderer: previously `node.path.join(".")`
// (computing the React key) threw on a missing path before rendering even
// started. Reproducing "throw" was never the goal, but reproducing "silent"
// would have been worse, so the seam is loud instead of either.
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
  // A "list" node with no valid path is a malformed pack config, not a fresh
  // section -- there is nowhere to write an edit back to, so rendering it
  // anyway (as an empty, unwritable list) would be the same silent-data-loss
  // shape the non-array-value log below exists to prevent. Log loudly,
  // naming the pack and the node, and render nothing rather than a control
  // bound to nowhere.
  if (!Array.isArray(node.path)) {
    console.error(
      `renderNode: list node has no valid path in pack "${packKey}" ` +
        `(node: ${JSON.stringify(node)}) -- rendering nothing`
    );
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
