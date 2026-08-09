import { CLOSING } from "./content";
import { Column } from "./primitives";
import { WaitlistForm } from "./WaitlistForm";

/**
 * The closing CTA, on ground-inverse.
 *
 * It sits on ink rather than on an indigo gradient. Cutting the old "Your data"
 * section removed the page's only dark break, which left the whole scroll on
 * paper and tint with no tonal relief; moving the CTA to ink restores it. The
 * indigo gradient now sits on top of the ink rather than being the ground.
 */
export function Closing() {
  return (
    <section className="bg-ground-inverse py-24 md:py-32">
      <Column>
        <h2 className="max-w-[18ch] font-display text-[40px] font-semibold leading-[1.05] tracking-tight text-on-inverse md:text-[56px]">
          {CLOSING.headline}
        </h2>
        <p className="mt-4 max-w-[52ch] text-lg text-on-inverse/70">{CLOSING.sub}</p>
        <WaitlistForm label={CLOSING.cta} tone="inverse" className="mt-8" />
      </Column>
    </section>
  );
}
