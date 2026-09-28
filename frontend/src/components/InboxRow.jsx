import { useState, Fragment } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { proposalSummary, entityPlace, humanise, renderValue } from "./proposalSummary";

const ACTION_VERB = { add: "Add", update: "Update", remove: "Remove" };

/**
 * One inbox item.
 *
 * Approving does not require expanding. The split from observations is by how
 * much thought an item needs, and a queue that makes a two-second decision
 * look like a considered one gets abandoned at the considered ones.
 *
 * So the face carries what the decision needs: where it goes, in the editor's
 * words; the value, wrapped rather than cut off; who suggested it and why.
 * Those last two were behind the chevron, and a reason with a quote is the
 * whole case for approving at all. The quote and the field-by-field detail
 * stay behind it.
 */
export default function InboxRow({ row, packs, busy, onApprove, onReject }) {
  const [open, setOpen] = useState(false);
  const { lead, trail, extra } = proposalSummary(row, packs);

  return (
    <div className="rounded-lg border">
      {/* Wraps on a phone: the summary takes the full width and the buttons
          the line below it. */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5 text-sm">
        <div className="min-w-0 basis-full space-y-0.5 sm:flex-1 sm:basis-auto">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {ACTION_VERB[row.action] || row.action}
            </span>
            {" · "}
            {entityPlace(row.entity, packs)}
            {row.proposed_by && <> · from {row.proposed_by}</>}
          </p>
          <p className="break-words font-medium">
            {lead}
            {trail && (
              <>
                <span className="font-normal text-muted-foreground"> → </span>
                {trail}
              </>
            )}
            {extra > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">+{extra} more</span>
            )}
          </p>
          {row.rationale && <p className="text-muted-foreground">{row.rationale}</p>}
        </div>

        {/* Labelled, not bare icons: a tick and a cross in two colours were
            the only way to tell the two apart. The aria-label still carries
            the row's value, because a queue of a dozen rows otherwise offers a
            dozen buttons called "Approve"; it starts with the visible word so
            voice control can still find it.

            Approve and reject are both tinted, and deliberately at the same
            weight. A red reject beside a neutral approve pulls the eye down
            the reject column, which is the wrong emphasis for the action
            people take most. Foreground tint rather than a filled button on
            either: a queue of filled buttons out-shouts its own rows. */}
        <span className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          size="sm" variant="ghost" disabled={busy} onClick={onApprove}
          className="text-success hover:bg-success/10 hover:text-success"
          aria-label={`Approve ${lead}`}
        >
          <Check className="h-4 w-4" />
          Approve
        </Button>
        {/* Colour alone is not an accessible signal, which is what the
            aria-label is for. */}
        <Button
          size="sm" variant="ghost" disabled={busy} onClick={onReject}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Reject ${lead}`}
        >
          <X className="h-4 w-4" />
          Reject
        </Button>
        <Button
          size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}
          aria-expanded={open} aria-label={`Details for ${lead}`}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </Button>
        </span>
      </div>

      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          {row.seen_count > 1 && (
            <p className="text-xs text-muted-foreground">seen {row.seen_count}×</p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
            {Object.entries(row.data || {}).map(([field, value]) => (
              <Fragment key={field}>
                <dt className="text-muted-foreground">{humanise(field)}</dt>
                <dd className="min-w-0 break-words">{renderValue(value)}</dd>
              </Fragment>
            ))}
          </dl>
          {row.evidence && (
            <blockquote className="border-l-2 pl-3 text-sm italic text-muted-foreground">
              “{row.evidence}”
            </blockquote>
          )}
        </div>
      )}
    </div>
  );
}
