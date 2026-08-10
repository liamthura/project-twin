import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { SubsectionCard } from "./SubsectionCard";

const card = () => document.querySelector("[data-subsection-card]");
const header = () => document.querySelector("[data-card-header]");

describe("SubsectionCard", () => {
  it("titles itself at the level its depth earns", () => {
    // The same depth rule the single-card layout used: a top-level node is h3,
    // a grouped child h4. Keeping it means the restructure changes the visual
    // tiers without flattening the document outline.
    const { unmount } = render(<SubsectionCard title="Education" depth={0}>rows</SubsectionCard>);
    expect(screen.getByRole("heading", { name: "Education", level: 3 })).toBeInTheDocument();
    unmount();
    render(<SubsectionCard title="Frameworks" depth={1}>chips</SubsectionCard>);
    expect(screen.getByRole("heading", { name: "Frameworks", level: 4 })).toBeInTheDocument();
  });

  it("sets the title at headline-2, which is smaller than the page title above it", () => {
    render(<SubsectionCard title="Education" depth={0}>rows</SubsectionCard>);
    const title = screen.getByRole("heading", { name: "Education" });
    expect(title.className).toContain("text-base");
    expect(title.className).toContain("font-semibold");
  });

  it("carries the card geometry the prototype measures", () => {
    // Figma 114:363: radius 12, padding 16, 1px border, no shadow at rest.
    // rounded-xl is calc(var(--radius) + 4px) via the config, so the concentric
    // 12/8/6 scale holds if --radius ever moves.
    render(<SubsectionCard title="Education" depth={0}>rows</SubsectionCard>);
    expect(card().className).toContain("rounded-xl");
    expect(card().className).toContain("p-4");
    expect(card().className).toContain("border");
    expect(card().className).toContain("shadow-none");
  });

  it("puts the header 12px above its content", () => {
    render(<SubsectionCard title="Education" depth={0}>rows</SubsectionCard>);
    expect(document.querySelector("[data-card-content]").className).toContain("mt-3");
  });

  it("puts the action slot in the header row, not in the content", () => {
    // The `+ Add` trigger a list node portals in has to sit in the row that
    // NAMES the list; that is the whole point of headerActionSlot.
    render(
      <SubsectionCard title="Education" depth={0} action={<div data-slot />}>
        rows
      </SubsectionCard>
    );
    expect(header().querySelector("[data-slot]")).not.toBeNull();
    expect(document.querySelector("[data-card-content] [data-slot]")).toBeNull();
  });

  it("puts the count opposite the title, in the same row", () => {
    render(
      <SubsectionCard title="Default style" depth={1} count={<span>3 of 3</span>}>
        fields
      </SubsectionCard>
    );
    expect(within(header()).getByText("3 of 3")).toBeInTheDocument();
  });

  it("renders no right-hand group at all when there is nothing to put in it", () => {
    // A `scalar` node's header carries neither a count nor an add -- the control
    // shows its own state -- so an empty flex container would be dead markup
    // that still eats the header's gap.
    render(<SubsectionCard title="Locale" depth={1}>control</SubsectionCard>);
    expect(header().children).toHaveLength(1);
  });

  it("renders its children as the card's content", () => {
    render(
      <SubsectionCard title="Education" depth={0}>
        <p>a row</p>
      </SubsectionCard>
    );
    expect(within(document.querySelector("[data-card-content]")).getByText("a row")).toBeInTheDocument();
  });

  describe("the save tick", () => {
    it("shows nothing without a tick", () => {
      render(<SubsectionCard title="Education" depth={0}>rows</SubsectionCard>);
      expect(document.querySelector("[data-save-tick]")).toBeNull();
    });

    it("scales and fades in on the way in", () => {
      render(<SubsectionCard title="Education" depth={0} tick="in">rows</SubsectionCard>);
      const tick = document.querySelector("[data-save-tick]");
      expect(tick).not.toBeNull();
      expect(tick.className).toContain("animate-save-tick-in");
      expect(tick.className).toContain("opacity-100");
    });

    it("fades out on the way out, and keeps that fade under reduced motion", () => {
      // Every other duration collapses to 0ms when the user asks for reduced
      // motion; data-motion="fade" is the one exception globals.css keeps, at
      // 100ms. Without it the tick would vanish instead of fading.
      render(<SubsectionCard title="Education" depth={0} tick="out">rows</SubsectionCard>);
      const tick = document.querySelector("[data-save-tick]");
      expect(tick.className).toContain("opacity-0");
      expect(tick).toHaveAttribute("data-motion", "fade");
      expect(tick.className).toContain("duration-medium");
    });

    it("says nothing to a screen reader, because the header chip already does", () => {
      // The header's save chip is a role="status" reading "Saving…"/"Saved".
      // A per-card announcement on top of that would report the same fact once
      // per card the user touched.
      render(<SubsectionCard title="Education" depth={0} tick="in">rows</SubsectionCard>);
      expect(document.querySelector("[data-save-tick]")).toHaveAttribute("aria-hidden", "true");
    });

    it("appears left of the count so the count does not move when it arrives", () => {
      // The right-hand group is right-aligned, so growing it leftward into the
      // title's slack leaves the count and the Add button exactly where they
      // were. A tick that shifted the button would be worse than no tick.
      render(
        <SubsectionCard title="Default style" depth={1} tick="in" count={<span>3 of 3</span>}>
          fields
        </SubsectionCard>
      );
      const right = header().children[1];
      expect(right.children[0].getAttribute("data-save-tick")).not.toBeNull();
      expect(right.textContent).toContain("3 of 3");
    });
  });
});
