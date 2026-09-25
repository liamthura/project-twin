// One subsection, one group. The unit the restructure is built on: the section
// used to be a single Card holding every node under nested headings, which made
// a manifest's shape read as one long form rather than as a set of things you
// can deal with separately.
//
// A hairline above, not a box around (wave 3). As bordered cards these held
// bordered lists and bordered inputs, three boxes deep; the list is now the
// only box, and the rule plus spacing does the grouping.
//
// The header is one row: what this is on the left, what you can do to it on the
// right. Which right-hand affordance appears is decided by the node's kind and
// not by this component -- `fields` gets a count because the manifest fixes its
// key set, `list`/`strings` get `+ Add` because they are unbounded, `scalar`
// gets nothing because the control shows its own state.
import { Check } from "lucide-react";

import { InfoButton } from "@/components/ui/info-button";
import { cn } from "@/lib/utils";

export function SubsectionCard({
  title,
  // For a section's one untitled list: the page title already names it, so
  // the heading stays in the outline and leaves the screen.
  titleHidden = false,
  info,
  description,
  depth = 0,
  action,
  count,
  tick,
  className,
  children,
  // The scroll-spy anchor rides on the card for a top-level leaf, so
  // `data-band` / `data-ui-node` are spread from the caller rather than being
  // props this component knows about. Keeps the anchor contract in one place --
  // SectionRenderer, reading outline().
  ...rest
}) {
  // The same depth rule the old NodeHeading used, so the visual tier cap does
  // not flatten the document outline with it: page title h2, top-level node h3,
  // grouped child h4.
  const Heading = depth === 0 ? "h3" : "h4";
  const hasRight = Boolean(tick || count || action);

  return (
    <section
      data-subsection-card
      className={cn("border-t border-border pt-4", className)}
      {...rest}
    >
      <div data-card-header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Heading
            className={titleHidden ? "sr-only" : "truncate text-base font-semibold text-foreground"}
          >
            {title}
          </Heading>
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
      {/* A node's own `description`. The prototype's cards have no line for one
          -- but eleven nodes across the manifests declare one, and the copy
          used to render nowhere at all for `fields` and `list` nodes, which was
          a bug worth fixing rather than repeating. */}
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div data-card-content className="mt-3">
        {children}
      </div>
    </section>
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
