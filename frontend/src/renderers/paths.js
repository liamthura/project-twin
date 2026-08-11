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
 *
 * Arrays are preserved: writing through an existing array index rebuilds via
 * `slice()` (array semantics) rather than object-spreading the array (which
 * would silently turn it into a plain object keyed by stringified indices).
 * A *missing* intermediate is always created as a plain object, even when the
 * next path segment is numeric — nothing at that point signals the caller
 * intended an array, and a plain object with a `"0"` key is the safer
 * default (see `setAt({}, ["a", 0], 1)` in the tests).
 *
 * A non-index key onto an array (e.g. `"length"`, or any non-numeric key) is
 * rejected rather than silently accepted: `next[key] = ...` on an array
 * accepts *any* key, but a non-index one lands as a stray own property (or,
 * for `"length"`, truncates the array) that `JSON.stringify` — the
 * persistence path — drops or corrupts without a trace. Throwing here turns
 * that into a loud bug at the point of the bad path, not a silent hole in
 * saved data discovered later.
 */
const ARRAY_INDEX = /^\d+$/;

export function setAt(obj, path, value) {
  if (path.length === 0) return value;
  const [key, ...rest] = path;
  if (Array.isArray(obj)) {
    if (!ARRAY_INDEX.test(String(key))) {
      throw new Error(
        `setAt: cannot write non-index key "${key}" onto an array -- arrays only ` +
          `accept numeric index keys (path: ${JSON.stringify(path)})`
      );
    }
    const next = obj.slice();
    next[key] = setAt(obj[key], rest, value);
    return next;
  }
  const base = obj && typeof obj === "object" ? obj : {};
  return { ...base, [key]: setAt(base[key], rest, value) };
}

/**
 * Returns a new object with the key at `path` deleted. A no-op (returns
 * `obj` unchanged) if any segment along the path is absent. Never mutates.
 *
 * Arrays are preserved the same way as `setAt`: writes through an index
 * rebuild via `slice()`. When the *final* path segment lands on an array
 * (i.e. the deletion target is an array element itself), the element is
 * spliced out — the array shortens by one, matching what callers deleting a
 * list item want (`removeAt(data, ["items", idx])`). We deliberately do NOT
 * leave a hole at that index: a hole would read as `undefined` in JS but
 * serialise as `null` in JSON, silently corrupting stored data.
 */
export function removeAt(obj, path) {
  if (path.length === 0) return obj;
  if (obj == null || typeof obj !== "object") return obj;
  const [key, ...rest] = path;
  if (!(key in obj)) return obj;

  if (rest.length === 0) {
    if (Array.isArray(obj)) {
      const next = obj.slice();
      next.splice(key, 1);
      return next;
    }
    const next = { ...obj };
    delete next[key];
    return next;
  }

  if (Array.isArray(obj)) {
    const next = obj.slice();
    next[key] = removeAt(obj[key], rest);
    return next;
  }
  return { ...obj, [key]: removeAt(obj[key], rest) };
}

/**
 * Normalises a pack into `{ sections: [...] }`.
 *
 * A pack declares its nodes at the top level (`pack.sections`), which is
 * every shipped pack and every fixture -- this reads that array and nothing
 * else. Two other shapes used to be accepted here: the `ui.sections`
 * wrapper (the pre-v2 manifests' spelling) and a legacy flat `ui` map
 * (`{ [listKey]: uiSpec }`, resolved to an entity by matching `entity.list`,
 * reproducing GenericSectionEditor.jsx's behaviour). Both are gone as of
 * Task 10 -- no shipped pack used either, and the hand-built test packs that
 * exercised them now use `sections` directly. See paths.test.js.
 */
/**
 * A band id: URL-safe, readable, and derived only here.
 *
 * Apostrophes are removed rather than replaced, so "When I'm feeling" gives
 * `when-im-feeling` and not the three-word-looking `when-i-m-feeling`.
 * Everything else non-alphanumeric collapses to a single hyphen, which is what
 * folds `&`, em dashes and runs of punctuation into one separator. Diacritics
 * are stripped from their base letter rather than dropping the letter itself.
 *
 * `index` is only the fallback for a title that slugifies to nothing -- a
 * heading of pure punctuation. It is never the identity: a sibling index would
 * point silently at the wrong band after any manifest reorder, where a slug
 * fails loudly. See the umbrella spec's routing contract.
 */
export function slugify(title, index) {
  const slug = String(title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `band-${index}`;
}

/**
 * The rail's sub-items for one pack: its TOP-LEVEL children, whatever their
 * kind, in manifest order, untitled ones omitted.
 *
 * Not "groups". `group` nodes carry `path: []`, and the prototype's rail under
 * Preferences lists three groups plus a top-level `list` (Likes & Dislikes). A
 * group renders as an eyebrow band with its cards beneath it; a top-level
 * list/strings/fields node is its own band. Never descends -- a nested title is
 * a heading inside a card, not a rail destination.
 *
 * Manifest-derived rather than registered by the bands themselves, and that is
 * the load-bearing choice: `packs` arrives from /settings before any content
 * mounts, so a cold deep link to #/preferences/communication can render a
 * complete, correctly-marked rail immediately. A registration-based contract is
 * empty until the content is on screen, which is exactly the deep-link case.
 *
 * Pure, like the rest of this file. The observing lives in useScrollSpy.
 */
export function outline(pack) {
  const { sections } = normalizeUi(pack);
  const seen = new Map();
  const bands = [];
  sections.forEach((node, index) => {
    if (!node?.title) return;
    const base = slugify(node.title, index);
    // First occurrence keeps the bare slug; later ones take -2, -3. Iterating in
    // order is what makes it deterministic: the same manifest always yields the
    // same ids.
    const nth = (seen.get(base) || 0) + 1;
    seen.set(base, nth);
    bands.push({
      id: nth === 1 ? base : `${base}-${nth}`,
      label: node.title,
      kind: node.kind,
      // Position among ALL top-level children, not among the titled ones, so
      // giving an untitled sibling a title later does not renumber anyone. For
      // ordering and diagnostics only -- never identity.
      index,
    });
  });
  return bands;
}

export function normalizeUi(pack) {
  return { sections: Array.isArray(pack?.sections) ? pack.sections : [] };
}
