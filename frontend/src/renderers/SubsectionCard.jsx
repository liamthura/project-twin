// One subsection, one card. The unit the restructure is built on: the section
// used to be a single Card holding every node under nested headings, which made
// a manifest's shape read as one long form rather than as a set of things you
// can deal with separately.
//
// Figma 114:363 / 114:413: radius 12, padding 16, header 12 above content, 1px
// border, no shadow at rest (shadow is reserved for things that float).
//
// The header is one row: what this is on the left, what you can do to it on the
// right. Which right-hand affordance appears is decided by the node's kind and
// not by this component -- `fields` gets a count because the manifest fixes its
// key set, `list`/`strings` get `+ Add` because they are unbounded, `scalar`
// gets nothing because the control shows its own state.
import { Check } from "lucide-react";

import { Card } from "@/components/ui/card";
import { InfoButton } from "@/components/ui/info-button";

export function SubsectionCard({ title, info, depth = 0, action, count, tick, children }) {
  // The same depth rule the old NodeHeading used, so the visual tier cap does
  // not flatten the document outline with it: page title h2, top-level node h3,
  // grouped child h4.
  const Heading = depth === 0 ? "h3" : "h4";
  const hasRight = Boolean(tick || count || action);

  return (
    <Card data-subsection-card className="rounded-xl p-4 shadow-none">
      <div data-card-header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Heading className="truncate text-base font-semibold text-foreground">{title}</Heading>
          <InfoButton info={info} title={title} />
        </div>
        {/* Rendered only when it holds something: a `scalar` node's header has
            neither a count nor an add, and an empty flex child would still eat
            the row's gap. */}
        {hasRight && (
          <div className="flex shrink-0 items-center gap-2">
            {/* Tick first, so it grows the group LEFTWARD into the title's
                slack. Appended after the count it would push the count and the
                Add button sideways every time a save landed. */}
            {tick && <SaveTick phase={tick} />}
            {count}
            {action}
          </div>
        )}
      </div>
      <div data-card-content className="mt-3">
        {children}
      </div>
    </Card>
  );
}

// The per-card save tick that replaced a toast per autosave flush. Decoration
// on purpose: the header's save chip is a role="status" that already announces
// "Saving…" then "Saved", and a per-card announcement would repeat that fact
// once for every card the reader touched.
//
// The entrance is a CSS animation, the 1.2s hold is a JS timer in
// SectionRenderer, and the exit is a transition marked data-motion="fade".
// That split is forced: the reduced-motion block sets animation-duration to
// 1ms on everything, so a keyframed hold would be erased, while data-motion
// ="fade" is the one exception that keeps a 100ms fade there.
function SaveTick({ phase }) {
  return (
    <span
      data-save-tick
      data-motion="fade"
      aria-hidden="true"
      className={`inline-flex text-primary transition-opacity duration-medium ${
        phase === "out" ? "opacity-0" : "animate-save-tick-in opacity-100"
      }`}
    >
      <Check className="h-4 w-4" />
    </span>
  );
}
