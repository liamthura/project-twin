import { useState } from "react";
import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SectionRenderer from "@/renderers/SectionRenderer";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/**
 * Renders a section with real state, so typing behaves as it does in the app.
 *
 * SectionRenderer is controlled: it reads values from `data` and reports
 * changes upward. Rendering it with a static prop makes every keystroke appear
 * to do nothing, so tests need a stateful owner exactly as App.jsx provides.
 */
export function renderSection({ pack, initial, onShowConfirmation }) {
  // The component gets its own copy, and the caller gets a pristine one. Sharing
  // a reference here would let a renderer that mutates `data` in place corrupt
  // the very object the assertion compares against -- and pass.
  const start = deepFreeze(structuredClone(initial));
  let seen = start;

  function Harness() {
    const [data, setData] = useState(start);
    return (
      <SectionRenderer
        pack={pack}
        data={data}
        onChange={(next) => {
          seen = next;
          setData(next);
        }}
        onShowConfirmation={onShowConfirmation}
      />
    );
  }

  const result = render(<Harness />);
  return { ...result, user: userEvent.setup(), latest: () => seen, initial: structuredClone(initial) };
}

/**
 * A controllable IntersectionObserver, for tests that care WHICH element is on
 * screen.
 *
 * The global stub in test/setup.js answers "everything, intersecting,
 * immediately". That is right for its consumer -- the landing page's scroll
 * entrances, where content behind one must be present and assertable -- and
 * useless for scroll-spy, where every band would report visible at once and a
 * test could not prove the marker landed on the right one. It would pass while
 * proving nothing, which is the failure mode setup.js's own comments warn about.
 *
 * So: install this per file in beforeEach, restore in afterEach. Do NOT change
 * the global stub; six landing test files depend on its behaviour.
 */
export function mockIntersectionObserver() {
  const previous = globalThis.IntersectionObserver;
  const observers = [];
  globalThis.IntersectionObserver = class {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.targets = new Set();
      this.disconnected = false;
      observers.push(this);
    }
    observe(target) {
      this.targets.add(target);
    }
    unobserve(target) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
      this.disconnected = true;
    }
    takeRecords() {
      return [];
    }
  };

  return {
    /** Every observer constructed since install, newest last. */
    observers,
    /** The most recent one -- what a single-hook test wants. */
    latest: () => observers[observers.length - 1],
    /**
     * Report exactly these bands as intersecting, in the order given: the first
     * argument is treated as the topmost on screen.
     *
     * The ordering has to be supplied rather than measured. jsdom does no
     * layout, so every boundingClientRect.top is 0, and a hook whose rule is
     * "topmost wins" would be picking between identical values -- the test would
     * assert whatever the iteration order happened to produce.
     */
    intersect(...ids) {
      // Wrapped in act() here rather than at every call site. A real observer
      // fires from the browser's own scheduler, so React has no idea an update
      // is coming and will not flush it -- the assertion reads the state before
      // the callback's setState landed and fails on a hook that is correct.
      act(() => {
        for (const observer of observers) {
          if (observer.disconnected) continue;
          const entries = [...observer.targets].map((target) => {
            const id = target.dataset.band;
            const rank = ids.indexOf(id);
            return {
              target,
              isIntersecting: rank !== -1,
              boundingClientRect: { top: rank === -1 ? Infinity : rank },
            };
          });
          if (entries.length) observer.callback(entries, observer);
        }
      });
    },
    restore() {
      globalThis.IntersectionObserver = previous;
    },
  };
}

/**
 * Stub `matchMedia` so a breakpoint branch is reachable.
 *
 * jsdom implements none of it, and `useMediaQuery(query, fallback = true)`
 * deliberately answers DESKTOP when it is missing -- so every existing test
 * keeps asserting the control it always did, and a mobile-only branch is
 * invisible without this. Three files already hand-roll their own, three
 * different ways; this is the shared one.
 *
 * `matches` may be a boolean for every query, or a predicate on the query
 * string when a test needs to answer two queries differently (a viewport
 * breakpoint and prefers-reduced-motion, say).
 */
export function mockMatchMedia(matches) {
  const previous = window.matchMedia;
  const answer = typeof matches === "function" ? matches : () => matches;
  window.matchMedia = (query) => ({
    matches: answer(query),
    media: query,
    onchange: null,
    // Both spellings: useMediaQuery prefers addEventListener and falls back to
    // addListener for Safari 13 and some embedded WebViews, so a stub missing
    // either sends it down the wrong branch.
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
  return {
    restore() {
      window.matchMedia = previous;
    },
  };
}
