import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The optional sections that are switched off, and a way to switch one on.
 *
 * Replaces the separate Sections page: adding a section is a one-off choice
 * made where the sections are listed, not a destination of its own. Hiding
 * one lives in that section's header. Shared by the desktop rail and the
 * mobile switcher so the two cannot offer different things.
 */
export function MoreSections({ hiddenPacks = [], onEnablePack, large = false }) {
  const [open, setOpen] = useState(false);
  if (hiddenPacks.length === 0) return null;

  const Caret = open ? ChevronDown : ChevronRight;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-lg px-3 text-left text-muted-foreground transition-colors duration-fast ease-standard hover:bg-muted/60 hover:text-foreground ${
          large ? "h-12 text-[15px]" : "h-9 text-sm"
        }`}
      >
        <Caret className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>More sections</span>
        <span className="ml-auto text-xs tabular-nums">{hiddenPacks.length}</span>
      </button>

      {open && (
        <ul className="mt-1 space-y-1 pl-3">
          {hiddenPacks.map((p) => (
            <li key={p.key} className="flex items-center justify-between gap-2 rounded-lg px-3 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{p.title}</p>
                {p.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                aria-label={`Add ${p.title}`}
                onClick={() => onEnablePack?.(p.key)}
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
