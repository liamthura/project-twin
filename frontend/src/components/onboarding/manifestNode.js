/**
 * One manifest node, by pack and path.
 *
 * Onboarding renders a handful of specific nodes -- profile's root scalars,
 * preferences' `communication.default` -- rather than a whole section, so it
 * needs to reach into the tree SectionRenderer walks top to bottom.
 *
 * The subtlety, and the reason this is tested rather than inlined: a GROUP node
 * holds its children under `sections`, the same key the pack itself uses for
 * its top level. Nothing in preferences' tree is reachable without recursing
 * through that -- `communication.default`, `response_format` and both
 * `learning_style` lists all sit one level down inside a group.
 *
 * Pure, so it is testable against the real shipped manifests with no DOM.
 */

// `[]` is a real path -- profile's basic_info node addresses the section ROOT.
// So this compares element by element rather than testing truthiness, and an
// empty path matches the node that declares an empty one.
function samePath(a, b) {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((seg, i) => seg === right[i]);
}

export function findNode(pack, path) {
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (!node) continue;
      // A group declares no path of its own; only leaves can match. Checking
      // `node.element` would not be enough -- a `strings` node has no fields
      // but is still a leaf -- so the kind is what decides.
      if (node.kind !== "group" && samePath(node.path, path)) return node;
      const found = walk(node.sections);
      if (found) return found;
    }
    return null;
  };
  return walk(pack?.sections);
}

export function nodeAt(packs, packKey, path) {
  const pack = (packs || []).find((p) => p?.key === packKey);
  return pack ? findNode(pack, path) : null;
}
