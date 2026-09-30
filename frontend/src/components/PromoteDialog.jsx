import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/**
 * What an observation can become in one pack, as the server works it out
 * (pack_loader.derive_promotion_targets) and /api/settings serves it: an
 * entity a single sentence can fill, that a section draws, named as the
 * editor names it, with its manifest `about`. The rule lives there once, so
 * this dialog and the suggestions routing asks Jev for offer the same types.
 */
export function promotionTargets(pack) {
  return pack?.promotable || [];
}

// A section with one type has nothing to choose; one with several starts
// unchosen, because the first was a guess the reader had to notice to undo.
export const defaultTarget = (section) =>
  section?.targets.length === 1 ? section.targets[0].entity : "";

export default function PromoteDialog({
  promoting, promotable, onChange, onCancel, onConfirm,
}) {
  const section = promotable.find((s) => s.key === promoting?.section);
  const target = section?.targets.find((t) => t.entity === promoting?.entity);
  // Only what this dialog can actually file: a suggestion for a section the
  // reader has since turned off is dropped rather than offered.
  const suggested = (promoting?.suggestions || []).flatMap((s) => {
    const sec = promotable.find((x) => x.key === s.section);
    const t = sec?.targets.find((x) => x.entity === s.entity);
    return t ? [{ s, sec, t }] : [];
  });

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
          {suggested.length > 0 && (
            <div className="space-y-1.5">
              <p id="promote-suggested" className="text-sm font-medium">Suggested</p>
              {/* Where it most likely goes, from any section, one tap each.
                  Chosen for you only when the suggestion was sure. */}
              <div role="group" aria-labelledby="promote-suggested" className="flex flex-wrap gap-2">
                {suggested.map(({ s, sec, t }) => {
                  const on = promoting.section === s.section && promoting.entity === s.entity;
                  return (
                    <Button
                      key={`${s.section}.${s.entity}`}
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-pressed={on}
                      aria-label={`${t.title}, in ${sec.title}`}
                      className={on ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : ""}
                      onClick={() => onChange((p) => ({ ...p, section: s.section, entity: s.entity, touched: true }))}
                    >
                      {t.title}
                      <span className={on ? "text-primary/80" : "text-muted-foreground"}>· {sec.title}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

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
                  entity: defaultTarget(next),
                  touched: true,
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
              onValueChange={(value) => onChange((p) => ({ ...p, entity: value, touched: true }))}
            >
              <SelectTrigger id="promote-entity">
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                {(section?.targets || []).map((t) => (
                  <SelectItem key={t.entity} value={t.entity}>
                    {t.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* The manifest's own words for the type, the same ones Jev is
                given when it suggests one. */}
            {target?.about?.what && (
              <p className="text-xs text-muted-foreground">{target.about.what}.</p>
            )}
          </div>

          {section && (
            <div className="space-y-1.5">
              {/* The agent's wording is a starting point, not the record.
                  Editing here is the last chance before it becomes data. */}
              <Label htmlFor="promote-text">{target?.label || "Text"}</Label>
              <Input
                id="promote-text"
                value={promoting?.text || ""}
                placeholder={target?.placeholder}
                onChange={(e) => onChange((p) => ({ ...p, text: e.target.value }))}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!target || !promoting?.text?.trim()}>
            Promote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
