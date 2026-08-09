import { STEPS } from "./content";
import { Column, Section, SectionHeader } from "./primitives";

/**
 * Three steps, on the clay tint.
 *
 * The numerals are the display face at its 40px floor -- that floor is a role
 * boundary rather than a legibility limit, so a numeral set exactly at it is
 * the intended use, not a violation.
 */
export function HowItWorks() {
  return (
    <Section id="how-it-works" ground="clay">
      <Column>
        <SectionHeader
          eyebrow={STEPS.eyebrow}
          headline={STEPS.headline}
          sub={STEPS.sub}
        />

        <ol className="mt-14 grid gap-6 md:grid-cols-3">
          {STEPS.items.map((step, index) => (
            <li
              key={step.title}
              className="rounded-xl border border-border bg-card p-8"
            >
              <p
                aria-hidden="true"
                className="font-display text-[40px] font-semibold leading-none text-primary"
              >
                {index + 1}
              </p>
              <h3 className="mt-6 text-lg font-semibold text-foreground">
                {step.title}
              </h3>
              <p className="mt-2 text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </Column>
    </Section>
  );
}
