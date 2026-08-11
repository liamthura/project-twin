// A v2 manifest node, presented in the shape the renderers already read.
//
// This file exists so the format migration and the renderer rewrite are two
// separate, separately-reviewable changes. v2 states a field's properties once,
// on the field ("this is long text, its placeholder is X, it shows as a badge");
// v1 stated them as a dozen parallel arrays and maps hanging off the node
// (`long_text`, `field_placeholders`, `badges`, ...). `v1Shape` rebuilds those
// arrays, so `fieldMeta`, `ListRenderer` and `AddEntryDialog` cannot tell that
// the manifests changed underneath them.
//
// It is temporary by design. Phase B teaches those renderers to read a field
// descriptor directly and deletes this file -- at which point the parallel
// arrays stop existing anywhere, which was the point of the format change.
//
// Nothing here decides anything. Every value comes from the node; if a mapping
// below needed a judgement call, that judgement belongs in the manifest.

// Where a field shows, in v1's vocabulary. The absent case is `["form"]`: a
// field with nothing said about it is an ordinary control in the edit form.
//
// `form` is the one position that depends on the node: a list's form is the
// expanded row and the Add dialog, which v1 called `detail_fields`, while a
// `fields` node IS a form and called the same thing `fields`.
const POSITIONS = {
  badge: "badges",
  row: "display_fields",
  count: "count_badges",
};

// A field's `type` and the v1 array whose members that type. `enum` is absent
// on purpose -- v1 identified those by the presence of a `valid_values` entry,
// not by a list of names.
// The two types whose value is a collection, and so the only two a `label` can
// promote into a block of its own.
const ARRAY_TYPES = new Set(["strings", "list"]);

const TYPE_ARRAYS = {
  strings: "array_fields",
  longtext: "long_text",
  date: "date_fields",
  time: "time_fields",
  bool: "bool_fields",
};

// The per-field maps, as [v2 field key, v1 node key].
const MAPS = [
  ["values", "enum"],
  ["default", "field_defaults"],
  ["placeholder", "field_placeholders"],
  ["suggestions", "suggestions"],
  ["format", "display_formats"],
];

export function v1Shape(node) {
  if (node.kind === "group") {
    return { ...node, sections: (node.sections || []).map(v1Shape) };
  }
  // No `element` means this node is already v1. The shim ships one commit
  // before the manifests convert, and `_template` may lag further, so passing
  // those through untouched is a supported state rather than a fallback.
  if (!node.element) return { ...node };

  const { element, ...rest } = node;
  const out = { ...rest };
  delete out.$comment;

  // Two renames, and that is all a `strings` node needs: its `element` names
  // the entity the array's members write to, which is a fact about the tool
  // contract that no renderer has ever seen.
  if ("search" in out) {
    out.searchable = out.search;
    delete out.search;
  }
  if ("control" in out) {
    out.item_control = out.control;
    delete out.control;
  }
  if (node.kind === "strings") return out;

  out.entity = element.entity;
  const formKey = node.kind === "fields" ? "fields" : "detail_fields";
  return { ...out, ...expandFields(element.fields || [], formKey) };
}

// The descriptors, redistributed into v1's parallel arrays.
//
// One field can contribute to several: `{name: "tags", type: "strings",
// show: ["form", "count"]}` is a member of `detail_fields`, `array_fields` and
// `count_badges`, and that is exactly how v1 spelled it in three places.
function expandFields(fields, formKey) {
  const arrays = {}; // v1 key -> [storage key], built in declaration order
  const maps = {}; // v1 key -> {storage key: value}
  const children = [];
  const out = {};

  const push = (key, name) => {
    (arrays[key] ||= []).push(name);
  };

  for (const field of fields) {
    // `write_only` is the whole reason the census in Task 1 was frozen: these
    // names are in the tool vocabulary and in no rendered position, so a shim
    // that let one through would put a control on screen for a field the user
    // was never meant to fill in.
    if (field.write_only) continue;

    if (field.role === "title") out.title_field = field.name;
    // `pin` IS this field's rendering. v1 named the pinned field in no display
    // array at all -- the star on each row is drawn from `pinned` -- so it
    // takes no position, no type array and no placeholder.
    if (field.pin) {
      out.pinned = { field: field.name, ...field.pin };
      continue;
    }

    // A labelled array draws its own titled block below the row. Its `show` is
    // about the row, so the two are independent and both apply: `references` is
    // a block under the row AND a count chip on it.
    const isChild = Boolean(field.label) && ARRAY_TYPES.has(field.type);
    if (isChild) children.push(childNode(field));

    for (const position of field.show ?? ["form"]) {
      push(position === "form" ? formKey : POSITIONS[position], field.name);
    }
    if (TYPE_ARRAYS[field.type] && !isChild) push(TYPE_ARRAYS[field.type], field.name);

    for (const [from, to] of MAPS) {
      // A child block owns its own placeholder; the parent must not also
      // advertise one for a field it does not draw a control for.
      if (isChild) continue;
      if (from in field) (maps[to] ||= {})[field.name] = field[from];
    }
  }

  // `fields` node only: v1 listed its members by name, in order.
  return { ...out, ...arrays, ...maps, ...(children.length ? { children } : {}) };
}

// A v1 child node, rebuilt from the field that replaced it. `label` becomes the
// block's heading; the nested `element` supplies the entity, and for a list, the
// descriptors of one member.
function childNode(field) {
  const child = { kind: field.type === "list" ? "list" : "strings", path: [field.name] };
  // Only a nested LIST carries its entity onto the node: renderNode hands
  // `entities[node.entity]` to ListRenderer, which needs it for the enum and
  // default fallbacks. StringsRenderer takes no entity and v1's strings
  // children named none -- and half of them have no entity to name, because a
  // bare array on a parent row is written by the parent's own update.
  if (field.type === "list") child.entity = field.element.entity;
  child.title = field.label;
  if (field.placeholder !== undefined) child.placeholder = field.placeholder;
  if (field.control !== undefined) child.item_control = field.control;
  if (field.type === "list") {
    return { ...child, ...expandFields(field.element.fields || [], "detail_fields") };
  }
  return child;
}
