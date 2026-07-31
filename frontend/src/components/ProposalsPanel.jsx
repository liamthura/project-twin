import { useState, useEffect, useCallback, Fragment } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  listProposals, approveProposal, rejectProposal, promoteProposal,
} from "@/lib/api";

const KINDS = [
  { key: "entity", label: "Inbox" },
  { key: "note", label: "Observations" },
];

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

export default function ProposalsPanel({
  onViewSection, onSectionChanged, onResolved, sectionTitles = {}, packs = [],
}) {
  const [kind, setKind] = useState("entity");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [promoting, setPromoting] = useState(null);
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
      // The sidebar dot is owned by the app, and it stops polling while this
      // panel is open -- so resolving something has to tell it directly.
      onResolved?.();
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

  // Sections that can actually receive a note, in tab order.
  const promotable = packs
    .filter((p) => p.enabled !== false && promotionTargets(p).length)
    .map((p) => ({ key: p.key, title: p.title || p.key, targets: promotionTargets(p) }));

  function openPromote(row) {
    // Default to what the agent suggested, but only if that section can
    // actually hold a note -- otherwise fall back visibly rather than filing
    // somewhere the card never mentioned.
    const hinted = promotable.find((s) => s.key === row.section_hint);
    const section = hinted || promotable[0];
    setPromoting({
      row,
      section: section?.key ?? "",
      entity: section?.targets[0]?.entity ?? "",
      text: row.note || "",
    });
  }

  function confirmPromote() {
    const { row, section, entity, text } = promoting;
    const field = promotable
      .find((s) => s.key === section)?.targets
      .find((t) => t.entity === entity)?.field;
    setPromoting(null);
    if (!field || !text.trim()) return;
    return act(row.id, "Promoted to your persona", () =>
      promoteProposal(row.id, entity, { [field]: text.trim() }));
  }

  const promotingSection = promotable.find((s) => s.key === promoting?.section);
  const promotingField = promotingSection?.targets
    .find((t) => t.entity === promoting?.entity)?.field;

  const selectClass =
    "h-9 w-full rounded-md border border-input bg-background px-3 text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";

  return (
    <div className="space-y-4">
      <Dialog open={Boolean(promoting)} onOpenChange={(o) => !o && setPromoting(null)}>
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
              <select
                id="promote-section"
                className={selectClass}
                value={promoting?.section || ""}
                onChange={(e) => {
                  const next = promotable.find((s) => s.key === e.target.value);
                  setPromoting((p) => ({
                    ...p,
                    section: e.target.value,
                    entity: next?.targets[0]?.entity ?? "",
                  }));
                }}
              >
                {promotable.map((s) => (
                  <option key={s.key} value={s.key}>{s.title}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="promote-entity">Type</Label>
              <select
                id="promote-entity"
                className={selectClass}
                value={promoting?.entity || ""}
                onChange={(e) =>
                  setPromoting((p) => ({ ...p, entity: e.target.value }))
                }
              >
                {(promotingSection?.targets || []).map((t) => (
                  <option key={t.entity} value={t.entity}>
                    {humanise(t.entity)}
                  </option>
                ))}
              </select>
            </div>

            {promotingField && (
              <div className="space-y-1.5">
                {/* The agent's wording is a starting point, not the record.
                    Editing here is the last chance before it becomes data. */}
                <Label htmlFor="promote-text">{humanise(promotingField)}</Label>
                <Input
                  id="promote-text"
                  value={promoting?.text || ""}
                  onChange={(e) =>
                    setPromoting((p) => ({ ...p, text: e.target.value }))
                  }
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoting(null)}>
              Cancel
            </Button>
            <Button
              onClick={confirmPromote}
              disabled={!promotingField || !promoting?.text?.trim()}
            >
              Promote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                // "suggested", not an arrow: this is where the agent thinks it
                // belongs, and you choose the real destination on promote. An
                // arrow read as a promise the promote dialog then broke.
                <span className="text-xs text-muted-foreground">
                  suggested: {humanise(row.section_hint)}
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
                    disabled={busy === row.id || !promotable.length}
                    onClick={() => openPromote(row)}
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
