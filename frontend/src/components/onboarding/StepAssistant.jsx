/**
 * Which assistant do you use? The first of the three Connect screens.
 *
 * Connect used to ask three things at once -- which assistant, how to connect
 * it, who fills it in -- with eleven actions and no filled button. This asks
 * the first, and choosing a row is the answer, so the screen needs no button of
 * its own. Nothing is preselected: every later screen names the one you chose.
 */
import { Button } from "@/components/ui/button";
import { INSTALLABLE_CLIENTS } from "@/lib/clients.js";

import { ClientPicker } from "./ClientPicker";

// The last row: the paste-in prompt and the token route. Sentences call it
// "your assistant", never "Something else".
export const OTHER_CLIENT = { id: "other", name: "Something else", kind: "other" };

// Every listed assistant is a desktop app or a terminal tool (lib/clients.js),
// so a phone is told so rather than left to find out on the next screen.
const onPhone = () => !!globalThis.matchMedia?.("(pointer: coarse) and (max-width: 639px)")?.matches;

export function StepAssistant({ onChoose, onTypeMyself, onSkip }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Which assistant do you use?</h1>
        <p className="max-w-prose text-muted-foreground">
          Connect it once, and it can read your persona and suggest what to add for you to approve.
        </p>
      </div>
      {onPhone() && (
        <p className="max-w-prose text-sm text-muted-foreground">
          Most assistants connect from a computer. Open {window.location.host} there, or type the
          basics here for now.
        </p>
      )}
      <ClientPicker clients={[...INSTALLABLE_CLIENTS, OTHER_CLIENT]} onChoose={onChoose} />
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Button variant="link" className="tap-target h-auto p-0 text-muted-foreground" onClick={onTypeMyself}>
          I'll type it myself
        </Button>
        <Button variant="link" className="tap-target h-auto p-0 text-muted-foreground" onClick={onSkip}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}
