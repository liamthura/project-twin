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
export function Closing({ joined = false, onJoined }) {
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
          {/* Already joined in the hero: acknowledge it rather than ask a
              second time. The two forms held independent state before, so
              someone who had just given their address was met at the bottom
              of the page by an empty field asking for it again. */}
          {joined ? (
            // Not role="status". The hero's form already announced the join
            // in its own live region, and a second one saying the same thing
            // means a screen reader hears it twice. By the time anyone reaches
            // this it is static content, not an update.
            <p className="mt-4 text-lg text-on-inverse/70">
              {CLOSING.done}
            </p>
          ) : (
            <>
              <p className="mt-4 max-w-[52ch] text-lg text-on-inverse/70">{CLOSING.sub}</p>
              <WaitlistForm
                label={CLOSING.cta}
                tone="inverse"
                align="center"
                className="mt-8"
                onJoined={onJoined}
              />
              {/* Reassurance parity with the hero. This is the higher-stakes
                  of the two asks, not the lower one. */}
              <p className="mt-3 max-w-[46ch] text-sm text-on-inverse/70">
                {CLOSING.note}{" "}
                <a
                  href={CLOSING.noteLink.href}
                  className="text-on-inverse underline underline-offset-4"
                >
                  {CLOSING.noteLink.label}
                </a>
                .
              </p>
            </>
          )}
        </div>
      </Column>
    </section>
  );
}
