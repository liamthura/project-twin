import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ListRenderer from "./ListRenderer";

// Shapes mirror the real "aesthetics" pack (frontend/src/__fixtures__/packs.json
// and frontend/src/__fixtures__/data/aesthetics.json): a title field, two
// badges (one enum with a VALUE_META icon, one without), a long-text detail
// field, an array detail field, suggestions, and an entity with valid_values,
// optional custom_* fields and field_defaults.
const node = {
  kind: "list",
  path: ["styles"],
  entity: "aesthetic",
  title_field: "name",
  badges: ["domain", "stance"],
  detail_fields: ["notes", "references"],
  array_fields: ["references"],
  suggestions: { name: ["Minimalist", "Scandinavian"] },
};

const entity = {
  valid_values: { domain: ["interior", "graphic"], stance: ["love", "like", "avoid"] },
  optional: ["custom_stance"],
  field_defaults: { stance: "like" },
};

const scandinavian = {
  id: "aesthetic_1",
  name: "Scandinavian",
  domain: "interior",
  stance: "love",
  notes: "Light wood, muted tones.",
  references: ["Kinfolk magazine"],
};

// ListRenderer is controlled (items in, onItems reports a replacement array
// out), so any test that needs a real add/remove round-trip renders it
// behind a tiny stateful harness rather than a static items array + spy.
function renderStateful(initialItems) {
  let seen = initialItems;
  function Harness() {
    const [state, setState] = useState(initialItems);
    return (
      <ListRenderer
        node={node}
        entity={entity}
        items={state}
        onItems={(next) => {
          seen = next;
          setState(next);
        }}
      />
    );
  }
  const utils = render(<Harness />);
  return { ...utils, user: userEvent.setup(), latest: () => seen };
}

describe("ListRenderer", () => {
  it("renders each row's title, and badges for fields listed in node.badges", () => {
    render(
      <ListRenderer node={node} entity={entity} items={[scandinavian]} onItems={() => {}} />
    );
    expect(screen.getByText("Scandinavian")).toBeInTheDocument();
    expect(screen.getByText("interior")).toBeInTheDocument();
    expect(screen.getByText("love")).toBeInTheDocument();
  });

  it("expands a row on click to reveal its detail fields", async () => {
    const { user } = renderStateful([scandinavian]);
    // Collapsed by default: the detail field isn't on screen yet.
    expect(screen.queryByDisplayValue("Light wood, muted tones.")).not.toBeInTheDocument();

    await user.click(screen.getByText("Scandinavian"));

    expect(screen.getByDisplayValue("Light wood, muted tones.")).toBeInTheDocument();
    expect(screen.getByText("Kinfolk magazine")).toBeInTheDocument();
  });

  it("routes removal through onShowConfirmation and does not call onItems until the confirm callback runs", async () => {
    let confirm;
    const onShowConfirmation = vi.fn((title, body, onConfirm) => {
      confirm = onConfirm;
    });
    const onItems = vi.fn();
    const user = userEvent.setup();
    render(
      <ListRenderer
        node={node}
        entity={entity}
        items={[scandinavian]}
        onItems={onItems}
        onShowConfirmation={onShowConfirmation}
      />
    );

    // The delete button is icon-only (no accessible name), unlike the Add
    // trigger and any suggestion chips, which both carry visible text.
    const deleteButton = screen.getAllByRole("button").find((b) => b.textContent === "");
    await user.click(deleteButton);

    expect(onShowConfirmation).toHaveBeenCalledTimes(1);
    expect(onShowConfirmation).toHaveBeenCalledWith(
      "Remove Scandinavian?",
      "This can't be undone.",
      expect.any(Function)
    );
    // The deletion must wait on confirmation -- a renderer that deletes
    // immediately and asks afterwards would already have called this.
    expect(onItems).not.toHaveBeenCalled();

    confirm();

    expect(onItems).toHaveBeenCalledTimes(1);
    expect(onItems).toHaveBeenCalledWith([]);
  });

  it("merges entity.field_defaults into a new item added via the dialog", async () => {
    const { user, latest } = renderStateful([scandinavian]);

    await user.click(screen.getByRole("button", { name: "Add" }));
    const dialog = screen.getByRole("dialog");
    const titleInput = within(dialog).getAllByRole("textbox")[0];
    await user.type(titleInput, "Y2K");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(latest()[0]).toMatchObject({ name: "Y2K", stance: "like" });
  });

  it("is a no-op when the added title duplicates an existing one, case-insensitively", async () => {
    const initial = [scandinavian];
    const { user, latest } = renderStateful(initial);

    await user.click(screen.getByRole("button", { name: "Add" }));
    const dialog = screen.getByRole("dialog");
    const titleInput = within(dialog).getAllByRole("textbox")[0];
    await user.type(titleInput, "scandinavian");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    // onItems is never called, so the harness's seen reference is still the
    // exact array we rendered with.
    expect(latest()).toBe(initial);
  });

  it("a suggestion chip adds an item, and chips for already-present titles are not offered", async () => {
    const { user, latest } = renderStateful([scandinavian]);

    // "Scandinavian" is already present (case-insensitively) -- its chip
    // must not be offered, only "Minimalist"'s.
    expect(screen.queryByText("+ Scandinavian")).not.toBeInTheDocument();
    const chip = screen.getByText("+ Minimalist");

    await user.click(chip);

    expect(latest()[0]).toMatchObject({ name: "Minimalist", stance: "like" });
  });

  // A schema-valid node need not carry `entity` at all -- waves 3-6 author
  // exactly such nodes for sections whose storage keys diverge from any
  // entity's manifest names. Before this fix, the Add dialog heading did
  // `node.entity.replace(...)` unconditionally and threw on click with no
  // error boundary anywhere in the app to catch it (see ListRenderer.jsx and
  // the crash this guarded against).
  it("does not throw and shows a sensible Add dialog heading when the node has no entity", async () => {
    const entitylessNode = { kind: "list", path: ["goals"], title_field: "title" };
    const user = userEvent.setup();
    render(
      <ListRenderer node={entitylessNode} entity={undefined} items={[]} onItems={() => {}} />
    );

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("heading", { name: "Add item" })).toBeInTheDocument();
  });

  it("uses node.title, when present, for the Add dialog heading in preference to node.entity", async () => {
    const titledNode = { ...node, title: "Aesthetic style" };
    const user = userEvent.setup();
    render(<ListRenderer node={titledNode} entity={entity} items={[]} onItems={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("heading", { name: "Add Aesthetic style" })).toBeInTheDocument();
  });

  it("uses node.long_text (array form) over the default long-text set to render a textarea", async () => {
    // "summary" has no enum, isn't an array field, and isn't in ScalarField's
    // default LONG_TEXT_FIELDS set, so this only renders a Textarea if the
    // node-declared long_text is honoured.
    const longTextNode = { ...node, detail_fields: ["summary"], long_text: ["summary"] };
    const item = { ...scandinavian, summary: "A short summary" };
    const user = userEvent.setup();
    render(<ListRenderer node={longTextNode} entity={entity} items={[item]} onItems={() => {}} />);

    await user.click(screen.getByText("Scandinavian"));

    const el = screen.getByDisplayValue("A short summary");
    expect(el.tagName).toBe("TEXTAREA");
  });

  it("gives node.optional precedence over entity.optional for the custom_* overflow input", async () => {
    // entity.optional lists custom_stance, but this node declares its own
    // inline enum with no custom_* override -- node.optional (empty) must
    // win, so no custom input appears for value "other".
    const inlineEnumNode = {
      ...node,
      enum: { stance: ["love", "like", "avoid", "other"] },
      optional: [],
    };
    const user = userEvent.setup();
    render(
      <ListRenderer
        node={inlineEnumNode}
        entity={entity}
        items={[{ ...scandinavian, stance: "other" }]}
        onItems={() => {}}
      />
    );

    await user.click(screen.getByText("Scandinavian"));

    expect(screen.queryByPlaceholderText("Custom stance…")).not.toBeInTheDocument();
  });
});
