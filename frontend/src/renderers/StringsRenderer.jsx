// A node whose stored value is a bare `string[]` -- lifestyle's `values`,
// `personality_traits`, `wellness.energy_peaks` and `wellness.stress_triggers`;
// preferences' three `code_style` lists and two `learning_style` lists.
//
// There are no per-item fields and, for most of these, no entity at all: what
// is stored is the string, not an object with a key. So unlike ListRenderer
// this takes no `entity` and builds no field meta -- it binds a path's worth of
// strings to ArrayInput, which is the control both retired editors used for
// exactly these keys.
import { ArrayInput } from "@/components/ArrayInput";

// "Values" -> "value", "Personality Traits" -> "personality trait". Only used
// when a node declares no `placeholder`; every node migrated in wave 5 declares
// one, because the editors' concrete examples ("e.g. Python, TypeScript...")
// explain a free-text list far better than a derived label does. The rule is
// deliberately naive -- trailing "s" only -- because it runs on manifest
// titles, which are authored, not on arbitrary input. A title where it reads
// wrong is a signal to write the placeholder out, not to grow a pluralisation
// library.
function derivePlaceholder(node) {
  const label = (node.title ?? "item").toLowerCase().replace(/_/g, " ");
  return `Add ${label.endsWith("s") ? label.slice(0, -1) : label}...`;
}

export function StringsRenderer({ node, items, onItems }) {
  // A path that has never been written reads back as undefined, and a stored
  // value can be any shape an MCP client left behind. Either way this renders
  // an empty, usable list rather than throwing -- ArrayInput would crash on
  // .map/.filter of a non-array.
  const list = Array.isArray(items) ? items : [];

  // `node.description` is deliberately NOT rendered here: SectionRenderer draws
  // it under the node's heading, for every kind. Rendering it in both places
  // showed it twice, and having only this renderer honour it silently dropped
  // the copy on `fields` and `list` nodes that declared one.
  return (
    <ArrayInput
      items={list}
      onChange={onItems}
      placeholder={node.placeholder ?? derivePlaceholder(node)}
    />
  );
}
