import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddEntryDialog } from "./AddEntryDialog";

// Descriptors: `item` is the title field by `role`, and `stance` says its own
// type, vocabulary, default and position instead of being named in four places
// on the node.
const node = {
  kind: "list", path: ["likes_dislikes"], title: "Likes & Dislikes",
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

  it("describes the dialog as adding one entry to the list it names", () => {
    render(
      <AddEntryDialog node={node} entity={undefined} items={[]}
        onAdd={vi.fn()} open onOpenChange={vi.fn()} />
    );
    // Radix needs aria-describedby to resolve to something at all, which is
    // what this asserted before it also asserted what that something says.
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-describedby");
    expect(descriptionOf()).toBeInTheDocument();
    expect(descriptionOf()).toHaveTextContent("Add one entry to Likes & Dislikes.");
  });

  it("describes it as adding one of the entity when there is no container title", () => {
    const untitled = { ...withElement({ entity: "mental_tab" }), title: undefined };
    render(
      <AddEntryDialog node={untitled} entity={undefined} items={[]}
        onAdd={vi.fn()} open onOpenChange={vi.fn()} />
    );
    expect(descriptionOf()).toHaveTextContent("Add one mental tab.");
  });

  it("lets a node's own description override either default", () => {
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
    expect(screen.getByRole("heading", { name: "Add to Likes & Dislikes" })).toBeInTheDocument();
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
