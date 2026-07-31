import { useState, useEffect, useCallback, Fragment } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";
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

const ACTION_VERB = { add: "Add", update: "Update", remove: "Remove" };

// Entity names and field keys are snake_case in the schema. This is a review
// surface a person reads, so they get read as words.
function humanise(key) {
  return String(key || "").replace(/_/g, " ");
}

function renderValue(value) {
  if (Array.isArray(value)) return value.map(humanise).join(", ");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([k, v]) => `${humanise(k)}: ${v}`)
      .join(" · ");
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  return humanise(value);
}

/**
 * Two review surfaces over one queue.
 *
 * The split is by how much thought an item needs, not by lifecycle stage.
 * Inbox items are a two-second approve or reject. Observations need a
 * decision about where something belongs. A queue that mixes fast and slow
 * items gets abandoned at the slow ones.
 */
// Agents propose while you have this open, and nothing else tells the page.
// This is the only surface in the app that changes without the user doing
// anything, so it is the only one that polls -- and only while it is mounted,
// which Radix already scopes to the tab being open.
const QUEUE_POLL_MS = 15000;

export default function ProposalsPanel({ onViewSection, onSectionChanged, sectionTitles = {} }) {
  const [kind, setKind] = useState("entity");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const { toast } = useToast();

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

  useEffect(() => {
    const tick = () => {
      // A backgrounded tab polling every 15s is just battery and rate limit.
      if (document.visibilityState === "visible") refresh(kind);
    };
    const timer = setInterval(tick, QUEUE_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [kind, refresh]);

  /**
   * Run one resolution, then say what happened.
   *
   * `title` is past tense because the row vanishes as it fires -- the toast is
   * the only remaining evidence the click did anything. Where a section
   * actually changed, the toast carries the way to go and look at it: approving
   * something and being shown nothing is the moment a review queue starts to
   * feel like a void you throw decisions into.
   */
  async function act(id, title, fn) {
    setBusy(id);
    try {
      const res = await fn();
      setRows((current) => current.filter((r) => r.id !== id));
      setError(null);
      const section = res?.section;
      // Refetch the section that changed straight away, rather than waiting
      // for the user to click through and find stale data. We know exactly
      // what moved, so there is nothing here worth polling for.
      if (section) onSectionChanged?.(section);
      toast({
        title,
        variant: "success",
        ...(section && onViewSection
          ? {
              // The default 5s is enough to read a confirmation but not to
              // read one AND decide to follow a link.
              duration: 10000,
              action: (
                <ToastAction
                  altText={`View in ${sectionTitles[section] || section}`}
                  onClick={() => onViewSection(section)}
                >
                  View in {sectionTitles[section] || section}
                </ToastAction>
              ),
            }
          : {}),
      });
    } catch {
      setError("That did not go through. The item is still in the queue.");
      toast({
        title: "That did not go through",
        description: "The item is still in the queue.",
        variant: "destructive",
      });
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

            {row.kind === "entity" ? (
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  <span>{ACTION_VERB[row.action] || row.action}</span>{" "}
                  <span className="text-muted-foreground">{humanise(row.entity)}</span>
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                  {Object.entries(row.data || {}).map(([field, value]) => (
                    <Fragment key={field}>
                      <dt className="text-muted-foreground">{humanise(field)}</dt>
                      <dd className="min-w-0 break-words">{renderValue(value)}</dd>
                    </Fragment>
                  ))}
                </dl>
              </div>
            ) : (
              <p className="text-sm font-medium">{row.note}</p>
            )}

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
                    onClick={() =>
                      act(row.id, "Added to your persona", () =>
                        approveProposal(row.id, undefined))
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === row.id}
                    onClick={() =>
                      act(row.id, "Rejected — it will not be proposed again", () =>
                        rejectProposal(row.id))
                    }
                  >
                    Reject
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    disabled={busy === row.id}
                    onClick={() => act(row.id, "Promoted to your persona", () => promote(row))}
                  >
                    Promote
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === row.id}
                    onClick={() =>
                      act(row.id, "Deleted — it will not be proposed again", () =>
                        rejectProposal(row.id))
                    }
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
