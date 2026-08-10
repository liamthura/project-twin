import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./switch";

// These assert on class names, which is normally a smell -- the thing being
// protected here is precisely a token binding, and a token binding has no
// behaviour to assert instead. jsdom computes no colours, so "the off track
// is not the boundary token" can only be checked as the class that carries it.
//
// Why it is worth a test at all: `bg-input` was the off track's fill until
// 2026-08-10, and when --input moved to a control-boundary value (so field
// edges could pass WCAG 1.4.11) the off state silently became darker and
// heavier than the on state. Nothing failed. See
// docs/superpowers/specs/2026-08-10-app-redesign-phase-2-design.md.
describe("Switch track tokens", () => {
  const trackOf = () => screen.getByRole("switch").className;

  it("fills the off track from muted-foreground, never from the boundary token", () => {
    render(<Switch checked={false} onCheckedChange={vi.fn()} />);
    const cls = trackOf();

    expect(cls).toContain("bg-muted-foreground/25");
    // The regression itself: a boundary token must not be a fill again.
    expect(cls).not.toContain("bg-input");
  });

  it("puts the boundary token on the boundary, where 1.4.11 applies", () => {
    render(<Switch checked={false} onCheckedChange={vi.fn()} />);
    const cls = trackOf();

    // A switch is a control, so its extent needs 3:1 -- `input` measures
    // 3.16 Light / 3.11 Dark against card. `border` measured 1.26.
    expect(cls).toContain("border-input");
    expect(cls).not.toContain("border-border");
  });

  it("darkens on hover rather than lightening, which /35 or /20 would do", () => {
    render(<Switch checked={false} onCheckedChange={vi.fn()} />);
    // /40 over /25. The previous value was /20 -- lighter than the off state
    // it was meant to respond to, so hover read backwards.
    expect(trackOf()).toContain("hover:bg-muted-foreground/40");
  });

  it("fills the on track from link, which is what clears the state pair in Dark", () => {
    render(<Switch checked onCheckedChange={vi.fn()} />);
    const cls = trackOf();

    // `link`, not `primary`. Identical to primary in Light (228 69% 55%), and
    // lighter in Dark (68% vs 62%) -- which takes off-vs-on from 2.38 to 3.09.
    // Ruled 2026-08-10; `indigo` is untouched, so Primary buttons are too.
    expect(cls).toContain("bg-link");
    expect(cls).toContain("border-link");
    expect(cls).not.toContain("bg-primary");
    expect(cls).not.toContain("bg-muted-foreground/25");
  });

  it("still reports and toggles its state", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} />);

    const track = screen.getByRole("switch");
    expect(track).toHaveAttribute("aria-checked", "false");

    await user.click(track);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
