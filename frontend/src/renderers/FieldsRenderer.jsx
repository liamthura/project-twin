// A node whose stored value is a single OBJECT whose named keys are edited in
// place: preferences' `communication.default` (tone / detail_level / locale),
// lifestyle's per-day `wellness.sleep.weekday` and `.weekend` (bedtime /
// wakeup), and -- in wave 6 -- profile's top-level scalars.
//
// No list, no add, no remove: the key set is fixed by the node's
// `element.fields`. That is the whole difference from ListRenderer, and it is
// why this renderer needs no title field, no search, and no confirmation
// dialog.
//
// Layout matches ListRenderer's edit form exactly (same two-column grid, same
// full-row rule via needsFullRow) so the same field looks the same wherever it
// is bound -- and since v2 they are the same layout read out of the same
// descriptors, rather than the same layout described twice. The two differ only
// in what a `fields` node cannot have: no badges, no title field leading the
// grid, and the label is title-cased rather than CSS-capitalised, because these
// controls sit alone in a card instead of under a row that already names itself.
import { Label } from "@/components/ui/label";

import { ScalarField } from "./ScalarField";
import { buildFieldMeta, needsFullRow } from "./fieldMeta";
import { elementShape } from "./elementShape";

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
  // The `form` position, which for a `fields` node is every field that does not
  // opt out: a node like this IS a form, so `show` is rarely declared on it at
  // all. A field that declares only `write_only` (lifestyle's `day_type`, the
  // router server.py never stores) is already gone by this point -- which is the
  // one thing v1's flat `fields` array could not express, and why
  // test_ui_schema.py had to exclude a whole vocabulary from its check.
  const fields = elementShape(node).form;

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
