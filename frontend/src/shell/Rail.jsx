import { Fragment } from "react";
import { ChevronDown, ChevronRight, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { outline } from "@/renderers/paths";
import { REVIEW_ICON, packIcon } from "./packIcons";

/** Sub-item row height, in px. The marker's travel is computed from it, so the
 *  two cannot drift: change `h-8` below and change this. */
const BAND_ROW_PX = 32;

const ITEM_CLASS =
  "flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm " +
  "transition-colors duration-fast ease-standard hover:bg-muted/60";

/**
 * The desktop rail: 240px, sticky beneath the 60px header, two levels.
 *
 * Presentational on purpose. It reports clicks through `onNavigate` and is told
 * which band is current through `activeBand` -- it does not observe scrolling
 * itself, because the same answer has to reach the address bar, and only App can
 * write that. See useScrollSpy.
 *
 * Only the active section expands. The prototype is explicit that switching
 * collapses the previous one, so there is no per-section expanded state to hold:
 * "expanded" and "active" are the same fact.
 */
export function Rail({
  packs = [],
  activeSection,
  activeBand,
  pendingCount = 0,
  onNavigate,
}) {
  const activePack = packs.find((p) => p.key === activeSection);
  // Every pack's bands, not just the active one's -- a collapsed section still
  // has to know whether it has anything to disclose. Derived from the manifest,
  // so all of this is complete on a cold deep link before any content has
  // mounted, which is the whole reason the outline is not built by the bands
  // registering themselves.
  const bandsByPack = new Map(packs.map((p) => [p.key, outline(p)]));
  const bands = activePack ? bandsByPack.get(activePack.key) : [];
  const activeIndex = bands.findIndex((b) => b.id === activeBand);

  const sectionItem = (key, title, Icon, extra) => {
    const isActive = activeSection === key;
    // A caret promises something to expand, so it is drawn only where there is
    // something. That rules out Review and Sections, and also a pack whose
    // children are all untitled (learning_log) -- which is why the test is
    // "has bands" rather than "is a pack".
    const hasBands = (bandsByPack.get(key) || []).length > 0;
    return (
      <li key={key}>
        <button
          type="button"
          onClick={() => onNavigate(key, null)}
          aria-current={isActive ? "page" : undefined}
          className={`${ITEM_CLASS} ${
            isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground"
          }`}
        >
          {/* The slot is always here even when the caret is not, so a row
              without one does not shift its icon left of every other row.
              The caret is decoration: the button already announces its state
              through aria-current, and a spoken "expanded" on top of that would
              describe the sub-items twice. */}
          <span data-caret-slot aria-hidden="true" className="flex h-3.5 w-3.5 shrink-0">
            {hasBands &&
              (isActive ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              ))}
          </span>
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{title}</span>
          {extra}
        </button>
      </li>
    );
  };

  return (
    <nav
      aria-label="Sections"
      className="sticky top-[60px] hidden w-60 shrink-0 self-start md:block"
    >
      {/* Review first: it is the one place something waits for the reader,
          and the approve loop is the product. The divider is load-bearing --
          Review is not a persona section and must not read as one. */}
      <ul className="space-y-0.5">
        {sectionItem(
          "review",
          "Review",
          REVIEW_ICON,
          pendingCount > 0 ? (
            // The number is the visible affordance; the label is what a screen
            // reader gets, because a bare "3" beside "Review" does not say
            // three of what.
            <Badge
              variant="secondary"
              aria-label={`${pendingCount} waiting`}
              className="ml-auto shrink-0 px-1.5 tabular-nums"
            >
              {pendingCount}
            </Badge>
          ) : null
        )}
      </ul>
      <hr className="my-2 border-border" />
      <ul className="space-y-0.5">
        {packs.map((p) => (
          // A Fragment with a key, not a bare <>: the section item and its
          // sub-item list are two siblings from one iteration, and an unkeyed
          // fragment makes React warn and re-key both on every reorder.
          <Fragment key={p.key}>
            {sectionItem(p.key, p.title, packIcon(p.key))}
            {p.key === activeSection && bands.length > 0 && (
              <li key={`${p.key}:bands`}>
                {/* The marker is ONE element translated between rows rather than
                    one per row: CSS cannot animate between two separate
                    elements, and the slide is the point -- it is what makes a
                    two-level rail read as one continuous place rather than a
                    list of links. */}
                <div className="relative ml-6 border-l border-border pl-3">
                  {activeIndex >= 0 && (
                    <span
                      data-spy-marker
                      aria-hidden="true"
                      className="absolute -left-px top-0 h-8 w-0.5 bg-primary transition-transform duration-medium ease-standard"
                      style={{ transform: `translateY(${activeIndex * BAND_ROW_PX}px)` }}
                    />
                  )}
                  <ul>
                    {bands.map((band) => (
                      <li key={band.id}>
                        <button
                          type="button"
                          onClick={() => onNavigate(p.key, band.id)}
                          aria-current={band.id === activeBand ? "true" : undefined}
                          className={`flex h-8 w-full items-center rounded-md px-2 text-left text-[13px] transition-colors duration-fast ease-standard hover:bg-muted/60 ${
                            band.id === activeBand
                              ? "font-medium text-foreground"
                              : "text-muted-foreground"
                          }`}
                        >
                          <span className="truncate">{band.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            )}
          </Fragment>
        ))}
      </ul>

      {/* A way into Settings -> Sections, where sections are switched on and
          off. Not a destination of its own: that choice also decides what AI
          clients can read, so it lives with the other settings. */}
      <button
        type="button"
        onClick={() => onNavigate("settings", "sections")}
        className="mt-3 flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-[13px] text-muted-foreground transition-colors duration-fast ease-standard hover:bg-muted/60 hover:text-foreground"
      >
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Manage sections
      </button>
    </nav>
  );
}
