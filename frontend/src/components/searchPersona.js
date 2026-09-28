// Word matches across the whole persona, for the search dialog.
//
// Over the data the app already holds, walked through each section's manifest
// so a result is named the way the editor names it and carries enough to go
// to it: the section, the band (for a form or a plain list) or the entry's id
// (for a list row, which ListRenderer then opens). Case-insensitive substring,
// nothing cleverer: meaning is the server's half of the dialog.
import { getAt, normalizeUi, outline } from "@/renderers/paths";
import { elementShape } from "@/renderers/elementShape";
import { humanise } from "@/components/proposalSummary";

export const SEARCH_LIMIT = 30;
const SKIP = new Set(["id", "last_updated", "added_date", "updated_at", "created_at"]);

// Every string inside a row, nested lists included.
function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) if (!SKIP.has(k)) strings(v, out);
  }
  return out;
}

// About 60 characters around the match, so the reader sees why it matched.
function excerpt(text, q) {
  const at = text.toLowerCase().indexOf(q);
  const start = Math.max(0, at - 25);
  const end = Math.min(text.length, at + q.length + 35);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

const label = (field, fields) => {
  const declared = fields.find((f) => f.name === field)?.label;
  if (declared) return declared;
  const words = humanise(field);
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * [{ key, section, sectionTitle, place, title, snippet, band, entityId }],
 * in pack order, at most SEARCH_LIMIT. `truncated` says whether more matched.
 */
export function searchPersona(packs, packData, query) {
  const q = query.trim().toLowerCase();
  const results = [];
  if (q.length < 2) return { results, truncated: false };
  let truncated = false;
  const push = (r) => {
    if (results.length >= SEARCH_LIMIT) truncated = true;
    else results.push(r);
  };

  for (const pack of packs || []) {
    const blob = packData?.[pack.key];
    if (!blob) continue;
    const bands = new Map(outline(pack).map((b) => [b.index, b.id]));
    const visit = (nodes, band) => {
      (nodes || []).forEach((node, i) => {
        const at = band ?? bands.get(i) ?? null;
        const place = node.title && node.title !== pack.title ? `${pack.title} › ${node.title}` : pack.title;
        const base = { section: pack.key, sectionTitle: pack.title, place, band: at };
        if (node.kind === "group") return visit(node.sections, at);
        const value = getAt(blob, node.path);
        if (node.kind === "list") {
          const titleField = elementShape(node).titleField;
          (Array.isArray(value) ? value : []).forEach((item, n) => {
            const hit = strings(item).find((s) => s.toLowerCase().includes(q));
            if (!hit) return;
            const title = String(item?.[titleField] || "Untitled entry");
            push({
              ...base, key: `${pack.key}:${node.path.join(".")}:${item?.id ?? n}`, title,
              snippet: title.toLowerCase().includes(q) ? null : excerpt(hit, q),
              entityId: item?.id ?? null,
            });
          });
        } else if (node.kind === "strings") {
          (Array.isArray(value) ? value : []).forEach((item, n) => {
            if (typeof item === "string" && item.toLowerCase().includes(q)) {
              push({ ...base, key: `${pack.key}:${node.path.join(".")}:${n}`, title: item, snippet: null, entityId: null });
            }
          });
        } else if (node.kind === "fields") {
          const fields = node.element?.fields || [];
          for (const f of fields) {
            const v = value?.[f.name];
            if (typeof v === "string" && v.toLowerCase().includes(q)) {
              push({
                ...base, key: `${pack.key}:${node.path.join(".")}:${f.name}`,
                title: `${label(f.name, fields)}: ${v.length > 80 ? `${v.slice(0, 77)}…` : v}`,
                snippet: null, entityId: null,
              });
            }
          }
        }
      });
    };
    visit(normalizeUi(pack).sections, null);
  }
  return { results, truncated };
}
