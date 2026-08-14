import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { humanise } from "./proposalSummary";

/**
 * An observation keeps its card.
 *
 * Promoting one is a real decision about where something belongs, so it gets
 * the surface that supports a decision: who proposed it, how many tools
 * noticed, the agent's reasoning and the user's own words. The inbox row next
 * door is a two-second approve, and it is one line for the same reason.
 */
export default function ObservationCard({ row, busy, canPromote, onPromote, onDelete }) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{row.proposed_by}</Badge>
        {row.seen_count > 1 && (
          <span className="text-xs text-muted-foreground">seen {row.seen_count}×</span>
        )}
        {row.section_hint && (
          // "suggested", not an arrow: this is where the agent thinks it
          // belongs, and you choose the real destination on promote. An arrow
          // read as a promise the promote dialog then broke.
          <span className="text-xs text-muted-foreground">
            suggested: {humanise(row.section_hint)}
          </span>
        )}
      </div>

      <p className="text-sm font-medium">{row.note}</p>
      <p className="text-sm text-muted-foreground">{row.rationale}</p>
      {row.evidence && (
        <blockquote className="border-l-2 pl-3 text-sm italic text-muted-foreground">
          “{row.evidence}”
        </blockquote>
      )}

      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !canPromote} onClick={onPromote}>
          Promote
        </Button>
        {/* Matches the inbox row's reject: same call, same tombstone, so it
            should not read as a milder act than the one next door. */}
        <Button
          size="sm" variant="outline" disabled={busy} onClick={onDelete}
          className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          Delete
        </Button>
      </div>
    </Card>
  );
}
