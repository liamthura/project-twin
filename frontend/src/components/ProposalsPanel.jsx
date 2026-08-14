import { useState, useEffect, useCallback } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  listProposals, proposalCount, approveProposal, rejectProposal, promoteProposal,
  listConnectedApps,
} from "@/lib/api";
import InboxRow from "./InboxRow";
import ObservationCard from "./ObservationCard";
import PromoteDialog, { promotionTargets } from "./PromoteDialog";

// Must match auth/src/oauth.js and ConnectedApps.jsx exactly -- this is the
// wire value, not a label.
const PROPOSE = "persona:propose";

const KINDS = [
  { key: "entity", label: "Inbox" },
  { key: "note", label: "Observations" },
];

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
  onViewSection, onSectionChanged, onCounts, onOpenSettings,
  sectionTitles = {}, packs = [],
}) {
  const [kind, setKind] = useState("entity");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [promoting, setPromoting] = useState(null);
  const [counts, setCounts] = useState({ entity: 0, note: 0, total: 0 });
  const [grants, setGrants] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const { toast } = useToast();

  // The tab you are not looking at has to say how much is waiting in it, and
  // the count endpoint is the only read that does not mark rows seen.
  const refreshCounts = useCallback(async () => {
    try {
      const next = await proposalCount();
      setCounts(next);
      onCounts?.(next.total);
    } catch {
      // A stale badge beats a broken panel.
    }
  }, [onCounts]);

  const refresh = useCallback(async (which) => {
    try {
      setRows(await listProposals(which));
      setError(null);
    } catch {
      setRows([]);
      setError("Could not load the queue.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { refresh(kind); refreshCounts(); }, [kind, refresh, refreshCounts]);

  useEffect(() => {
    const tick = () => {
      // A backgrounded tab polling every 15s is just battery and rate limit.
      if (document.visibilityState !== "visible") return;
      refresh(kind);
      refreshCounts();
    };
    const timer = setInterval(tick, QUEUE_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [kind, refresh, refreshCounts]);

  // An empty queue has two very different causes, and they have different
  // fixes. Asked once, and only when there is nothing to review: a reader with
  // proposals waiting never sees this line, and this is the one surface in the
  // app that already polls. A failure is treated as "no grants", which renders
  // no extra line -- which is what happens today.
  useEffect(() => {
    // `loaded` matters: rows is [] on the first render too, before the queue
    // has been fetched at all. Without it this fires on every mount, which is
    // the opposite of asking only when there is nothing to review.
    if (!loaded || rows.length > 0 || grants !== null) return;
    let cancelled = false;
    listConnectedApps()
      .then((list) => { if (!cancelled) setGrants(list); })
      .catch(() => { if (!cancelled) setGrants([]); });
    return () => { cancelled = true; };
  }, [loaded, rows.length, grants]);

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
      // panel is open -- so resolving something has to tell it. Refreshing the
      // counts does both: it moves the tab badges and hands the new total up,
      // in one request rather than the panel's and App's.
      refreshCounts();
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

  return (
    <div className="space-y-4">
      <PromoteDialog
        promoting={promoting}
        promotable={promotable}
        onChange={setPromoting}
        onCancel={() => setPromoting(null)}
        onConfirm={confirmPromote}
      />

      <Tabs value={kind} onValueChange={setKind}>
        <TabsList>
          {KINDS.map((k) => (
            <TabsTrigger key={k.key} value={k.key}>
              {k.label}
              {/* A real space, not just the margin. Without a whitespace text
                  node the accessible name computes as "Inbox3". */}
              {counts[k.key] > 0 && (
                <>
                  {" "}
                  <span className="text-xs text-muted-foreground">
                    {counts[k.key]}
                  </span>
                </>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {rows.length === 0 ? (
        <EmptyState className="space-y-2">
          <p>Nothing waiting. Agents propose changes here as they notice them.</p>
          {grants?.length === 0 && (
            <p>
              Nothing is connected yet.{" "}
              <Button variant="link" className="h-auto p-0" onClick={onOpenSettings}>
                Connect an app
              </Button>
            </p>
          )}
          {grants?.length > 0
            && !grants.some((g) => (g.scopes || []).includes(PROPOSE)) && (
            <p>
              {grants.length === 1
                ? `${grants[0].clientName} can read your persona but not suggest changes to it.`
                : "None of your connected apps can suggest changes to your persona."}{" "}
              <Button variant="link" className="h-auto p-0" onClick={onOpenSettings}>
                Review access
              </Button>
            </p>
          )}
        </EmptyState>
      ) : (
        rows.map((row) =>
          row.kind === "entity" ? (
            <InboxRow
              key={row.id}
              row={row}
              packs={packs}
              busy={busy === row.id}
              onApprove={() =>
                act(row.id, "Added to your persona", () =>
                  approveProposal(row.id, undefined))
              }
              onReject={() =>
                act(row.id, "Rejected — it will not be proposed again", () =>
                  rejectProposal(row.id))
              }
            />
          ) : (
            <ObservationCard
              key={row.id}
              row={row}
              busy={busy === row.id}
              canPromote={promotable.length > 0}
              onPromote={() => openPromote(row)}
              onDelete={() =>
                act(row.id, "Deleted — it will not be proposed again", () =>
                  rejectProposal(row.id))
              }
            />
          ),
        )
      )}
    </div>
  );
}
