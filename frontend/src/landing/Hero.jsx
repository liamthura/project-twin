import { HERO, CLIENTS } from "./content";
import { EditorMock } from "./mini";
import { Column } from "./primitives";
import { WaitlistForm } from "./WaitlistForm";

/**
 * The hero.
 *
 * The gradient field sits behind the mockup and never under the headline --
 * "gradient artwork never sits under text" is a system rule, and it is what
 * keeps WCAG checking down to a handful of enumerable pairs instead of every
 * pixel. The field is decorative, so it is a background image on an
 * aria-hidden layer rather than an <img> with alt text.
 */
export function Hero({ onSignIn }) {
  return (
    <section id="top" className="relative overflow-hidden bg-background pt-16 md:pt-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[900px] bg-[url('/landing/hero-field-light.webp')] bg-cover bg-top bg-no-repeat dark:bg-[url('/landing/hero-field-dark.webp')]"
      />

      <Column className="relative">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground md:text-[13px]">
          {HERO.eyebrow}
        </p>

        <h1 className="mt-5 max-w-[15ch] font-display text-[44px] font-semibold leading-[1.02] tracking-tight md:text-[72px]">
          {HERO.headline}
        </h1>

        <p className="mt-6 max-w-[54ch] text-lg text-muted-foreground md:text-xl">
          {HERO.body}
        </p>

        <div className="mt-8">
          <WaitlistForm label={HERO.cta} />
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

        {/* Unconnected by any drawn line, deliberately: a line implies a
            direction of travel that the protocol does not have. */}
        <ul className="mt-10 flex flex-wrap items-center gap-3 pb-20 md:pb-28">
          {CLIENTS.map((client) => (
            <li
              key={client.slug}
              className="rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground shadow-sm"
            >
              {client.name}
            </li>
          ))}
        </ul>
      </Column>
    </section>
  );
}

/**
 * The editor, in browser chrome.
 *
 * Markup rather than a screenshot, so it follows the theme and can be checked
 * against the files it claims to depict. The chrome is decorative -- three dots
 * and a rule, no fake URL bar, because a fake URL is a claim about a domain
 * that does not exist yet.
 */
function ProductShot() {
  return (
    <figure className="mt-14 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-muted-foreground/25" />
        <span className="h-3 w-3 rounded-full bg-muted-foreground/25" />
        <span className="h-3 w-3 rounded-full bg-muted-foreground/25" />
      </div>
      <EditorMock />
    </figure>
  );
}
