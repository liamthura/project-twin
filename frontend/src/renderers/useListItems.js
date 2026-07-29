// The list-editing semantics of a `kind: "list"` node, separated from its
// rendering.
//
// This is not a line-count exercise. These five operations carry invariants
// that have nothing to do with the DOM and that every one of them learned the
// hard way:
//
//   - `expanded` is keyed by ARRAY INDEX, so any operation that changes the
//     length of the list has to move those keys with the rows they name. Add
//     prepends and shifts up; remove shifts down. Left alone, a key like
//     {0: true} silently follows the wrong row.
//   - `field_defaults` may carry an unresolved token ("@now") that no control
//     ever rendered, so it has to be resolved AFTER the draft is merged and
//     only where the value is still the untouched token.
//   - `exclusive_fields` means at most one row may hold the flag; setting it
//     anywhere clears it everywhere else.
//   - a scalar edited to "" is a DELETION, but a child node writing an empty
//     array is a value.
//
// Kept as a hook rather than free functions so the two setState callbacks stay
// where the rules that need them are, and testable without rendering anything.
import { setAt } from "./paths";

export function useListItems({
  items,
  onItems,
  titleField,
  fieldDefaults,
  exclusiveFields,
  pinnedField,
  existingTitles,
  setExpanded,
  setQuery,
  onShowConfirmation,
}) {
  const addItem = (base) => {
    // `base` (the dialog draft) already carries the raw field_defaults
    // forward for any field with no control of its own (e.g. a token like
    // "@now" that was never rendered), so resolving `fieldDefaults` alone
    // and spreading `base` on top would let that stale raw token win.
    // Resolve after merging instead -- but only for keys the manifest
    // actually declared as the token AND whose value in the merged item is
    // still that untouched token. A user who types the literal string
    // "@now" into a real control (e.g. the title field) is entering data,
    // not invoking the token, and must not have it silently overwritten.
    const item = { ...fieldDefaults, ...base };
    for (const [k, v] of Object.entries(fieldDefaults)) {
      if (v === "@now" && item[k] === "@now") item[k] = new Date().toISOString();
    }
    if (!item[titleField]) return;
    if (existingTitles.has(item[titleField].toLowerCase())) return;
    onItems([item, ...items]);
    // The new item is prepended, so every previously-stored index shifts up
    // by one. `expanded` is keyed by array index -- left unshifted, a key
    // like {0: true} would now point at the brand-new row instead of the one
    // the user had open, silently collapsing it. Mirrors the shift removeItem
    // already does (down, there; up, here). Deliberately not also seeding an
    // entry for the new row's own index -- the Add dialog already collected
    // its fields, so auto-expanding it would just be noise.
    setExpanded((prev) => {
      const next = {};
      for (const [k, v] of Object.entries(prev)) next[Number(k) + 1] = v;
      return next;
    });
    // A stale query re-filters the newly-added row out of `visible`, so the
    // only sign anything happened is the header count ticking up -- clear it
    // on the path that actually writes, so Add lands the user back on the
    // unfiltered list with the new row on top, rather than looking like it
    // silently failed.
    setQuery("");
  };

  const updateItem = (idx, changes) => {
    const next = [...items];
    next[idx] = { ...next[idx] };
    for (const [field, value] of Object.entries(changes)) {
      if (value === undefined || value === "") delete next[idx][field];
      else next[idx][field] = value;
    }
    for (const field of exclusiveFields) {
      if (changes[field] !== true) continue;
      // Every OTHER row loses the flag. Deleted rather than set false: absent
      // is how a row that never claimed it already looks, so this leaves one
      // shape instead of two that render identically.
      next.forEach((item, i) => {
        if (i !== idx && item && item[field] !== undefined) {
          next[i] = { ...item };
          delete next[i][field];
        }
      });
    }
    onItems(next);
  };

  // Writes `value` at an item-relative `path` inside the item stored at
  // `idx`. `updateItem` above takes a flat field map and cannot reach inside
  // an item, which is exactly what a child node needs. Uses the same
  // immutable setAt the section root uses, so the item is replaced rather
  // than mutated and every sibling key survives by reference.
  //
  // Deliberately NOT reproducing updateItem's delete-on-empty-string rule: a
  // child writes whatever its own renderer produced (for a child list, an
  // array), and an empty array is the honest record of "the user removed the
  // last entry" -- the same thing the section root leaves behind when the
  // last row of a top-level list is deleted. Blanking a scalar inside a child
  // item is the child renderer's own concern and is handled by ITS updateItem.
  const updateItemAt = (idx, path, value) => {
    const next = [...items];
    next[idx] = setAt(next[idx] ?? {}, path, value);
    onItems(next);
  };

  // Claim the pinned slot. Routed through updateItem so the exclusivity rule
  // declared on the entity clears every other row, rather than being
  // reimplemented here and drifting from it.
  const promote = (idx) => updateItem(idx, { [pinnedField]: true });

  const removeItem = (idx) => {
    const doRemove = () => {
      onItems(items.filter((_, i) => i !== idx));
      // `expanded` is keyed by array index, so every index above the removed
      // one now addresses a different item. Shift them down to follow their
      // rows, rather than leaving a stale key pointing at nothing and the
      // shifted-up row falling back to collapsed.
      setExpanded((prev) => {
        const next = {};
        for (const [k, v] of Object.entries(prev)) {
          const i = Number(k);
          if (i < idx) next[i] = v;
          else if (i > idx) next[i - 1] = v;
        }
        return next;
      });
    };
    if (onShowConfirmation) {
      onShowConfirmation(
        `Remove ${items[idx][titleField] || "Untitled entry"}?`,
        "This can't be undone.",
        doRemove
      );
    } else doRemove();
  };

  return { addItem, updateItem, updateItemAt, promote, removeItem };
}
