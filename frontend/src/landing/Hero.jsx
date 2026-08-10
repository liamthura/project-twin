import { HERO, CLIENTS } from "./content";
import { EditorMock } from "./mini";
import { Column } from "./primitives";
import { WaitlistForm } from "./WaitlistForm";
import { Safari } from "@/components/ui/safari";
import { BlurFade } from "@/components/ui/blur-fade";

/**
 * The hero.
 *
 * **Centred**, which is the whole shape of it: eyebrow, headline, body, the
 * waitlist field and both notes all sit on the page's centre line, with the
 * mockup below them and the client chips centred under that. An earlier build
 * set this left-aligned and it read as a different page.
 *
 * The gradient field is a **pool behind the mockup**, not a wash over the
 * section. "Gradient artwork never sits under text" is a system rule, and it is
 * what keeps WCAG checking down to a handful of enumerable pairs -- a full-bleed
 * field puts the headline, the body copy and the input placeholder on top of a
 * moving background and none of those pairs can be checked once.
 */
export function Hero({ onSignIn }) {
  return (
    <section id="top" className="relative overflow-hidden bg-background pt-20 md:pt-28">
      <Column className="relative">
        <div className="mx-auto flex max-w-[820px] flex-col items-center text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground md:text-[13px]">
            {HERO.eyebrow}
          </p>

          <h1 className="mt-5 font-display text-[44px] font-semibold leading-[1.02] tracking-tight md:text-[72px]">
            {HERO.headline}
          </h1>

          <p className="mt-6 max-w-[56ch] text-lg text-muted-foreground md:text-xl">
            {HERO.body}
          </p>

          <WaitlistForm label={HERO.cta} className="mt-8" align="center" />

          <p className="mt-3 text-sm text-muted-foreground">{HERO.note}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {HERO.signIn.prefix}{" "}
            <button
              type="button"
              onClick={onSignIn}
              className="rounded text-link underline-offset-4 hover:underline"
            >
              {HERO.signIn.label}
            </button>
          </p>
        </div>

        <ProductShot />
        <ClientChips />
      </Column>
    </section>
  );
}

/**
 * The editor, in browser chrome.
 *
 * Live markup rather than a screenshot, so it follows the theme and can be
 * checked against the files it claims to depict. The gradient pool is anchored
 * to this block rather than to the section, so it never reaches the copy above.
 */
function ProductShot() {
  return (
    // Inset inside the content column rather than filling it, so the gradient
    // pool is visible around the frame instead of only behind it.
    <div className="relative mx-auto mt-16 max-w-[1040px]">
      {/* z-0, not -z-10: a negative index would put this behind the section's
          own `bg-background` and it would never be seen at all.

          Masked to a soft ellipse. Unmasked, the image is a rectangle, and its
          top edge cut a visible hard line straight across the waitlist field --
          which also put the field's placeholder on top of gradient artwork, the
          one thing the system rule forbids. It now starts below the copy and
          dissolves at every edge. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-32 -top-8 bottom-[-12%] z-0 bg-[url('/landing/hero-field-light.webp')] bg-cover bg-center bg-no-repeat dark:bg-[url('/landing/hero-field-dark.webp')]"
        style={{
          WebkitMaskImage:
            "radial-gradient(115% 85% at 50% 45%, #000 30%, transparent 76%)",
          maskImage:
            "radial-gradient(115% 85% at 50% 45%, #000 30%, transparent 76%)",
        }}
      />
      <BlurFade inView offset={12} className="relative z-10">
        <Safari url="mygist.thuradev.qzz.io" className="drop-shadow-2xl">
          <div className="h-full overflow-hidden bg-background">
            <EditorMock />
          </div>
        </Safari>
      </BlurFade>
    </div>
  );
}

/**
 * Clients, as chips. Unconnected by any drawn line, deliberately: a line
 * implies a direction of travel the protocol does not have.
 *
 * Two of the five have no mark here. Simple Icons does not carry OpenAI (pulled
 * over a trademark request) or Hermes, and the source the owner asked for sits
 * behind bot protection. Those two render as their name alone rather than as an
 * invented glyph.
 */
function ClientChips() {
  return (
    <ul className="mt-12 flex flex-wrap items-center justify-center gap-3 pb-24 md:pb-32">
      {CLIENTS.map((client) => (
        <li
          key={client.slug}
          className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground shadow-sm"
        >
          {client.mark ? (
            <img
              src={`/landing/logos/${client.slug}.svg`}
              alt=""
              aria-hidden="true"
              className="h-4 w-4 opacity-80 dark:invert"
            />
          ) : null}
          {client.name}
        </li>
      ))}
    </ul>
  );
}
