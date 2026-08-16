/**
 * Which client are you connecting.
 *
 * A single column, and that is a rule rather than a preference: three identical
 * cards in a row is one of the named AI-slop signatures in the design record,
 * and six of them would be a worse version of the same thing. A list also
 * scales without reflowing, which matters because the roster grows.
 *
 * One row open at a time. Two open cards put two server addresses and two copy
 * buttons on screen at once, and there is no reading of that which helps.
 *
 * `renderExpanded` rather than importing InstallCard directly: the picker knows
 * about rows and selection, and nothing about what installing involves. That
 * keeps the two testable apart, and the picker reusable from Settings later.
 */
import { ChevronDown } from "lucide-react";

import { MagicCard } from "@/components/ui/magic-card";
import { cn } from "@/lib/utils";

// What the row promises the action will be. Named for the reader rather than
// for the roster: "deeplink" is our word, "One click" is theirs.
const ACTION_LABEL = {
  deeplink: "One click",
  command: "One command",
  steps: "A few steps",
};

function Mark({ client }) {
  if (!client.mark) {
    // No logo file for this one. `design/logos/README.md` records why, and an
    // invented glyph would be worse than an initial.
    return (
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border text-[10px] font-semibold text-muted-foreground"
      >
        {client.name.charAt(0)}
      </span>
    );
  }
  return (
    <img
      src={`/landing/logos/${client.slug}.svg`}
      alt=""
      aria-hidden="true"
      className="h-6 w-6 shrink-0"
    />
  );
}

export function ClientPicker({ clients, selectedId, onSelect, renderExpanded }) {
  return (
    <ul className="space-y-2">
      {clients.map((client) => {
        const open = client.id === selectedId;
        return (
          <li key={client.id}>
            <MagicCard>
              <button
                type="button"
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-3 py-3 text-left"
                onClick={() => onSelect(open ? null : client.id)}
              >
                <Mark client={client} />
                <span className="flex-1 text-sm font-medium">{client.name}</span>
                <span className="text-xs text-muted-foreground">
                  {ACTION_LABEL[client.kind]}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                    open && "rotate-180",
                  )}
                />
              </button>
              {open && (
                <div className="border-t px-3 py-4">{renderExpanded(client)}</div>
              )}
            </MagicCard>
          </li>
        );
      })}
    </ul>
  );
}
