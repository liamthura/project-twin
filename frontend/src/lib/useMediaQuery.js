import { useEffect, useState } from "react";

// Subscribe to a CSS media query from JS.
//
// Needed only where a breakpoint has to change WHICH control renders, not just
// how it looks -- a Tailwind `sm:` class can restyle a control but cannot swap a
// segmented button group for a dropdown, and rendering both with one hidden
// would put two controls for one field in the accessibility tree.
//
// `fallback` is what a caller gets when `matchMedia` is unavailable. jsdom does
// not implement it, so every existing unit test would otherwise take whichever
// branch `false` happens to select; defaulting to the DESKTOP answer keeps those
// tests asserting the same control they have always asserted, and leaves the
// narrow-screen branch to environments that actually have a viewport.
export function useMediaQuery(query, fallback = true) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return fallback;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mq.matches);
    // addListener is the pre-2021 spelling; Safari 13 and some embedded
    // WebViews still ship only that one, and this is a mobile-facing hook.
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, [query]);

  return matches;
}

// The one breakpoint this app branches on in JS. Matches Tailwind's `sm`, so a
// component that swaps controls here stays in step with siblings that only
// restyle via `sm:` classes.
export const SM_UP = "(min-width: 640px)";
