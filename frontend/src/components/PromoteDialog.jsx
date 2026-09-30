import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SelectControl } from "@/components/controls";
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

export const fillKey = (section, entity) => `${section}.${entity}`;

/**
 * The values a type's form starts with: the observation's note as its name,
 * as the dialog always offered, then whatever filling (backend/filling.py)
 * took from the observation, which replaces the name when it found a shorter
 * one and puts the note in the notes field instead.
 */
export function startingValues(target, note, fill) {
  const name = (target?.fields || []).find((f) => f.identifier)?.key;
  return { ...(name ? { [name]: note || "" } : {}), ...(fill?.values || {}) };
}

/** The required fields still empty: Promote waits for these. */
export function missingRequired(target, values) {
  return (target?.fields || []).filter((f) => f.required && !String(values?.[f.key] ?? "").trim());
}

/** What a promote sends: the values given, trimmed, and nothing left blank. */
export function promotedData(values) {
  return Object.fromEntries(
    Object.entries(values || {})
      .map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])
      .filter(([, v]) => v !== "" && v != null),
  );
}

// One field of the chosen type, as the editor would draw it.
function FieldInput({ field, value, onChange, labelled }) {
  const id = `promote-${field.key}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {field.label}
        {labelled && field.required && <span className="font-normal text-muted-foreground"> (required)</span>}
      </Label>
      {field.type === "enum" ? (
        <div id={id}>
          <SelectControl options={field.values} value={value || undefined} onChange={(v) => onChange(v ?? "")} />
        </div>
      ) : field.type === "longtext" ? (
        <Textarea id={id} rows={3} value={value || ""} placeholder={field.placeholder || undefined}
          onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={id} value={value || ""} placeholder={field.placeholder || undefined}
          onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

export default function PromoteDialog({
  promoting, promotable, onChange, onCancel, onConfirm,
}) {
  const section = promotable.find((s) => s.key === promoting?.section);
  const target = section?.targets.find((t) => t.entity === promoting?.entity);
  // Choosing a type, by any of the three controls, starts its form afresh:
  // from what filling found for it if that has arrived, else the note.
  const choose = (p, sectionKey, entity) => {
    const t = promotable.find((x) => x.key === sectionKey)?.targets.find((x) => x.entity === entity);
    const key = entity ? fillKey(sectionKey, entity) : null;
    return { ...p, section: sectionKey, entity, touched: true, valuesFor: key, edited: false,
      values: t ? startingValues(t, p.row?.note, p.fills?.[key]) : {} };
  };
  const missing = missingRequired(target, promoting?.values);
  // How many values came from filling rather than from the reader.
  const fill = promoting?.fills?.[fillKey(promoting?.section, promoting?.entity)];
  const filled = promoting?.edited ? 0 : Object.keys(fill?.confidence || {}).length;
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
                      onClick={() => onChange((p) => choose(p, s.section, s.entity))}
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
                onChange((p) => choose(p, value, defaultTarget(next)));
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
              onValueChange={(value) => onChange((p) => choose(p, p.section, value))}
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

          {/* The chosen type's own fields, as the editor names them. The
              observation's words are a starting point, not the record: this
              is the last chance to edit before they become data. */}
          {target && (
            <div className="space-y-3 border-t pt-4">
              {filled > 0 && (
                <p className="text-xs text-muted-foreground">
                  Filled in from the observation. Check them before you promote.
                </p>
              )}
              {(target.fields || []).map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  labelled={(target.fields || []).length > 1}
                  value={promoting.values?.[f.key]}
                  onChange={(v) => onChange((p) => ({ ...p, values: { ...p.values, [f.key]: v }, edited: true }))}
                />
              ))}
              {missing.length > 0 && (target.fields || []).length > 1 && (
                <p className="text-xs text-muted-foreground">
                  Still needed: {missing.map((f) => f.label).join(", ")}.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Pinned to the foot while the form scrolls: a work experience has
            six fields, and on a phone Promote went below the fold. */}
        <DialogFooter className="sticky -bottom-6 -mx-6 -mb-6 border-t bg-background px-6 py-4">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!target || missing.length > 0}>
            Promote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
