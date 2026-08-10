import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddEntryDialog } from "./AddEntryDialog";

const node = {
  kind: "list", path: ["likes_dislikes"], title: "Likes & Dislikes",
  entity: "like", title_field: "item", badges: ["stance"],
  enum: { stance: ["like", "dislike"] }, field_defaults: { stance: "like" },
};

describe("AddEntryDialog accessibility", () => {
  it("gives the dialog a description, so Radix has something to point aria-describedby at", () => {
    render(
      <AddEntryDialog node={node} entity={undefined} items={[]}
        onAdd={vi.fn()} open onOpenChange={vi.fn()} />
    );
    const dialog = screen.getByRole("dialog");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy)).toBeInTheDocument();
  });

  it("says 'Add to <list>' when the node names its container, not 'Add <list>'", () => {
    render(
      <AddEntryDialog node={node} entity={undefined} items={[]}
        onAdd={vi.fn()} open onOpenChange={vi.fn()} />
    );
    expect(screen.getByRole("heading", { name: "Add to Likes & Dislikes" })).toBeInTheDocument();
  });

  it("says a bare 'Add <entity>' when there is no container title to add to", () => {
    const untitled = { ...node, title: undefined, entity: "mental_tab" };
    render(
      <AddEntryDialog node={untitled} entity={undefined} items={[]}
        onAdd={vi.fn()} open onOpenChange={vi.fn()} />
    );
    expect(screen.getByRole("heading", { name: "Add mental tab" })).toBeInTheDocument();
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
