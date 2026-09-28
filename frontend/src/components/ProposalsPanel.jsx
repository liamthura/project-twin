import { useState, useEffect, useCallback, useRef } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  listProposals, proposalCount, approveProposal, rejectProposal, promoteProposal,
  listConnectedApps, listTokens, listStale, keepEntry,
} from "@/lib/api";
import { formatDateLabel } from "@/renderers/isoDate";
import { connectionStatus } from "./onboarding/connectionStatus";
import InboxRow from "./InboxRow";
import ObservationCard from "./ObservationCard";
import PromoteDialog, { promotionTargets } from "./PromoteDialog";

const KINDS = [
  { key: "entity", label: "Inbox" },
  { key: "note", label: "Observations" },
  // Not suggestions: entries of yours that have sat unchanged past their
  // section's window. Here so everything waiting on the reader is in one place,
  // but left off the rail's count, which is for what assistants sent.
  { key: "stale", label: "Stale" },
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

// How long a Reject or Delete waits before it reaches the server. Nothing on
// the server takes a rejection back, so the toast's Undo is only real if the
// request has not been sent yet.
const UNDO_MS = 8000;

export default function ProposalsPanel({
  onViewSection, onSectionChanged, onCounts, onOpenSettings, onConnect,
  sectionTitles = {}, packs = [],
}) {
  const [kind, setKind] = useState("entity");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [promoting, setPromoting] = useState(null);
  const [counts, setCounts] = useState({ entity: 0, note: 0, total: 0 });
  const [connection, setConnection] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const { toast } = useToast();
  // id -> { kind, timer, dismiss } for each rejection not yet confirmed sent.
  const pendingRef = useRef(new Map());

  // Held in a ref so refreshCounts never changes identity. It is a dependency
  // of the polling effect, so a caller passing an inline arrow would otherwise
  // tear down and rebuild the interval on every render -- and a 15s interval
  // rebuilt every render never fires at all.
  const onCountsRef = useRef(onCounts);
  onCountsRef.current = onCounts;

  // The tab you are not looking at has to say how much is waiting in it, and
  // the count endpoint is the only read that does not mark rows seen.
  const refreshCounts = useCallback(async () => {
    try {
      const [counted, stale] = await Promise.all([
        proposalCount(),
        listStale().catch(() => []),
      ]);
      const next = { ...counted, stale: stale.length };
      // A rejection inside its Undo window is still counted by the server, and
      // the poll would otherwise put it back on the badge the row left.
      for (const { kind } of pendingRef.current.values()) {
        next[kind] = Math.max(0, (next[kind] ?? 0) - 1);
        next.total = Math.max(0, next.total - 1);
      }
      setCounts(next);
      onCountsRef.current?.(next.total);
    } catch {
      // A stale badge beats a broken panel.
    }
  }, []);

  const refresh = useCallback(async (which) => {
    try {
      // A row waiting out its Undo is still on the server, and the 15s poll
      // would otherwise bring it back.
      const fresh = which === "stale"
        ? (await listStale()).map((r) => ({ ...r, kind: "stale" }))
        : await listProposals(which);
      setRows(fresh.filter((r) => !pendingRef.current.has(r.id)));
      setError(null);
    } catch {
      setRows([]);
      setError("Could not load the queue.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { refresh(kind); refreshCounts(); }, [kind, refresh, refreshCounts]);

  // Leaving Review sends whatever is still waiting: the reader watched it go.
  useEffect(() => () => {
    for (const [id, pending] of pendingRef.current) {
      if (pending.sent) continue;
      clearTimeout(pending.timer);
      pending.dismiss();
      rejectProposal(id).catch(() => {});
    }
    pendingRef.current.clear();
  }, []);

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
  // app that already polls.
  //
  // Tokens and grants both count. Checking grants alone told everyone who
  // connected with a token that nothing was connected -- the same shared rule
  // as onboarding and the Getting-started card, so the three cannot disagree.
  // listTokens throws for a read-scoped credential; that is a permission, not
  // a failure, so it degrades to "no tokens I can see".
  useEffect(() => {
    // `loaded` matters: rows is [] on the first render too, before the queue
    // has been fetched at all. Without it this fires on every mount, which is
    // the opposite of asking only when there is nothing to review.
    if (!loaded || rows.length > 0 || connection !== null) return;
    let cancelled = false;
    Promise.all([
      listTokens().catch(() => []),
      listConnectedApps().catch(() => []),
    ]).then(([tokens, grants]) => {
      // `total` because naming one connection when several can only read
      // would imply the others can suggest.
      if (!cancelled) {
        setConnection({
          ...connectionStatus(tokens, grants),
          total: tokens.length + grants.length,
        });
      }
    });
    return () => { cancelled = true; };
  }, [loaded, rows.length, connection]);

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

  /**
   * Reject (or Delete) now on screen, on the server once the toast has gone.
   * The row leaves at once, as it does for Approve; Undo puts it back where it
   * was. A failed send puts it back too, and says so.
   */
  function rejectLater(row, title) {
    const at = rows.findIndex((r) => r.id === row.id);
    // The badges follow the queue on screen, not the server, for the 8s the
    // two disagree: "Inbox 3" over two rows read as a row gone missing.
    const bump = (delta) =>
      setCounts((c) => {
        const next = {
          ...c,
          [row.kind]: Math.max(0, (c[row.kind] ?? 0) + delta),
          total: Math.max(0, c.total + delta),
        };
        onCountsRef.current?.(next.total);
        return next;
      });
    bump(-1);
    const restore = () =>
      setRows((current) => {
        const next = [...current];
        next.splice(Math.max(0, Math.min(at, next.length)), 0, row);
        return next;
      });
    setRows((current) => current.filter((r) => r.id !== row.id));

    // Held until the server answers, so a poll landing mid-request neither
    // lists the row again nor counts it.
    const send = async () => {
      try {
        await rejectProposal(row.id);
        pendingRef.current.delete(row.id);
        refreshCounts();
      } catch {
        pendingRef.current.delete(row.id);
        restore();
        bump(1);
        toast({
          title: "That did not go through",
          description: "The item is back in the queue.",
          variant: "destructive",
        });
      }
    };
    const undo = () => {
      const pending = pendingRef.current.get(row.id);
      // `sent` once the timer has fired: the request is out, and there is
      // nothing left to take back.
      if (!pending || pending.sent) return;
      clearTimeout(pending.timer);
      pendingRef.current.delete(row.id);
      restore();
      bump(1);
    };
    const shown = toast({
      title,
      duration: UNDO_MS,
      action: <ToastAction altText="Undo" onClick={undo}>Undo</ToastAction>,
    });
    const fire = () => {
      pendingRef.current.get(row.id).sent = true;
      send();
    };
    pendingRef.current.set(row.id, {
      kind: row.kind,
      timer: setTimeout(fire, UNDO_MS),
      dismiss: shown.dismiss,
    });
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
      {/* Titled as Settings and every section are, so the page says where you
          are and a screen reader has an h1 to land on. */}
      <div className="space-y-1 pb-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Review</h1>
        <p className="text-sm text-muted-foreground">
          What your assistants suggested, and entries that may be out of date. Nothing
          suggested reaches your persona until you say so.
        </p>
      </div>

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
              {/* Both the space and the margin are needed, at different
                  layers. The whitespace text node is what makes the accessible
                  name "Inbox 3" rather than "Inbox3" -- but TabsTrigger is
                  inline-flex, and a whitespace-only text node never becomes a
                  flex item, so on screen it contributes nothing. The margin is
                  what you actually see. */}
              {counts[k.key] > 0 && (
                <>
                  {" "}
                  <span className="ml-1.5 text-xs text-muted-foreground">
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
          {/* Each tab says what it holds. Observations used to repeat the
              Inbox line, so nothing anywhere said what an observation is. */}
          {kind === "stale" ? (
            <p>
              Nothing stale. An entry shows up here when it has gone a long time
              without changing, so you can keep it or update it.
            </p>
          ) : kind === "note" ? (
            <p>
              No observations. These are things an assistant noticed that don&apos;t
              belong to one section yet. Promote one into a section, or delete it.
            </p>
          ) : (
            <p>Nothing waiting. Assistants suggest changes here as they notice them.</p>
          )}
          {kind !== "stale" && connection?.state === "none" && (
            <p>
              Nothing is connected yet.{" "}
              <Button variant="link" className="h-auto p-0" onClick={onConnect}>
                Connect an app
              </Button>
            </p>
          )}
          {kind !== "stale" && connection?.state === "waiting" && (
            <p>
              {connection.name || "Your token"} is set up but hasn&apos;t been used yet.
              Suggestions arrive once your client makes its first call.
            </p>
          )}
          {kind !== "stale" && connection?.state === "connected" && !connection.canPropose && (
            <p>
              {connection.total === 1
                ? `${connection.name || "Your connection"} can read your persona but not suggest changes to it.`
                : "None of your connections can suggest changes to your persona."}{" "}
              <Button
                variant="link"
                className="h-auto p-0"
                onClick={() => onOpenSettings?.(connection.kind === "grant" ? "apps" : "tokens")}
              >
                Review access
              </Button>
            </p>
          )}
        </EmptyState>
      ) : (
        rows.map((row) =>
          row.kind === "stale" ? (
            <StaleRow
              key={row.id}
              row={row}
              section={sectionTitles[row.section] || row.section}
              busy={busy === row.id}
              onKeep={() => act(row.id, "Kept. It won't show as stale for a while.", () => keepEntry(row.id))}
              onOpen={() => onViewSection?.(row.section)}
            />
          ) : row.kind === "entity" ? (
            <InboxRow
              key={row.id}
              row={row}
              packs={packs}
              busy={busy === row.id}
              onApprove={(edited) =>
                act(row.id, edited ? "Added to your persona, with your changes" : "Added to your persona", () =>
                  approveProposal(row.id, edited))
              }
              onReject={() => rejectLater(row, "Rejected. It won't be suggested again.")}
            />
          ) : (
            <ObservationCard
              key={row.id}
              row={row}
              busy={busy === row.id}
              canPromote={promotable.length > 0}
              onPromote={() => openPromote(row)}
              onDelete={() => rejectLater(row, "Deleted. It won't be suggested again.")}
            />
          ),
        )
      )}
    </div>
  );
}

// One stale entry: where it lives, what it is, how long it has sat.
function StaleRow({ row, section, busy, onKeep, onOpen }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-xs text-muted-foreground">{section}</p>
        <p className="break-words font-medium">{row.title}</p>
        <p className="text-xs text-muted-foreground">Unchanged since {formatDateLabel(row.since)}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={onKeep}>
          Keep
        </Button>
        <Button size="sm" variant="ghost" onClick={onOpen}>
          Open in {section}
        </Button>
      </div>
    </div>
  );
}
