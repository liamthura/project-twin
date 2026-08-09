import { cn } from "@/lib/utils";

/**
 * The MyGist mark, from frontend/public/logo.svg.
 *
 * Inlined rather than <img src="/logo.svg"> so it can take currentColor for the
 * knockout and mono variants. Strokes are live here, unlike the Figma component
 * where they had to be outlined -- SVG scales stroke-width with the viewBox,
 * which is exactly the thing Figma's resize() does not do.
 */
export function Mark({ className, ...props }) {
  return (
    <svg
      viewBox="0 0 96 96"
      className={cn("h-6 w-6", className)}
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <circle cx="45" cy="40" r="15" stroke="currentColor" strokeWidth="9" />
      <path
        d="M60 40 v22 a14 14 0 0 1 -14 14 h-9"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The horizontal lockup: mark + wordmark, the page's primary brand element.
 *
 * `tone="inverse"` is the footer and closing-CTA case. Only the wordmark
 * changes -- the mark keeps Indigo, which is what the brand guide's
 * Ground-inverse cell prescribes.
 *
 * The wordmark is the one place the display face is allowed below its 40px
 * floor, because it is a logotype rather than running text. No webfont ships
 * for it yet, so it currently renders in Geist; see tailwind.config.js.
 */
export function Lockup({ tone = "default", className }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Mark className="h-6 w-6 shrink-0 text-primary" />
      <span
        className={cn(
          "font-display text-xl font-semibold leading-none tracking-tight",
          tone === "inverse" ? "text-on-inverse" : "text-foreground",
        )}
      >
        MyGist
      </span>
    </span>
  );
}
