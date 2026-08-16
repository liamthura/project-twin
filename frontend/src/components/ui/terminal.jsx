import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

/**
 * Magic UI's `terminal`, adapted, and adapted hard.
 *
 * Three changes from the registry version, all load-bearing:
 *
 *   `TypingAnimation` is gone entirely, not imported and left uncalled. It
 *   reveals a string one character at a time on a setInterval, which is a fine
 *   effect for a hero and the wrong one for a command someone came here to
 *   copy: mid-animation the text is incomplete, and a triple-click selects
 *   whatever had arrived by then. The card exists to hand over a command, so
 *   the command is complete on first paint.
 *
 *   The three coloured dots are gone. They are a drawing of a macOS title bar,
 *   and "decorative status dots where no real state exists" is on the design
 *   ban list. The bar carries the client's name instead, which is something the
 *   reader actually needs to know while three cards are on screen.
 *
 *   `max-h-100` was a Tailwind 4 utility and does not exist on this project's
 *   v3. It is `max-h-[25rem]`, which is what v4 resolves it to.
 *
 * What is kept is the chrome: a bordered box with a title bar and a mono body.
 * The design record asks for real product chrome over "fake UI assembled from
 * styled divs", and a terminal is the chrome these commands genuinely live in.
 */

/**
 * One line. Fades in on mount, and only on mount.
 *
 * The registry version drives this from an in-view observer and a sequence
 * context so lines appear one after another. Both are gone with the typing: a
 * card that is already open should show its command now, and the entrance is
 * the flow's standard 240ms rather than a staged reveal.
 */
export function AnimatedSpan({ children, delay = 0, className, ...props }) {
  const reduced = useReducedMotion();

  if (reduced) {
    return (
      <div className={cn("grid text-xs font-normal tracking-tight", className)} {...props}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: "easeOut", delay: delay / 1000 }}
      className={cn("grid text-xs font-normal tracking-tight", className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function Terminal({ children, title, className }) {
  return (
    <div
      className={cn(
        "z-0 max-h-[25rem] w-full overflow-hidden rounded-lg border border-border bg-muted/40",
        className,
      )}
    >
      {title && (
        <div className="border-b border-border px-3 py-2">
          <span className="text-[11px] font-medium text-muted-foreground">{title}</span>
        </div>
      )}
      <pre className="overflow-x-auto p-3">
        <code className="grid gap-y-1 font-mono">{children}</code>
      </pre>
    </div>
  );
}
