import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Terminal, AnimatedSpan } from "./terminal.jsx";

describe("Terminal", () => {
  it("shows its lines in full straight away", () => {
    // The registry component types character by character. A command someone
    // came here to copy must be complete and selectable on first paint.
    render(
      <Terminal title="Claude Code">
        <AnimatedSpan>claude mcp add --transport http mygist https://example.test/mcp</AnimatedSpan>
      </Terminal>,
    );
    expect(
      screen.getByText("claude mcp add --transport http mygist https://example.test/mcp"),
    ).toBeInTheDocument();
  });

  it("names the client in the title bar", () => {
    render(
      <Terminal title="Codex">
        <AnimatedSpan>codex mcp add mygist</AnimatedSpan>
      </Terminal>,
    );
    expect(screen.getByText("Codex")).toBeInTheDocument();
  });

  it("draws no decorative traffic lights", () => {
    // Banned pattern: status dots where no real state exists.
    const { container } = render(
      <Terminal title="Codex">
        <AnimatedSpan>codex mcp add mygist</AnimatedSpan>
      </Terminal>,
    );
    expect(container.querySelector(".bg-red-500")).toBeNull();
    expect(container.querySelector(".bg-yellow-500")).toBeNull();
    expect(container.querySelector(".bg-green-500")).toBeNull();
  });

  it("uses no Tailwind 4 utilities", () => {
    // max-h-100 and bg-linear-to-* exist in v4 only. This project is on v3, and
    // a v4 class fails silently as an unknown class rather than loudly.
    const { container } = render(
      <Terminal title="Codex">
        <AnimatedSpan>codex mcp add mygist</AnimatedSpan>
      </Terminal>,
    );
    expect(container.innerHTML).not.toMatch(/\bmax-h-100\b/);
    expect(container.innerHTML).not.toMatch(/\bbg-linear-to-/);
  });
});
