import { ChevronDown, ChevronRight } from "lucide-react";

import { isMonochrome } from "@/lib/clients.js";
import { cn } from "@/lib/utils";

import { HERO, CLIENTS } from "./content";
import { AssistantMock, PreferencesMock } from "./mini";
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
 *
 * A previous build did exactly that: the field was mounted on the section at
 * `inset-0`, and a comment next to it claimed the full-bleed wash was the
 * intended design while this docstring, six lines up, said the opposite. The
 * measured cost was the eyebrow at 3.72:1, the body at 3.33:1 and the
 * invite-only note -- the sentence carrying all the trust at the moment of the
 * ask -- at 3.21:1, all against a 4.5 floor, in light mode only. The audit
 * missed it because `design/contrast-audit.md` checks `muted-fg` against
 * paper, and the shipped page was not using paper. The field lives on
 * `ProductShot` now, which is the only place it can be checked once.
 */
export function Hero({ onSignIn, onJoined }) {
  return (
    <section id="top" className="relative overflow-hidden bg-background pt-20 md:pt-28">
      <Column className="relative z-10">
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

          <WaitlistForm
            label={HERO.cta}
            className="mt-8"
            align="center"
            onJoined={onJoined}
          />

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
 * The pair: what you write, and what an assistant does with it.
 *
 * The page's thesis is that the persona **travels**, and for three builds the
 * hero showed the web editor on its own -- the commodity, the one door every
 * visitor already has ten of. The differentiator was only ever stated in
 * prose. Here it is shown: a tone rule typed on the left, and the same rule
 * coming back out of a client on the right that nobody typed it into.
 *
 * **The two frames are deliberately asymmetric.** The editor gets browser
 * chrome because it genuinely is a web app at that URL. The assistant gets
 * none -- no window furniture, no client name, no mark -- because no chat
 * client ships with this project and drawing one's chrome would be both a
 * fiction and somebody else's trademark. That rule is not invented here;
 * `docs-site/public/screenshots/README.md` already set it for the `chat-*`
 * figures, and the asymmetry is what keeps the claim honest.
 *
 * Live markup rather than screenshots, so both follow the theme and can be
 * checked against the files they claim to depict. The gradient pool is
 * anchored to this block rather than to the section, so it never reaches the
 * copy above.
 */
function ProductShot() {
  return (
    // Inset inside the content column rather than filling it, so the gradient
    // pool is visible around the frame instead of only behind it.
    //
    // `aria-hidden`, matching `TileMedia` in Bento.jsx. Without it the mock's
    // own `h3` lands between the hero `h1` and the first section `h2`, and
    // roughly nineteen invented strings ("Maya Ellis", "Goals", "Preferences")
    // read out as if they were the visitor's own persona.
    <div aria-hidden="true" className="relative mx-auto mt-16 max-w-[1040px]">
      {/* The pool. Bled past the frame so it reads as light around the mockup
          rather than as a rectangle behind it, and clipped by the section's
          `overflow-hidden` at narrow widths.

          The top bleed is deliberately the small one. This block is `mt-16`
          below the copy, so a symmetric `-inset-y-16` would put the artwork's
          top edge exactly on the sign-in line's baseline -- measured at 556px
          against a copy block ending at 556px, which is not clearance, it is a
          coincidence one spacing change away from reintroducing the defect
          this file just fixed. 48px of real gap instead. */}
      <div className="pointer-events-none absolute -inset-x-24 -bottom-12 -top-4 -z-10 bg-[url('/landing/hero-field-light.webp')] bg-cover bg-center bg-no-repeat [-webkit-mask-image:radial-gradient(ellipse_at_center,#000_55%,transparent_88%)] [mask-image:radial-gradient(ellipse_at_center,#000_55%,transparent_88%)] dark:bg-[url('/landing/hero-field-dark.webp')] md:-inset-x-48 md:-bottom-16" />
      <BlurFade inView offset={12} className="relative z-10">
        {/* Stacked on a phone, side by side from `md`. Editor first in both,
            which is the causal order -- you write it, then it shows up. The
            connector points the same way at both breakpoints, so reversing
            the stack to lead with the assistant would leave the arrow
            pointing at the thing that caused it. */}
        <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center md:gap-0">
          <div className="min-w-0 flex-1 drop-shadow-2xl">
            <Safari url="mygist.thuradev.qzz.io">
              <div className="h-full overflow-hidden bg-background">
                <PreferencesMock />
              </div>
            </Safari>
          </div>

          <Connector />

          {/* Matched to the Safari frame's screen aspect so the pair reads as
              two panes of one image rather than two unrelated cards. */}
          <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-card shadow-xl md:aspect-[1200/700]">
            <AssistantMock />
          </div>
        </div>
      </BlurFade>
    </div>
  );
}

/**
 * The link between the two frames.
 *
 * This is an explicit exception to the rule three functions down, which says
 * the client chips carry no drawn line because "a line implies a direction of
 * travel the protocol does not have". Between the chips that is true: MCP does
 * not flow from Claude to Cursor. Between these two frames it is false --
 * there is a real direction, you write and a client reads -- so the line is
 * carrying information rather than decorating.
 *
 * Rotates a quarter turn when the pair stacks, so it always points from the
 * editor to the assistant.
 */
function Connector() {
  return (
    // A bare chevron floating in the gap read as a stray mark rather than as
    // a joint, so the arrow sits in a card-coloured node the two rules run
    // into. The rules are short on purpose: they connect, they do not travel.
    <div className="flex shrink-0 flex-col items-center justify-center md:flex-row md:px-2">
      <span className="h-3 w-px bg-border md:h-px md:w-4" />
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card shadow-sm">
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground md:hidden" />
        <ChevronRight className="hidden h-3.5 w-3.5 text-muted-foreground md:block" />
      </span>
      <span className="h-3 w-px bg-border md:h-px md:w-4" />
    </div>
  );
}

/**
 * Clients, as chips. Unconnected by any drawn line, deliberately: a line
 * implies a direction of travel the protocol does not have.
 *
 * Not every chip has a mark. Whether one does comes from `hasMark` in
 * `lib/clients.js`: Simple Icons does not carry OpenAI (pulled over a
 * trademark request) or Hermes, the source the owner asked for sits behind
 * bot protection, and Cursor has no logo file yet either. Those render as
 * their name alone rather than as an invented glyph.
 */
function ClientChips() {
  return (
    <div className="pb-24 md:pb-32">
      <ul className="mt-12 flex flex-wrap items-center justify-center gap-3">
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
                className={cn(
                  "h-4 w-4 opacity-80",
                  // Only the marks that are a single dark fill. See
                  // MONOCHROME_SLUGS for what inverting the rest did.
                  isMonochrome(client.slug) && "dark:invert",
                )}
              />
            ) : (
              // A monogram, not a guessed glyph. It reads as a placeholder
              // rather than as somebody's mark drawn from memory.
              <span
                aria-hidden="true"
                className="flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] font-medium text-muted-foreground"
              >
                {client.name[0]}
              </span>
            )}
            {client.name}
          </li>
        ))}
      </ul>
      <div className="mt-6 text-center">
        <p className="text-sm text-muted-foreground">{HERO.clientsCaption}</p>
        {/* The definition, at the first place the page says the word. */}
        <p className="mt-1 text-sm text-muted-foreground/80">{HERO.clientsNote}</p>
      </div>
    </div>
  );
}
