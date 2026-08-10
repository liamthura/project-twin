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
// The ON track binds `link`, not `primary`. In Light the two tokens hold the
// SAME value (228 69% 55%), so this changes nothing there; in Dark `link` is
// lighter (68% vs 62%), which takes the off/on pair from 2.38 -- under the 3:1
// that 1.4.11 asks of states -- to 3.09.
//
// That is not the token abuse it looks like. `link` and `primary` were split
// because a fill carrying a LABEL wants to be darker so the label passes, while
// the same colour as text wants to be lighter. This track carries no label --
// the thumb is a shape, not text -- so the reason for the split does not reach
// it, and the lighter of the two is simply the better fill here. `indigo` is
// untouched, so every Primary button is unaffected.
//
// One measurement is accepted rather than overlooked, recorded in
// docs/superpowers/specs/2026-08-10-app-redesign-phase-2-design.md: the white
// thumb is 1.39 against a Light track. A switch conveys state by thumb
// POSITION, not colour -- the ring above and the thumb's shadow carry it, which
// is what the shadow is for. (On the ON track the thumb reads at 5.55 Light /
// 3.54 Dark.)
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
          ? "border-link bg-link"
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
