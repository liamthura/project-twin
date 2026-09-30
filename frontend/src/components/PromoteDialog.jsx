import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { bindingNodes, humanise } from "./proposalSummary";

const sentence = (key) => {
  const words = humanise(key);
  return words.charAt(0).toUpperCase() + words.slice(1);
};

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
    .map(([entity, spec]) => {
      // In the editor's own words: the subsection's title, and the field's
      // label and hint. The list read "mood override" and "response format",
      // so "Prefers comments in the margin" went under a field called "mood"
      // and looked no more wrong than any other choice.
      const [node, other] = bindingNodes(pack.sections, entity);
      const host = node || variantHost(pack.sections, entity);
      // An entity no section draws (preferences' generic `preference`) would
      // file the note where the editor never shows it.
      if (pack.sections && !host) return null;
      const shown = other ? null : host;
      const def = shown?.element?.fields?.find((f) => f.name === spec.identifier);
      // Two entities over one list (like and dislike) are told apart by name.
      const shared = shown?.element?.variants?.length > 0 || shown !== node;
      return {
        entity,
        field: spec.identifier,
        // An untitled list (Goals, Circle) goes by what one entry is called.
        title: shown?.title
          ? (shared ? `${shown.title}: ${humanise(entity)}` : shown.title)
          : sentence(shown?.element?.noun ?? entity),
        // A list of plain strings has no field of its own to name.
        label: def?.label || (shown && !def ? "Text" : sentence(spec.identifier)),
        placeholder: def?.placeholder || shown?.placeholder,
      };
    })
    .filter(Boolean);
}

// The node an entity is a variant of: `dislike` is drawn by the list whose
// element is `like`.
function variantHost(nodes, entity) {
  for (const node of nodes || []) {
    if (node?.element?.variants?.some((v) => v.entity === entity)) return node;
    const inner = variantHost(node?.sections, entity);
    if (inner) return inner;
  }
  return null;
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
                  entity: defaultTarget(next),
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
                    {t.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
