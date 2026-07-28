// Pure derived-state pipeline for ListRenderer: the sort comparator and the
// search matcher. Extracted verbatim from ListRenderer.jsx so both are
// directly testable without rendering -- see listPipeline.test.js.

// Display order only. The indexes are sorted, never the array, because
// updateItem/removeItem address the real stored position -- sorting a copy and
// handing them display positions would edit the wrong row.
export function buildOrder(items, sort) {
  const order = items.map((_, i) => i);
  if (sort?.field) {
    const { field, dir = "asc" } = sort;
    const sign = dir === "desc" ? -1 : 1;
    // An empty string looks blank to the user exactly like a missing key
    // does, so both must be treated as absent -- otherwise "" (not == null)
    // falls through to the localeCompare branch, where it sorts before any
    // non-empty string on an ascending list instead of trailing like a
    // missing key does.
    const missing = (v) => v == null || v === "";
    order.sort((a, b) => {
      const av = items[a]?.[field];
      const bv = items[b]?.[field];
      // A missing (or blank) key sorts last in both directions: an undated
      // row is not "oldest", it is unknown, and dropping it off the top of a
      // desc list would hide it.
      if (missing(av) && missing(bv)) return 0;
      if (missing(av)) return 1;
      if (missing(bv)) return -1;
      // Two real numbers compare numerically (so 2 sorts before 10); every
      // other case -- including numeric strings like "10" -- compares as
      // text, since JSON gives no signal that a string was meant as a number.
      if (typeof av === "number" && typeof bv === "number") return sign * (av - bv);
      return sign * String(av).localeCompare(String(bv));
    });
  }
  return order;
}

// Display filter only, applied after sorting -- like `order`, this holds
// stored indexes, never display positions, so updateItem/removeItem still
// address the real row while a filter is active.
// The union of what both deleted editors searched: title, badges, detail
// fields, and every entry of an array field.
export function filterVisible(order, items, query, fields) {
  return !query
    ? order
    : order.filter((i) => {
        const item = items[i];
        return fields.some((f) => {
          const v = item?.[f];
          if (Array.isArray(v)) return v.some((e) => String(e).toLowerCase().includes(query));
          return v != null && String(v).toLowerCase().includes(query);
        });
      });
}

// Display filter only, same contract as filterVisible -- `order` (here,
// already-searched) holds stored indexes in and out. `selected` maps a facet
// field to the one value currently chosen for it, or leaves it absent/
// undefined for "no filter on this field" (the facet's "All" state). A row
// survives only if it matches every active facet -- facets narrow the same
// visible set the search box does, they don't offer alternate results.
//
// Deliberately reads `items[i][field]` rather than trusting some upstream
// enum validation: nothing stops a stored value from being a legacy value no
// longer in the option list (ScalarField/EnumControl call this "legacy" and
// still render it dashed) -- such a row simply matches no facet selection
// other than "All", the same way it would if a user filtered by hand.
export function applyFacets(order, items, facets, selected) {
  if (!facets || facets.length === 0) return order;
  return order.filter((i) => {
    const item = items[i];
    return facets.every((f) => {
      const v = selected?.[f];
      return v === undefined || item?.[f] === v;
    });
  });
}
