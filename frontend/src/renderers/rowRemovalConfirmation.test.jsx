// The overflow menu and the confirmation dialog, rendered together.
//
// Why this file exists at all: Task 2 moved row removal behind a Radix
// DropdownMenu, and the spec's central claim was that "the confirmation dialog
// and everything behind it are untouched". Nothing in the repo could check that
// claim. Every ListRenderer and SectionRenderer test passes `vi.fn()` for
// `onShowConfirmation` -- which proves the renderer ASKS for confirmation, and
// proves nothing at all about what happens when a real dialog answers. And
// App.test.jsx never removes a row. So the one claim no test covered was the one
// that was false: the two Radix layers could not coexist, and clicking Remove in
// the real app threw `RangeError: Maximum call stack size exceeded` and left the
// page unable to take clicks.
//
// WHAT THIS GUARDS, and how it breaks:
//
// `@radix-ui/react-dropdown-menu` reaches the shared internals through
// `@radix-ui/react-menu`, and Dialog reaches the same ones directly. Both
// `react-focus-scope` (its `focusScopesStack`) and `react-dismissable-layer`
// (its `originalBodyPointerEvents`) hold state at MODULE scope, so two resolved
// copies of either package means two independent stacks that cannot see each
// other:
//
//   - two focus stacks: opening the Dialog never pauses the menu's focus trap,
//     both `focusin` handlers stay live, and each yanks focus back into its own
//     container until the stack blows (step 3 below).
//   - two pointer-events owners: the menu sets `body{pointer-events:none}`, the
//     Dialog's copy records "none" as the original and writes it back on close,
//     and the app stops taking clicks until reload (step 6 below).
//
// A dependency bump is what would break this test -- specifically any install
// that lets a second copy of one of those packages back into the tree. That is
// what the `overrides` block in package.json prevents, and this test is the
// thing that notices when it stops working. If it fails, check for nested
// copies before suspecting this file:
//
//   ls node_modules/@radix-ui/*/node_modules/@radix-ui/
//
// It is an integration test on purpose. The unit tests either side of the seam
// both passed throughout; the defect only existed where they met.
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ListRenderer from "./ListRenderer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const node = {
  kind: "list",
  path: ["people"],
  element: {
    entity: "person",
    identifier: "name",
    fields: [
      { name: "name", role: "title" },
      { name: "relationship" },
    ],
  },
};

const items = [
  { name: "Ada Lovelace", relationship: "Mentor" },
  { name: "Grace Hopper", relationship: "Colleague" },
];

// The confirmation dialog exactly as App.jsx wires it: the same four-key state
// object (App.jsx:176-182), the same showConfirmation/handleConfirm/handleCancel
// trio (:184-201), and the same markup and button labelling (:784-799),
// including `onOpenChange={handleCancel}` and the destructive button taking its
// label from whether the title starts with "Remove". Copied rather than imported
// because App.jsx owns this inline; if App's wiring changes, this harness has to
// change with it, and that is a deliberate cost -- the alternative is a test
// that passes against a dialog the app no longer renders.
function Harness({ onItems }) {
  const [list, setList] = useState(items);
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: "",
    description: "",
    action: null,
  });

  const showConfirmation = (title, description, action) => {
    setConfirmDialog({ isOpen: true, title, description, action });
  };

  const handleConfirm = () => {
    if (confirmDialog.action) confirmDialog.action();
    setConfirmDialog({ ...confirmDialog, isOpen: false });
  };

  const handleCancel = () => {
    setConfirmDialog({ ...confirmDialog, isOpen: false });
  };

  return (
    <>
      <ListRenderer
        node={node}
        items={list}
        onItems={(next) => {
          onItems(next);
          setList(next);
        }}
        onShowConfirmation={showConfirmation}
      />
      <Dialog open={confirmDialog.isOpen} onOpenChange={handleCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmDialog.title}</DialogTitle>
            <DialogDescription>{confirmDialog.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirm}>
              {confirmDialog.title?.startsWith("Remove") ? "Remove" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("removing a row through the overflow menu and the real dialog", () => {
  it("opens the confirmation, traps focus, removes the row and releases the page", async () => {
    const onItems = vi.fn();
    const user = userEvent.setup();
    render(<Harness onItems={onItems} />);

    // 1. the row's overflow menu, then Remove. With two focus-scope copies this
    //    is where the RangeError lands: the menu's trap and the dialog's trap
    //    both stay active and fight over focus inside one event dispatch.
    await user.click(
      screen.getByRole("button", { name: "More actions for Ada Lovelace" })
    );
    await user.click(await screen.findByRole("menuitem", { name: "Remove" }));

    // 2. the dialog names the row it is about, not a generic "this item".
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Remove Ada Lovelace?")).toBeInTheDocument();

    // 3. focus is inside the dialog while it is open. This is the focus-scope
    //    half of the bug: with the menu's trap still live, focus never settles
    //    in the dialog even if the render survives.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    // 4-5. confirming runs the action the renderer handed over, and the row is
    //      gone from what the section is asked to store.
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(onItems).toHaveBeenCalledTimes(1);
    const [[next]] = onItems.mock.calls;
    expect(next.map((i) => i.name)).toEqual(["Grace Hopper"]);

    // 6. the page still takes clicks. This is the dismissable-layer half: the
    //    menu owns `body{pointer-events:none}` while it is open, and a second
    //    copy of that module restores the wrong value on close, freezing the
    //    whole app until reload. An empty string is what "nobody is holding it"
    //    looks like.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(document.body.style.pointerEvents).toBe("");
  });
});
