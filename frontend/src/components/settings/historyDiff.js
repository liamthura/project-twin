// What restoring a previous version would change, compared with now.
//
// Walked over the section's manifest rather than the raw blobs, so every line
// is named the way the editor names it: a node title, an entry's title, a
// field's label. Entries match by id, which survives across versions; an entry
// without one (a row added and never saved) falls back to its title.
import { getAt, normalizeUi } from "@/renderers/paths";
import { elementShape } from "@/renderers/elementShape";
import { humanise, renderValue } from "@/components/proposalSummary";

// Stamped by the server on every save, so a difference there says nothing
// about what the version held.
const BOOKKEEPING = new Set(["id", "last_updated", "added_date", "updated_at", "created_at"]);

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function label(field, fields) {
  const declared = fields.find((f) => f.name === field)?.label;
  if (declared) return declared;
  const words = humanise(field);
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// A nested list (references, highlights) is summarised by its length: its own
// rows are out of scope for this view.
function show(value) {
  if (Array.isArray(value) && value.some((v) => v && typeof v === "object")) {
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  const text = String(renderValue(value ?? ""));
  if (!text) return "(empty)";
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

// `declared` for a form node: Personal Information sits at the section's root,
// and comparing every key there would list the whole section as its fields.
function fieldChanges(now, then, fields, declared = false) {
  const keys = declared
    ? new Set(fields.map((f) => f.name))
    : new Set([...Object.keys(now || {}), ...Object.keys(then || {})]);
  return [...keys]
    .filter((k) => !BOOKKEEPING.has(k) && !same(now?.[k], then?.[k]))
    .map((k) => ({ field: label(k, fields), from: show(now?.[k]), to: show(then?.[k]) }));
}

function listChanges(node, now, then) {
  const titleField = elementShape(node).titleField;
  const fields = node.element?.fields || [];
  const key = (item) => item?.id ?? item?.[titleField];
  const name = (item) => String(item?.[titleField] ?? "Untitled entry");
  const nowBy = new Map((now || []).map((item) => [key(item), item]));
  const thenBy = new Map((then || []).map((item) => [key(item), item]));
  return {
    back: [...thenBy].filter(([k]) => !nowBy.has(k)).map(([, item]) => name(item)),
    removed: [...nowBy].filter(([k]) => !thenBy.has(k)).map(([, item]) => name(item)),
    changed: [...thenBy]
      .filter(([k]) => nowBy.has(k))
      .map(([k, item]) => ({ name: name(item), fields: fieldChanges(nowBy.get(k), item, fields) }))
      .filter((c) => c.fields.length > 0),
  };
}

/**
 * [{ title, back: [name], removed: [name], changed: [{ name, fields: [{ field,
 * from, to }] }] }], one per manifest node that would change. `from` is now,
 * `to` is after the restore. Empty when the version matches what is there.
 */
export function restoreChanges(pack, current, version) {
  const groups = [];
  const visit = (nodes, groupTitle) => {
    for (const node of nodes || []) {
      if (node.kind === "group") {
        visit(node.sections, node.title);
        continue;
      }
      const now = getAt(current, node.path);
      const then = getAt(version, node.path);
      if (same(now, then)) continue;
      const title = node.title || groupTitle || pack.title;
      let change;
      if (node.kind === "list") {
        change = listChanges(node, now, then);
      } else if (node.kind === "strings") {
        const had = new Set(now || []);
        const will = new Set(then || []);
        change = {
          back: [...will].filter((v) => !had.has(v)).map(String),
          removed: [...had].filter((v) => !will.has(v)).map(String),
          changed: [],
        };
      } else if (node.kind === "fields") {
        const fields = fieldChanges(now, then, node.element?.fields || [], true);
        change = { back: [], removed: [], changed: fields.length ? [{ name: null, fields }] : [] };
      } else {
        change = {
          back: [], removed: [],
          changed: [{ name: null, fields: [{ field: title, from: show(now), to: show(then) }] }],
        };
      }
      if (change.back.length || change.removed.length || change.changed.length) {
        groups.push({ title, ...change });
      }
    }
  };
  visit(normalizeUi(pack).sections);
  return groups;
}
