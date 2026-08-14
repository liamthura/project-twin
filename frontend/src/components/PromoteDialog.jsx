import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
            {/* Label htmlFor + SelectTrigger id, the same pairing the sort
                control uses. A Radix trigger is a button, so this is what
                gives it an accessible name. */}
            <Select
              value={promoting?.section || ""}
              onValueChange={(value) => {
                const next = promotable.find((s) => s.key === value);
                onChange((p) => ({
                  ...p,
                  section: value,
                  entity: next?.targets[0]?.entity ?? "",
                }));
              }}
            >
              <SelectTrigger id="promote-section">
                <SelectValue placeholder="Choose a section" />
              </SelectTrigger>
              <SelectContent>
                {promotable.map((s) => (
                  <SelectItem key={s.key} value={s.key}>{s.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="promote-entity">Type</Label>
            <Select
              value={promoting?.entity || ""}
              onValueChange={(value) => onChange((p) => ({ ...p, entity: value }))}
            >
              <SelectTrigger id="promote-entity">
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                {(section?.targets || []).map((t) => (
                  <SelectItem key={t.entity} value={t.entity}>
                    {humanise(t.entity)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
