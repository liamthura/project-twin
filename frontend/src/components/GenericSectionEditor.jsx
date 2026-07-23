import { useState } from "react";
import {
  Plus, Trash2, ChevronDown,
  Heart, ThumbsUp, Ban, Bookmark, Play, Check, X, Pause, CircleDot,
  BookOpen, Newspaper, Mic, Tv, Clapperboard, Gamepad2, Video, Music,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrayInput } from "@/components/ArrayInput";

const LONG_TEXT_FIELDS = new Set(["notes", "why", "description"]);

// Enums with this many values or fewer render as a segmented control;
// larger sets render as wrapping chip radios. Clicking the active choice
// clears it (all generic enum fields are optional).
const SEGMENTED_MAX = 4;

// Semantic icon + color pairing for well-known enum values, so state reads
// at a glance. Accessibility rule: color is never the only signal — every
// value keeps its text label and gains an icon; tints meet AA in both themes.
const VALUE_META = {
  // aesthetics stance
  love: { icon: Heart, tone: "text-rose-600 dark:text-rose-400",
          chip: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300" },
  like: { icon: ThumbsUp },
  avoid: { icon: Ban, tone: "text-amber-700 dark:text-amber-400",
           chip: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  // media + goal status
  want: { icon: Bookmark },
  in_progress: { icon: Play },
  finished: { icon: Check, tone: "text-emerald-700 dark:text-emerald-400",
              chip: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
  achieved: { icon: Check, tone: "text-emerald-700 dark:text-emerald-400",
              chip: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
  active: { icon: CircleDot, tone: "text-emerald-700 dark:text-emerald-400",
            chip: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
  paused: { icon: Pause, tone: "text-amber-700 dark:text-amber-400",
            chip: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  dropped: { icon: X },
  // media kinds (icon only — categorical, no status semantics)
  book: { icon: BookOpen },
  article: { icon: Newspaper },
  podcast: { icon: Mic },
  show: { icon: Tv },
  film: { icon: Clapperboard },
  game: { icon: Gamepad2 },
  video: { icon: Video },
  music: { icon: Music },
};

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

function ValueIcon({ value, className }) {
  const Icon = VALUE_META[value]?.icon;
  return Icon ? <Icon aria-hidden="true" className={className} /> : null;
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="inline-flex rounded-lg bg-muted p-[3px]">
      {options.map((v) => {
        const active = value === v;
        const tone = active ? VALUE_META[v]?.tone : undefined;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? undefined : v)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm capitalize transition-colors ${FOCUS_RING} ${
              active
                ? `bg-background font-medium shadow-sm ${tone || "text-foreground"}`
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ValueIcon value={v} className="h-3.5 w-3.5" />
            {v.replace(/_/g, " ")}
          </button>
        );
      })}
    </div>
  );
}

function ChipRadioGroup({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((v) => {
        const active = value === v;
        const chip = active ? VALUE_META[v]?.chip : undefined;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? undefined : v)}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs capitalize transition-colors ${FOCUS_RING} ${
              active
                ? chip || "border-primary bg-accent font-medium text-accent-foreground"
                : "border-input bg-background text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <ValueIcon value={v} className="h-3 w-3" />
            {v.replace(/_/g, " ")}
          </button>
        );
      })}
    </div>
  );
}

function FieldInput({ field, value, onChange, entity, arrayFields, customValue, onCustomChange }) {
  const enums = entity.valid_values?.[field];
  if (enums) {
    const customField = `custom_${field}`;
    const hasCustom = (entity.optional || []).includes(customField);
    const Control = enums.length <= SEGMENTED_MAX ? SegmentedControl : ChipRadioGroup;
    return (
      <div className="space-y-2">
        <Control options={enums} value={value} onChange={onChange} />
        {hasCustom && value === "other" && (
          <Input
            value={customValue || ""}
            onChange={(e) => onCustomChange?.(e.target.value)}
            placeholder={`Custom ${field.replace(/_/g, " ")}…`}
            className="h-8 max-w-[240px]"
            autoFocus
          />
        )}
      </div>
    );
  }
  if (arrayFields.includes(field)) {
    return <ArrayInput items={value || []} onChange={onChange} placeholder={`Add ${field}…`} />;
  }
  if (LONG_TEXT_FIELDS.has(field)) {
    return <Textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={2} />;
  }
  return <Input value={value || ""} onChange={(e) => onChange(e.target.value)} />;
}

function PackList({ listKey, uiSpec, entityName, entity, items, onItems, onShowConfirmation }) {
  const [expanded, setExpanded] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const titleField = uiSpec.title_field;
  const badges = uiSpec.badges || [];
  const detailFields = uiSpec.detail_fields || [];
  const arrayFields = uiSpec.array_fields || [];
  const suggestions = uiSpec.suggestions?.[titleField] || [];
  const existingTitles = new Set(items.map((i) => (i[titleField] || "").toLowerCase()));
  const editFields = [...new Set([...badges, ...detailFields])];

  const addItem = (base) => {
    const item = { ...(entity.field_defaults || {}), ...base };
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
            setDraft(o ? { ...(entity.field_defaults || {}) } : {});
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" variant="outline"><Plus className="mr-1 h-4 w-4" />Add</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add {entityName.replace(/_/g, " ")}</DialogTitle></DialogHeader>
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
                  <FieldInput
                    field={f}
                    value={draft[f]}
                    entity={entity}
                    arrayFields={arrayFields}
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
          {items.map((item, idx) => (
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
                    <div key={f} className={LONG_TEXT_FIELDS.has(f) || arrayFields.includes(f) ? "sm:col-span-2" : ""}>
                      <Label className="text-xs capitalize">{f.replace(/_/g, " ")}</Label>
                      <FieldInput
                        field={f}
                        value={item[f]}
                        entity={entity}
                        arrayFields={arrayFields}
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
          ))}
        </div>
      )}
    </div>
  );
}

export default function GenericSectionEditor({ pack, data, onChange, onShowConfirmation }) {
  const ui = pack.ui || {};
  const entityByList = {};
  for (const [entityName, espec] of Object.entries(pack.entities || {})) {
    if (espec.list) entityByList[espec.list] = { entityName, espec };
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{pack.title}</CardTitle>
        <CardDescription>{pack.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {Object.entries(ui).map(([listKey, uiSpec]) => {
          const entityNames = Object.keys(pack.entities || {});
          const mapping = entityByList[listKey] ||
            (entityNames.length === 1
              ? { entityName: entityNames[0], espec: pack.entities[entityNames[0]] }
              : null);
          if (!mapping) return null;
          return (
            <PackList
              key={listKey}
              listKey={listKey}
              uiSpec={uiSpec}
              entityName={mapping.entityName}
              entity={mapping.espec}
              items={Array.isArray(data?.[listKey]) ? data[listKey] : []}
              onItems={(next) => onChange({ ...(data || {}), [listKey]: next })}
              onShowConfirmation={onShowConfirmation}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}
