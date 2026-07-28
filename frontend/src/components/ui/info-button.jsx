import { useState } from "react";
import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { InfoDialog } from "@/components/ui/info-dialog";

// The "i" that explains a section or one of its lists, with its own dialog and
// open state. Extracted from ListRenderer so the button can sit beside the
// heading it explains -- the section's Card title, a list's own h3, or a
// nested child's label -- rather than inside the list body, which is the one
// place that has no heading to attach it to.
//
// State lives here because each instance opens independently: `projects` and
// `knowledge` both carry two lists with separate info content, so a single
// shared `infoOpen` would open the wrong one.
export function InfoButton({ info, title }) {
  const [open, setOpen] = useState(false);
  if (!info) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="tap-target h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={title ? `About ${title}` : "About this section"}
        onClick={() => setOpen(true)}
      >
        <Info className="h-4 w-4" />
      </Button>
      <InfoDialog
        open={open}
        onOpenChange={setOpen}
        title={title ?? "About this section"}
        description={info.overview}
      >
        <p className="font-medium text-foreground">Tips for filling this section:</p>
        <ul className="space-y-2 text-muted-foreground">
          {(info.tips || []).map((tip, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-primary">•</span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Got it</Button>
        </DialogFooter>
      </InfoDialog>
    </>
  );
}
