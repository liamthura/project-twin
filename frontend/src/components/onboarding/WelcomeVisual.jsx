/**
 * The diagram on Welcome: what you keep here flows to the assistants you use.
 *
 * It earns its place by explaining the product in one glance -- three sources
 * on the left, one hub, several clients on the right -- which is a job the two
 * paragraphs beside it were doing alone and doing slowly.
 *
 * Motion notes, because both choices here are load-bearing:
 *
 *   It animates in CSS, not JavaScript. globals.css already zeroes every
 *   animation under `prefers-reduced-motion: reduce` (animation-duration 1ms,
 *   iteration-count 1), so a CSS keyframe is covered by the app's existing
 *   promise for free. A JS loop would have to re-check that rule itself, and
 *   would be the one thing on the page still moving for someone who asked
 *   everything to stop.
 *
 *   The connectors animate their dash OFFSET, not their length. The stroke
 *   itself never changes shape, so nothing reflows and the effect reads as
 *   current moving along a wire rather than a line drawing itself over and
 *   over. `strokeDasharray` sets the period; the keyframe walks exactly one
 *   period, which is what makes the loop seamless.
 *
 * Presentational only: `aria-hidden`, because everything it says is said in the
 * prose next to it, and a screen reader announcing "diagram" adds nothing a
 * listener can act on.
 */

// One dash period. Must match the distance `dash-flow` travels in
// tailwind.config.js, or the loop visibly jumps on every repeat.
const DASH = "6 6";

function Node({ x, y, label, muted }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width="62"
        height="24"
        rx="6"
        className={
          muted
            ? "fill-muted stroke-border"
            : "fill-primary/10 stroke-primary/40"
        }
        strokeWidth="1"
      />
      <text
        x={x + 31}
        y={y + 16}
        textAnchor="middle"
        className="fill-muted-foreground text-[9px] font-medium"
      >
        {label}
      </text>
    </g>
  );
}

export function WelcomeVisual() {
  return (
    <svg
      viewBox="0 0 320 150"
      className="h-auto w-full max-w-md"
      role="presentation"
      aria-hidden="true"
    >
      {/* Left: what you keep. Right: what reads it. Drawn first so the nodes
          sit on top of the line ends rather than under them. */}
      <g
        fill="none"
        strokeWidth="1.5"
        strokeDasharray={DASH}
        className="animate-dash-flow stroke-primary/50"
      >
        <path d="M74 27 C 110 27, 110 75, 132 75" />
        <path d="M74 75 H 132" />
        <path d="M74 123 C 110 123, 110 75, 132 75" />
      </g>
      <g
        fill="none"
        strokeWidth="1.5"
        strokeDasharray={DASH}
        className="animate-dash-flow stroke-primary/50"
      >
        <path d="M188 75 C 210 75, 210 27, 246 27" />
        <path d="M188 75 H 246" />
        <path d="M188 75 C 210 75, 210 123, 246 123" />
      </g>

      <Node x="12" y="15" label="about you" muted />
      <Node x="12" y="63" label="your work" muted />
      <Node x="12" y="111" label="how you like" muted />

      {/* The hub. The halo pulses on opacity alone -- scaling it would drag the
          connectors' endpoints, which are drawn to fixed coordinates. */}
      <circle cx="160" cy="75" r="30" className="animate-hub-pulse fill-primary/20" />
      <circle
        cx="160"
        cy="75"
        r="22"
        className="fill-background stroke-primary"
        strokeWidth="1.5"
      />
      <text
        x="160"
        y="79"
        textAnchor="middle"
        className="fill-foreground text-[10px] font-semibold"
      >
        MyGist
      </text>

      <Node x="246" y="15" label="Claude" />
      <Node x="246" y="63" label="ChatGPT" />
      <Node x="246" y="111" label="anything" />
    </svg>
  );
}
