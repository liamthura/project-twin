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
    <section className="relative overflow-hidden bg-ground-inverse py-24 md:py-32">
      {/* The indigo gradient sits ON the ink rather than being the ground, and
          covers the whole section as the prototype draws it -- deep blue at the
          left falling away to warm dark at the right. Cutting the old "Your
          data" section removed the page's only dark break; moving the CTA to
          ink restored it, and this keeps the colour. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[url('/landing/hero-field-dark.webp')] bg-cover bg-center"
      />
      <Column className="relative">
        <div className="mx-auto flex max-w-[720px] flex-col items-center text-center">
          <h2 className="font-display text-[40px] font-semibold leading-[1.05] tracking-tight text-on-inverse md:text-[56px]">
            {CLOSING.headline}
          </h2>
          <p className="mt-4 max-w-[52ch] text-lg text-on-inverse/70">{CLOSING.sub}</p>
          <WaitlistForm label={CLOSING.cta} tone="inverse" align="center" className="mt-8" />
        </div>
      </Column>
    </section>
  );
}
