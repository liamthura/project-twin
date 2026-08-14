// A dropdown inside a modal, in a real browser.
//
// This exists because jsdom cannot answer the question. Dismissing a Radix
// Select by clicking outside it depends on `pointer-events: none`, which Radix
// puts on `document.body` while a layer is open -- and jsdom ignores
// `pointer-events` when it decides what an event hit. In jsdom the click lands
// on whatever element the test names; in a browser it lands wherever the
// cascade allows. Only the second one is the behaviour a reader gets.
//
// Storybook's browser project runs these in headless chromium.
import { useState } from "react";
// storybook/test's userEvent, not @testing-library/user-event: the latter's
// setup() patches document.hasFocus and throws "Illegal invocation" under the
// browser provider. This one dispatches real CDP mouse events at an element's
// coordinates, which means the CSS cascade decides what the click actually
// hits -- exactly the thing being tested.
import { expect, userEvent } from "storybook/test";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectControl } from "@/components/controls";

// Five values, so EnumControl's own branch would pick the dropdown over the
// segmented control. Used directly here to keep the story about one thing.
const OPTIONS = ["book", "article", "podcast", "show", "film"];

function DialogWithDropdown() {
  const [value, setValue] = useState(undefined);
  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add media</DialogTitle>
          <DialogDescription>A dropdown lives below this line.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p data-testid="outside-target" className="text-sm">
            Somewhere else in the dialog.
          </p>
          <SelectControl options={OPTIONS} value={value} onChange={setValue} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default {
  title: "UI/Select in a dialog",
  component: DialogWithDropdown,
};

export const DismissesOnOutsideClick = {
  render: () => <DialogWithDropdown />,
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;

    // The trigger reads "Select…" until something is chosen.
    await userEvent.click(doc.querySelector('[role="combobox"]'));

    expect(await waitForListbox(doc)).toBeTruthy();

    // What does a reader's click actually land on? elementFromPoint is the
    // browser's own hit test -- no synthetic event, no test-chosen target.
    const spot = doc.querySelector('[data-testid="outside-target"]');
    const box = spot.getBoundingClientRect();
    const hit = doc.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

    // What the click lands on is the dialog's own overlay, not the paragraph
    // and not <html>. Radix gives the overlay an inline `pointer-events: auto`
    // so overlay-click-to-close keeps working while `body` is none, and it
    // spans the viewport at `inset-0` -- so it catches everything that falls
    // through the dialog content, which the open select has disabled.
    expect(hit).toBeTruthy();
    expect(hit.getAttribute("data-state")).toBe("open");
    expect(getComputedStyle(hit).pointerEvents).toBe("auto");

    // Clicking it is what the reader is doing. Aimed at the top-left corner so
    // the point is unambiguously outside both the select and the dialog card.
    //
    // This is the assertion that failed before @radix-ui/react-dialog was
    // brought up to the version matching the pinned dismissable-layer: the
    // listbox stayed open, and the only way out was to pick an option.
    await userEvent.click(hit, { position: { x: 5, y: 5 } });

    await waitForGone(doc);
    expect(doc.querySelector('[role="listbox"]')).toBeNull();
  },
};

async function waitForListbox(doc) {
  for (let i = 0; i < 50; i += 1) {
    const found = doc.querySelector('[role="listbox"]');
    if (found) return found;
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

async function waitForGone(doc) {
  for (let i = 0; i < 50; i += 1) {
    if (!doc.querySelector('[role="listbox"]')) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}
