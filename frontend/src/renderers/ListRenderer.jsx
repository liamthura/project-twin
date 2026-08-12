// Renders a `kind: "list"` node -- a list of objects with a title field,
// optional badges, expandable detail fields, an Add dialog, and suggestion
// chips. Lifted from GenericSectionEditor's module-private `PackList`
// (frontend/src/components/GenericSectionEditor.jsx:45-244), with these
// changes and no others:
//   - takes `node` instead of `uiSpec` + `listKey`
//   - takes a pre-resolved `entity` spec object (or undefined)
//   - delegates every field control to ScalarField via a `meta` built from
//     `node` alone
//
// WHERE THE FIELDS COME FROM. Everything this file used to read off nine
// parallel arrays on the node (`title_field`, `badges`, `detail_fields`,
// `display_fields`, `count_badges`, `display_formats`, `suggestions`,
// `field_defaults`, `pinned`) now comes from `element.fields` -- one descriptor
// per field, saying its own type, vocabulary, default and positions. See
// elementShape.js for the pass that reads them, and meta_schema.json for what
// each key means. The arrays are gone from the manifests, from the schema and
// from here; nothing translates between the two shapes any more.
//
// The pre-resolved `entity` is no longer consulted for anything this file
// renders: v2 states a field's vocabulary and default on the field, so there is
// no second copy on the entity to prefer or fall back to. It used to be passed
// on to `buildFieldMeta` for exactly that fallback; Task 10 deleted that pre-v2
// branch (and the `entity` parameter along with it), so `buildFieldMeta` below
// takes `node` alone now. `entity` itself stays a prop of this component --
// renderNode still resolves and passes it, and `AddEntryDialog` still receives
// it from here unread, both purely for the existing call shape; see
// renderNode.threading.test.jsx.
import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, ChevronDown, Star, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { VALUE_META, FOCUS_RING, ValueIcon, EnumControl } from "@/components/controls";
import { ScalarField, ISO_DATE } from "./ScalarField";
import { buildFieldMeta, needsFullRow as fieldNeedsFullRow } from "./fieldMeta";
import { elementShape, blockNode } from "./elementShape";
import { buildOrder, filterVisible, applyFacets } from "./listPipeline";
import { getAt } from "./paths";
import { useListItems } from "./useListItems";
import { AddEntryDialog } from "./AddEntryDialog";
import { HeaderActionSlotContext, useHeaderActionSlot } from "./headerActionSlot";
// Circular by construction: renderNode imports ListRenderer to dispatch a
// "list" node, and ListRenderer imports renderNode to dispatch a row's block
// fields (an array-valued field with a `label`) against one of its own items.
//
// The rule that actually matters: neither module may dereference the other's
// export at module-initialisation time, and today neither does -- both sides
// only call into the other from inside a function body (ListRenderer's
// render, renderNode's own function), by which point the whole cycle has
// finished loading. Concretely, "dereference at module-initialisation time"
// means a top-level call (e.g. `export default memo(ListRenderer)` sitting
// at module scope) or a module-scope constant computed from the other
// module's export (`const X = renderNode(...)`) -- either would run while
// the other module is still mid-evaluation, before its export is assigned.
// If one of those is genuinely wanted, break the cycle first (e.g. move the
// dispatch into a third module both import).
import { renderNode } from "./renderNode";

// Read-only display of a machine-written key (a created-at stamp, an id).
// Local time and locale-free: an instant is stored as UTC, showing it raw
// would be wrong by the offset, and a locale-formatted string would make the
// same log read differently on two machines. An unparseable value is shown
// verbatim rather than dropped -- nothing validates these on write, and
// hiding a value the user can see in their own JSON is worse than an odd
// looking badge.
//
// A CALENDAR DATE is the exception, and it is why the early return below
// exists. "2026-01-12" is not an instant: `new Date` parses a bare
// yyyy-mm-dd as UTC midnight (per the spec's date-only form), and the
// local-time getters below then roll it back a day in every negative-offset
// zone -- TZ=America/New_York rendered projects' `added_date` of 2026-01-12
// as "2026-01-11". There is no offset to correct for, because there is no
// instant; the honest rendering is the stored string itself, which already
// has exactly the shape this function would produce. Tested on the value's
// shape rather than on `format` so a "datetime" format asks nothing of a
// date-only value either -- there is no time in it to show.
function formatDisplay(value, format) {
  const raw = String(value);
  if (!format) return raw;
  if (ISO_DATE.test(raw)) return raw;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return raw;
  const p = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return format === "date" ? date : `${date} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// `entities` (the whole map) and `packKey` are passed straight back into
// renderNode when dispatching a row's block fields against that row's item, the
// same way SectionRenderer dispatches a section's own top-level nodes -- the
// block resolves its own entity out of the map, and packKey names the pack in
// any log the block's dispatch emits. `entity` stays the pre-resolved object it
// always was, for every existing call site and test.
export default function ListRenderer({
  node, entity, entities, packKey, items, onItems, onShowConfirmation,
}) {
  const [expanded, setExpanded] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  // Where this list's `+ Add` belongs: the header row of the section node that
  // names it, if one published a slot. The add itself cannot move up there --
  // `addItem` needs the `expanded` and `query` state above -- so the trigger
  // is portalled into the slot instead. See headerActionSlot.jsx.
  const headerSlot = useHeaderActionSlot();
  const [query, setQuery] = useState("");
  // Facet state lives here, not in listPipeline: it's per-field UI selection,
  // not derived data. Keyed by storage key; a field absent from this map (or
  // holding `undefined`) means that facet's "All" state -- no row is excluded
  // on its account. Never fed back through `onItems` -- see applyFacets in
  // listPipeline.js and the facet bar below, neither of which touches items.
  const [facetValues, setFacetValues] = useState({});
  // Reader-chosen display order, or null for "whatever the section declares".
  // Deliberately not persisted: it is display state, so it needs no storage
  // key and adds nothing to the storage-keys reference.
  const [sortDir, setSortDir] = useState(null);
  const sortId = useId();
  const meta = buildFieldMeta(node);
  // Every position this node's fields occupy, in declaration order, from one
  // pass over `element.fields`. `blocks` and `pinned` are the two that are not
  // just names -- see elementShape.js.
  const {
    titleField, badges, form: detailFields, row: displayFields, count: countBadges,
    blocks, pinned, suggestions, formats,
    // Fields at most one row may hold as true, declared by the field itself
    // (`exclusive: true`). Setting one clears every other row's copy -- see
    // useListItems -- so the invariant holds however the user gets there:
    // `aesthetics.primary` decides which entry rides into the minimal context
    // scope, and two primaries would make that a coin toss. v1 read this off the
    // entity's `exclusive_fields`, which is now DERIVED from this flag rather
    // than declared beside it.
    exclusive: exclusiveFields,
  } = elementShape(node);
  const existingTitles = new Set(items.map((i) => (i[titleField] || "").toLowerCase()));
  // A node may lift ONE row out of the list and render it above, as the
  // section's answer to a question the list as a whole cannot answer --
  // "which of these is your design language". The lifted row is excluded from
  // the list below rather than shown twice, and every remaining row gets a
  // star to claim the slot. The flag itself never appears as a field control:
  // a labelled switch inside a detail grid is a poor way to say "this one is
  // THE one" -- which is why elementShape gives a pinned field no position at
  // all, and why nothing below has to filter it back out.
  const pinnedField = pinned?.field;
  const pinnedIdx = pinnedField
    ? items.findIndex((i) => i && i[pinnedField] === true)
    : -1;
  const editFields = [...new Set([...badges, ...detailFields])];
  // What the expanded row actually offers a control for. The title field leads
  // whether or not it declares the `form` position: it is the one field every
  // row has, the Add dialog has always given it its own input, and three
  // shipped nodes (goals, media, aesthetics) left it out of v1's detail_fields
  // -- so an entry could be named once and never renamed. Making it a renderer
  // guarantee stops the omission recurring in the next manifest, which naming
  // it in three manifests would not.
  const bodyEditFields = [...new Set([titleField, ...editFields])].filter(Boolean);
  // Declared per field (`default`), collected by fieldMeta in the same pass that
  // withholds a block's own default from its parent. No entity fallback: v2
  // states a default once, and the entity's copy is DERIVED from these
  // descriptors minus anything marked `off_contract` -- so preferring it would
  // silently drop education's `status: "current"`, which the form applies and
  // the MCP contract deliberately does not.
  const fieldDefaults = meta.field_defaults ?? {};
  // What this list holds, for the Add affordances. Was inline in the dialog
  // heading only; the header button said a bare "Add", which reads fine beside
  // a populated list and says nothing on an empty screen where it is the only
  // thing to act on.
  const addLabel = (node.element?.entity ?? node.title ?? "item").replace(/_/g, " ");
  // Opens the dialog from outside Radix's trigger, for the empty-state panel
  // below. AddEntryDialog seeds its own draft from `fieldDefaults` off the
  // `open` prop -- deliberately, because a change made here is invisible to
  // Radix's onOpenChange (see the comment on that effect) -- so both entry
  // points, this one and the header's DialogTrigger, seed identically by
  // construction rather than by two call sites agreeing.
  const openAdd = () => setAddOpen(true);

  // See needsFullRow in fieldMeta.js -- shared so this list's edit form and a
  // `fields` node lay out the same field identically.
  const needsFullRow = (f) => fieldNeedsFullRow(meta, f);

  // The list-editing rules live in useListItems: index-shifting on add and
  // remove, the "@now" resolution order, exclusive-field clearing, and the
  // delete-on-empty-string rule that child writes deliberately do not share.
  // See that file for why each is the way it is.
  const { addItem, updateItem, updateItemAt, promote, removeItem } = useListItems({
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
  });

  // The one field this list can offer to re-order by: a field shown on the row
  // that declares a date `format`. Sourced from that declaration rather than
  // from any key that merely looks like a date, which is what keeps
  // `knowledge`'s `created_at` out of it -- that manifest records that its two
  // write paths disagree (one local time labelled UTC, one real UTC), so any
  // ordering by it would be wrong by the offset for half the entries. It takes
  // no `row` position (its `show` is empty), and this rule only ever reads the
  // fields the row shows.
  //
  // Today exactly one shipped node qualifies: learning_log/entries.
  const sortField = displayFields.find((f) => ["datetime", "date"].includes(formats[f]));
  // What the control shows. Falls back to the declared direction when the
  // section declares one on this same field, so learning_log opens on
  // "Newest" -- the order it already had.
  // `sortField &&` is load-bearing: without it, a node with neither a date
  // field nor a declared sort compares undefined === undefined, takes the
  // true branch, and dereferences a `node.sort` that isn't there.
  const sortValue =
    sortDir ??
    (sortField && node.sort?.field === sortField ? (node.sort.dir ?? "asc") : "desc");

  // Display order. `sortDir` is null until the reader touches the control, so
  // an untouched list sorts exactly as its manifest declares -- adding the
  // control changed no node's initial order.
  //
  // This is a one-line change for a reason worth keeping: `buildOrder` sorts
  // STORED INDEXES rather than the array (see listPipeline.js), and `expanded`
  // is keyed by stored index too, so re-ordering the display cannot point an
  // expansion key at the wrong row. Sorting also never writes -- the schema
  // calls `sort` "display order only" -- so nothing here touches `onItems`.
  // Untouched (`sortDir === null`) falls through to `node.sort` verbatim, so
  // this cannot change any node's initial order -- not even one whose declared
  // sort names a different field than the date field the control offers.
  const order = buildOrder(items, sortDir ? { field: sortField, dir: sortDir } : node.sort);
  const searchFields = [
    ...new Set([titleField, ...badges, ...detailFields, ...meta.array_fields]),
  ];
  const q = query.trim().toLowerCase();
  const searched = filterVisible(order, items, q, searchFields);
  // Facets narrow the search box's own output -- same stored indexes in,
  // same stored indexes out -- so the two compose instead of racing: a query
  // and an active facet both hide a row, neither can un-hide what the other
  // excluded. `facetOptions` reads the very `meta` ScalarField is handed, so a
  // facet's chips and the row's own control for that field can never offer
  // different vocabularies -- v1 resolved the two separately and had to be told
  // to agree. A facet field with no resolvable options is skipped entirely
  // below rather than narrowing on a value that could never be selected; the
  // loader only accepts a facet naming a declared enum, so that is a guard
  // against a hand-built node rather than a shipped one.
  const facetOptions = (field) => meta.valid_values?.[field];
  const visible = applyFacets(searched, items, node.facets, facetValues)
    .filter((idx) => idx !== pinnedIdx);
  // Whether the header's "N of M" count needs to account for something
  // narrowing `visible` -- previously only the search query, now a selected
  // facet too. Reads the same facetValues map applyFacets already consumed;
  // an entry present but `undefined` is a field left on "All" and does not
  // count as active.
  const facetsActive = (node.facets || []).some((f) => facetValues[f] !== undefined);
  // The facets that will actually draw a control. Resolved here rather than
  // inside the render map because two things need the answer: the row below
  // decides whether it has any left-hand content at all, and a node whose
  // every facet field resolves to no options must not render an empty group.
  const facetFields = (node.facets || []).filter((f) => (facetOptions(f) || []).length > 0);
  // Does anything sit to the LEFT of the count in the row below? When nothing
  // does, the count is the row's only child and stays where it always was.
  const hasRowControls = facetFields.length > 0 || Boolean(sortField);

  // The one Add dialog this list has, trigger included. Built here rather than
  // in the section header because `addItem` (and the three invariants
  // useListItems holds for it) lives here -- only the trigger's DOM position
  // moves, via the portal below.
  const addDialog = (
    <AddEntryDialog
      node={node}
      entity={entity}
      items={items}
      onAdd={addItem}
      open={addOpen}
      onOpenChange={setAddOpen}
      trigger={
        // Visibly a bare "Add" -- beside the heading that names the list, that
        // is all it needs to say, and a longer label would crowd the row. To a
        // screen reader it says what it adds: a section with several list nodes
        // renders several of these triggers, and "Add", "Add", "Add" read out
        // of the heading's context distinguishes none of them. Same `addLabel`
        // the empty panel's button spells out visibly, so the two never name
        // the same action differently.
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          aria-label={`Add ${addLabel}`}
        >
          <Plus className="h-3.5 w-3.5" />Add
        </Button>
      }
    />
  );

  return (
    <div className="space-y-3">
      {/* The trigger renders in the header row that NAMES this list, which is
          a DOM node SectionRenderer owns -- so it gets there by portal rather
          than by moving the add logic up to meet it.
          When there is no slot, it renders inline, at the top of the list
          body, exactly where it used to be. That is not dead code: a nested
          child list gets no slot (its parent claimed the section header), and
          ListRenderer is rendered on its own throughout its test file. */}
      {headerSlot ? (
        createPortal(addDialog, headerSlot)
      ) : (
        <div className="flex items-center justify-end">{addDialog}</div>
      )}

      {/* Keep the box mounted whenever a query is active, even if it filtered
          every row out of existence -- otherwise deleting the last match(es)
          unmounts the only control that can clear `query`, stranding the user
          on an empty state that tells them to "clear the search" with nothing
          left to clear it with. Still absent when there's genuinely nothing
          to search (no items, no active query). */}
      {node.search && (items.length > 0 || q) && (
        <Input
          type="search"
          aria-label="Search"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9"
        />
      )}

      {/* The count sits WITH the filters rather than in a toolbar above them:
          it is feedback on what they did ("2 of 7"), and a row away from the
          controls that change it there was nothing to connect the two.
          Rendered even for a node with neither facets nor search, where this
          row is the count alone -- it is the only thing that tells the reader
          how long the list is.

          Within the row the controls lead and the count is pushed to the far
          right, which is the prototype's arrangement: every toolbar row there
          is SPACE_BETWEEN with the count last (`Order` row 327:1124, `Filters`
          row 324:1169). Reading order follows cause then effect -- you change a
          control on the left, the number on the right answers. The push is
          `ml-auto` rather than `justify-between` on the row because the row can
          hold three things (facets, sort, count) and justify-between would
          spread the two controls apart instead of keeping them grouped. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Facets: display-only row filters, drawn above the list. Each entry
            in node.facets names an enum storage key; `facetOptions` above
            resolves that field's option set. A field with no resolvable
            options is skipped -- a control with zero real values to pick would
            only ever be able to show "All". Every EnumControl here is fed an
            extra leading "All" pseudo-option so the reset affordance is always
            visible rather than relying on the click-the-active-value-again
            toggle EnumControl uses elsewhere; the mapping back to `undefined`
            (== no filter on this field) happens in the onChange below, never
            stored, never threaded through onItems. */}
        {facetFields.length > 0 && (
          <div role="group" aria-label="Filters" className="flex flex-wrap gap-x-4 gap-y-2">
            {facetFields.map((f) => {
              const options = facetOptions(f);
              return (
                <div
                  key={f}
                  role="group"
                  aria-label={`Filter by ${f.replace(/_/g, " ")}`}
                  className="flex items-center gap-1.5"
                >
                  <span className="text-xs font-medium capitalize text-muted-foreground">
                    {f.replace(/_/g, " ")}
                  </span>
                  <EnumControl
                    options={["All", ...options]}
                    value={facetValues[f] ?? "All"}
                    onChange={(v) =>
                      setFacetValues((prev) => ({
                        ...prev,
                        [f]: v === "All" || v === undefined ? undefined : v,
                      }))
                    }
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Order, beside the filters and the count they all feed. Two options
            and no empty state, which is why this is a plain Select rather than
            EnumControl: both of EnumControl's shapes offer a way back to "no
            value" (segmented clears on active-click, the dropdown grows a
            Clear item), and a list is always in SOME order. */}
        {sortField && (
          <div className="flex items-center gap-1.5">
            <Label htmlFor={sortId} className="text-xs font-medium text-muted-foreground">
              Sort
            </Label>
            <Select value={sortValue} onValueChange={setSortDir}>
              <SelectTrigger id={sortId} className="h-9 w-auto min-w-[130px] gap-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Newest</SelectItem>
                <SelectItem value="asc">Oldest</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Last in the row, and pushed right only when something precedes it --
            with no facets and no sort this is the row's only child, and a lone
            count belongs where it has always been rather than stranded against
            the right edge with nothing to sit opposite. */}
        <div className={`text-sm text-muted-foreground${hasRowControls ? " ml-auto" : ""}`}>
          {q || facetsActive ? `${visible.length} of ${items.length}` : items.length}{" "}
          {items.length === 1 ? "entry" : "entries"}
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Suggested (tap to add)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions
              .filter((s) => !existingTitles.has(s.toLowerCase()))
              .map((s) => (
                <button key={s} type="button"
                  onClick={() => addItem({ [titleField]: s })}
                  className={`rounded-full border border-input bg-background px-3 py-1 text-xs text-muted-foreground hover:bg-muted/50 ${FOCUS_RING}`}>
                  + {s}
                </button>
              ))}
          </div>
        </div>
      )}

      {pinnedField && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {pinned.title}
          </p>
          {pinnedIdx === -1 ? (
            <EmptyState>{pinned.empty}</EmptyState>
          ) : (
            <div className="rounded-md border border-primary/40 bg-primary/[0.03]">
              {renderRow(pinnedIdx)}
            </div>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState>
          {q ? (
            "No matches. Clear the search to see everything."
          ) : facetsActive ? (
            "No matches. Clear a filter to see everything."
          ) : (
            // A genuinely empty list, which is where a new user starts. The
            // only way in used to be the small outline Add button up in the
            // header, while this panel -- the thing they are actually looking
            // at -- told them to "tap a suggestion". Only `aesthetics` ships
            // any suggestions, so for every other pack that sentence pointed
            // at nothing and the panel offered no way forward at all.
            //
            // So the call to action lives here, where the eye already is, and
            // the suggestion wording appears only when there is something to
            // tap. This is a plain button rather than a second DialogTrigger
            // because Radix requires a trigger to sit inside its Dialog, and
            // this panel is a sibling of the header that owns it -- opening
            // via the same state the trigger sets keeps one dialog and one
            // draft-seeding path.
            <div className="space-y-3">
              <p>
                {suggestions.length > 0
                  ? "Nothing here yet. Add one, or tap a suggestion below."
                  : "Nothing here yet."}
              </p>
              <Button size="sm" onClick={openAdd}>
                <Plus className="mr-1 h-4 w-4" />
                Add {addLabel}
              </Button>
            </div>
          )}
        </EmptyState>
      ) : (
        <div className="rounded-md border">
          {visible.map(renderRow)}
        </div>
      )}
    </div>
  );

  // One row. Named rather than inline so the pinned block above renders the
  // SAME thing the list does -- a second copy would drift the moment either
  // gained a control. Declared after the return because function declarations
  // hoist, which keeps 130 lines of JSX where they already were.
  function renderRow(idx) {
    const item = items[idx];
    // Only the fields this row actually carries a value for -- a blank line
    // labelled "timestamp" is worse than no line.
    const bodyDisplayFields = displayFields.filter(
      (f) => item[f] != null && item[f] !== ""
    );
    return (
            // Keyed by the row's stored index, not its id or title: every
            // writer here (updateItem, updateItemAt, removeItem, and
            // expanded's own add/remove index shifting) already addresses
            // rows by that same index, so it is the identity the component
            // actually uses. All three reference child lists
            // (project_reference, domain_reference, mental_tab_reference)
            // are permanently id-less -- none are in any manifest's
            // id_lists -- as is any row addItem has just written and every
            // knowledge-entity row in `domains` before the next save. Keying
            // on `item[titleField]` instead remounted the row (and its input
            // DOM node) on every keystroke of a title edit, since the key
            // changed along with the value being typed.
            <div key={idx}
              className="border-b border-border last:border-b-0">
              {/* items-start, not items-center: on a phone the title and the
                  badges are two stacked lines, and centring would float the
                  chevron and the buttons against the middle of a two-line
                  block. From `sm` up the inner div goes back to one row and
                  everything lines up as before. */}
              <div className="flex cursor-pointer items-start gap-2 px-3 py-2.5 hover:bg-muted/40 sm:items-center"
                onClick={() => setExpanded({ ...expanded, [idx]: !expanded[idx] })}>
                <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform sm:mt-0 ${expanded[idx] ? "" : "-rotate-90"}`} />
                {/* The badges used to sit beside the title in one row, and on a
                    375px screen a source chip plus a timestamp chip left the
                    title nothing to truncate into -- entries were unreadable,
                    which is the one thing a collapsed row has to do. `min-w-0`
                    is what lets `truncate` work at all inside a flex child. */}
                <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-2">
                <span className="block truncate text-sm font-medium">{item[titleField]}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5 sm:mt-0 sm:flex-1 sm:flex-nowrap">
                  {displayFields
                    .filter((f) => item[f] != null && item[f] !== "")
                    .map((f) => (
                      <Badge key={f} variant="secondary" className="gap-1 text-[10px] font-mono">
                        {formatDisplay(item[f], formats[f])}
                      </Badge>
                    ))}
                  {/* count_badges: opt-in "N <field>" chips for array-valued
                      storage keys, e.g. "3 references". Read-only, like
                      display_fields above -- no control renders for these in
                      the expanded row beyond whatever detail_fields
                      independently declares. A field that is absent, empty,
                      or not an array renders no badge at all: a "0 x" chip on
                      every row that has never used a feature is noise, not
                      information, and a non-array value here must not throw
                      on `.length`. Singularised by trimming a trailing "s"
                      only at count 1 -- good enough for every field this wave
                      actually names (references/tags/highlights); a plural
                      that doesn't just add "s" (e.g. an irregular noun) would
                      read oddly singular, but no such field exists yet. */}
                  {countBadges
                    .filter((f) => Array.isArray(item[f]) && item[f].length > 0)
                    .map((f) => {
                      const n = item[f].length;
                      const label = f.replace(/_/g, " ");
                      return (
                        <Badge key={`count:${f}`} variant="secondary" className="gap-1 text-[10px] font-mono">
                          {n} {n === 1 ? label.replace(/s$/, "") : label}
                        </Badge>
                      );
                    })}
                  {badges.filter((b) => item[b]).map((b) => {
                    const value = String(item[b]);
                    const chip = VALUE_META[value]?.chip;
                    return (
                      <Badge
                        key={b}
                        variant={chip ? "outline" : "secondary"}
                        className={`gap-1 text-[10px] ${chip || ""}`}
                      >
                        <ValueIcon value={value} className="h-2.5 w-2.5" />
                        {value.replace(/_/g, " ")}
                      </Badge>
                    );
                  })}
                </span>
                </div>
                {pinnedField && (
                  <Button variant="ghost" size="icon"
                    className={`h-7 w-7 shrink-0 ${
                      idx === pinnedIdx
                        ? "text-link hover:text-link"
                        : "text-muted-foreground hover:text-link"
                    }`}
                    aria-label={
                      idx === pinnedIdx
                        ? `${item[titleField] || "Untitled entry"} is ${pinned.noun}`
                        : `Make ${item[titleField] || "Untitled entry"} ${pinned.noun}`
                    }
                    aria-pressed={idx === pinnedIdx}
                    disabled={idx === pinnedIdx}
                    onClick={(e) => { e.stopPropagation(); promote(idx); }}>
                    <Star className={`h-3.5 w-3.5 ${idx === pinnedIdx ? "fill-current" : ""}`} />
                  </Button>
                )}
                <DropdownMenu>
                  {/* stopPropagation because this trigger sits INSIDE the row
                      header, whose own onClick toggles `expanded` -- opening a
                      menu must not also expand the row. The menu content needs
                      no such guard: it is portalled out of this subtree. */}
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                      aria-label={`More actions for ${item[titleField] || "Untitled entry"}`}
                      onClick={(e) => e.stopPropagation()}>
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => removeItem(idx)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {expanded[idx] && (
                <>
                {/* px-9 aligns detail fields under the row title (px-3 + a
                    16px chevron + an 8px gap). That indent is worth 72px of a
                    375px screen, which is most of why an enum control had
                    nowhere to go -- so it only applies from sm up. */}
                {/* Read-only machine-written values, shown in the body and not
                    only as a collapsed-row chip. The chip is a glance; the body
                    is where you go to read an entry, and a learning entry whose
                    only timestamp was a chip lost the time of day entirely
                    whenever that chip rendered a date-shaped value. Same
                    formatter as the chip, so the two never disagree. */}
                {bodyDisplayFields.length > 0 && (
                  <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 pb-2 sm:px-9">
                    {bodyDisplayFields.map((f) => (
                      <div key={f}>
                        <Label className="text-xs capitalize">
                          {meta.field_labels[f] ?? f.replace(/_/g, " ")}
                        </Label>
                        <p className="font-mono text-xs text-muted-foreground">
                          {formatDisplay(item[f], formats[f])}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid gap-3 px-4 pb-3 sm:grid-cols-2 sm:px-9">
                  {bodyEditFields.map((f) => (
                    <div key={f} className={needsFullRow(f) ? "sm:col-span-2" : ""}>
                      <Label className="text-xs capitalize">
                        {meta.field_labels[f] ?? f.replace(/_/g, " ")}
                      </Label>
                      <ScalarField
                        field={f}
                        value={item[f]}
                        meta={meta}
                        customValue={item[`custom_${f}`]}
                        onChange={(v) =>
                          updateItem(idx, v !== "other"
                            ? { [f]: v, [`custom_${f}`]: undefined }
                            : { [f]: v })
                        }
                        onCustomChange={(v) => updateItem(idx, { [`custom_${f}`]: v })}
                      />
                    </div>
                  ))}
                </div>
                {/* Block fields, dispatched through the same seam the section
                    root uses -- but bound to THIS item: the block's `path` is
                    `[field.name]` and resolves against `item`, and its writes go
                    back through `updateItemAt(idx, ...)`. `idx` is the row's own
                    stored index (from `visible`), never a display position:
                    `order` and `visible` mean the row on screen is not the row
                    at that array position.

                    This is what v1 spelled as a nested `children` array, and the
                    reason v2 does not: a child bound against the ROW while a
                    group's children bound against the SECTION ROOT, from the
                    same key. As a field inside `element.fields` there is only
                    one reading available -- an array-valued key ON this row --
                    which is exactly what `updateItemAt` writes. */}
                {/* A block list is a descendant of THIS one, so it would
                    otherwise read the very header slot this list just claimed
                    and portal its own Add up there too -- two triggers in the
                    section header, none beside the block's rows. Handing
                    descendants `null` sends a block list down the inline
                    branch, which is where a nested Add belongs: its own
                    heading is a Label inside the row, not a section header. */}
                <HeaderActionSlotContext.Provider value={null}>
                {blocks.map((field, ci) => {
                  // A field's `name` is required and its `type` decides the kind,
                  // so unlike a hand-authored v1 child there is no such thing
                  // here as a block with no path or an unsupported kind -- see
                  // blockNode in elementShape.js. That means renderNode's own
                  // guards (a missing/empty path, an unsupported kind) can never
                  // fire on a node THIS FUNCTION builds -- `child.kind` is always
                  // "list" or "strings" and `child.path` is always the field's
                  // own required, non-empty `name` -- so there is no `if
                  // (!rendered) return null` here to bail out of; a block is
                  // rejected only if renderNode's rules change under it.
                  const child = blockNode(field);
                  const rendered = renderNode({
                    node: child,
                    value: getAt(item, child.path),
                    onValue: (next) => updateItemAt(idx, child.path, next),
                    entities,
                    packKey,
                    onShowConfirmation,
                  });
                  return (
                    <div
                      key={`${ci}:${child.path.join(".")}`}
                      data-ui-node={child.title}
                      className="space-y-2 px-4 pb-3 sm:px-9"
                    >
                      {/* The heading row keeps its flex wrapper even though it
                          now holds one child: a field descriptor carries no
                          `info` -- the dialog belongs to a NODE, and a v1 child
                          could hold one where a block field cannot -- so the
                          InfoButton that sat here always rendered null for every
                          child in every shipped pack, and there is nothing left
                          for it to draw. */}
                      {child.title && (
                        <div className="flex items-center gap-1.5">
                          <Label className="text-xs capitalize">{child.title}</Label>
                        </div>
                      )}
                      {rendered}
                    </div>
                  );
                })}
                </HeaderActionSlotContext.Provider>
                </>
              )}
            </div>
    );
  }
}
