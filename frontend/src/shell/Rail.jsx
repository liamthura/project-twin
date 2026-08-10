import { Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { outline } from "@/renderers/paths";
import { REVIEW_ICON, SECTIONS_ICON, packIcon } from "./packIcons";

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
  version,
  onNavigate,
}) {
  const activePack = packs.find((p) => p.key === activeSection);
  // Derived from the manifest, so this is complete on a cold deep link before
  // any content has mounted -- the whole reason the outline is not built by the
  // bands registering themselves.
  const bands = activePack ? outline(activePack) : [];
  const activeIndex = bands.findIndex((b) => b.id === activeBand);

  const sectionItem = (key, title, Icon, extra) => {
    const isActive = activeSection === key;
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
          {/* The disclosure caret is decoration: the button already announces
              its state through aria-current, and a second spoken "expanded"
              would describe the sub-items twice. */}
          {isActive ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
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

      {/* Load-bearing, not decoration: Review and Sections are not persona
          sections and must not read as though they were. */}
      <hr className="my-2 border-border" />

      <ul className="space-y-0.5">
        {sectionItem(
          "review",
          "Review",
          REVIEW_ICON,
          pendingCount > 0 ? (
            // The number, not a dot. pendingCount is already fetched; spending
            // it on decoration and then explaining it in sr-only text was the
            // old shape.
            <Badge
              variant="secondary"
              // The number is the visible affordance; the label is what a screen
              // reader gets, because a bare "3" beside "Review" does not say
              // three of what. The old dot carried that sentence in sr-only
              // text, and the intent outlives the dot.
              aria-label={`${pendingCount} waiting`}
              className="ml-auto shrink-0 px-1.5 tabular-nums"
            >
              {pendingCount}
            </Badge>
          ) : null
        )}
        {sectionItem("sections", "Sections", SECTIONS_ICON)}
      </ul>

      {version && (
        <p className="mt-4 px-3 font-mono text-[11px] text-muted-foreground">{version}</p>
      )}
    </nav>
  );
}
