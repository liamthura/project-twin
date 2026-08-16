import { useCallback, useEffect } from "react";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

/**
 * Magic UI's `magic-card`, adapted.
 *
 * Four changes from the registry version:
 *
 *   `next-themes` is gone, along with the whole `mode="orb"` branch that
 *   needed it. This app switches themes with a class on <html>, not that
 *   library, and the gradient mode never read the theme in the first place.
 *
 *   The default palette was #9E7AFF to #FE8BBB. That is the purple-to-pink
 *   gradient the design record names as the single most recognisable AI-slop
 *   signature. Both ends are semantic tokens now, and the spotlight is a muted
 *   tint rather than a saturated one.
 *
 *   `var(--color-background)` and `var(--color-border)` are Tailwind 4 theme
 *   variables. This project's equivalents are `hsl(var(--background))` and
 *   `hsl(var(--border))`.
 *
 *   It honours `prefers-reduced-motion`, returning a plain bordered box. A
 *   spotlight chasing the cursor is precisely the drifting effect someone who
 *   set that flag asked not to have.
 */
const SPOTLIGHT_SIZE = 200;

export function MagicCard({ children, className }) {
  const reduced = useReducedMotion();

  // Started off-card, so nothing is lit until the pointer actually arrives.
  const mouseX = useMotionValue(-SPOTLIGHT_SIZE);
  const mouseY = useMotionValue(-SPOTLIGHT_SIZE);

  const reset = useCallback(() => {
    mouseX.set(-SPOTLIGHT_SIZE);
    mouseY.set(-SPOTLIGHT_SIZE);
  }, [mouseX, mouseY]);

  const handlePointerMove = useCallback(
    (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      mouseX.set(e.clientX - rect.left);
      mouseY.set(e.clientY - rect.top);
    },
    [mouseX, mouseY],
  );

  // A pointer that leaves the window never fires pointerleave on the card.
  // blur alone is not enough: switching to another tab fires visibilitychange
  // but not blur, because the window keeps OS focus. So the spotlight would
  // stay frozen at the last pointer position until a genuine pointer event
  // recalculates it. Both listeners reset the spotlight when focus is lost.
  useEffect(() => {
    const clear = () => reset();
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clear();
      }
    };
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [reset]);

  const border = useMotionTemplate`
    linear-gradient(hsl(var(--background)) 0 0) padding-box,
    radial-gradient(${SPOTLIGHT_SIZE}px circle at ${mouseX}px ${mouseY}px,
      hsl(var(--primary) / 0.5),
      hsl(var(--border)) 100%
    ) border-box
  `;

  const spotlight = useMotionTemplate`
    radial-gradient(${SPOTLIGHT_SIZE}px circle at ${mouseX}px ${mouseY}px,
      hsl(var(--muted-foreground) / 0.12),
      transparent 100%
    )
  `;

  if (reduced) {
    return (
      <div className={cn("relative overflow-hidden rounded-lg border", className)}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={cn(
        "group relative isolate overflow-hidden rounded-lg border border-transparent",
        className,
      )}
      onPointerMove={handlePointerMove}
      onPointerLeave={reset}
      style={{ background: border }}
    >
      <div className="absolute inset-px z-20 rounded-[inherit] bg-background" />
      <motion.div
        className="pointer-events-none absolute inset-px z-30 rounded-[inherit] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{ background: spotlight }}
      />
      <div className="relative z-40">{children}</div>
    </motion.div>
  );
}
