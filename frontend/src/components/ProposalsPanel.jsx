import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  listProposals, approveProposal, rejectProposal, promoteProposal,
} from "@/lib/api";

const KINDS = [
  { key: "entity", label: "Inbox" },
  { key: "note", label: "Observations" },
];

// A note carries only a section_hint, so promotion needs a destination entity.
// These are the entities that both accept a single free-text identifier and
// declare a `tags` field, so the agent-observation tag survives the promotion.
const PROMOTION_TARGET = {
  knowledge: { entity: "mental_tab", field: "title" },
  projects: { entity: "project", field: "name" },
  media: { entity: "media_item", field: "title" },
};
const DEFAULT_TARGET = { entity: "mental_tab", field: "title" };

/**
 * Two review surfaces over one queue.
 *
 * The split is by how much thought an item needs, not by lifecycle stage.
 * Inbox items are a two-second approve or reject. Observations need a
 * decision about where something belongs. A queue that mixes fast and slow
 * items gets abandoned at the slow ones.
 */
export default function ProposalsPanel() {
  const [kind, setKind] = useState("entity");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async (which) => {
    try {
      setRows(await listProposals(which));
      setError(null);
    } catch {
      setRows([]);
      setError("Could not load the queue.");
    }
  }, []);

  useEffect(() => { refresh(kind); }, [kind, refresh]);

  async function act(id, fn) {
    setBusy(id);
    try {
      await fn();
      setRows((current) => current.filter((r) => r.id !== id));
      setError(null);
    } catch {
      setError("That did not go through. The item is still in the queue.");
    } finally {
      setBusy(null);
    }
  }

  function promote(row) {
    const target = PROMOTION_TARGET[row.section_hint] || DEFAULT_TARGET;
    return promoteProposal(row.id, target.entity, { [target.field]: row.note });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {KINDS.map((k) => (
          <Button
            key={k.key}
            variant={kind === k.key ? "default" : "outline"}
            size="sm"
            onClick={() => setKind(k.key)}
          >
            {k.label}
          </Button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {rows.length === 0 ? (
        <EmptyState>
          Nothing waiting. Agents propose changes here as they notice them.
        </EmptyState>
      ) : (
        rows.map((row) => (
          <Card key={row.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{row.proposed_by}</Badge>
              {row.seen_count > 1 && (
                <span className="text-xs text-muted-foreground">
                  seen {row.seen_count}×
                </span>
              )}
              {row.section_hint && (
                <span className="text-xs text-muted-foreground">
                  → {row.section_hint}
                </span>
              )}
            </div>

            <p className="text-sm font-medium">
              {row.kind === "entity"
                ? `${row.action} ${row.entity}: ${JSON.stringify(row.data)}`
                : row.note}
            </p>

            <p className="text-sm text-muted-foreground">{row.rationale}</p>
            {row.evidence && (
              <blockquote className="border-l-2 pl-3 text-sm italic text-muted-foreground">
                “{row.evidence}”
              </blockquote>
            )}

            <div className="flex gap-2">
              {row.kind === "entity" ? (
                <>
                  <Button
                    size="sm"
                    disabled={busy === row.id}
                    onClick={() => act(row.id, () => approveProposal(row.id, undefined))}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === row.id}
                    onClick={() => act(row.id, () => rejectProposal(row.id))}
                  >
                    Reject
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    disabled={busy === row.id}
                    onClick={() => act(row.id, () => promote(row))}
                  >
                    Promote
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === row.id}
                    onClick={() => act(row.id, () => rejectProposal(row.id))}
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
