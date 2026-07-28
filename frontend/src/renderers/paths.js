// Pure, framework-free helpers for reading/writing nested data by array path,
// plus a normaliser that turns a pack's `ui` block (old flat map or new
// explicit sections array) into a uniform `{ sections: [...] }` shape.
//
// No React import, no DOM access, no side effects. Later renderer waves
// depend on that purity, so keep it that way.

/**
 * Reads the value at `path` inside `obj`. Returns `undefined` if any
 * intermediate segment is missing or not traversable. Never throws.
 */
export function getAt(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * Returns a new object/value with `value` placed at `path`, creating any
 * missing intermediate objects along the way. Everything off the path is
 * shared by reference with the input (no deep clone). Never mutates `obj`.
 */
export function setAt(obj, path, value) {
  if (path.length === 0) return value;
  const [key, ...rest] = path;
  const base = obj && typeof obj === "object" ? obj : {};
  return { ...base, [key]: setAt(base[key], rest, value) };
}

/**
 * Returns a new object with the key at `path` deleted. A no-op (returns
 * `obj` unchanged) if any segment along the path is absent. Never mutates.
 */
export function removeAt(obj, path) {
  if (path.length === 0) return obj;
  if (obj == null || typeof obj !== "object") return obj;
  const [key, ...rest] = path;
  if (!(key in obj)) return obj;
  if (rest.length === 0) {
    const next = { ...obj };
    delete next[key];
    return next;
  }
  return { ...obj, [key]: removeAt(obj[key], rest) };
}

/**
 * Normalises a pack's `ui` block into `{ sections: [...] }`.
 *
 * Accepts:
 * - The new explicit form: `ui.sections` is already an array — passed
 *   through unchanged.
 * - The legacy flat map: `ui` is `{ [listKey]: uiSpec }`. Each entry becomes
 *   `{ kind: "list", path: [listKey], entity: <resolved>, ...uiSpec }`.
 * - No `ui` block at all: returns `{ sections: [] }`.
 *
 * Entity resolution for the legacy map reproduces GenericSectionEditor.jsx's
 * behaviour exactly: prefer the entity whose declared `list` equals the
 * key; if none matches and the pack has exactly one entity, fall back to
 * it; otherwise the section is skipped (no entity to bind it to).
 */
export function normalizeUi(pack) {
  const ui = pack?.ui;
  if (!ui) return { sections: [] };
  if (Array.isArray(ui.sections)) return { sections: ui.sections };

  const entities = pack.entities || {};
  const entityByList = {};
  for (const [entityName, espec] of Object.entries(entities)) {
    if (espec.list) entityByList[espec.list] = entityName;
  }
  const entityNames = Object.keys(entities);

  const sections = [];
  for (const [listKey, uiSpec] of Object.entries(ui)) {
    const entity =
      entityByList[listKey] ?? (entityNames.length === 1 ? entityNames[0] : undefined);
    if (entity === undefined) continue;
    sections.push({ kind: "list", path: [listKey], entity, ...uiSpec });
  }
  return { sections };
}
