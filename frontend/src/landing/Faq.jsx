import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FAQ } from "./content";
import { Column, Section, SectionHeader } from "./primitives";
import { cn } from "@/lib/utils";

/**
 * The FAQ, on the verdigris tint.
 *
 * Two columns on desktop: the topic label in a 280px left column, questions
 * filling the rest. At mobile the label stacks above its questions.
 *
 * Built against the Checklist Design FAQ checklist. Two of its items -- a table
 * of contents and search -- are deliberately not implemented: the checklist
 * gates both on "a large amount of questions", and this is nine questions in a
 * page *section* rather than a standalone FAQ page. A ToC would be longer than
 * the thing it indexes.
 */
export function Faq() {
  return (
    <Section id="faq" ground="verdigris">
      <Column>
        <SectionHeader
          eyebrow={FAQ.eyebrow}
          headline={FAQ.headline}
          sub={FAQ.sub}
        />

        <div className="mt-14 space-y-12">
          {FAQ.groups.map((group) => (
            <div key={group.label} className="md:flex md:gap-10">
              {/* Sticky and narrower. At 280px, fixed, it reserved a column
                  the width of the label and left it empty for the full height
                  of the group -- three thin labels in a wide void. Sticking it
                  to the viewport means the label is beside whichever question
                  you are actually reading, which is the job it was doing
                  badly. */}
              <h3 className="mb-4 shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground md:sticky md:top-24 md:mb-0 md:w-[200px] md:self-start">
                {group.label}
              </h3>
              <div className="min-w-0 flex-1 divide-y divide-border border-t border-border">
                {group.items.map((item) => (
                  <FaqItem key={item.q} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <ContactCard />
      </Column>
    </Section>
  );
}

/**
 * One question.
 *
 * Every item ships **closed**. An earlier build opened the first of each group
 * so three answers were readable without a click; the owner asked for all of
 * them closed, which also makes the three groups scannable as a list of nine
 * questions rather than as three answers with six headings between them.
 *
 * The open/close is a **grid-rows transition**, not `hidden`. `height: auto`
 * cannot be transitioned, and a fixed max-height has to be guessed -- guess low
 * and long answers are clipped, guess high and short ones lag behind a
 * transition timed for a paragraph that is not there. `grid-template-rows`
 * going 0fr -> 1fr animates to the content's own height with no number in it.
 */
function FaqItem({ item }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div>
      <h4>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={id}
          className="flex w-full items-start justify-between gap-6 py-5 text-left"
        >
          <span className="text-[17px] font-medium text-foreground">{item.q}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>
      </h4>
      <div
        id={id}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        {/* The row has to be able to shrink to nothing, hence min-h-0, and the
            overflow has to be hidden or the answer shows through at 0fr. */}
        <div className="overflow-hidden">
          {/* Measure capped so a long answer does not run the full column. */}
          <p
            className={cn(
              // Measured, not guessed. 680px at 15px produced full lines of
              // 93 to 99 characters, well past the 65-75 a reading measure
              // wants. `ch` is used so the cap tracks the face and size, but
              // note it is NOT one character: `ch` is the width of "0", which
              // in Geist at 15px is ~9.9px against an average character of
              // ~7.0px. 68ch measured 676px and 96 characters -- all but
              // identical to the 680px it replaced. 51ch is the value that
              // actually lands at ~72.
              "max-w-[51ch] pb-6 text-[15px] leading-relaxed text-muted-foreground transition-opacity duration-300 motion-reduce:transition-none",
              open ? "opacity-100" : "opacity-0",
            )}
            // Kept out of the accessibility tree and out of tab order while
            // collapsed. grid-rows-[0fr] hides it visually, but without this a
            // screen reader still reads all nine answers straight through.
            aria-hidden={!open}
          >
            {item.a}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Contact options, ordered easiest-first per the checklist: email is one tap
 * and a person answers; the documentation is more effort but answers more.
 */
function ContactCard() {
  return (
    // One row, as the prototype draws it: the ask on the left, both ways out on
    // the right. Stacks only when there is genuinely no room for the row.
    <div className="mt-14 flex flex-col gap-6 rounded-xl border border-border bg-card px-8 py-6 md:flex-row md:items-center md:justify-between">
      <div>
        <h3 className="text-lg font-semibold text-foreground">{FAQ.contact.title}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{FAQ.contact.sub}</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        {FAQ.contact.options.map((option) => (
          <Button
            key={option.label}
            asChild
            variant={option.primary ? "default" : "outline"}
            className="rounded-full px-5"
          >
            <a href={option.href}>{option.label}</a>
          </Button>
        ))}
      </div>
    </div>
  );
}
