// The calendar's month arrows, measured in a real browser.
//
// jsdom has no layout: every rect is 0x0 there, so a click target that is too
// small, overlapping its neighbour, or sitting outside its own container is
// invisible to the unit suite. These assertions are geometry, so they only mean
// anything under the Storybook browser project.
import { expect, userEvent } from "storybook/test";

import { Calendar } from "@/components/ui/calendar";

// A fixed month, so nothing here depends on the day the suite runs.
const MONTH = new Date(2026, 11, 1);

function OneMonth() {
  return <Calendar mode="single" defaultMonth={MONTH} />;
}

export default {
  title: "UI/Calendar",
  component: OneMonth,
};

const MIN_TARGET = 36;

export const MonthArrowsAreClickable = {
  render: () => <OneMonth />,
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    const prev = canvasElement.querySelector('button[aria-label*="Previous"]');
    const next = canvasElement.querySelector('button[aria-label*="Next"]');
    expect(prev).toBeTruthy();
    expect(next).toBeTruthy();

    const prevBox = prev.getBoundingClientRect();
    const nextBox = next.getBoundingClientRect();

    // Big enough to hit. shadcn's default is 28px; a day button in the same grid
    // is 36, and an arrow smaller than the cells it navigates reads as an
    // afterthought as well as being hard to press.
    for (const [name, box] of [
      ["previous", prevBox],
      ["next", nextBox],
    ]) {
      expect(box.width, `${name} arrow is ${box.width}px wide`).toBeGreaterThanOrEqual(
        MIN_TARGET,
      );
      expect(box.height, `${name} arrow is ${box.height}px tall`).toBeGreaterThanOrEqual(
        MIN_TARGET,
      );
    }

    // Not overlapping each other. These are directional controls, so a shared
    // strip of hit area means pressing back and going forward.
    const overlaps =
      prevBox.right > nextBox.left &&
      nextBox.right > prevBox.left &&
      prevBox.bottom > nextBox.top &&
      nextBox.bottom > prevBox.top;
    expect(overlaps, "the two month arrows overlap").toBe(false);

    // Inside the calendar, not hanging off it. The nav is absolutely positioned,
    // and it used to resolve against whatever was positioned above it rather
    // than against the calendar itself.
    const root = canvasElement.querySelector(".rdp-root").getBoundingClientRect();
    for (const [name, box] of [
      ["previous", prevBox],
      ["next", nextBox],
    ]) {
      expect(box.left, `${name} arrow starts left of the calendar`).toBeGreaterThanOrEqual(
        root.left,
      );
      expect(box.right, `${name} arrow ends right of the calendar`).toBeLessThanOrEqual(
        root.right,
      );
      expect(box.top, `${name} arrow starts above the calendar`).toBeGreaterThanOrEqual(
        root.top,
      );
    }

    // Nothing covers them. elementFromPoint is the browser's own hit test, which
    // is the only thing that answers "can this actually be clicked".
    for (const [name, el, box] of [
      ["previous", prev, prevBox],
      ["next", next, nextBox],
    ]) {
      const hit = doc.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      expect(
        el === hit || el.contains(hit),
        `something covers the ${name} arrow`,
      ).toBe(true);
    }

    // And they work. A caption change is the proof that the press landed.
    expect(canvasElement.textContent).toContain("December 2026");
    await userEvent.click(prev);
    expect(canvasElement.textContent).toContain("November 2026");
    await userEvent.click(next);
    await userEvent.click(next);
    expect(canvasElement.textContent).toContain("January 2027");
  },
};
