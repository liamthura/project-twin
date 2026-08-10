import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/controls";

// An on/off control for a stored JSON boolean.
//
// Sized and styled to sit beside the other controls rather than beneath them:
// the track is the height of a small Input, and the thumb carries a shadow so
// it reads as a raised object on the track.
//
// The off state deliberately does NOT read `--input`, which it used to. That
// token is a control BOUNDARY token: it moved to `20 6% 57%` / `60 2% 40%` so
// field edges could pass WCAG 1.4.11, and as a track FILL that made Off darker
// and heavier than On -- inverting the one thing a switch has to communicate.
// `muted-foreground/25` tracks an existing pair instead, so no border ruling
// can drag it again, and hover steps to /40 (/35 measures 1.16 against /25,
// which is not a visible change).
//
// The boundary is where `input` belongs, and now gets it: the track is a
// control, so its extent needs 3:1 (3.16 Light / 3.11 Dark). Before this it
// bound `border` at 1.26 and the dark fill was masking the failure.
//
// Two measurements are accepted rather than overlooked, both recorded in
// docs/superpowers/specs/2026-08-10-app-redesign-phase-2-design.md: off/on
// track is 2.38 in Dark, and the white thumb is 1.39 against a Light track.
// A switch conveys state by thumb POSITION, not colour -- the ring above and
// the thumb's shadow carry it, which is what the shadow is for.
//
// Focus uses the shared FOCUS_RING so keyboard users get exactly what every
// other control gives them, and it stays a real `role="switch"` button, so it
// is reachable and announced without extra work.
export function Switch({ checked, onCheckedChange, className, ...props }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "tap-target relative inline-flex h-6 w-11 shrink-0 items-center rounded-full",
        "border transition-colors duration-200",
        checked
          ? "border-primary bg-primary"
          : "border-input bg-muted-foreground/25 hover:bg-muted-foreground/40",
        FOCUS_RING,
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full bg-card shadow-sm ring-1 ring-black/5",
          "transition-transform duration-200 ease-out",
          checked ? "translate-x-[22px]" : "translate-x-[1px]"
        )}
      />
    </button>
  );
}
