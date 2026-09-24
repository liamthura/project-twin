import { useState, Fragment } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { proposalSummary, humanise, renderValue } from "./proposalSummary";

const ACTION_VERB = { add: "Add", update: "Update", remove: "Remove" };

/**
 * One inbox item, one line.
 *
 * Approving does not require expanding. The split from observations is by how
 * much thought an item needs, and a queue that makes a two-second decision
 * look like a considered one gets abandoned at the considered ones.
 *
 * `proposed_by` and `seen N×` live in the expanded detail because the line has
 * no room for them. On an observation they stay on the card face, where they
 * inform a decision the reader is about to make.
 */
export default function InboxRow({ row, packs, busy, onApprove, onReject }) {
  const [open, setOpen] = useState(false);
  const { lead, trail, extra } = proposalSummary(row, packs);

  return (
    <div className="rounded-lg border">
      {/* Wraps on a phone: the summary takes the first line and the buttons
          the second, rather than three fixed columns squeezing the value the
          reader is deciding on down to nothing. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
        <span className="flex min-w-0 basis-full items-center gap-3 sm:flex-1 sm:basis-auto">
        <span className="w-16 shrink-0 font-medium">
          {ACTION_VERB[row.action] || row.action}
        </span>
        <span className="w-32 shrink-0 truncate text-muted-foreground max-sm:w-auto max-sm:max-w-[40%]">
          {humanise(row.entity)}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {lead}
          {trail && (
            <>
              <span className="text-muted-foreground"> → </span>
              {trail}
            </>
          )}
          {extra > 0 && (
            <span className="ml-2 text-xs text-muted-foreground">+{extra} more</span>
          )}
        </span>
        </span>

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
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{row.proposed_by}</Badge>
            {row.seen_count > 1 && (
              <span className="text-xs text-muted-foreground">
                seen {row.seen_count}×
              </span>
            )}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
            {Object.entries(row.data || {}).map(([field, value]) => (
              <Fragment key={field}>
                <dt className="text-muted-foreground">{humanise(field)}</dt>
                <dd className="min-w-0 break-words">{renderValue(value)}</dd>
              </Fragment>
            ))}
          </dl>
          <p className="text-sm text-muted-foreground">{row.rationale}</p>
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
