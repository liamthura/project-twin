import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/controls";

// An on/off control for a stored JSON boolean.
//
// Sized and styled to sit beside the other controls rather than beneath them:
// the track is the height of a small Input, and the thumb carries a shadow so
// it reads as a raised object on the track. The off state uses `bg-input` --
// the token every field border already uses -- because `bg-muted` on a muted
// card left the track almost invisible, which is the one state a switch has to
// communicate.
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
          : "border-border bg-input hover:bg-muted-foreground/20",
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
