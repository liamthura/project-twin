import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { INSTALLABLE_CLIENTS } from "@/lib/clients.js";
import { ClientPicker } from "./ClientPicker.jsx";

const renderPicker = (props = {}) =>
  render(
    <ClientPicker
      clients={INSTALLABLE_CLIENTS}
      selectedId={null}
      onSelect={vi.fn()}
      renderExpanded={(client) => <p>install {client.id}</p>}
      {...props}
    />,
  );

describe("ClientPicker", () => {
  it("lists every installable client", () => {
    renderPicker();
    for (const client of INSTALLABLE_CLIENTS) {
      expect(screen.getByRole("button", { name: new RegExp(client.name, "i") })).toBeInTheDocument();
    }
  });

  it("reports which one was chosen", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderPicker({ onSelect });

    await user.click(screen.getByRole("button", { name: /claude code/i }));
    expect(onSelect).toHaveBeenCalledWith("claude-code");
  });

  it("expands only the chosen row", () => {
    renderPicker({ selectedId: "cursor" });

    expect(screen.getByText("install cursor")).toBeInTheDocument();
    expect(screen.queryByText("install codex")).not.toBeInTheDocument();
  });

  it("closes a row that is clicked while open", async () => {
    // Selecting the open row again is the only way back to a closed list, and a
    // row that will not close reads as broken.
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderPicker({ selectedId: "cursor", onSelect });

    await user.click(screen.getByRole("button", { name: /cursor/i }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("says which row is open, for a screen reader", () => {
    renderPicker({ selectedId: "cursor" });

    expect(screen.getByRole("button", { name: /cursor/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: /codex/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("stacks in one column rather than a grid", () => {
    // Three identical cards in a row is a named AI-slop signature, and six
    // would be worse. This pins the layout so a later tidy-up cannot quietly
    // reintroduce it.
    const { container } = render(
      <ClientPicker
        clients={INSTALLABLE_CLIENTS}
        selectedId={null}
        onSelect={vi.fn()}
        renderExpanded={() => null}
      />,
    );
    expect(container.querySelector('[class*="grid-cols-"]')).toBeNull();
  });
});
