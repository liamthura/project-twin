// @vitest-environment node
//
// parseRoute is pure string work, and routes.js imports nothing -- so this file
// needs no DOM and should not pay ~700ms to build one. The other exports here
// (readRoute, goToRoute) do touch `window` and are covered from App.test.jsx,
// which has a jsdom environment and a matchMedia stub already.
import { describe, it, expect } from "vitest";

import { parseRoute } from "./routes.js";

describe("parseRoute", () => {
  it("reads a bare section", () => {
    expect(parseRoute("preferences")).toEqual({ section: "preferences", band: null });
  });

  it("reads a section and a band", () => {
    expect(parseRoute("preferences/communication")).toEqual({
      section: "preferences",
      band: "communication",
    });
  });

  it("returns an empty section for an empty route", () => {
    // What readRoute() gives before anything has navigated. The caller decides
    // what to do with it; parseRoute does not invent a default.
    expect(parseRoute("")).toEqual({ section: "", band: null });
  });

  it("treats a trailing slash as no band rather than an empty one", () => {
    // `"review/".split("/")` yields ["review", ""], and an empty-string band
    // would fail band validation and trigger a pointless replaceState.
    expect(parseRoute("review/")).toEqual({ section: "review", band: null });
  });

  it("keeps only the first two segments, so a third cannot smuggle in a band", () => {
    expect(parseRoute("a/b/c")).toEqual({ section: "a", band: "b" });
  });

  it("never throws on a missing argument", () => {
    expect(parseRoute()).toEqual({ section: "", band: null });
    expect(parseRoute(null)).toEqual({ section: "", band: null });
  });
});
