import { FolderInput, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FOCUS_RING } from "@/components/controls";

/**
 * One observation, laid out as an inbox row is: one header line saying what
 * it is, where and from whom, then the note, the reasoning and the reader's
 * own words, with the actions on the right. It used its own card, chip and
 * button weights, and read as a different product one tab over.
 *
 * Nothing sits behind a chevron: there are no fields to show, and promoting
 * one opens a dialog that asks where it goes.
 */
export default function ObservationCard({
  row, busy, canPromote, onPromote, onDelete, selected = false, onSelect, focusProps, place,
}) {
  return (
    <div
      {...focusProps}
      role="group"
      aria-label={`Observation: ${row.note}`}
      className={`rounded-lg border ${FOCUS_RING}`}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5 text-sm sm:flex-nowrap">
        <div className="flex min-w-0 basis-full items-start gap-3 sm:flex-1 sm:basis-auto">
          {onSelect && (
            <Checkbox
              checked={selected}
              onCheckedChange={(v) => onSelect(v === true)}
              aria-label={`Select ${row.note}`}
              className="tap-target mt-0.5"
            />
          )}
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Observation</span>
              {/* "suggested for", not a bare place: this is where the agent
                  thinks it belongs, and you choose the real destination on
                  promote. A plain destination read as a promise the promote
                  dialog then broke. */}
              {place && <> · suggested for {place}</>}
              {row.proposed_by && <> · from {row.proposed_by}</>}
              {row.seen_count > 1 && <> · seen {row.seen_count}×</>}
            </p>
            <p className="break-words font-medium">{row.note}</p>
            {row.rationale && <p className="text-muted-foreground">{row.rationale}</p>}
            {row.evidence && (
              <p className="break-words italic text-muted-foreground">“{row.evidence}”</p>
            )}
          </div>
        </div>

        {/* The inbox row's weights: tinted, not filled. Delete is the same call
            and the same tombstone as Reject, so it looks the same. */}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            size="sm" variant="ghost" disabled={busy || !canPromote} onClick={onPromote} data-guide="promote"
            className="text-primary hover:bg-primary/10 hover:text-primary"
            aria-label={`Promote ${row.note}`}
          >
            <FolderInput className="h-4 w-4" />
            Promote
          </Button>
          <Button
            size="sm" variant="ghost" disabled={busy} onClick={onDelete}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Delete ${row.note}`}
          >
            <X className="h-4 w-4" />
            Delete
          </Button>
        </span>
      </div>
    </div>
  );
}
