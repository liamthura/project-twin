// Where an entry came from, how old it is, and whether it has gone stale.
//
// SectionRenderer fetches one section's record and hands it down by context,
// because the rows that read it sit inside ListRenderer, several renderNode
// hops below. Fetched on its own, not with the section's data: the editor saves
// whole sections back, and nothing in here must ever ride along and be written
// as persona data.
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { getProvenance, keepEntry, proposalsFor } from "@/lib/api.js";
import { formatDateLabel } from "./isoDate";

export const ProvenanceContext = createContext(null);

// { entries: {id: record}, keep(id) }. Refetched after every save (`savedAt`),
// since a write moves the dates it shows. A failed read shows nothing: this is
// a footnote to the editor, not something to put an error in front of it for.
export function useSectionProvenance(section, savedAt) {
  const [entries, setEntries] = useState({});
  const load = useCallback(() => {
    getProvenance(section)
      .then((r) => setEntries(r?.entries || {}))
      .catch(() => {});
  }, [section]);
  useEffect(load, [load, savedAt]);
  const keep = useCallback((id) => keepEntry(id).then(load), [load]);
  return { entries, keep };
}

export function useEntryProvenance(id) {
  const ctx = useContext(ProvenanceContext);
  return { record: id ? ctx?.entries?.[id] : undefined, keep: ctx?.keep };
}

// "Claude Desktop via Review", "Cursor", "you".
function who({ by, via }) {
  if (via === "editor") return "you";
  const name = by || "an assistant";
  return via === "review" ? `${name} via Review` : name;
}

// The line under an opened entry's fields.
export function EntryOrigin({ id }) {
  const { record, keep } = useEntryProvenance(id);
  const [why, setWhy] = useState(null); // null closed, [] loading/empty, [...]
  const [keeping, setKeeping] = useState(false);
  if (!record) return null;
  const { added, changed, updated_at: updated, kept_at: kept, checked, stale } = record;

  const parts = [];
  if (added) parts.push(`Added by ${who(added)}, ${formatDateLabel(added.at)}`);
  if (changed) parts.push(`${parts.length ? "changed" : "Changed"} by ${who(changed)}, ${formatDateLabel(changed.at)}`);
  // Older than this record: all that is known is when it last changed -- which
  // the stale line already says, when there is one.
  if (!parts.length && updated && !stale) parts.push(`Last changed ${formatDateLabel(updated)}`);
  if (kept) parts.push(`kept ${formatDateLabel(kept)}`);

  const toggleWhy = () => {
    if (why) return setWhy(null);
    setWhy([]);
    proposalsFor(id).then(setWhy).catch(() => setWhy([{ failed: true }]));
  };
  const reason = why?.[0];

  return (
    <div data-entry-origin className="space-y-2 px-4 pb-3 text-xs text-muted-foreground sm:px-9">
      {stale && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-foreground">Unchanged since {formatDateLabel(checked)}.</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            disabled={keeping}
            onClick={() => {
              setKeeping(true);
              keep(id).finally(() => setKeeping(false));
            }}
          >
            Keep
          </Button>
        </p>
      )}
      {parts.length > 0 && (
        <p>
          {parts.join(" · ")}
          {/* Newest first from the server, so an entry changed through
              Review shows the reasoning for the change. */}
          {(added?.via === "review" || changed?.via === "review") && (
            <>
              {" "}
              <button
                type="button"
                aria-expanded={!!why}
                onClick={toggleWhy}
                className="font-medium text-link underline-offset-2 hover:underline"
              >
                Why?
              </button>
            </>
          )}
        </p>
      )}
      {reason && (
        <div className="space-y-1 border-l-2 border-border pl-3">
          {reason.failed ? (
            <p>Couldn&apos;t load the reasoning. Try again in a moment.</p>
          ) : (
            <>
              {reason.rationale && <p className="text-foreground">{reason.rationale}</p>}
              {reason.evidence && <p className="italic">&ldquo;{reason.evidence}&rdquo;</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
