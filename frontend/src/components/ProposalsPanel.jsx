import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { Keyboard } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FOCUS_RING } from "@/components/controls";
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
import { entityPlace, findEntitySpec, humanise, proposalSummary, renderValue } from "./proposalSummary";
import ObservationCard from "./ObservationCard";
import PromoteDialog, { defaultTarget, promotionTargets } from "./PromoteDialog";

const clip = (text, max = 40) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

// "Added 4 to your persona" said nothing true about two of them when two were
// updates. One kind names its verb; a mix is counted by kind.
export function approvedMany(batch) {
  const counts = { add: 0, update: 0, remove: 0 };
  for (const row of batch) counts[row.action in counts ? row.action : "add"] += 1;
  const kinds = Object.entries(counts).filter(([, n]) => n);
  if (kinds.length === 1) {
    const [[action]] = kinds;
    const verb = { add: "Added", update: "Updated", remove: "Removed" }[action];
    const into = action === "remove" ? "from" : action === "update" ? "in" : "to";
    return `${verb} ${batch.length} ${into} your persona`;
  }
  const done = { add: "added", update: "updated", remove: "removed" };
  return `Approved ${batch.length}: ${kinds.map(([a, n]) => `${n} ${done[a]}`).join(", ")}`;
}

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

// How long the toast carrying an Approve, Reject or Delete's Undo stands. The
// decision is sent when that toast goes, not on a timer of its own: Radix
// pauses the toast while the pointer or focus is on it, and nothing on the
// server takes a decision back, so Undo is only real while nothing is sent.
const UNDO_MS = 8000;

// The row that has focus takes these. Only the row: a key typed into one of
// its inputs is text, and nothing fires without a row focused, which is what
// keeps single letters from misfiring for voice control (WCAG 2.1.4).
const KEYS = [
  ["j / ↓", "Next"],
  ["k / ↑", "Previous"],
  ["a", "Approve (Inbox)"],
  ["r", "Reject (Inbox)"],
  ["e", "Edit before approving (Inbox)"],
  ["Enter", "Show details (Inbox)"],
  ["x", "Select"],
  ["?", "This list"],
];
const MOVES = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 };

export default function ProposalsPanel({
  onViewSection, onSectionChanged, onCounts, onOpenSettings, onConnect,
  sectionTitles = {}, packs = [], packData = {},
}) {
  const [kind, setKind] = useState("entity");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [promoting, setPromoting] = useState(null);
  const [counts, setCounts] = useState({ entity: 0, note: 0, total: 0 });
  const [connection, setConnection] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const listRef = useRef(null);
  // { from, to }: after a key acts on `from`, focus goes to `to` once `from`
  // has left the list -- so the queue can be worked down without the mouse.
  const focusAfterRef = useRef(null);
  const { toast } = useToast();
  // id -> { kind, sent, undone, fire, dismiss } for each decision not yet
  // confirmed sent. A batch shares one record across its ids.
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
  useEffect(() => setSelected(new Set()), [kind]);

  const rowEls = () => [...(listRef.current?.querySelectorAll("[data-review-row]") || [])];
  useEffect(() => {
    const next = focusAfterRef.current;
    if (!next || rows.some((r) => r.id === next.from)) return;
    focusAfterRef.current = null;
    rowEls().find((el) => el.dataset.rowId === next.to)?.focus();
  }, [rows]);

  function advanceFrom(id) {
    const els = rowEls();
    const i = els.findIndex((el) => el.dataset.rowId === id);
    focusAfterRef.current = { from: id, to: (els[i + 1] || els[i - 1])?.dataset.rowId };
  }

  const choose = useCallback((id, on) => setSelected((current) => {
    if (current.has(id) === on) return current;
    const next = new Set(current);
    if (on) next.add(id); else next.delete(id);
    return next;
  }), []);

  const chosen = rows.filter((r) => selected.has(r.id));

  function onListKeyDown(e) {
    const rowEl = e.target.closest?.("[data-review-row]");
    if (!rowEl || e.target !== rowEl || e.metaKey || e.ctrlKey || e.altKey) return;
    const id = rowEl.dataset.rowId;
    if (MOVES[e.key]) {
      const els = rowEls();
      els[Math.max(0, Math.min(els.length - 1, els.indexOf(rowEl) + MOVES[e.key]))]?.focus();
    } else if (e.key === "x") {
      if (rowEl.dataset.selectable !== "false") choose(id, !selected.has(id));
    } else if (e.key === "?") {
      setShowKeys(true);
    } else {
      return;
    }
    e.preventDefault();
  }

  // From anywhere on the page, not only from a focused row: `?` on arrival
  // opened nothing though the list of keys offers it, and `j` had to follow a
  // click. Anything that takes typing, or a dialog or menu, keeps its keys.
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest?.(
        "[data-review-row], input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], [role='listbox']",
      )) return;
      if (e.key === "?") setShowKeys(true);
      // j and k only: the arrow keys still scroll the page.
      else if ((e.key === "j" || e.key === "k") && rowEls()[0]) rowEls()[0].focus();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Leaving Review sends whatever is still waiting: the reader watched it go.
  // Once per batch, which shares one record across its ids.
  useEffect(() => () => {
    for (const pending of new Set(pendingRef.current.values())) {
      pending.fire();
      pending.dismiss();
    }
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
   * Approve, Reject or Delete now on screen, on the server once the toast has
   * gone. The rows leave at once and Undo puts them back where they were:
   * nothing on the server takes a decision back, so Undo is only real while
   * the request has not been sent. An approval waits like the rest because it
   * is the one that writes, and a stray `a` should cost no more than a stray
   * `r`. Sent one after another -- two writes landing on one section at once
   * could lose one -- and a failure comes back to the queue, and says so.
   *
   * `call(row)` makes the request. `action`, when given, is a second toast
   * button beside Undo.
   */
  function resolveLater(batch, title, call, action) {
    const ids = new Set(batch.map((r) => r.id));
    const kind = batch[0].kind;
    // Where each sat, in order, so Undo puts them all back where they were.
    const at = batch
      .map((row) => [row, rows.findIndex((r) => r.id === row.id)])
      .sort((a, b) => a[1] - b[1]);
    // The badges follow the queue on screen, not the server, for the 8s the
    // two disagree: "Inbox 3" over two rows read as a row gone missing.
    const bump = (delta) =>
      setCounts((c) => {
        const next = {
          ...c,
          [kind]: Math.max(0, (c[kind] ?? 0) + delta),
          total: Math.max(0, c.total + delta),
        };
        onCountsRef.current?.(next.total);
        return next;
      });
    bump(-batch.length);
    const restore = (only = ids) =>
      setRows((current) => {
        const next = [...current];
        for (const [row, i] of at) {
          if (only.has(row.id)) next.splice(Math.max(0, Math.min(i, next.length)), 0, row);
        }
        return next;
      });
    setRows((current) => current.filter((r) => !ids.has(r.id)));

    // Held until the server answers, so a poll landing mid-request neither
    // lists the rows again nor counts them. Also run by leaving Review, when
    // this panel is gone: the section refresh and a failure's toast still
    // reach the app.
    const send = async () => {
      const failed = new Set();
      const sections = new Set();
      for (const row of batch) {
        try {
          const res = await call(row);
          if (res?.section) sections.add(res.section);
        } catch {
          failed.add(row.id);
        }
      }
      for (const id of ids) pendingRef.current.delete(id);
      refreshCounts();
      sections.forEach((section) => onSectionChanged?.(section));
      if (failed.size) {
        restore(failed);
        toast({
          title: "That did not go through",
          description: failed.size === 1
            ? "The item is back in the queue."
            : `${failed.size} items are back in the queue.`,
          variant: "destructive",
        });
      }
    };
    // One record for the batch, under each of its ids. `fire` sends it once,
    // when the toast goes however it goes (its time, its close button, a newer
    // toast replacing it, leaving Review), and never after Undo.
    const pending = { kind, sent: false, undone: false };
    pending.fire = () => {
      if (pending.sent || pending.undone) return;
      pending.sent = true;
      send();
    };
    const undo = () => {
      if (pending.sent || pending.undone) return;
      pending.undone = true;
      for (const id of ids) pendingRef.current.delete(id);
      restore();
      bump(batch.length);
    };
    const undoButton = <ToastAction altText="Undo" onClick={undo}>Undo</ToastAction>;
    const shown = toast({
      title,
      duration: UNDO_MS,
      action: action ? <>{undoButton}{action}</> : undoButton,
      onClose: pending.fire,
    });
    pending.dismiss = shown.dismiss;
    for (const id of ids) pendingRef.current.set(id, pending);
  }

  const rejectLater = (batch, title) => resolveLater(batch, title, (row) => rejectProposal(row.id));

  // What a toast calls the row it is about. "Added to Circle" did not say
  // who, and the next row sliding up under the pointer read the same; a
  // screen reader heard a place and no thing. A note is a sentence, so it
  // is quoted and cut to a glance.
  function named(row) {
    if (row.kind === "note") return `“${clip((row.note || "").replace(/[.!?]+$/, ""))}”`;
    const spec = findEntitySpec(row.entity, packs);
    const value = spec?.identifier ? row.data?.[spec.identifier] : null;
    return clip(value ? renderValue(value) : proposalSummary(row, packs).lead);
  }
  const said = (verb, row) => [verb, named(row)].filter(Boolean).join(" ");

  // Where an approval lands, in the toast's words, and a way to go and see it.
  // The section is known before the request is sent: it is the pack that
  // declares the entity. Following the link leaves Review, which sends the
  // approval at once and refreshes the section behind it.
  function approveLater(batch, edited) {
    if (batch.length > 1) {
      resolveLater(batch, approvedMany(batch), (row) => approveProposal(row.id));
      return;
    }
    const [row] = batch;
    const section = packs.find((p) => p.entities?.[row.entity])?.key;
    const verb = { update: "updated in", remove: "removed from" }[row.action] || "added to";
    const place = section ? entityPlace(row.entity, packs) : "your persona";
    const name = named(row);
    const title = name
      ? `${name} ${verb} ${place}`
      : `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${place}`;
    resolveLater(
      batch,
      `${title}${edited ? ", with your changes" : ""}`,
      (r) => approveProposal(r.id, edited),
      section && onViewSection ? (
        <ToastAction
          altText={`View in ${sectionTitles[section] || section}`}
          onClick={() => onViewSection(section)}
        >
          View in {sectionTitles[section] || section}
        </ToastAction>
      ) : null,
    );
  }

  /**
   * Keep several, one request after another. Each row leaves as its own
   * request succeeds; a failure stays, and the closing toast says how many.
   */
  async function resolveMany(batch, call, done) {
    setBulkBusy(true);
    const sections = new Set();
    let failed = 0;
    for (const row of batch) {
      try {
        const res = await call(row.id);
        setRows((current) => current.filter((r) => r.id !== row.id));
        if (res?.section) sections.add(res.section);
      } catch {
        failed += 1;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    refreshCounts();
    sections.forEach((s) => onSectionChanged?.(s));
    const ok = batch.length - failed;
    toast(
      failed
        ? {
            title: ok ? done(ok) : "That did not go through",
            description: `${failed} didn't go through and ${failed === 1 ? "is" : "are"} still in the queue.`,
            variant: "destructive",
          }
        : { title: done(ok), variant: "success" },
    );
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
      entity: defaultTarget(section),
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
    // Narrower than the editor, as Settings is: at full width a row's reason
    // and quote ran to 120 characters a line.
    <div className="max-w-3xl space-y-4">
      {/* Titled as Settings and every section are, so the page says where you
          are and a screen reader has an h1 to land on. */}
      <div className="space-y-1 pb-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Review</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
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

      <div className="flex items-center justify-between gap-2">
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
      {/* Not on a touch screen, where there is no keyboard to use them, nor
          over an empty tab, where there is no row to use them on. */}
      {rows.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="hidden text-muted-foreground sm:inline-flex coarse:hidden"
          onClick={() => setShowKeys(true)}
        >
          <Keyboard className="h-4 w-4" aria-hidden="true" />
          Keyboard shortcuts
        </Button>
      )}
      </div>

      {/* Read with each row, so a screen reader learns the keys exist without
          finding the button first. */}
      <p id="review-keys-hint" className="sr-only">
        {kind === "entity"
          ? "Press a to approve, r to reject, e to edit, j and k to move, x to select, question mark for all shortcuts."
          : "Press j and k to move, x to select, question mark for all shortcuts."}
      </p>

      <Dialog open={showKeys} onOpenChange={setShowKeys}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Click a row or Tab to it, then press:</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
            {KEYS.map(([key, what]) => (
              <Fragment key={key}>
                <dt>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{key}</kbd>
                </dt>
                <dd>{what}</dd>
              </Fragment>
            ))}
          </dl>
        </DialogContent>
      </Dialog>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {rows.length > 0 && (
        <div className="flex items-center gap-2 px-3 text-sm text-muted-foreground">
          <Checkbox
            id="review-select-all"
            className="tap-target"
            checked={chosen.length === 0 ? false : chosen.length === rows.length ? true : "indeterminate"}
            onCheckedChange={(v) => setSelected(v === true ? new Set(rows.map((r) => r.id)) : new Set())}
          />
          <Label htmlFor="review-select-all" className="font-normal">Select all</Label>
        </div>
      )}

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
        <div ref={listRef} onKeyDown={onListKeyDown} className="space-y-4">
        {rows.map((row, index) => {
          const common = {
            key: row.id,
            row,
            busy: busy === row.id || bulkBusy,
            selected: selected.has(row.id),
            onSelect: (on) => choose(row.id, on),
            // Roving: Tab enters the list at its first row, and j/k move.
            focusProps: {
              tabIndex: index === 0 ? 0 : -1,
              "aria-describedby": "review-keys-hint",
              "data-review-row": "",
              "data-row-id": row.id,
            },
          };
          return row.kind === "stale" ? (
            <StaleRow
              {...common}
              section={sectionTitles[row.section] || row.section}
              onKeep={() => act(row.id, "Kept. It won't show as stale for a while.", () => keepEntry(row.id))}
              onOpen={() => onViewSection?.(row.section, row.id)}
            />
          ) : row.kind === "entity" ? (
            <InboxRow
              {...common}
              packs={packs}
              onAdvance={() => advanceFrom(row.id)}
              packData={packData}
              onApprove={(edited) => approveLater([row], edited)}
              onReject={() => rejectLater([row], `${said("Rejected", row)}. It won't be suggested again.`)}
            />
          ) : (
            <ObservationCard
              {...common}
              place={row.section_hint && (sectionTitles[row.section_hint] || humanise(row.section_hint))}
              canPromote={promotable.length > 0}
              onPromote={() => openPromote(row)}
              onDelete={() => rejectLater([row], `${said("Deleted", row)}. It won't be suggested again.`)}
            />
          );
        })}
        </div>
      )}

      {/* Sticky, so a long queue keeps its actions in reach. */}
      {chosen.length > 0 && (
        <div
          role="region"
          aria-label="Selected"
          className="sticky bottom-4 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background py-2 pl-3 pr-2 shadow-md"
        >
          <span className="text-sm font-medium">{chosen.length} selected</span>
          <span className="ml-auto flex flex-wrap gap-1">
            {kind === "entity" && (
              <>
                <Button
                  size="sm" variant="ghost" disabled={bulkBusy}
                  className="text-emerald-700 hover:bg-success/10 hover:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-300"
                  onClick={() => {
                    approveLater(chosen);
                    setSelected(new Set());
                  }}
                >
                  Approve {chosen.length}
                </Button>
                <Button
                  size="sm" variant="ghost" disabled={bulkBusy}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    rejectLater(chosen, chosen.length === 1
                      ? `${said("Rejected", chosen[0])}. It won't be suggested again.`
                      : `Rejected ${chosen.length}. They won't be suggested again.`);
                    setSelected(new Set());
                  }}
                >
                  Reject {chosen.length}
                </Button>
              </>
            )}
            {kind === "note" && (
              <Button
                size="sm" variant="ghost" disabled={bulkBusy}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  rejectLater(chosen, chosen.length === 1
                    ? `${said("Deleted", chosen[0])}. It won't be suggested again.`
                    : `Deleted ${chosen.length}. They won't be suggested again.`);
                  setSelected(new Set());
                }}
              >
                Delete {chosen.length}
              </Button>
            )}
            {kind === "stale" && (
              <Button
                size="sm" variant="ghost" disabled={bulkBusy}
                onClick={() => resolveMany(chosen, keepEntry, (n) => `Kept ${n}. They won't show as stale for a while.`)}
              >
                Keep {chosen.length}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}

// One stale entry: where it lives, what it is, how long it has sat.
function StaleRow({ row, section, busy, onKeep, onOpen, selected, onSelect, focusProps }) {
  return (
    <div
      {...focusProps}
      role="group"
      aria-label={`Stale: ${row.title}`}
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 text-sm ${FOCUS_RING}`}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={(v) => onSelect(v === true)}
        aria-label={`Select ${row.title}`}
        className="tap-target"
      />
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
