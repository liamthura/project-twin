/**
 * Which assistant are you connecting: one row per assistant, and choosing a
 * row is the answer.
 *
 * It was an accordion that opened each client's steps in place, on the same
 * screen as every other way to connect and the question of who fills it in --
 * eleven actions and no filled button. Now the steps get a screen of their own
 * (StepConnect), so a row only has to say what it is and what it takes.
 *
 * A single column, and that is a rule rather than a preference: three identical
 * cards in a row is one of the named AI-slop signatures in the design record. A
 * list also scales without reflowing, which matters because the roster grows.
 *
 * `lib/clients.js` explains `kind`: of the clients MyGist names, exactly one has
 * a real deeplink, so the effort label is a fact about each, not decoration.
 */
import { AppWindow, ChevronRight, MoreHorizontal, Terminal } from "lucide-react";

import { MagicCard } from "@/components/ui/magic-card";

const EFFORT = {
  deeplink: "One click",
  command: "One command",
  steps: "A few steps",
  other: "Paste a prompt, or use a token",
};

// A client with no logo file gets an icon for how it installs, not a letter in
// a box, which read as a placeholder.
const KIND_ICON = { command: Terminal, steps: AppWindow, deeplink: AppWindow, other: MoreHorizontal };

function Mark({ client }) {
  if (client.mark) {
    return (
      <img src={`/landing/logos/${client.slug}.svg`} alt="" aria-hidden="true" className="h-6 w-6 shrink-0" />
    );
  }
  const Icon = KIND_ICON[client.kind];
  return <Icon aria-hidden="true" className="h-5 w-6 shrink-0 text-muted-foreground" />;
}

export function ClientPicker({ clients, onChoose }) {
  return (
    <ul className="space-y-2">
      {clients.map((client) => (
        <li key={client.id}>
          <MagicCard>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-3 text-left coarse:min-h-14"
              // The name and the effort are two spans, which a screen reader
              // would run together as "ClaudeA few steps".
              aria-label={`${client.name}, ${EFFORT[client.kind].toLowerCase()}`}
              onClick={() => onChoose(client.id)}
            >
              <Mark client={client} />
              <span className="flex-1 text-sm font-medium">{client.name}</span>
              <span className="text-xs text-muted-foreground">{EFFORT[client.kind]}</span>
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </MagicCard>
        </li>
      ))}
    </ul>
  );
}
