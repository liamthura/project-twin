/**
 * Search the whole persona: ⌘K / Ctrl+K, or the header's Search button.
 *
 * Two halves. Word matches come from searchPersona, over the data the app
 * already holds, so they cover forms and plain lists and arrive as you type.
 * "Related by meaning" comes from the server's index, the one assistants
 * search, and only exists where embeddings are configured -- /api/search
 * answers nothing otherwise, and a failure there shows nothing rather than an
 * error, since it is the extra and not the search.
 *
 * A combobox over a listbox: focus stays in the input, ↑/↓ move the active
 * option (aria-activedescendant), Enter opens it.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { searchMeaning } from "@/lib/api.js";
import { searchPersona } from "./searchPersona";

const MEANING_LIMIT = 5;

export function SearchDialog({ open, onOpenChange, packs = [], packData = {}, onOpen }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [related, setRelated] = useState([]);
  // Set when a result was chosen, so closing does not hand focus back to the
  // Search button over the row the result just opened.
  const chosenRef = useRef(false);

  const { results, truncated } = useMemo(
    () => searchPersona(packs, packData, query),
    [packs, packData, query],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setRelated([]);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
    setRelated([]);
    if (query.trim().length < 2) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchMeaning(query)
        .then((rows) => { if (!cancelled) setRelated(rows); })
        .catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const titles = Object.fromEntries(packs.map((p) => [p.key, p.title]));
  const seen = new Set(results.map((r) => r.entityId).filter(Boolean));
  const meaning = related
    .filter((r) => titles[r.section] && !seen.has(r.entity_id))
    .slice(0, MEANING_LIMIT)
    .map((r) => ({
      key: `meaning:${r.entity_id}`, section: r.section, sectionTitle: titles[r.section],
      place: titles[r.section], title: r.title, snippet: r.snippet, entityId: r.entity_id, band: null,
    }));
  const all = [...results, ...meaning];

  const choose = (result) => {
    chosenRef.current = true;
    onOpenChange(false);
    onOpen(result);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!all.length) return;
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length);
    } else if (e.key === "Enter" && all[active]) {
      e.preventDefault();
      choose(all[active]);
    }
  };

  // Word matches grouped under their section, in the order the rail lists them.
  const groups = [];
  for (const r of results) {
    const last = groups[groups.length - 1];
    if (last?.title === r.sectionTitle) last.items.push(r);
    else groups.push({ title: r.sectionTitle, items: [r] });
  }
  if (meaning.length) groups.push({ title: "Related by meaning", items: meaning });

  const option = (r) => {
    const i = all.indexOf(r);
    // Under its section's heading a word match needs only the part it is in;
    // a meaning match sits under "Related by meaning" and needs the section.
    const where = meaning.includes(r) ? r.sectionTitle : r.place.split(" › ")[1];
    const detail = [where, r.snippet].filter(Boolean).join(" · ");
    return (
      <li
        key={r.key}
        id={`search-option-${i}`}
        role="option"
        aria-selected={i === active}
        onMouseMove={() => setActive(i)}
        onClick={() => choose(r)}
        className={`cursor-pointer rounded-md px-3 py-2 text-sm ${i === active ? "bg-muted" : ""}`}
      >
        <span className="block break-words font-medium">{r.title}</span>
        {detail && (
          <span className="block break-words text-xs text-muted-foreground">{detail}</span>
        )}
      </li>
    );
  };

  const typed = query.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[12%] max-w-xl translate-y-0 gap-0 p-0 data-[state=closed]:slide-out-to-top-[10%] data-[state=open]:slide-in-from-top-[10%] max-sm:inset-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:grid-rows-[auto_minmax(0,1fr)] max-sm:rounded-none"
        onCloseAutoFocus={(e) => {
          if (chosenRef.current) e.preventDefault();
          chosenRef.current = false;
        }}
      >
        <DialogTitle className="sr-only">Search your persona</DialogTitle>
        <DialogDescription className="sr-only">
          Type to search every section. Use the arrow keys to move and Enter to open.
        </DialogDescription>
        <div className="flex items-center gap-2 border-b px-4 py-3 pr-12">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-label="Search your persona"
            aria-expanded={all.length > 0}
            aria-controls="search-results"
            aria-activedescendant={all.length ? `search-option-${active}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search every section"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
          />
        </div>
        <div className="max-h-[60dvh] overflow-y-auto p-2 max-sm:max-h-none">
          {!typed ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Type at least two letters to search every section.
            </p>
          ) : all.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing matches &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            <ul id="search-results" role="listbox" aria-label="Results" className="space-y-2">
              {groups.map((g) => (
                <Fragment key={g.title}>
                  <li role="presentation" className="px-3 pt-1 text-xs font-medium text-muted-foreground">
                    {g.title}
                  </li>
                  {g.items.map(option)}
                </Fragment>
              ))}
              {truncated && (
                <li role="presentation" className="px-3 py-1 text-xs text-muted-foreground">
                  Showing the first {results.length} matches. Type more to narrow them.
                </li>
              )}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
