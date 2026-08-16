import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MagicCard } from "./magic-card.jsx";

describe("MagicCard", () => {
  it("renders its children", () => {
    render(
      <MagicCard>
        <p>Claude Code</p>
      </MagicCard>,
    );
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("carries no raw hex colours", () => {
    // The registry defaults are #9E7AFF to #FE8BBB, which is the purple-to-pink
    // AI gradient on the design ban list. Every colour here comes from a token.
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
});
