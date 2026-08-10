import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
