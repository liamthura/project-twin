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

  it("does not reach for a Tailwind grid-cols- utility", () => {
    // This does not, and cannot, prove the rows stack in one column: jsdom
    // does no layout, Tailwind's CSS is not loaded in this test environment,
    // and getComputedStyle has no resolved grid-template-columns to read.
    // What it catches is the actual regression this codebase would introduce:
    // someone reaching for `grid grid-cols-3` again, which is a named
    // AI-slop signature and the one concrete way this file has drifted
    // before. A cheap tripwire against that one regression, not a layout
    // guarantee.
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

  it("links the open panel to its header both ways, for a screen reader", () => {
    // aria-expanded alone only helps someone reading the list linearly.
    // Navigating by region (a normal way to move around a list like this in
    // JAWS, NVDA or VoiceOver) needs the button's aria-controls and the
    // panel's id to be the same string, and the panel's aria-labelledby and
    // the button's id to be the same string the other way. Asserting both
    // attributes exist without checking they resolve to each other would
    // pass even if the ids were swapped or simply wrong.
    renderPicker({ selectedId: "cursor" });

    const trigger = screen.getByRole("button", { name: /cursor/i });
    const panel = screen.getByRole("region", { name: /cursor/i });

    expect(trigger).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", trigger.id);
  });
});
