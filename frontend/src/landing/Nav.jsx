import { Button } from "@/components/ui/button";
import { Lockup } from "./Brand";
import { Column } from "./primitives";

/**
 * The nav bar.
 *
 * Anchored and full width with a hairline bottom rule -- not a floating pill,
 * and no frosted glass. The centre links are gone: three items on the right
 * (Docs, Sign in, and the waitlist CTA) is the whole bar, at both breakpoints.
 * Mobile carries the same three at smaller type rather than collapsing into a
 * hamburger, because three items do not need a menu.
 */
export function Nav({ onSignIn, onJoin }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <Column className="flex h-16 items-center justify-between md:h-[72px]">
        <a href="#top" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          <Lockup />
          <span className="sr-only">MyGist home</span>
        </a>

        <nav className="flex items-center gap-4 md:gap-6">
          <a
            href="/docs"
            className="rounded-md text-[13px] text-foreground hover:text-link md:text-sm"
          >
            Docs
          </a>
          <button
            type="button"
            onClick={onSignIn}
            className="rounded-md text-[13px] text-foreground hover:text-link md:text-sm"
          >
            Sign in
          </button>
          {/* Two labels, one name. Without the aria-label a screen reader
              reads both spans -- "Join the waitlistJoin" -- because CSS
              visibility is not what the accessibility tree is built from. */}
          <Button size="sm" onClick={onJoin} aria-label="Join the waitlist">
            <span className="hidden sm:inline">Join the waitlist</span>
            <span className="sm:hidden">Join</span>
          </Button>
        </nav>
      </Column>
    </header>
  );
}
