// The menu primitive, proved once here so no consumer has to re-prove it.
//
// Radix supplies the focus trap, arrow-key navigation, typeahead and aria
// wiring; these tests do not re-test Radix. They pin the three facts every
// caller relies on: the content is absent until the trigger is used, the items
// are reachable by the `menuitem` role, and selecting one closes the menu.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

function Menu({ onSelect = () => {} }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="More actions">⋯</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem variant="destructive" onSelect={onSelect}>
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("DropdownMenu", () => {
  it("does not render its items until the trigger is used", () => {
    render(<Menu />);
    expect(screen.queryByRole("menuitem", { name: "Remove" })).toBeNull();
  });

  it("exposes its items as menuitem roles once open", async () => {
    const user = userEvent.setup();
    render(<Menu />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: "Remove" })).toBeInTheDocument();
  });

  it("calls onSelect and closes when an item is chosen", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Menu onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: "Remove" })).toBeNull();
  });

  // `text-destructive` is a real design token (tailwind.config.js:35), so this
  // asserts the token by name -- not the same thing as restating a multi-class
  // incantation, which is why Task 5 defines `headline-3` instead of asserting
  // its three classes here.
  it("marks a destructive item with the destructive token", async () => {
    const user = userEvent.setup();
    render(<Menu />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    const item = await screen.findByRole("menuitem", { name: "Remove" });
    expect(item.className).toMatch(/text-destructive/);
  });
});
