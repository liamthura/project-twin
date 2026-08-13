// How full a `fields` node is, for the count in its card header ("6 of 7").
//
// A count is only meaningful against a denominator, which is why this exists
// for `fields` and for nothing else: the manifest fixes a `fields` node's key
// set, so "6 of 7" says one key is still blank. A `list` or `strings` node has
// nothing to be complete against, and its header carries `+ Add` instead.
//
// `false` and `0` count as FILLED: a switch that is off and a number that is
// zero are both answers, and reporting them as gaps would send the reader back
// to a field they already dealt with. Only absence counts as unfilled.
//
// Pure, and in its own file rather than inside the card, because "what counts
// as filled" is exactly the kind of rule that gets re-answered differently in
// a second place.
import { elementShape } from "./elementShape";

export function fillSummary(node, value) {
  // The same list FieldsRenderer draws, from the same pass: the count is
  // "how many of the controls below are answered", so a denominator that
  // counted anything the card does not render would be a promise the screen
  // cannot keep.
  const fields = node ? elementShape(node).form : [];
  // A path never written reads back as undefined, and an MCP client can leave
  // any shape behind -- FieldsRenderer already renders empty controls for a
  // non-object rather than throwing, so this reports the same emptiness rather
  // than counting the characters of a stray string.
  const stored = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  // Declared keys only. `communication.default` is seeded with a `locale` that
  // predates its node, and objects here are shared with MCP writers that may
  // know keys the manifest does not; counting those would push `filled` past
  // `total`.
  const filled = fields.filter((field) => isFilled(stored[field])).length;
  return { filled, total: fields.length };
}

function isFilled(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
