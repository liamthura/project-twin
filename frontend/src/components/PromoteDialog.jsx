import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { humanise } from "./proposalSummary";

/**
 * Which entities in a pack a single line of text can actually become.
 *
 * A note is one sentence, so the only entities it can fill are the ones whose
 * sole required field is their own identifier. Anything needing a second value
 * -- `hobby_specific` needs an owning hobby, `project_reference` needs a
 * project -- would produce a proposal that cannot execute, so it is not
 * offered rather than offered and then failing on confirm.
 */
export function promotionTargets(pack) {
  return Object.entries(pack?.entities || {})
    .filter(([, spec]) => {
      const required = spec.required || [];
      return (spec.actions || []).includes("add")
        && spec.identifier
        && !spec.parent
        && required.length === 1
        && required[0] === spec.identifier;
    })
    .map(([entity, spec]) => ({ entity, field: spec.identifier }));
}

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";

export default function PromoteDialog({
  promoting, promotable, onChange, onCancel, onConfirm,
}) {
  const section = promotable.find((s) => s.key === promoting?.section);
  const field = section?.targets.find((t) => t.entity === promoting?.entity)?.field;

  return (
    <Dialog open={Boolean(promoting)} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Promote to your persona</DialogTitle>
          <DialogDescription>
            An observation has no home of its own. Choose where this belongs
            and it becomes real, editable data.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="promote-section">Section</Label>
            <select
              id="promote-section"
              className={selectClass}
              value={promoting?.section || ""}
              onChange={(e) => {
                const next = promotable.find((s) => s.key === e.target.value);
                onChange((p) => ({
                  ...p,
                  section: e.target.value,
                  entity: next?.targets[0]?.entity ?? "",
                }));
              }}
            >
              {promotable.map((s) => (
                <option key={s.key} value={s.key}>{s.title}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="promote-entity">Type</Label>
            <select
              id="promote-entity"
              className={selectClass}
              value={promoting?.entity || ""}
              onChange={(e) => onChange((p) => ({ ...p, entity: e.target.value }))}
            >
              {(section?.targets || []).map((t) => (
                <option key={t.entity} value={t.entity}>
                  {humanise(t.entity)}
                </option>
              ))}
            </select>
          </div>

          {field && (
            <div className="space-y-1.5">
              {/* The agent's wording is a starting point, not the record.
                  Editing here is the last chance before it becomes data. */}
              <Label htmlFor="promote-text">{humanise(field)}</Label>
              <Input
                id="promote-text"
                value={promoting?.text || ""}
                onChange={(e) => onChange((p) => ({ ...p, text: e.target.value }))}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!field || !promoting?.text?.trim()}>
            Promote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
