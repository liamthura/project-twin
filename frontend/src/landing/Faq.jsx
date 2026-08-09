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
              <h3 className="mb-4 shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground md:mb-0 md:w-[280px]">
                {group.label}
              </h3>
              <div className="min-w-0 flex-1 divide-y divide-border border-t border-border">
                {group.items.map((item, index) => (
                  // The first question in each group ships open, so three
                  // answers are readable without a click and the disclosure
                  // pattern is still obvious.
                  <FaqItem key={item.q} item={item} defaultOpen={index === 0} />
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

function FaqItem({ item, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
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
              "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>
      </h4>
      <div id={id} hidden={!open}>
        {/* Measure capped so a long answer does not run the full column width. */}
        <p className="max-w-[680px] pb-6 text-[15px] leading-relaxed text-muted-foreground">
          {item.a}
        </p>
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
    <div className="mt-14 rounded-xl border border-border bg-card p-8">
      <h3 className="text-xl font-semibold text-foreground">{FAQ.contact.title}</h3>
      <p className="mt-1 text-muted-foreground">{FAQ.contact.sub}</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        {FAQ.contact.options.map((option) => (
          <Button
            key={option.label}
            asChild
            variant={option.primary ? "default" : "outline"}
          >
            <a href={option.href}>{option.label}</a>
          </Button>
        ))}
      </div>
    </div>
  );
}
