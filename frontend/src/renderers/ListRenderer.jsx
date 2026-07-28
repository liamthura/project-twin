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
import { Plus, Trash2, ChevronDown, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoDialog } from "@/components/ui/info-dialog";
import { VALUE_META, FOCUS_RING, ValueIcon, SEGMENTED_MAX } from "@/components/controls";
import { ScalarField, LONG_TEXT_FIELDS } from "./ScalarField";
import { buildOrder, filterVisible } from "./listPipeline";

// Read-only display of a machine-written key (a created-at stamp, an id).
// Local time and locale-free: the stored value is UTC, showing it raw would
// be wrong by the offset, and a locale-formatted string would make the same
// log read differently on two machines. An unparseable value is shown
// verbatim rather than dropped -- nothing validates these on write, and
// hiding a value the user can see in their own JSON is worse than an odd
// looking badge.
function formatDisplay(value, format) {
  const raw = String(value);
  if (!format) return raw;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return raw;
  const p = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return format === "date" ? date : `${date} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function ListRenderer({ node, entity, items, onItems, onShowConfirmation }) {
  const [expanded, setExpanded] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const [query, setQuery] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const titleField = node.title_field;
  const badges = node.badges || [];
  const detailFields = node.detail_fields || [];
  const arrayFields = node.array_fields || [];
  const suggestions = node.suggestions?.[titleField] || [];
  const existingTitles = new Set(items.map((i) => (i[titleField] || "").toLowerCase()));
  // Same case-insensitive comparison addItem itself uses to reject a
  // collision -- computed here too so the dialog can surface it instead of
  // letting addItem silently no-op and close on a title the user already has.
  const titleCollides =
    !!draft[titleField] && existingTitles.has(draft[titleField].toLowerCase());
  const editFields = [...new Set([...badges, ...detailFields])];
  const fieldDefaults = node.field_defaults ?? entity?.field_defaults ?? {};
  // A node-declared long_text (schema: array of storage keys) takes
  // precedence over the entity-agnostic default set, same as enum and
  // field_defaults above -- normalised to a Set once here so both the
  // custom_* grid layout below and ScalarField's own (defensive) normalising
  // agree on what "long text" means for this node.
  const longText = node.long_text ? new Set(node.long_text) : LONG_TEXT_FIELDS;
  const meta = {
    valid_values: node.enum ?? entity?.valid_values,
    optional: node.optional ?? entity?.optional ?? [],
    array_fields: arrayFields,
    long_text: longText,
    // Opt-in per node rather than inferred from the field name: `period` on
    // profile.education and `bedtime` on lifestyle.sleep read like dates and
    // are not, so a name heuristic would turn free text into a lossy picker.
    date_fields: node.date_fields ?? [],
  };

  // Which fields need the whole row rather than one of the two grid columns.
  //
  // On a 1152px desktop a column is only ~386px wide: 1152 - 32 (page px-4)
  // - 192 (tab sidebar) - 24 (gap-6) - 48 (card p-6) - 72 (grid sm:px-9),
  // then halved less the 12px gap. A four-option segmented control needs
  // roughly 400px, so it wrapped after three options while the column beside
  // it sat empty. Giving it the full row is the same treatment long text and
  // array inputs already get.
  //
  // Only segmented enums qualify: more than SEGMENTED_MAX options renders a
  // ~170px dropdown instead, which fits a column comfortably. Three or fewer
  // options also fit, and stretching those across the row would just leave a
  // gap where the neighbouring field used to be.
  const needsFullRow = (f) => {
    if (longText.has(f) || arrayFields.includes(f)) return true;
    const options = meta.valid_values?.[f];
    return Boolean(options) && options.length > 3 && options.length <= SEGMENTED_MAX;
  };

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
  const searchFields = [...new Set([titleField, ...badges, ...detailFields, ...arrayFields])];
  const q = query.trim().toLowerCase();
  const visible = filterVisible(order, items, q, searchFields);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {node.info && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="About this section"
              onClick={() => setInfoOpen(true)}
            >
              <Info className="h-4 w-4" />
            </Button>
          )}
          <div className="text-sm text-muted-foreground">
            {q ? `${visible.length} of ${items.length}` : items.length}{" "}
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
          {q
            ? "No matches. Clear the search to see everything."
            : "Nothing here yet. Use Add, or tap a suggestion."}
        </EmptyState>
      ) : (
        <div className="rounded-md border">
          {visible.map((idx) => {
            const item = items[idx];
            return (
            <div key={item.id || `${item[titleField]}-${idx}`}
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
                // px-9 aligns detail fields under the row title (px-3 + a
                // 16px chevron + an 8px gap). That indent is worth 72px of a
                // 375px screen, which is most of why an enum control had
                // nowhere to go -- so it only applies from sm up.
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
              )}
            </div>
            );
          })}
        </div>
      )}

      {node.info && (
        <InfoDialog
          open={infoOpen}
          onOpenChange={setInfoOpen}
          title={node.title ?? "About this section"}
          description={node.info.overview}
        >
          <p className="font-medium text-foreground">Tips for filling this section:</p>
          <ul className="space-y-2 text-muted-foreground">
            {(node.info.tips || []).map((tip, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-primary">•</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setInfoOpen(false)}>Got it</Button>
          </DialogFooter>
        </InfoDialog>
      )}
    </div>
  );
}
