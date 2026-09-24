import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Header } from "./Header";

const renderHeader = (props = {}) => render(<Header {...props} />);

describe("Header", () => {
  it("names the app", () => {
    renderHeader();
    expect(screen.getByRole("heading", { name: "MyGist" })).toBeInTheDocument();
  });

  describe("the save-state chip", () => {
    it("reads Saved when there is nothing to do", () => {
      renderHeader({ saveState: "saved" });
      expect(screen.getByRole("status")).toHaveTextContent("Saved");
      expect(screen.queryByRole("button", { name: "Save now" })).not.toBeInTheDocument();
    });

    it("reads Saving… while a write is in flight, and offers no action", () => {
      // Offering Save now mid-save invites a second write over the first.
      renderHeader({ saveState: "saving" });
      expect(screen.getByRole("status")).toHaveTextContent("Saving…");
      expect(screen.queryByRole("button", { name: "Save now" })).not.toBeInTheDocument();
    });

    it("reads Unsaved and offers Save now -- the one state with an action", async () => {
      const onSaveNow = vi.fn();
      renderHeader({ saveState: "unsaved", onSaveNow });
      expect(screen.getByRole("status")).toHaveTextContent("Unsaved");
      await userEvent.click(screen.getByRole("button", { name: "Save now" }));
      expect(onSaveNow).toHaveBeenCalledTimes(1);
    });

    it("announces a state change without the user looking at it", () => {
      renderHeader({ saveState: "saving" });
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("falls back to Saved for an unrecognised state rather than rendering blank", () => {
      renderHeader({ saveState: "nonsense" });
      expect(screen.getByRole("status")).toHaveTextContent("Saved");
    });
  });

  it("carries no auto-save control -- that preference lives in Connection Settings now", () => {
    // The regression guard for the eviction. A switch reappearing here is the
    // likely way this slice gets undone, so it is asserted rather than assumed.
    renderHeader({ saveState: "unsaved" });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/auto-?save/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/auto-?save/i)).not.toBeInTheDocument();
  });

  it("shows a disconnected badge only when disconnected", () => {
    const { rerender } = renderHeader({ isConnected: true });
    expect(screen.queryByText("Disconnected")).not.toBeInTheDocument();
    rerender(<Header isConnected={false} />);
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  describe("the account menu", () => {
    it("shows the name it was given", () => {
      renderHeader({ accountName: "Liam" });
      expect(screen.getByRole("button", { name: "Liam" })).toBeInTheDocument();
    });

    it("falls back to Account when there is no name yet", () => {
      renderHeader({ accountName: undefined });
      expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
    });

    it("opens Settings from the menu", async () => {
      const onOpenSettings = vi.fn();
      renderHeader({ accountName: "Liam", onOpenSettings });
      await userEvent.click(screen.getByRole("button", { name: "Liam" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Settings" }));
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it("offers each theme by name, marks the current one, and sets the one chosen", async () => {
      // The old control was a lone icon that cycled on click: it said neither
      // what it was nor what the next click would do.
      const onSetTheme = vi.fn();
      renderHeader({ theme: "dark", onSetTheme });
      await userEvent.click(screen.getByRole("button", { name: "Account" }));
      expect(await screen.findByRole("menuitem", { name: "Dark theme, current" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("menuitem", { name: "Light theme" }));
      expect(onSetTheme).toHaveBeenCalledWith("light");
    });

    it("signs out from the menu", async () => {
      const onSignOut = vi.fn();
      renderHeader({ onSignOut });
      await userEvent.click(screen.getByRole("button", { name: "Account" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
      expect(onSignOut).toHaveBeenCalledTimes(1);
    });

    it("no longer has a standalone theme button", () => {
      renderHeader();
      expect(screen.queryByRole("button", { name: /^Theme:/ })).not.toBeInTheDocument();
    });
  });

  it("is 60px and sticky, which is what every scroll-margin in the app assumes", () => {
    renderHeader();
    const header = screen.getByRole("banner");
    expect(header.className).toContain("sticky");
    expect(header.querySelector(".h-\\[60px\\]")).not.toBeNull();
  });
});
