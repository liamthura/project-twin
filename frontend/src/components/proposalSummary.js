/**
 * What one inbox row says on its single line.
 *
 * A proposal stores only the values being proposed, never the ones on record,
 * so the arrow in `tone -> direct` is not a before and after. It is the
 * identifier and the one other field that carries a value. Entities that
 * declare a parent read the other way round -- `climbing -> bouldering` --
 * because there the parent is the context and the identifier is the thing
 * being proposed.
 */

// Entity names and field keys are snake_case in the schema. A person reads this
// surface, so they get read as words.
export function humanise(key) {
  return String(key ?? "").replace(/_/g, " ");
}

export function renderValue(value) {
  if (Array.isArray(value)) return value.map(humanise).join(", ");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([k, v]) => `${humanise(k)}: ${v}`)
      .join(" · ");
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  return humanise(value);
}

// Present means "worth showing": an empty string, an empty array and a null are
// all fields the agent left alone, and counting them would put `+2 more` on a
// row that is hiding nothing.
function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value === null || value === undefined) return false;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return String(value).trim() !== "";
}

export function findEntitySpec(entity, packs) {
  for (const pack of packs || []) {
    const spec = pack?.entities?.[entity];
    if (spec) return spec;
  }
  return null;
}

export function proposalSummary(row, packs) {
  const data = row?.data || {};
  const entries = Object.entries(data).filter(([, v]) => present(v));
  const spec = findEntitySpec(row?.entity, packs);

  if (!spec?.identifier) {
    // A disabled pack, a renamed entity, a proposal left over from an older
    // schema. Showing the first value keeps the row readable and approvable; a
    // blank one would look broken.
    const [first, ...rest] = entries;
    return { lead: first ? renderValue(first[1]) : "", trail: "", extra: rest.length };
  }

  const { identifier, parent } = spec;
  const lead = present(data[identifier]) ? renderValue(data[identifier]) : "";
  const others = entries.filter(([k]) => k !== identifier && k !== parent);

  if (parent && present(data[parent])) {
    return { lead: renderValue(data[parent]), trail: lead, extra: others.length };
  }
  if (others.length === 1) {
    return { lead, trail: renderValue(others[0][1]), extra: 0 };
  }
  return { lead, trail: "", extra: others.length };
}
