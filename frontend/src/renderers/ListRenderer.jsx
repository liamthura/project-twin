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
import { VALUE_META, FOCUS_RING, ValueIcon } from "@/components/controls";
import { ScalarField, LONG_TEXT_FIELDS } from "./ScalarField";

export default function ListRenderer({ node, entity, items, onItems, onShowConfirmation }) {
  const [expanded, setExpanded] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const titleField = node.title_field;
  const badges = node.badges || [];
  const detailFields = node.detail_fields || [];
  const arrayFields = node.array_fields || [];
  const suggestions = node.suggestions?.[titleField] || [];
  const existingTitles = new Set(items.map((i) => (i[titleField] || "").toLowerCase()));
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
    const doRemove = () => onItems(items.filter((_, i) => i !== idx));
    if (onShowConfirmation) {
      onShowConfirmation(
        `Remove ${items[idx][titleField]}?`,
        "This can't be undone.",
        doRemove
      );
    } else doRemove();
  };

  // Display order only. The indexes are sorted, never the array, because
  // updateItem/removeItem address the real stored position -- sorting a copy and
  // handing them display positions would edit the wrong row.
  const order = items.map((_, i) => i);
  if (node.sort?.field) {
    const { field, dir = "asc" } = node.sort;
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {items.length} {items.length === 1 ? "entry" : "entries"}
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
                    if (e.key === "Enter" && draft[titleField]) {
                      addItem(draft);
                      setAddOpen(false);
                      setDraft({});
                    }
                  }}
                  autoFocus
                />
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
              {editFields.map((f) => (
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
                disabled={!draft[titleField]}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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

      {items.length === 0 ? (
        <EmptyState>Nothing here yet. Use Add, or tap a suggestion.</EmptyState>
      ) : (
        <div className="rounded-md border">
          {order.map((idx) => {
            const item = items[idx];
            return (
            <div key={item.id || `${item[titleField]}-${idx}`}
              className="border-b border-border last:border-b-0">
              <div className="flex cursor-pointer items-center gap-2 px-3 py-2.5 hover:bg-muted/40"
                onClick={() => setExpanded({ ...expanded, [idx]: !expanded[idx] })}>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded[idx] ? "" : "-rotate-90"}`} />
                <span className="truncate text-sm font-medium">{item[titleField]}</span>
                <span className="flex flex-1 items-center gap-1.5">
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
                  onClick={(e) => { e.stopPropagation(); removeItem(idx); }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {expanded[idx] && (
                <div className="grid gap-3 px-9 pb-3 sm:grid-cols-2">
                  {editFields.map((f) => (
                    <div key={f} className={longText.has(f) || arrayFields.includes(f) ? "sm:col-span-2" : ""}>
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
    </div>
  );
}
