import { useState } from "react";
import { Plus, Trash2, ChevronDown } from "lucide-react";
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

function FieldInput({ field, value, onChange, entity, arrayFields }) {
  const enums = entity.valid_values?.[field];
  if (enums) {
    return (
      <select
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">—</option>
        {enums.map((v) => (
          <option key={v} value={v}>{v.replace(/_/g, " ")}</option>
        ))}
      </select>
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

  const updateItem = (idx, field, value) => {
    const next = [...items];
    next[idx] = { ...next[idx], [field]: value };
    if (value === undefined || value === "") delete next[idx][field];
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
        <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setDraft({}); }}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline"><Plus className="mr-1 h-4 w-4" />Add</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add {entityName.replace(/_/g, " ")}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs capitalize">{titleField}</Label>
                <Input
                  value={draft[titleField] || ""}
                  onChange={(e) => setDraft({ ...draft, [titleField]: e.target.value })}
                  autoFocus
                />
              </div>
              {editFields.map((f) => (
                <div key={f}>
                  <Label className="text-xs capitalize">{f.replace(/_/g, " ")}</Label>
                  <FieldInput field={f} value={draft[f]} entity={entity} arrayFields={arrayFields}
                    onChange={(v) => setDraft({ ...draft, [f]: v })} />
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
            Suggested — tap to add
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions
              .filter((s) => !existingTitles.has(s.toLowerCase()))
              .map((s) => (
                <button key={s} type="button"
                  onClick={() => addItem({ [titleField]: s })}
                  className="rounded-full border border-input bg-background px-3 py-1 text-xs text-muted-foreground hover:bg-muted/50">
                  + {s}
                </button>
              ))}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState>Nothing here yet — add your first entry above.</EmptyState>
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
                  {badges.filter((b) => item[b]).map((b) => (
                    <Badge key={b} variant="secondary" className="text-[10px]">
                      {String(item[b]).replace(/_/g, " ")}
                    </Badge>
                  ))}
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
                      <FieldInput field={f} value={item[f]} entity={entity} arrayFields={arrayFields}
                        onChange={(v) => updateItem(idx, f, v)} />
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
