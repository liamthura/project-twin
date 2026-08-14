import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PromoteDialog from "./PromoteDialog";

const PROMOTABLE = [
  {
    key: "lifestyle", title: "Lifestyle",
    targets: [{ entity: "hobby", field: "name" }, { entity: "value", field: "value" }],
  },
  {
    key: "knowledge", title: "Knowledge",
    targets: [{ entity: "mental_tab", field: "title" }],
  },
];

function Harness({ onConfirm = vi.fn(), onCancel = vi.fn() }) {
  const [promoting, setPromoting] = useState({
    row: { id: "p2", note: "Wants the recommendation first." },
    section: "lifestyle",
    entity: "hobby",
    text: "Wants the recommendation first.",
  });
  return (
    <PromoteDialog
      promoting={promoting}
      promotable={PROMOTABLE}
      onChange={setPromoting}
      onCancel={onCancel}
      onConfirm={() => onConfirm(promoting)}
    />
  );
}

describe("a Select inside the real Dialog", () => {
  /*
   * Radix keeps module-scope state in react-focus-scope (a stack of focus
   * scopes) and react-dismissable-layer (the body's original pointer-events).
   * When a Dialog and a layer component rendered inside it resolve to
   * different copies of those packages, the inner one's teardown restores
   * `pointer-events: none` onto the body and the dialog goes dead while
   * looking perfectly fine.
   *
   * That is exactly what shipped in slice 2b: an overflow menu that could not
   * open a confirmation dialog passed five task reviews, because no test in
   * the repo rendered two Radix layer components together. `npm ls` says
   * react-select dedupes against react-dialog today. This is what keeps that
   * true when a dependency moves.
   *
   * The explicit timeout is not decoration. This class of failure HANGS
   * rather than going red, so without it a regression reports as silence.
   */
  it("picks an option and leaves the dialog usable", { timeout: 15000 }, async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    const dialog = await screen.findByRole("dialog");
    // A modal dialog legitimately sets `pointer-events: none` on the body
    // while it is open, so the value itself proves nothing. What matters is
    // that opening and closing a Select INSIDE it leaves that value where the
    // dialog put it. Restoring the wrong saved value is the whole failure.
    const bodyPointerEvents = document.body.style.pointerEvents;

    await user.click(within(dialog).getByLabelText(/^type$/i));
    await user.click(await screen.findByRole("option", { name: "value" }));

    expect(within(dialog).getByLabelText(/^type$/i)).toHaveTextContent("value");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.body.style.pointerEvents).toBe(bodyPointerEvents);

    await user.click(within(dialog).getByRole("button", { name: /^promote$/i }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ entity: "value" }));
  });

  it("changing section resets the type to that section's first target", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByLabelText(/section/i));
    await user.click(await screen.findByRole("option", { name: "Knowledge" }));

    // Leaving `hobby` selected under Knowledge would offer a type that
    // section cannot hold, and confirm would file nothing.
    expect(within(dialog).getByLabelText(/^type$/i)).toHaveTextContent("mental tab");
  });
});
