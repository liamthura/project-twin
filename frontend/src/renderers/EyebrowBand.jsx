// The label over a group's cards: mono, uppercase, tracked, with a hairline
// rule running out to the end of the row.
//
// It replaces two things the single-card layout used to need -- a bold heading
// inside the card and the `<hr>` that separated one group from the next -- and
// it is why neither survives the restructure. The rule belongs to the label
// rather than dividing content, so it is decoration (aria-hidden, no separator
// role) and the 32px gap between runs does the dividing.
//
// Figma: EyebrowBand `61:22`, instance `109:98`, label `I109:98;61:23`
// (13 Geist Mono, +6%, UPPER), rule `I109:98;61:24` (1px).
import { InfoButton } from "@/components/ui/info-button";

export function EyebrowBand({ title, info, description }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {/* h3, not a styled div: the band names the cards beneath it, so it is
            part of the document outline. Level 3 continues the tree the depth
            rule already sets -- page title h2, top-level node h3, grouped child
            h4 -- so the visual tier cap does not flatten the outline with it. */}
        <h3 className="shrink-0 font-mono text-[13px] uppercase tracking-[0.06em] text-muted-foreground">
          {title}
        </h3>
        <InfoButton info={info} title={title} />
        <span aria-hidden="true" data-eyebrow-rule className="h-px flex-1 bg-border" />
      </div>
      {/* Four groups across three packs declare a `description`, and the
          prototype's bands are a single row with nowhere to put one. Dropping
          it would delete real manifest copy and re-introduce the bug that had
          `fields` and `list` descriptions rendering nowhere at all, so it lands
          under the rule instead -- a divergence, recorded in the plan. */}
      {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
    </div>
  );
}
