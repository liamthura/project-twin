// One pass over a node's field descriptors, in the terms the surfaces that
// render them ask their questions in.
//
// v2 states a field's rendering once, on the field: `{name: "status", type:
// "enum", values: [...], show: ["form", "badge"], default: "current"}`. v1 said
// the same thing by naming `status` in `detail_fields`, in `badges`, in `enum`
// and in `field_defaults` -- four arrays that had to agree, and on
// profile.education did not (the node offered a `status` vocabulary its entity
// never declared, and nothing could say which copy was the intended one). This
// module is what replaced those arrays: one loop, and the only thing consulted
// about a field is the field.
//
// `show` is an ARRAY of POSITIONS rather than a set of booleans because one
// field can hold several at once -- `status` is a badge on the collapsed row and
// a control in the expanded one -- and because order within a position then
// comes from the `fields` array. That is how v2 collapses v1's two independent
// orderings (the `badges` order and the `detail_fields` order) into one: the
// order the descriptors are declared in.
//
// Pure and React-free, like paths.js, so a census can walk a whole pack through
// it without rendering anything. fieldCensus and controlCensus both do.

// Position name -> the key it fills on the shape below. `form` is the one
// position that means something different per kind -- a list's form is its
// expanded row and its Add dialog, a `fields` node IS a form -- but both draw
// the same controls in the same order, which is why one key serves both.
const POSITIONS = {
  form: "form",
  badge: "badges",
  row: "row",
  count: "count",
};

// A field with nothing said about it is an ordinary control in the edit form.
// Named rather than left implicit at the one call site because it is the
// commonest case in every shipped pack: most descriptors declare no `show` at
// all, and reading this file should not require inferring that from an `??`.
const DEFAULT_SHOW = ["form"];

// The two types whose value is a collection, and so the only two a `label` can
// promote out of the row into a titled block of its own. A `text` field with a
// label is still an inline control -- there is nothing there to give a heading.
const BLOCK_TYPES = new Set(["strings", "list"]);

/**
 * Does this descriptor render as its own titled block under the row, rather than
 * as one control inside it?
 *
 * This is v2's replacement for v1's `children`, and the rule is deliberately the
 * label: `topics` (an unlabelled `strings` field on a coursework row) is a chip
 * input in the detail grid, while `highlights` (a LABELLED `strings` field on an
 * education row) is a heading with its own editable rows beneath it. Both store
 * an array of strings at a key on the row; the only difference is whether the
 * manifest gave it a name of its own to sit under.
 *
 * Exported because two other readers need exactly this rule and must not
 * re-answer it: `fieldMeta` withholds a block's vocabulary, default and
 * placeholder from the PARENT's `meta` (they belong to the block), and the block
 * gets them back through `blockNode` below.
 */
export function isBlockField(field) {
  return Boolean(field.label) && BLOCK_TYPES.has(field.type);
}

/**
 * The node a block field renders as.
 *
 * Not a conversion and not a shim: meta_schema.json's `listElement` says a
 * `type: "list"` field and a `kind: "list"` node mean the SAME thing, so an
 * array-valued field named `name` on a row already IS a node of that kind at
 * path `[name]` relative to the row. Projecting it makes that identity
 * executable -- a block gets the whole of ListRenderer or StringsRenderer (add,
 * remove, confirmation, chips-vs-rows, the id-less-row keying) instead of a
 * second, thinner rendering of the same list inside a row.
 *
 * `title` is the field's `label`, which is what earned it the block in the first
 * place. `placeholder` and `control` follow it down because they describe the
 * BLOCK's input rather than anything on the parent row -- education's
 * `highlights` declares `control: "input"` because an achievement is
 * sentence-like, and chips would mean retyping the whole line to fix a typo.
 */
export function blockNode(field) {
  return {
    kind: field.type === "list" ? "list" : "strings",
    path: [field.name],
    title: field.label,
    ...(field.placeholder !== undefined ? { placeholder: field.placeholder } : {}),
    ...(field.control !== undefined ? { control: field.control } : {}),
    // A nested list's `element` carries the descriptors of one member, which is
    // what makes the block a real list. On a `strings` block it says only which
    // MCP entity may write the array -- no renderer reads it, and half the
    // string blocks have none -- so it is carried only when the field has one.
    ...(field.element !== undefined ? { element: field.element } : {}),
  };
}

/**
 * Everything a node's `element.fields` says about WHERE its fields render.
 *
 * Returns storage keys, not descriptors, for every position: the edit grid, the
 * search index, the badges and both censuses address a field by its stored key
 * (`meta` is keyed by it, a row's value is `item[key]`), so handing out
 * descriptors would only push this same lookup into every caller. `blocks` is
 * the exception and holds whole descriptors, because `blockNode` needs the rest
 * of the field to build its node.
 *
 * A node with no `element` yields empty positions rather than throwing: a
 * `strings` node has no named keys inside a bare string to render, and the
 * legacy flat `ui` map builds nodes with no element at all until Task 10 deletes
 * it.
 */
export function elementShape(node) {
  const shape = {
    // The field that names a row: `role: "title"`, which exactly one field per
    // list element carries (loader cross-check 2).
    titleField: undefined,
    // Offered as chips above the list and under the Add dialog's title input.
    // Only the TITLE field's are ever read -- a suggestion is a proposed row,
    // not a proposed value for some other key -- so this is that one list,
    // already resolved. v1 stored a map keyed by field name and looked up
    // `suggestions[title_field]` at three call sites.
    suggestions: [],
    form: [], // controls in the expanded row, and in the Add dialog
    badges: [], // chips on the collapsed row, drawn from the stored value
    row: [], // read-only values, on the collapsed row and in its body
    count: [], // "3 references" chips, for array-valued keys
    blocks: [], // descriptors, not names -- see blockNode
    pinned: undefined,
    formats: {}, // storage key -> `format`, for the read-only positions
    exclusive: [], // at most one row may hold this true
  };

  for (const field of node.element?.fields ?? []) {
    // In the MCP contract and rendered nowhere -- learning_log's
    // `conversation_metadata`, lifestyle's `day_type`. Dropped before every
    // other branch so none of them can put a control on screen for a field the
    // user was never meant to fill in. Thirteen such names exist across the
    // shipped packs, which is what the frozen field census was written to
    // catch.
    if (field.write_only) continue;
    if (field.role === "title") {
      shape.titleField = field.name;
      shape.suggestions = field.suggestions ?? [];
    }
    // Read BEFORE the `pin` branch returns: `primary` is both the pinned flag
    // and the field only one row may hold, and v1 kept that second half on the
    // entity (`exclusive_fields`) as a second copy of something the field
    // already knew. useListItems clears every other row's copy on a write.
    if (field.exclusive) shape.exclusive.push(field.name);

    if (field.pin) {
      // `pin` IS this field's rendering -- the star on every row, plus the one
      // lifted row above the list -- so it takes no position, no control in the
      // edit grid and no entry in the Add dialog. A labelled switch inside a
      // detail grid is a poor way to say "this one is THE one", and a `default`
      // on it would make every added row claim the slot.
      shape.pinned = { field: field.name, ...field.pin };
      continue;
    }

    // A block's `show` is about the ROW, so the two are independent and both
    // apply: `references` is a titled block under the row AND a "3 references"
    // chip on it. The one position it may not take is `form`: the block IS its
    // control, and an inline one beside it would draw a text input over an
    // array. No shipped pack declares `form` on a labelled array -- this is the
    // rule that keeps the next one from having to find that out.
    const isBlock = isBlockField(field);
    if (isBlock) shape.blocks.push(field);

    for (const position of field.show ?? DEFAULT_SHOW) {
      if (isBlock && position === "form") continue;
      const key = POSITIONS[position];
      if (key) shape[key].push(field.name);
    }
    // Display only, and read only for the positions that show a stored value
    // verbatim. Withheld from a block for the same reason its placeholder is:
    // the parent draws no value for it, so a format here would apply to
    // nothing.
    if (!isBlock && field.format !== undefined) shape.formats[field.name] = field.format;
  }

  return shape;
}
