/**
 * Guided tours and one-off hints, on driver.js.
 *
 * Each is shown once per account, not per device: what has been seen is kept
 * on the server in onboarding.seen (settings_store.py). Elements are found by
 * `data-guide` attributes, never by class names or text, and a step whose
 * element is not laid out is dropped rather than pointed at nothing.
 *
 * driver.js ignores prefers-reduced-motion, so this does it: no animation, no
 * smooth scrolling, and no confetti.
 *
 * The copy for every tour and hint used in more than one place is here, so the
 * house-style checks have one file to read. It is the spec's Guides table.
 */
import { driver } from "driver.js";
import { hints } from "driver.js/hints";
import "driver.js/dist/driver.css";
import "driver.js/dist/hints.css";
import confetti from "canvas-confetti";

import { getOnboarding, markSeen } from "./onboarding.js";

const matches = (q) => !!globalThis.matchMedia?.(q)?.matches;
const reduced = () => matches("(prefers-reduced-motion: reduce)");
const narrow = () => matches("(max-width: 639px)");
const SEARCH_KEY = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || "") ? "⌘K" : "Ctrl K";

export const TOURS = {
  firstSuggestion: [
    {
      element: '[data-guide="approve"]',
      popover: {
        title: "Approve to save it",
        description: "Approving adds this to your persona. Until you do, nothing has changed.",
      },
    },
    {
      element: '[data-guide="reject"]',
      popover: {
        title: "Not quite right?",
        description: "Open its details to edit it before approving, or reject it. A rejected suggestion is never raised again.",
      },
    },
  ],
  editor: [
    {
      element: '[data-guide="sections"]',
      popover: {
        title: "Your persona, by section",
        description: "Profile, goals, projects and the rest. Turn sections on or off in Manage sections.",
      },
    },
    {
      element: "#main-content input, #main-content textarea",
      popover: {
        title: "Type to change anything",
        description: "Changes save as you type, and the header says Saved when they're in.",
      },
    },
    {
      element: '[data-guide="history"]',
      popover: {
        title: "Undo with History",
        description: "Every change to a section is kept, and a restore can itself be undone.",
      },
    },
    {
      element: '[data-guide="search"]',
      popover: { title: "Find anything", description: `Search your whole persona with ${SEARCH_KEY}.` },
    },
  ],
};

export const HINTS = {
  promote: {
    element: '[data-guide="promote"]',
    title: "Give it a home",
    description: "An observation doesn't belong to a section yet. Promote it to file it as an entry you can edit.",
  },
};

let seen = null;
function loadSeen() {
  seen ??= getOnboarding()
    .then((s) => new Set(s.seen || []))
    .catch(() => new Set());
  return seen;
}

async function remember(key) {
  (await loadSeen()).add(key);
  // At worst a lost write shows the guide once more on another device.
  markSeen(key).catch(() => {});
}

/** Tests only: forget the cached set. */
export function resetSeen() {
  seen = null;
}

/** The first match that is laid out: the rail is in the DOM on a phone, only hidden. */
export function visible(selector) {
  return [...document.querySelectorAll(selector)].find((el) => el.getClientRects().length > 0) || null;
}

function place(step) {
  const element = visible(step.element);
  if (!element) return null;
  return {
    ...step,
    element,
    // Below its element on a phone, where there is no room beside it, unless
    // the step chose a side (the token's, so it does not cover the warning).
    popover: { ...(narrow() ? { side: "bottom", align: "center" } : {}), ...step.popover },
  };
}

const THEME = {
  popoverClass: "mygist-guide",
  overlayOpacity: 0.35,
  stagePadding: 6,
  stageRadius: 10,
  nextBtnText: "Next",
  prevBtnText: "Back",
  doneBtnText: "Done",
  onPopoverRender: (popover) => popover.closeButton?.setAttribute("aria-label", "Close guide"),
};

/** A tour of `steps`, once per `key` unless `force`. Resolves true if it started. */
export async function startTour(key, steps, { force = false } = {}) {
  if (!force && (await loadSeen()).has(key)) return false;
  const live = steps.map(place).filter(Boolean);
  if (!live.length) return false;
  driver({
    ...THEME,
    animate: !reduced(),
    smoothScroll: !reduced(),
    showProgress: live.length > 1,
    progressText: "{{current}} of {{total}}",
    steps: live,
    onDestroyed: () => remember(key),
  }).drive();
  return true;
}

/**
 * A pulsing dot on one element that opens a short note when tapped, once per
 * `key`. Its "Got it" dismisses it (driver.js's default), and that is what is
 * remembered; closing the note any other way leaves the dot to tap again.
 */
export async function showHint(key, { element, title, description }) {
  if ((await loadSeen()).has(key)) return false;
  const target = visible(element);
  if (!target) return false;
  hints({
    popoverClass: "mygist-guide",
    beacon: { animate: !reduced() },
    hints: [{ id: key, element: target, popover: { title, description, showButton: true, buttonText: "Got it" } }],
    onDismiss: () => remember(key),
  }).show();
  return true;
}

/** Confetti for the first approval ever, and only that one. */
export async function celebrateFirst() {
  const key = "moment:first-approval";
  if ((await loadSeen()).has(key)) return;
  remember(key);
  if (!reduced()) confetti({ particleCount: 90, spread: 70, origin: { y: 0.75 } });
}
