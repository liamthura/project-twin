import { useEffect, useState } from "react";

/**
 * Which band the reader is currently looking at.
 *
 * One observer for the whole page rather than one per band. Bands come and go as
 * sections switch, and N observers would be N things to unwind -- the kind of
 * bookkeeping that leaves a stale one running after a section change.
 *
 * `rootMargin` defaults to clearing the 60px sticky header at the top and
 * ignoring the bottom 60% of the viewport, so "current" means "near the top of
 * what you can actually read", not "anywhere on screen". Without the bottom
 * inset, a tall band entering from below would steal the marker while the reader
 * is still in the one above it. The value was tuned by eye and is recorded in
 * this slice's fidelity checklist rather than left implicit here.
 */
export function useScrollSpy(ids, { rootMargin = "-60px 0px -60% 0px" } = {}) {
  const [current, setCurrent] = useState(null);

  // A string, not the array: `ids` is a fresh array on every render (it comes
  // out of outline().map), so depending on it directly would tear down and
  // rebuild the observer on every single commit.
  const key = ids.join(",");

  useEffect(() => {
    if (!key) {
      // No bands in this section -- learning_log's shape. Clear any marker left
      // over from the section the reader came from.
      setCurrent(null);
      return undefined;
    }
    if (typeof IntersectionObserver === "undefined") return undefined;

    // Which bands are on screen, and how far down. Kept across callbacks because
    // the observer reports only what CHANGED: a band that scrolled out arrives
    // as one entry, and the bands still visible are not mentioned at all.
    const visible = new Map();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.dataset.band;
          if (entry.isIntersecting) visible.set(id, entry.boundingClientRect.top);
          else visible.delete(id);
        }
        // Nothing on screen: hold the previous answer rather than blanking the
        // marker. Scrolling through the gap between two bands would otherwise
        // make it flicker off and back on.
        if (visible.size === 0) return;
        const [topId] = [...visible.entries()].sort((a, b) => a[1] - b[1])[0];
        setCurrent(topId);
      },
      { rootMargin }
    );

    for (const id of key.split(",")) {
      // Queried rather than passed as refs: the bands are rendered by
      // SectionRenderer, several levels down and behind a Card, and threading a
      // ref out of there would couple the editor to the shell. The attribute IS
      // the contract -- see the umbrella spec.
      const el = document.querySelector(`[data-band="${id}"]`);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [key, rootMargin]);

  return current;
}
