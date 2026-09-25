import { ChevronDown, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { outline } from "@/renderers/paths";
import { REVIEW_ICON, packIcon } from "./packIcons";

/**
 * Mobile navigation: a sticky `Section ▾` trigger under the header that opens
 * a dropdown of every destination.
 *
 * It replaced a horizontal tab strip (twelve tabs in one edge-faded scroller),
 * then a pull-up sheet (wave 3): a full-height sheet covered the page for what
 * is a pick-one-from-a-list, which is what a dropdown is for, and it is the
 * same control the account menu and the row menus already use. Any subsection
 * is still two taps away: the active section's bands are listed under it.
 */
export function SectionMenu({
  packs = [],
  activeSection,
  activeBand,
  pendingCount = 0,
  onNavigate,
}) {
  const activePack = packs.find((p) => p.key === activeSection);
  const activeTitle =
    activePack?.title ??
    ({ review: "Review", settings: "Settings" }[activeSection] ?? "Section");

  // 44px rows: this is the phone's only navigation.
  const itemClass = "h-11 gap-3 px-3 text-[15px]";

  const destination = (key, title, Icon, extra) => {
    const isActive = activeSection === key;
    // Only the active section's bands, matching the desktop rail.
    const bands = key === activeSection && activePack ? outline(activePack) : [];
    return [
      <DropdownMenuItem
        key={key}
        onSelect={() => onNavigate(key, null)}
        aria-current={isActive ? "page" : undefined}
        className={`${itemClass} ${isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground"}`}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{title}</span>
        {extra}
      </DropdownMenuItem>,
      ...bands.map((band) => (
        <DropdownMenuItem
          key={`${key}:${band.id}`}
          onSelect={() => onNavigate(key, band.id)}
          aria-current={band.id === activeBand ? "true" : undefined}
          className={`ml-7 h-11 border-l px-3 text-sm ${
            band.id === activeBand ? "font-medium text-foreground" : "text-muted-foreground"
          }`}
        >
          <span className="truncate">{band.label}</span>
        </DropdownMenuItem>
      )),
    ];
  };

  return (
    <div className="sticky top-[60px] z-10 -mx-4 mb-6 border-b bg-background px-4 py-2 md:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-11 w-full items-center justify-between rounded-lg border bg-card px-3 text-sm font-medium"
          >
            <span className="truncate">{activeTitle}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          aria-label="Sections"
          className="max-h-[70dvh] w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
        >
          {/* Same order as the rail: Review first, then the sections. */}
          {destination(
            "review",
            "Review",
            REVIEW_ICON,
            pendingCount > 0 ? (
              <Badge
                variant="secondary"
                aria-label={`${pendingCount} waiting`}
                className="ml-auto shrink-0 px-1.5 tabular-nums"
              >
                {pendingCount}
              </Badge>
            ) : null
          )}
          <DropdownMenuSeparator />
          {packs.flatMap((p) => destination(p.key, p.title, packIcon(p.key)))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => onNavigate("settings", "sections")}
            className={`${itemClass} text-sm text-muted-foreground`}
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
            Manage sections
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
