import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { EnumControl, SEGMENTED_MAX } from "./controls";

// jsdom has no layout engine: it reports every width as 0, so an overflow
// cannot be asserted by measuring. These tests pin the layout contract that
// prevents it instead -- which is weaker than a real viewport check, and is
// why the mobile behaviour still wants a look on a device.
//
// The bug: SegmentedControl was a single non-wrapping `inline-flex` row. A
// four-option enum (media.status -- want / in progress / finished / dropped)
// needs roughly 400px, while an expanded row on a 375px phone leaves about
// 223px once the page's px-4, the card's p-6 and the detail grid's px-9 are
// subtracted. The control ran off the side of the screen and its last
// options could not be reached at all.
describe("EnumControl layout on narrow screens", () => {
  const fourOptions = ["want", "in_progress", "finished", "dropped"];

  function segmentedRoot() {
    // The buttons' common parent is the muted pill.
    return screen.getByRole("button", { name: "want" }).parentElement;
  }

  it("renders a segmented control at the size where the overflow occurred", () => {
    render(<EnumControl options={fourOptions} value="want" onChange={() => {}} />);
    expect(fourOptions.length).toBeLessThanOrEqual(SEGMENTED_MAX);
    for (const o of fourOptions) {
      expect(screen.getByRole("button", { name: o.replace(/_/g, " ") })).toBeInTheDocument();
    }
  });

  it("lets the segmented control wrap instead of running off the screen", () => {
    render(<EnumControl options={fourOptions} value="want" onChange={() => {}} />);
    const root = segmentedRoot();
    expect(root.className).toContain("flex-wrap");
    // Without max-w-full the flex container sizes to its content and wrapping
    // never triggers, so both halves are load-bearing.
    expect(root.className).toContain("max-w-full");
  });

  it("gives each option a thumb-sized hit area", () => {
    render(<EnumControl options={fourOptions} value="want" onChange={() => {}} />);
    // py-1 is a ~26px target. `tap-target` (globals.css) grows the hit area
    // by 6px on every side via an ::after overlay, without moving anything.
    for (const o of fourOptions) {
      const button = screen.getByRole("button", { name: o.replace(/_/g, " ") });
      expect(button.className).toContain("tap-target");
    }
  });

  it("keeps the dropdown trigger inside a container narrower than its 170px floor", () => {
    const many = ["book", "article", "podcast", "show", "film", "game", "video", "music"];
    render(<EnumControl options={many} value="book" onChange={() => {}} />);
    expect(many.length).toBeGreaterThan(SEGMENTED_MAX);
    const trigger = screen.getByRole("combobox");
    expect(trigger.className).toContain("max-w-full");
  });
});

// SelectTrigger's base class carries `[&>span]:line-clamp-1`, which applies
// display:-webkit-box and -webkit-box-orient:vertical to any DIRECT span
// child. That selector is `.class > span` (0,1,1) and outranks a plain
// `.inline-flex` (0,1,0), so the trigger's icon and label were laid out as
// two vertical lines with the second clamped away -- the icon rendered on
// top of its own text. Pre-existing since the dropdown was introduced.
describe("SelectControl trigger content", () => {
  const many = ["book", "article", "podcast", "show", "film", "game", "video", "music"];

  it("lays the selected value out horizontally despite the trigger's line-clamp", () => {
    render(<EnumControl options={many} value="book" onChange={() => {}} />);
    const trigger = screen.getByRole("combobox");
    const valueSpan = within(trigger).getByText("book").parentElement;

    // The important flag is what settles the cascade against `>span`.
    // A non-important display utility loses and the stacking returns.
    expect(valueSpan.className).toContain("!flex");
  });

  it("keeps the icon from being squashed and lets a long label truncate", () => {
    render(<EnumControl options={many} value="podcast" onChange={() => {}} />);
    const trigger = screen.getByRole("combobox");
    const label = within(trigger).getByText("podcast");

    // The label is nested, so the clamp -- which only reaches direct
    // children -- cannot apply to it either.
    expect(label.tagName).toBe("SPAN");
    expect(label.className).toContain("truncate");
    expect(label.parentElement).not.toBe(trigger);

    const icon = trigger.querySelector("svg");
    expect(icon.getAttribute("class")).toContain("shrink-0");
  });
});
