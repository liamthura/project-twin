// A node whose stored value is a single OBJECT whose named keys are edited in
// place: preferences' `communication.default` (tone / detail_level / locale),
// lifestyle's per-day `wellness.sleep.weekday` and `.weekend` (bedtime /
// wakeup), and -- in wave 6 -- profile's top-level scalars.
//
// No list, no add, no remove: the key set is fixed by the manifest's `fields`.
// That is the whole difference from ListRenderer, and it is why this renderer
// needs no title_field, no search, and no confirmation dialog.
//
// Layout matches ListRenderer's edit form exactly (same two-column grid, same
// full-row rule via needsFullRow) so the same field looks the same wherever it
// is bound.
import { Label } from "@/components/ui/label";

import { ScalarField } from "./ScalarField";
import { buildFieldMeta, needsFullRow } from "./fieldMeta";

// "detail_level" -> "Detail level". Storage keys are snake_case; the label is
// the only place a user sees them, and every migrated pack spells them this
// way already.
function labelFor(field) {
  const words = field.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function FieldsRenderer({ node, entity, value, onValue, packKey }) {
  // A path never written reads back as undefined, and an MCP client can leave
  // any shape behind. Either way this renders empty controls rather than
  // throwing -- and, critically, a non-object is NOT spread into the write
  // below, so a stray string at this path is replaced by a clean object on
  // first edit rather than exploding into indexed character keys.
  const stored = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const meta = buildFieldMeta(node, entity);
  const fields = node.fields ?? [];

  // Every write spreads the CURRENT stored object first, so keys this node
  // does not declare survive the edit. These objects are shared with MCP
  // writers that may know keys the manifest does not -- `communication.default`
  // is seeded with a `locale` that predates this node, and a bare
  // `{ [field]: next }` would delete it on the first keystroke.
  const setField = (field, next) => onValue({ ...stored, [field]: next });

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((field) => {
        const id = `${packKey ?? "section"}-${(node.path ?? []).join("-")}-${field}`;
        return (
          <div
            key={field}
            className={`space-y-1.5 ${needsFullRow(meta, field) ? "sm:col-span-2" : ""}`}
          >
            <Label htmlFor={id} className="text-xs text-muted-foreground">
              {labelFor(field)}
            </Label>
            <ScalarField
              id={id}
              field={field}
              value={stored[field]}
              meta={meta}
              onChange={(next) => setField(field, next)}
            />
          </div>
        );
      })}
    </div>
  );
}
