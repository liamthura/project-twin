// Renders a `kind: "list"` node -- a list of objects with a title field,
// optional badges, expandable detail fields, an Add dialog, and suggestion
// chips. Lifted from GenericSectionEditor's module-private `PackList`
// (frontend/src/components/GenericSectionEditor.jsx:45-244), with these
// changes and no others:
//   - takes `node` instead of `uiSpec` + `listKey`
//   - takes a pre-resolved `entity` spec object (or undefined)
//   - delegates every field control to ScalarField via a `meta` built from
//     `node` and `entity`
//   - `node.enum` and `node.field_defaults` take precedence over the
//     entity's, for sections whose manifest field names are not their
//     storage keys (unused by today's packs, needed by waves 3-6)
import { useState } from "react";
import { Plus, Trash2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoButton } from "@/components/ui/info-button";
import { VALUE_META, FOCUS_RING, ValueIcon, EnumControl } from "@/components/controls";
import { ScalarField, ISO_DATE } from "./ScalarField";
import { buildFieldMeta, needsFullRow as fieldNeedsFullRow } from "./fieldMeta";
import { buildOrder, filterVisible, applyFacets } from "./listPipeline";
import { getAt, setAt } from "./paths";
// Circular by construction: renderNode imports ListRenderer to dispatch a
// "list" node, and ListRenderer imports renderNode to dispatch a node's
// `children` against one of its own items.
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
// renderNode when dispatching `node.children` against a row's item, the same
// way SectionRenderer dispatches a section's own top-level nodes -- the child
// resolves its own entity out of the map, and packKey names the pack in any
// log the child's dispatch emits. `entity` stays the pre-resolved object it
// always was, for every existing call site and test.
export default function ListRenderer({
  node, entity, entities, packKey, items, onItems, onShowConfirmation,
}) {
  const [expanded, setExpanded] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const [query, setQuery] = useState("");
  // Facet state lives here, not in listPipeline: it's per-field UI selection,
  // not derived data. Keyed by storage key; a field absent from this map (or
  // holding `undefined`) means that facet's "All" state -- no row is excluded
  // on its account. Never fed back through `onItems` -- see applyFacets in
  // listPipeline.js and the facet bar below, neither of which touches items.
  const [facetValues, setFacetValues] = useState({});
  const titleField = node.title_field;
  const badges = node.badges || [];
  const detailFields = node.detail_fields || [];
  const suggestions = node.suggestions?.[titleField] || [];
  const existingTitles = new Set(items.map((i) => (i[titleField] || "").toLowerCase()));
  // Same case-insensitive comparison addItem itself uses to reject a
  // collision -- computed here too so the dialog can surface it instead of
  // letting addItem silently no-op and close on a title the user already has.
  const titleCollides =
    !!draft[titleField] && existingTitles.has(draft[titleField].toLowerCase());
  const editFields = [...new Set([...badges, ...detailFields])];
  const fieldDefaults = node.field_defaults ?? entity?.field_defaults ?? {};
  // What this list holds, for the Add affordances. Was inline in the dialog
  // heading only; the header button said a bare "Add", which reads fine beside
  // a populated list and says nothing on an empty screen where it is the only
  // thing to act on.
  const addLabel = (node.entity ?? node.title ?? "item").replace(/_/g, " ");
  // Opening the dialog and seeding the draft, extracted because the empty
  // state opens the same dialog from outside Radix's trigger. Both paths must
  // seed identically or a manifest default would apply invisibly on one route
  // and visibly on the other.
  const openAdd = () => {
    setAddOpen(true);
    setDraft({ ...fieldDefaults });
  };
  const meta = buildFieldMeta(node, entity);

  // See needsFullRow in fieldMeta.js -- shared so this list's edit form and a
  // `fields` node lay out the same field identically.
  const needsFullRow = (f) => fieldNeedsFullRow(meta, f);

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

  const order = buildOrder(items, node.sort);
  const searchFields = [
    ...new Set([titleField, ...badges, ...detailFields, ...meta.array_fields]),
  ];
  const q = query.trim().toLowerCase();
  const searched = filterVisible(order, items, q, searchFields);
  // Facets narrow the search box's own output -- same stored indexes in,
  // same stored indexes out -- so the two compose instead of racing: a query
  // and an active facet both hide a row, neither can un-hide what the other
  // excluded. `facetOptions` resolves per field with the same precedence
  // ScalarField uses (node.enum wins over the entity's), so a node with an
  // inline enum still gets a facet instead of one silently rendering no
  // options. A facet field with no resolvable options is skipped entirely
  // below rather than narrowing on a value that could never be selected.
  const facetOptions = (field) => node.enum?.[field] ?? entity?.valid_values?.[field];
  const visible = applyFacets(searched, items, node.facets, facetValues);
  // Whether the header's "N of M" count needs to account for something
  // narrowing `visible` -- previously only the search query, now a selected
  // facet too. Reads the same facetValues map applyFacets already consumed;
  // an entry present but `undefined` is a field left on "All" and does not
  // count as active.
  const facetsActive = (node.facets || []).some((f) => facetValues[f] !== undefined);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <div className="text-sm text-muted-foreground">
            {q || facetsActive ? `${visible.length} of ${items.length}` : items.length}{" "}
            {items.length === 1 ? "entry" : "entries"}
          </div>
        </div>
        <Dialog
          open={addOpen}
          onOpenChange={(o) => {
            setAddOpen(o);
            // Preselect manifest defaults (e.g. stance: like) so the controls
            // show the real initial state instead of applying it invisibly.
            setDraft(o ? { ...fieldDefaults } : {});
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" variant="outline"><Plus className="mr-1 h-4 w-4" />Add</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Add {(node.title ?? node.entity ?? "item").replace(/_/g, " ")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs capitalize">{titleField}</Label>
                <Input
                  value={draft[titleField] || ""}
                  onChange={(e) => setDraft({ ...draft, [titleField]: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && draft[titleField] && !titleCollides) {
                      addItem(draft);
                      setAddOpen(false);
                      setDraft({});
                    }
                  }}
                  autoFocus
                />
                {titleCollides && (
                  <p className="text-xs text-destructive">
                    "{draft[titleField]}" already exists.
                  </p>
                )}
                {suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {suggestions
                      .filter((s) => !existingTitles.has(s.toLowerCase()))
                      .slice(0, 8)
                      .map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setDraft({ ...draft, [titleField]: s })}
                          className={`rounded-full border border-input bg-background px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted/50 ${FOCUS_RING}`}
                        >
                          {s}
                        </button>
                      ))}
                  </div>
                )}
              </div>
              {editFields.filter((f) => f !== titleField).map((f) => (
                <div key={f} className="space-y-1.5">
                  <Label className="text-xs capitalize">{f.replace(/_/g, " ")}</Label>
                  <ScalarField
                    field={f}
                    value={draft[f]}
                    meta={meta}
                    customValue={draft[`custom_${f}`]}
                    onChange={(v) => {
                      const next = { ...draft, [f]: v };
                      if (v !== "other") delete next[`custom_${f}`];
                      setDraft(next);
                    }}
                    onCustomChange={(v) => setDraft({ ...draft, [`custom_${f}`]: v })}
                  />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={() => { addItem(draft); setAddOpen(false); setDraft({}); }}
                disabled={!draft[titleField] || titleCollides}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Keep the box mounted whenever a query is active, even if it filtered
          every row out of existence -- otherwise deleting the last match(es)
          unmounts the only control that can clear `query`, stranding the user
          on an empty state that tells them to "clear the search" with nothing
          left to clear it with. Still absent when there's genuinely nothing
          to search (no items, no active query). */}
      {node.searchable && (items.length > 0 || q) && (
        <Input
          type="search"
          aria-label="Search"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9"
        />
      )}

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
      {(node.facets || []).length > 0 && (
        <div role="group" aria-label="Filters" className="flex flex-wrap gap-x-4 gap-y-2">
          {node.facets.map((f) => {
            const options = facetOptions(f);
            if (!options || options.length === 0) return null;
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
          {visible.map((idx) => {
            const item = items[idx];
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
              <div className="flex cursor-pointer items-center gap-2 px-3 py-2.5 hover:bg-muted/40"
                onClick={() => setExpanded({ ...expanded, [idx]: !expanded[idx] })}>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded[idx] ? "" : "-rotate-90"}`} />
                <span className="truncate text-sm font-medium">{item[titleField]}</span>
                <span className="flex flex-1 items-center gap-1.5">
                  {(node.display_fields || [])
                    .filter((f) => item[f] != null && item[f] !== "")
                    .map((f) => (
                      <Badge key={f} variant="secondary" className="gap-1 text-[10px] font-mono">
                        {formatDisplay(item[f], node.display_formats?.[f])}
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
                  {(node.count_badges || [])
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
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  aria-label={`Remove ${item[titleField] || "Untitled entry"}`}
                  onClick={(e) => { e.stopPropagation(); removeItem(idx); }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {expanded[idx] && (
                <>
                {/* px-9 aligns detail fields under the row title (px-3 + a
                    16px chevron + an 8px gap). That indent is worth 72px of a
                    375px screen, which is most of why an enum control had
                    nowhere to go -- so it only applies from sm up. */}
                <div className="grid gap-3 px-4 pb-3 sm:grid-cols-2 sm:px-9">
                  {editFields.map((f) => (
                    <div key={f} className={needsFullRow(f) ? "sm:col-span-2" : ""}>
                      <Label className="text-xs capitalize">{f.replace(/_/g, " ")}</Label>
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
                {/* Child nodes, dispatched through the same seam the section
                    root uses -- but bound to THIS item: the child's `path`
                    resolves against `item`, and its writes go back through
                    `updateItemAt(idx, ...)`. `idx` is the row's own stored
                    index (from `visible`), never a display position: `order`
                    and `visible` mean the row on screen is not the row at
                    that array position. */}
                {(node.children || []).map((child, ci) => {
                  // Only a well-formed path can be read or written. A child of
                  // an unsupported kind carries no such guarantee, and getAt
                  // throws on a non-iterable path -- so guard before reading,
                  // exactly as SectionRenderer guards at the root.
                  const hasPath = Array.isArray(child.path);
                  const rendered = renderNode({
                    node: child,
                    value: hasPath ? getAt(item, child.path) : undefined,
                    onValue: (next) => updateItemAt(idx, child.path, next),
                    entities,
                    packKey,
                    onShowConfirmation,
                  });
                  // renderNode returns null (after logging) for a node it
                  // rejects. Bail before the wrapper so a rejected child
                  // contributes nothing -- not an empty div, and not a
                  // heading floating over nothing.
                  if (!rendered) return null;
                  return (
                    <div
                      key={`${ci}:${hasPath ? child.path.join(".") : ""}`}
                      data-ui-node={child.title}
                      className="space-y-2 px-4 pb-3 sm:px-9"
                    >
                      {child.title && (
                        <div className="flex items-center gap-1.5">
                          <Label className="text-xs capitalize">{child.title}</Label>
                          <InfoButton info={child.info} title={child.title} />
                        </div>
                      )}
                      {rendered}
                    </div>
                  );
                })}
                </>
              )}
            </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
