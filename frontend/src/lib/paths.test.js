import { describe, it, expect } from "vitest";
import { isAppPath, legacyForward } from "./paths";

const at = (pathname, search = "", hash = "") => ({ pathname, search, hash });

describe("isAppPath", () => {
  it("matches /app and anything under it, and nothing that only starts alike", () => {
    expect(isAppPath("/app")).toBe(true);
    expect(isAppPath("/app/")).toBe(true);
    expect(isAppPath("/app/consent")).toBe(true);
    expect(isAppPath("/")).toBe(false);
    expect(isAppPath("/apple")).toBe(false);
  });
});

describe("legacyForward", () => {
  it("leaves a plain visit to the landing page alone", () => {
    expect(legacyForward(at("/"))).toBeNull();
    expect(legacyForward(at("/", "", "#top"))).toBeNull();
  });

  it("sends an old hash bookmark to the same route under /app", () => {
    expect(legacyForward(at("/", "", "#/profile/work"))).toBe("/app/#/profile/work");
  });

  it("keeps the query from emails and invite links sent before the move", () => {
    expect(legacyForward(at("/", "?reset=1&token=abc"))).toBe("/app/?reset=1&token=abc");
    expect(legacyForward(at("/", "?verified=1"))).toBe("/app/?verified=1");
    expect(legacyForward(at("/", "?onboarding=1"))).toBe("/app/?onboarding=1");
    expect(legacyForward(at("/", "?invite=7F2K", "#/signup"))).toBe("/app/?invite=7F2K#/signup");
  });

  it("adds the slash to a bare /app, keeping the route and query", () => {
    expect(legacyForward(at("/app", "?x=1", "#/review"))).toBe("/app/?x=1#/review");
  });

  it("never forwards from anywhere but the root", () => {
    expect(legacyForward(at("/app/", "?reset=1", "#/profile"))).toBeNull();
  });
});
