import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { outline } from "@/renderers/paths";
import { REVIEW_ICON, SECTIONS_ICON, packIcon } from "./packIcons";

/**
 * Mobile navigation: a sticky `Section ▾` trigger under the header, and a
 * full-height sheet listing every destination.
 *
 * This replaces the horizontal tab strip, which was the single thing that made
 * navigation hard: twelve tabs in one edge-faded scroller, most of them
 * off-screen, no indication of depth, and a second scroll axis on a surface that
 * already scrolled vertically. Everything here is on one axis, and any
 * subsection is two taps away with the whole structure visible at once.
 */
export function SectionSheet({
  packs = [],
  activeSection,
  activeBand,
  pendingCount = 0,
  version,
  onNavigate,
}) {
  const [open, setOpen] = useState(false);

  const activePack = packs.find((p) => p.key === activeSection);
  const activeTitle =
    activePack?.title ??
    (activeSection === "review" ? "Review" : activeSection === "sections" ? "Sections" : "Section");

  // Navigating always closes: leaving the sheet up over the content it just
  // scrolled to would hide the thing the tap was for.
  const go = (section, band) => {
    onNavigate(section, band);
    setOpen(false);
  };

  const destination = (key, title, Icon, extra) => {
    const isActive = activeSection === key;
    // Only the active section's bands are nested, matching the desktop rail --
    // every section's bands at once would be the same wall of links the strip
    // was, just rotated.
    const bands = key === activeSection && activePack ? outline(activePack) : [];
    return (
      <li key={key}>
        <button
          type="button"
          onClick={() => go(key, null)}
          aria-current={isActive ? "page" : undefined}
          className={`flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] ${
            isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground"
          }`}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{title}</span>
          {extra}
        </button>
        {bands.length > 0 && (
          <ul className="ml-7 border-l border-border pl-3">
            {bands.map((band) => (
              <li key={band.id}>
                <button
                  type="button"
                  onClick={() => go(key, band.id)}
                  aria-current={band.id === activeBand ? "true" : undefined}
                  className={`flex h-11 w-full items-center rounded-md px-2 text-left text-sm ${
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
        )}
      </li>
    );
  };

  return (
    <div className="sticky top-[60px] z-10 -mx-4 border-b bg-background px-4 py-2 md:hidden">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between rounded-lg border bg-card px-3 text-sm font-medium"
          >
            <span className="truncate">{activeTitle}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </DialogTrigger>

        {/* Full height, entering from the bottom. The positioning classes
            override DialogContent's centred-modal defaults -- `cn` runs through
            tailwind-merge, so the later ones win rather than both applying. */}
        <DialogContent
          className="left-0 top-auto bottom-0 h-[85dvh] max-h-[85dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-xl p-0 duration-slow ease-emphasized data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom"
        >
          <DialogHeader className="border-b px-4 py-3 text-left">
            <DialogTitle className="text-base">Go to</DialogTitle>
          </DialogHeader>
          <nav aria-label="Sections" className="overflow-y-auto px-2 pb-6">
            <ul>{packs.map((p) => destination(p.key, p.title, packIcon(p.key)))}</ul>
            {/* Same load-bearing divider as the rail: Review and Sections are
                not persona sections. */}
            <hr className="my-2 border-border" />
            <ul>
              {destination(
                "review",
                "Review",
                REVIEW_ICON,
                pendingCount > 0 ? (
                  <Badge variant="secondary" className="ml-auto shrink-0 px-1.5 tabular-nums">
                    {pendingCount}
                  </Badge>
                ) : null
              )}
              {destination("sections", "Sections", SECTIONS_ICON)}
            </ul>
            {version && (
              <p className="mt-4 px-3 font-mono text-[11px] text-muted-foreground">{version}</p>
            )}
          </nav>
        </DialogContent>
      </Dialog>
    </div>
  );
}
