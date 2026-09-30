import { useEffect, useState, Fragment } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FOCUS_RING } from "@/components/controls";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  proposalSummary, entityPlace, humanise, renderValue, updateChanges,
} from "./proposalSummary";

const ACTION_VERB = { add: "Add", update: "Update", remove: "Remove" };

/**
 * One inbox item.
 *
 * Approving does not require expanding. The split from observations is by how
 * much thought an item needs, and a queue that makes a two-second decision
 * look like a considered one gets abandoned at the considered ones.
 *
 * So the face carries what the decision needs: where it goes, in the editor's
 * words; the value, wrapped rather than cut off; who suggested it, why, and
 * the reader's own words it quoted. A reason with a quote is the whole case
 * for approving at all. The field-by-field detail stays behind the chevron.
 *
 * The row itself takes focus (the panel gives the first one tabIndex 0 and
 * moves between them on j/k), and while it has focus a, r, e and Enter act on
 * it. Only the row: a key typed into one of its inputs is text.
 */
// Text and numbers are edited as text, a list of strings as one comma-separated
// line. Anything else (an object, a boolean) is shown, not edited: agents rarely
// propose one, and the server validates whatever is sent either way.
const isEditable = (value) =>
  typeof value === "string" ||
  typeof value === "number" ||
  (Array.isArray(value) && value.every((v) => typeof v === "string"));

// Sentence case, as every other label in the app: "Start date", not "start date".
const fieldName = (field) => {
  const words = humanise(field);
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const shown = (value) => renderValue(value ?? "") || "(empty)";

// "Notes: Paused → Weekly call". The arrow is drawn, and read out as a word.
function Change({ from, to }) {
  return (
    <>
      <span className="text-muted-foreground">{shown(from)}</span>
      <span className="text-muted-foreground" aria-hidden="true"> → </span>
      <span className="sr-only"> becomes </span>
      {shown(to)}
    </>
  );
}

const toText = (value) => (Array.isArray(value) ? value.join(", ") : String(value ?? ""));

// The draft back into the shapes the proposal arrived in.
function fromDraft(data, draft) {
  return Object.fromEntries(
    Object.entries(data).map(([field, value]) => {
      if (!(field in draft)) return [field, value];
      const text = draft[field];
      if (Array.isArray(value)) return [field, text.split(",").map((t) => t.trim()).filter(Boolean)];
      if (typeof value === "number" && text.trim() !== "" && !Number.isNaN(Number(text))) {
        return [field, Number(text)];
      }
      return [field, text];
    }),
  );
}

export default function InboxRow({
  row, packs, packData, busy, onApprove, onReject, selected = false, onSelect, onAdvance, focusProps,
}) {
  const [open, setOpen] = useState(false);
  // null while not editing. Agents get a detail slightly wrong often enough
  // that correcting it beats rejecting a mostly-right suggestion; the server
  // writes the corrected values through the same checks as the original.
  const [draft, setDraft] = useState(null);
  const data = row.data || {};
  const approve = () => onApprove(draft ? fromDraft(data, draft) : undefined);
  const { lead, trail, extra } = proposalSummary(row, packs);
  // Set for an update whose entry was found: the face then says what changes
  // from what, rather than an arrow that read like a rename.
  const changes = updateChanges(row, packs, packData);
  const startEdit = () =>
    setDraft(
      Object.fromEntries(
        Object.entries(data).filter(([, v]) => isEditable(v)).map(([f, v]) => [f, toText(v)]),
      ),
    );

  // A row being edited is never part of a bulk approve, which would send it
  // as suggested and drop the edits.
  useEffect(() => {
    if (draft && selected) onSelect?.(false);
  }, [draft, selected, onSelect]);

  const onKeyDown = (e) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    const run = {
      a: () => !busy && (onAdvance?.(), approve()),
      r: () => !busy && (onAdvance?.(), onReject()),
      e: () => { setOpen(true); if (!draft) startEdit(); },
      Enter: () => setOpen((v) => !v),
    }[e.key];
    if (run) {
      e.preventDefault();
      run();
    }
  };

  return (
    <div
      {...focusProps}
      role="group"
      aria-label={`${ACTION_VERB[row.action] || row.action} ${lead}`}
      data-selectable={!draft}
      onKeyDown={onKeyDown}
      className={`rounded-lg border ${FOCUS_RING}`}
    >
      {/* Wraps on a phone: the summary takes the full width and the buttons
          the line below it. Never from sm up, where a long title wrapped them
          under itself on some rows and not others, so the buttons moved. */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5 text-sm sm:flex-nowrap">
        <div className="flex min-w-0 basis-full items-start gap-3 sm:flex-1 sm:basis-auto">
        {onSelect && (
          <Checkbox
            checked={selected}
            disabled={!!draft}
            onCheckedChange={(v) => onSelect(v === true)}
            aria-label={`Select ${lead}`}
            className="tap-target mt-0.5"
          />
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
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
            {trail && !changes && (
              <>
                <span className="font-normal text-muted-foreground"> → </span>
                {trail}
              </>
            )}
            {extra > 0 && !changes && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">+{extra} more</span>
            )}
          </p>
          {changes?.length === 0 && (
            <p className="text-muted-foreground">Matches what is already there.</p>
          )}
          {changes?.length > 0 && (
            <p className={`break-words ${open ? "" : "line-clamp-3"}`}>
              <span className="text-muted-foreground">{fieldName(changes[0].field)}: </span>
              <Change {...changes[0]} />
              {changes.length > 1 && (
                <span className="ml-2 text-xs text-muted-foreground">+{changes.length - 1} more</span>
              )}
            </p>
          )}
          {row.rationale && <p className="text-muted-foreground">{row.rationale}</p>}
          {/* Three lines while closed, so one long quote cannot push the
              queue off the screen. */}
          {row.evidence && (
            <p className={`break-words italic text-muted-foreground ${open ? "" : "line-clamp-3"}`}>
              “{row.evidence}”
            </p>
          )}
        </div>
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
          size="sm" variant="ghost" disabled={busy} onClick={approve}
          className="text-emerald-700 hover:bg-success/10 hover:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-300"
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
          {draft ? (
            <div className="space-y-3">
              {Object.entries(data).map(([field, value]) =>
                isEditable(value) ? (
                  <div key={field} className="space-y-1.5">
                    <Label htmlFor={`edit-${row.id}-${field}`}>{fieldName(field)}</Label>
                    <Input
                      id={`edit-${row.id}-${field}`}
                      value={draft[field]}
                      onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                    />
                    {changes?.some((c) => c.field === field) && (
                      <p className="text-xs text-muted-foreground">
                        Now: {shown(changes.find((c) => c.field === field).from)}
                      </p>
                    )}
                  </div>
                ) : (
                  <p key={field} className="text-sm">
                    <span className="text-muted-foreground">{fieldName(field)}</span>{" "}
                    {renderValue(value)}
                  </p>
                ),
              )}
            </div>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
              {Object.entries(data).map(([field, value]) => {
                const change = changes?.find((c) => c.field === field);
                return (
                  <Fragment key={field}>
                    <dt className="text-muted-foreground">{fieldName(field)}</dt>
                    <dd className="min-w-0 break-words">
                      {change ? <Change {...change} /> : renderValue(value)}
                    </dd>
                  </Fragment>
                );
              })}
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            {draft ? (
              <>
                <Button size="sm" disabled={busy} onClick={approve}>
                  Approve with changes
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  Discard changes
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={startEdit}>
                Edit before approving
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
