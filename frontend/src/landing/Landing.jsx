import { Nav } from "./Nav";
import { Hero } from "./Hero";
import { HowItWorks } from "./HowItWorks";
import { Bento } from "./Bento";
import { Faq } from "./Faq";
import { Closing } from "./Closing";
import { Footer } from "./Footer";

/**
 * The marketing page.
 *
 * Section order carries a deliberate tonal arc: paper+blue -> warm -> paper ->
 * cool -> dark -> dark. The page resolves into dark in both colour modes,
 * because ground-inverse does not invert.
 *
 * Motion: entrance transitions and hover only. No loops, drifts, pulses,
 * shimmers, travel, beams, aurora, meteors or particles -- the ban list is in
 * the design spec, and it is a positioning decision rather than a taste one. A
 * page selling durable, boring infrastructure should not fidget.
 */
export default function Landing({ onSignIn }) {
  return (
    <div className="min-h-dvh bg-background">
      {/* The signature element: a 12px gradient band, full-bleed to the
          viewport edges. Decorative, and no text ever sits on it. */}
      <div
        aria-hidden="true"
        className="h-3 w-full bg-[url('/landing/edge-strip-light.webp')] bg-cover bg-center dark:bg-[url('/landing/edge-strip-dark.webp')]"
      />

      <Nav onSignIn={onSignIn} onJoin={scrollToWaitlist} />

      <main>
        <Hero onSignIn={onSignIn} />
        <HowItWorks />
        <Bento />
        <Faq />
        <Closing />
      </main>

      <Footer />
    </div>
  );
}

/** The nav CTA and the hero field are the same action, so it scrolls rather
 *  than duplicating a third copy of the form. */
function scrollToWaitlist() {
  const target = document.querySelector("#top");
  if (!target) return;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // Guarded: focusing the field is the part that matters, and it should still
  // happen anywhere scrollIntoView is missing rather than throwing first.
  target.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "start" });
  target.querySelector("input[type=email]")?.focus({ preventScroll: true });
}
