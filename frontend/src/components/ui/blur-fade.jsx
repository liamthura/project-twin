import { useRef } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";

/**
 * Magic UI's `blur-fade`, adapted.
 *
 * Two changes from the registry version. It is JSX rather than TSX, since this
 * app is not TypeScript. And it honours `prefers-reduced-motion`: the original
 * animates regardless, which would break the reduced-motion frame the design
 * spec requires.
 *
 * Section entrances only. The spec's motion ban list rules out anything that
 * loops, drifts, pulses or shimmers -- this fires once, on entry, and stops.
 */
export function BlurFade({
  children,
  className,
  duration = 0.4,
  delay = 0,
  offset = 6,
  direction = "down",
  inView = true,
  inViewMargin = "-50px",
  blur = "6px",
  ...props
}) {
  const ref = useRef(null);
  const inViewResult = useInView(ref, { once: true, margin: inViewMargin });
  const isInView = !inView || inViewResult;
  const reduced = useReducedMotion();

  // Rendered plainly rather than as a motion.div with zeroed values: a visitor
  // who asked for no motion should not be paying for the library's per-frame
  // work to be told nothing moves.
  if (reduced) {
    return (
      <div ref={ref} className={className}>
        {children}
      </div>
    );
  }

  const axis = direction === "left" || direction === "right" ? "x" : "y";
  const from = direction === "right" || direction === "down" ? -offset : offset;

  return (
    <AnimatePresence>
      <motion.div
        ref={ref}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        exit="hidden"
        variants={{
          hidden: { [axis]: from, opacity: 0, filter: `blur(${blur})` },
          visible: { [axis]: 0, opacity: 1, filter: "blur(0px)" },
        }}
        transition={{ delay: 0.04 + delay, duration, ease: "easeOut" }}
        className={className}
        {...props}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
