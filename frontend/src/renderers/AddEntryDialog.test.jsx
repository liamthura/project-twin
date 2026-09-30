import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddEntryDialog } from "./AddEntryDialog";

// Descriptors: `item` is the title field by `role`, and `stance` says its own
// type, vocabulary, default and position instead of being named in four places
// on the node.
const node = {
  kind: "list", path: ["likes_dislikes"], title: "Likes & dislikes",
  element: {
    entity: "like",
    identifier: "item",
    fields: [
      { name: "item", role: "title" },
      {
        name: "stance", type: "enum", values: ["like", "dislike"],
        default: "like", show: ["badge"],
      },
    ],
  },
};

// A node like the one above with one part of its element replaced.
const withElement = (extra) => ({ ...node, element: { ...node.element, ...extra } });

describe("AddEntryDialog accessibility", () => {
  // What aria-describedby actually resolves TO, not merely that it resolves.
  // The description has to agree with whichever branch the heading took, or an
  // entity-only node reads "Add mental tab" over "Add one entry to this list."
  // -- two different nouns for one dialog.
  const descriptionOf = () =>
    document.getElementById(screen.getByRole("dialog").getAttribute("aria-describedby"));

  it("adds no description that only repeats the heading", () => {
    // "Add to Likes & dislikes" over "Add one entry to Likes & dislikes." said
    // the same thing twice, so a node without helper text of its own gets none.
    render(
      <AddEntryDialog node={node} entity={undefined} items={[]}
        onAdd={vi.fn()} open onOpenChange={vi.fn()} />
    );
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(/^Add one/)).not.toBeInTheDocument();
  });

  it("names an untitled list's entry by the element's noun when it declares one", () => {
    // circle's `connection` read "Add connection", one click from the
    // Connections settings, which are apps.
    const untitled = { ...withElement({ entity: "connection", noun: "person" }), title: undefined };
    render(
      <AddEntryDialog node={untitled} entity={undefined} items={[]}
        onAdd={vi.fn()} open onOpenChange={vi.fn()} />
    );
    expect(screen.getByRole("heading", { name: "Add person" })).toBeInTheDocument();
  });

  it("shows a node's own description when it has one", () => {
    const described = { ...node, description: "Anything you love or can't stand." };
    render(
      <AddEntryDialog node={described} entity={undefined} items={[]}
        onAdd={vi.fn()} open onOpenChange={vi.fn()} />
    );
    expect(descriptionOf()).toHaveTextContent("Anything you love or can't stand.");
  });

  it("says 'Add to <list>' when the node names its container, not 'Add <list>'", () => {
    render(
      <AddEntryDialog node={node} entity={undefined} items={[]}
        onAdd={vi.fn()} open onOpenChange={vi.fn()} />
    );
    expect(screen.getByRole("heading", { name: "Add to Likes & dislikes" })).toBeInTheDocument();
  });

  it("says a bare 'Add <entity>' when there is no container title to add to", () => {
    const untitled = { ...withElement({ entity: "mental_tab" }), title: undefined };
    render(
      <AddEntryDialog node={untitled} entity={undefined} items={[]}
        onAdd={vi.fn()} open onOpenChange={vi.fn()} />
    );
    expect(screen.getByRole("heading", { name: "Add mental tab" })).toBeInTheDocument();
  });

  // The seeding mechanism itself, pinned at this level because it is the
  // subtle part: `@radix-ui/react-use-controllable-state` calls `onChange`
  // only from its own internal setter, so a controlled `open` moved from
  // outside Radix -- which is every open ListRenderer's empty-state panel
  // performs -- is never reported through `onOpenChange`. Seeding therefore
  // reacts to the `open` prop, and this test drives `open` the way that panel
  // does: by rerendering with a new value and no event of any kind.
  it("re-seeds the draft whenever `open` turns true, including when nothing reported the close", async () => {
    // `stance` as plain text in the FORM position, so it renders as an input
    // whose seeded default is readable as a display value.
    const plain = withElement({
      fields: [{ name: "item", role: "title" }, { name: "stance", default: "like" }],
    });
    const props = {
      node: plain, entity: undefined, items: [],
      onAdd: vi.fn(), onOpenChange: vi.fn(),
    };
    const user = userEvent.setup();
    const { rerender } = render(<AddEntryDialog {...props} open />);

    expect(screen.getByDisplayValue("like")).toBeInTheDocument();
    await user.type(screen.getAllByRole("textbox")[0], "half-finished");

    rerender(<AddEntryDialog {...props} open={false} />);
    rerender(<AddEntryDialog {...props} open />);

    expect(screen.getAllByRole("textbox")[0]).toHaveValue("");
    expect(screen.getByDisplayValue("like")).toBeInTheDocument();
  });

  it("offers a labelled way out, and closes without adding anything", async () => {
    const onAdd = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <AddEntryDialog node={node} entity={undefined} items={[]}
        onAdd={onAdd} open onOpenChange={onOpenChange} />
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe("AddEntryDialog's choice fields", () => {
  const withStatus = (values) => withElement({
    fields: [
      { name: "item", role: "title" },
      { name: "status", type: "enum", values, show: ["badge"] },
    ],
  });

  it("offers five or more choices as a dropdown, which wrapped as buttons", () => {
    render(
      <AddEntryDialog node={withStatus(["active", "paused", "completed", "archived", "idea"])}
        entity={undefined} items={[]} onAdd={vi.fn()} open onOpenChange={vi.fn()} />
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /paused/i })).not.toBeInTheDocument();
  });

  it("keeps four as buttons, which fit on one line", () => {
    render(
      <AddEntryDialog node={withStatus(["active", "achieved", "paused", "dropped"])}
        entity={undefined} items={[]} onAdd={vi.fn()} open onOpenChange={vi.fn()} />
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /paused/i })).toBeInTheDocument();
  });
});
