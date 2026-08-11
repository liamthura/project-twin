// Picks a renderer for one ui node. Extracted from SectionRenderer's inline
// CardContent.map so a node that is NOT a direct child of the section root
// can be dispatched too: ListRenderer calls this for a row's own BLOCK fields
// (elementShape.js's `blocks`, projected into nodes by `blockNode`), where the
// path resolves against the row's item rather than the section.
//
// The seam is a plain function, not a component, so a caller can decide where
// its output goes -- inside a Card, inside a row, or nowhere.
//
// The entity is resolved HERE, out of the pack's map, so no renderer has to
// carry the map around: a node names its entity inside its `element` (v1 put the
// name on the node itself, which is why a `fields` node's on-screen description
// and its entity's MCP-facing description collided on one key). Every renderer
// below gets the resolved object or `undefined`. Neither reads a field's
// vocabulary or default from it any more -- `buildFieldMeta` (fieldMeta.js)
// dropped its pre-v2 branch and its `entity` parameter in Task 10, since v2
// states both on the field itself -- but the resolved object is still threaded
// down to `ListRenderer` and `FieldsRenderer` as their own `entity` prop; see
// renderNode.threading.test.jsx, which pins that as backwards compatibility
// independent of what buildFieldMeta happens to do with it.
//
// A node with no valid `path` array logs loudly and renders nothing,
// rather than silently falling back to an empty, unwritable list -- see the
// guard below. This is one deliberate departure from pure byte-parity with
// the pre-extraction SectionRenderer: previously `node.path.join(".")`
// (computing the React key) threw on a missing path before rendering even
// started. Reproducing "throw" was never the goal, but reproducing "silent"
// would have been worse, so the seam is loud instead of either.
import ListRenderer from "./ListRenderer";
import { StringsRenderer } from "./StringsRenderer";
import { FieldsRenderer } from "./FieldsRenderer";

export function renderNode({ node, value, onValue, entities, packKey, onShowConfirmation }) {
  // Every branch below checks its own path rules before reading anything else.
  // A node of an unsupported kind is not guaranteed to carry a well-formed
  // path (or any path at all), so kind is always resolved first -- the guards
  // exist precisely to make a malformed node harmless rather than a crash.
  if (node.kind === "strings") {
    // Same rule as a list: an empty path addresses the CONTAINING object, and
    // setAt returns the new value for a zero-length path -- so the first write
    // would replace the section (or the parent row) with a bare string[].
    // Array.isArray([]) is true, so nothing downstream can catch it.
    if (!Array.isArray(node.path) || node.path.length === 0) {
      console.error(
        `renderNode: strings node has no valid path in pack "${packKey}" ` +
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
    return <StringsRenderer node={node} items={value} onItems={onValue} />;
  }
  if (node.kind === "fields") {
    // Unlike list and strings, an EMPTY path is legitimate here: it addresses
    // the section root, which is what profile's top-level scalars bind. That
    // is safe because FieldsRenderer spreads the object it was handed on every
    // write, so writing to the root updates keys rather than replacing the
    // section. meta_schema.json makes the non-empty-path rule conditional on
    // kind: "list" for exactly this reason.
    if (!Array.isArray(node.path)) {
      console.error(
        `renderNode: fields node has no valid path in pack "${packKey}" ` +
          `(node: ${JSON.stringify(node)}) -- rendering nothing`
      );
      return null;
    }
    return (
      <FieldsRenderer
        node={node}
        entity={entities?.[node.element?.entity]}
        value={value}
        onValue={onValue}
        packKey={packKey}
      />
    );
  }
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
      entity={entities?.[node.element?.entity]}
      entities={entities}
      packKey={packKey}
      items={Array.isArray(value) ? value : []}
      onItems={onValue}
      onShowConfirmation={onShowConfirmation}
    />
  );
}
