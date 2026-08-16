import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";

import { MagicCard } from "./magic-card.jsx";

describe("MagicCard", () => {
  afterEach(() => {
    // Restore visibilityState to avoid leaking test state into other tests.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });
  it("renders its children", () => {
    render(
      <MagicCard>
        <p>Claude Code</p>
      </MagicCard>,
    );
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("does not reach for the registry's 6-digit hex defaults", () => {
    // This does not, and cannot, prove the component carries no raw colour:
    // the pattern matches 6-digit hex only, so a 3-digit hex or an rgb()
    // literal would pass unnoticed. What it catches is the actual regression
    // this file would introduce: the registry defaults #9E7AFF to #FE8BBB,
    // the purple-to-pink AI gradient on the design ban list, creeping back in
    // verbatim. A cheap tripwire against that one regression, not a
    // no-raw-colour guarantee.
    const { container } = render(
      <MagicCard>
        <p>Claude Code</p>
      </MagicCard>,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("survives a pointer move without a theme provider", () => {
    // The registry version imports next-themes, which this app does not use.
    // Only its orb mode needed the theme, and orb mode is not vendored.
    const { container } = render(
      <MagicCard>
        <p>Claude Code</p>
      </MagicCard>,
    );
    const card = container.firstChild;
    expect(() => {
      card.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 10, clientY: 10 }),
      );
    }).not.toThrow();
  });

  it("resets the spotlight when the page becomes hidden", async () => {
    // When switching tabs, blur does not fire (the window keeps OS focus),
    // but visibilitychange does. The spotlight must reset to avoid being
    // frozen at the last pointer position.
    const { container } = render(
      <MagicCard>
        <p>Claude Code</p>
      </MagicCard>,
    );
    const card = container.firstChild;

    // Fire pointermove to light the spotlight at (100, 100).
    act(() => {
      fireEvent.pointerMove(card, { clientX: 100, clientY: 100 });
    });

    // Wait for the motion value to update and serialize in the style.
    await waitFor(() => {
      expect(container.innerHTML).toMatch(/100px/);
    }, { timeout: 1000 });

    // Stub visibilityState to "hidden" and dispatch the event on document.
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // The spotlight must have reset to off-card position (-200px).
    await waitFor(() => {
      expect(container.innerHTML).toMatch(/-200px/);
    }, { timeout: 1000 });
  });
});
