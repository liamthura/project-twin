import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PromoteDialog, { promotionTargets } from "./PromoteDialog";

const PROMOTABLE = [
  {
    key: "lifestyle", title: "Lifestyle",
    targets: [
      { entity: "hobby", field: "name", title: "Hobbies", label: "Name" },
      { entity: "value", field: "value", title: "Values", label: "Value", placeholder: "e.g. honesty" },
    ],
  },
  {
    key: "knowledge", title: "Knowledge",
    targets: [{ entity: "mental_tab", field: "title", title: "Mental tabs", label: "Title" }],
  },
];

function Harness({ onConfirm = vi.fn(), onCancel = vi.fn(), entity = "hobby" }) {
  const [promoting, setPromoting] = useState({
    row: { id: "p2", note: "Wants the recommendation first." },
    section: "lifestyle",
    entity,
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
    await user.click(await screen.findByRole("option", { name: "Values" }));

    expect(within(dialog).getByLabelText(/^type$/i)).toHaveTextContent("Values");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.body.style.pointerEvents).toBe(bodyPointerEvents);

    await user.click(within(dialog).getByRole("button", { name: /^promote$/i }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ entity: "value" }));
  });

  it("changing to a section with one type chooses it", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByLabelText(/section/i));
    await user.click(await screen.findByRole("option", { name: "Knowledge" }));

    // Leaving `hobby` selected under Knowledge would offer a type that
    // section cannot hold, and confirm would file nothing.
    expect(within(dialog).getByLabelText(/^type$/i)).toHaveTextContent("Mental tabs");
    expect(within(dialog).getByLabelText(/^title$/i)).toBeInTheDocument();
  });

  it("names a section with several types unchosen, and will not promote until one is picked", async () => {
    const user = userEvent.setup();
    render(<Harness entity="" />);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/^type$/i)).toHaveTextContent("Choose a type");
    expect(within(dialog).getByRole("button", { name: /^promote$/i })).toBeDisabled();

    await user.click(within(dialog).getByLabelText(/^type$/i));
    await user.click(await screen.findByRole("option", { name: "Values" }));
    // The field under it takes the editor's label and hint for that type.
    expect(within(dialog).getByLabelText(/^value$/i)).toHaveAttribute("placeholder", "e.g. honesty");
    expect(within(dialog).getByRole("button", { name: /^promote$/i })).toBeEnabled();
  });
});

describe("promotionTargets", () => {
  it("names each type as the editor does, with its field's label and hint", () => {
    const pack = {
      entities: {
        mood_override: { actions: ["add"], required: ["mood"], identifier: "mood" },
        response_format: { actions: ["add"], required: ["item"], identifier: "item" },
      },
      sections: [{
        kind: "group", title: "Communication",
        sections: [
          {
            kind: "list", title: "When I'm feeling...",
            element: {
              entity: "mood_override", identifier: "mood",
              fields: [{ name: "mood", placeholder: "e.g. stressed, tired" }],
            },
          },
          {
            kind: "strings", title: "Response format", placeholder: "e.g. code blocks",
            element: { entity: "response_format", identifier: "item" },
          },
        ],
      }],
    };
    expect(promotionTargets(pack)).toEqual([
      { entity: "mood_override", field: "mood", title: "When I'm feeling...", label: "Mood", placeholder: "e.g. stressed, tired" },
      { entity: "response_format", field: "item", title: "Response format", label: "Text", placeholder: "e.g. code blocks" },
    ]);
  });

  it("names two entities over one list apart, and leaves out one no section draws", () => {
    const pack = {
      entities: {
        like: { actions: ["add"], required: ["item"], identifier: "item" },
        dislike: { actions: ["add"], required: ["item"], identifier: "item" },
        preference: { actions: ["add"], required: ["key"], identifier: "key" },
      },
      sections: [{
        kind: "list", title: "Likes & dislikes",
        element: {
          entity: "like", identifier: "item", variants: [{ entity: "dislike" }],
          fields: [{ name: "item" }],
        },
      }],
    };
    expect(promotionTargets(pack).map((t) => [t.entity, t.title])).toEqual([
      ["like", "Likes & dislikes: like"],
      ["dislike", "Likes & dislikes: dislike"],
    ]);
  });
});
