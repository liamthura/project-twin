import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { useScrollSpy } from "./useScrollSpy";
import { mockIntersectionObserver } from "@/test/harness";

// The global stub in test/setup.js reports EVERY target as intersecting the
// moment it is observed, which would make every assertion here vacuous. A
// controllable one is installed per test and restored after, leaving the global
// behaviour intact for the landing-page files that need it.
let io;
beforeEach(() => {
  io = mockIntersectionObserver();
});
afterEach(() => {
  io.restore();
});

/** Three bands plus a live readout of what the hook currently reports. */
function Probe({ ids, options }) {
  const current = useScrollSpy(ids, options);
  return (
    <div>
      <p data-testid="current">{current ?? "none"}</p>
      {ids.map((id) => (
        <div key={id} data-band={id}>
          {id}
        </div>
      ))}
    </div>
  );
}

const IDS = ["code-style", "communication", "learning-style"];
const current = () => screen.getByTestId("current").textContent;

describe("useScrollSpy", () => {
  it("reports nothing before anything has intersected", () => {
    render(<Probe ids={IDS} />);
    expect(current()).toBe("none");
  });

  it("makes the only visible band current", () => {
    render(<Probe ids={IDS} />);
    io.intersect("communication");
    expect(current()).toBe("communication");
  });

  it("picks the topmost when several are visible at once", () => {
    render(<Probe ids={IDS} />);
    // A tall viewport showing two bands: the one higher up is what the reader is
    // reading, so it takes the marker.
    io.intersect("communication", "learning-style");
    expect(current()).toBe("communication");
  });

  it("hands the marker on as the reader scrolls past a band", () => {
    render(<Probe ids={IDS} />);
    io.intersect("code-style");
    expect(current()).toBe("code-style");
    io.intersect("communication");
    expect(current()).toBe("communication");
  });

  it("holds the previous band when nothing is visible, rather than blanking", () => {
    // The gap between two bands. Blanking here makes the marker flicker off and
    // back on during an ordinary scroll.
    render(<Probe ids={IDS} />);
    io.intersect("communication");
    expect(current()).toBe("communication");
    io.intersect();
    expect(current()).toBe("communication");
  });

  it("keeps a still-visible band current when a different one leaves", () => {
    // The observer reports only what CHANGED, so a band scrolling out arrives
    // alone -- the hook must remember that the other one is still on screen.
    render(<Probe ids={IDS} />);
    io.intersect("code-style", "communication");
    expect(current()).toBe("code-style");
    io.intersect("communication");
    expect(current()).toBe("communication");
  });

  it("clears the marker for a section with no bands", () => {
    const { rerender } = render(<Probe ids={IDS} />);
    io.intersect("communication");
    expect(current()).toBe("communication");
    rerender(<Probe ids={[]} />);
    expect(current()).toBe("none");
  });

  it("observes every band it was given", () => {
    render(<Probe ids={IDS} />);
    expect(io.latest().targets.size).toBe(3);
  });

  it("clears the header height by default, and ignores the lower viewport", () => {
    render(<Probe ids={IDS} />);
    expect(io.latest().options.rootMargin).toBe("-60px 0px -60% 0px");
  });

  it("takes an explicit rootMargin", () => {
    render(<Probe ids={IDS} options={{ rootMargin: "0px" }} />);
    expect(io.latest().options.rootMargin).toBe("0px");
  });

  it("disconnects on unmount rather than leaving an observer running", () => {
    const { unmount } = render(<Probe ids={IDS} />);
    const observer = io.latest();
    unmount();
    expect(observer.disconnected).toBe(true);
  });

  it("survives an entry with no boundingClientRect", () => {
    // The GLOBAL stub in test/setup.js reports { isIntersecting, intersectionRatio,
    // target } and no rect. Dereferencing it there threw from inside the
    // observer callback and took App's entire render down -- every App test
    // failed with "Cannot read properties of undefined (reading 'top')" and no
    // hint that scroll-spy was the cause.
    render(<Probe ids={IDS} />);
    const observer = io.latest();
    act(() => {
      observer.callback(
        [...observer.targets].map((target) => ({ target, isIntersecting: true })),
        observer
      );
    });
    expect(current()).not.toBe("none");
  });

  it("does not rebuild its observer when the ids are re-derived unchanged", () => {
    // `ids` is a fresh array every render (outline().map(...)), so depending on
    // the array identity would tear down and rebuild the observer on every
    // commit -- and lose the visible-band map with it.
    const { rerender } = render(<Probe ids={["a", "b"]} />);
    const before = io.observers.length;
    rerender(<Probe ids={["a", "b"]} />);
    expect(io.observers.length).toBe(before);
  });
});
