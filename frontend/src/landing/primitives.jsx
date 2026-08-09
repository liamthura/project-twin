import { cn } from "@/lib/utils";

/**
 * The one content column.
 *
 * 1280px of content inside a 1440 frame, which is 80px of page padding. Every
 * section uses this and nothing opts out -- section headers that hugged their
 * own text produced four different left edges on the first assembly, and
 * "inconsistent" was the first thing the owner named on review.
 */
export function Column({ className, children, ...props }) {
  return (
    <div
      className={cn("mx-auto w-full max-w-[1280px] px-6 md:px-20", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Section header: mono eyebrow, display headline, optional body sub.
 *
 * The eyebrow is uppercase in the mono face at 11-13px. It is a label, not a
 * heading, so it is rendered as a <p> and the real heading follows.
 */
export function SectionHeader({ eyebrow, headline, sub, tone = "default", className }) {
  const inverse = tone === "inverse";
  return (
    <header className={cn("max-w-[720px]", className)}>
      {eyebrow ? (
        <p
          className={cn(
            "mb-4 font-mono text-[11px] uppercase tracking-[0.14em] md:text-[13px]",
            inverse ? "text-on-inverse/60" : "text-muted-foreground",
          )}
        >
          {eyebrow}
        </p>
      ) : null}
      <h2
        className={cn(
          // 40px is the display face's hard floor: below it the notches stop
          // reading as a signal. This is the smallest the face is ever set.
          "font-display text-[40px] font-semibold leading-[1.05] tracking-tight md:text-[56px]",
          inverse ? "text-on-inverse" : "text-foreground",
        )}
      >
        {headline}
      </h2>
      {sub ? (
        <p
          className={cn(
            "mt-4 text-lg",
            inverse ? "text-on-inverse/70" : "text-muted-foreground",
          )}
        >
          {sub}
        </p>
      ) : null}
    </header>
  );
}

/**
 * A page section with its tonal ground.
 *
 * The page reads paper+blue -> warm -> paper -> cool -> dark -> dark. That arc
 * is why `inverse` uses ground-inverse rather than the app's `foreground`:
 * Ink and Paper invert together, so an ink-grounded section comes out *lighter*
 * than the page in dark mode and the arc runs backwards.
 */
const GROUNDS = {
  paper: "bg-background",
  clay: "bg-clay-tint",
  verdigris: "bg-verdigris-tint",
  inverse: "bg-ground-inverse",
};

export function Section({ ground = "paper", className, children, ...props }) {
  return (
    <section className={cn(GROUNDS[ground], "py-20 md:py-28", className)} {...props}>
      {children}
    </section>
  );
}
