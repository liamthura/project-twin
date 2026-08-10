// The Add dialog, lifted out of ListRenderer so that one component owns the
// draft lifecycle, the copy, and the footer -- and so the section card header
// can mount the same dialog the empty-state panel mounts. Both entry points
// must seed `field_defaults` identically or a manifest default would apply
// invisibly on one route and visibly on the other.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { FOCUS_RING } from "@/components/controls";
import { buildFieldMeta } from "./fieldMeta";
import { ScalarField } from "./ScalarField";

export function AddEntryDialog({ node, entity, items, onAdd, open, onOpenChange, trigger }) {
  const titleField = node.title_field;
  const badges = node.badges ?? [];
  const detailFields = node.detail_fields ?? [];
  const pinnedField = node.pinned?.field;
  const fieldDefaults = node.field_defaults ?? entity?.field_defaults ?? {};
  const suggestions = node.suggestions?.[titleField] || [];
  const meta = buildFieldMeta(node, entity);

  const [draft, setDraft] = useState({ ...fieldDefaults });

  const existingTitles = new Set(items.map((i) => (i[titleField] || "").toLowerCase()));
  // Same case-insensitive comparison addItem uses to reject a collision --
  // computed here so the dialog can surface it instead of letting addItem
  // silently no-op and close on a title the user already has.
  const titleCollides =
    !!draft[titleField] && existingTitles.has(draft[titleField].toLowerCase());

  // `pinned.field` never renders as an editable control, per meta_schema.json.
  const editFields = [...new Set([...badges, ...detailFields])].filter((f) => f !== pinnedField);

  const submit = () => { onAdd(draft); onOpenChange(false); setDraft({}); };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        // Preselect manifest defaults (e.g. stance: like) so the controls show
        // the real initial state instead of applying it invisibly.
        setDraft(o ? { ...fieldDefaults } : {});
      }}
    >
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {/* A container name takes "Add to" -- the list is the destination, not the
                thing being added. An entity name is already the singular noun, so it
                takes a bare "Add". `Add Likes & Dislikes` was the old string. */}
            {node.title
              ? `Add to ${node.title}`
              : `Add ${(node.entity ?? "item").replace(/_/g, " ")}`}
          </DialogTitle>
          <DialogDescription>
            {node.description ?? `Add one entry to ${node.title ?? "this list"}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs capitalize">{titleField}</Label>
            <Input
              value={draft[titleField] || ""}
              onChange={(e) => setDraft({ ...draft, [titleField]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft[titleField] && !titleCollides) submit();
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
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!draft[titleField] || titleCollides}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
