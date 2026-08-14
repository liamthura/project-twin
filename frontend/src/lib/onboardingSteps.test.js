import { describe, it, expect } from "vitest";
import {
  ONBOARDING_STEPS,
  STORABLE_STEPS,
  DEFAULT_ONBOARDING_STEP,
  isOnboardingRoute,
  isStorableStep,
  normaliseStep,
  stepIndex,
  nextStep,
  prevStep,
} from "./onboardingSteps";

describe("isOnboardingRoute", () => {
  it.each([
    ["onboarding", true],
    ["profile", false],
    ["review", false],
    ["signin", false],
    ["", false],
    [undefined, false],
  ])("%s -> %s", (section, expected) => {
    expect(isOnboardingRoute(section)).toBe(expected);
  });
});

describe("normaliseStep", () => {
  it.each(ONBOARDING_STEPS)("keeps the known step %s", (step) => {
    expect(normaliseStep(step)).toBe(step);
  });

  it.each([["nonsense"], [null], [undefined], [""], ["Welcome"]])(
    "corrects %s to welcome",
    (step) => {
      expect(normaliseStep(step)).toBe(DEFAULT_ONBOARDING_STEP);
    },
  );
});

describe("walking the steps", () => {
  it("puts connect between the welcome and the typing", () => {
    expect(ONBOARDING_STEPS).toEqual([
      "welcome",
      "connect",
      "about-you",
      "how-you-like",
      "complete",
    ]);
  });

  it("reports an unknown step as the first one, matching normaliseStep", () => {
    expect(stepIndex("nonsense")).toBe(0);
  });

  it("has no next after the last step and no previous before the first", () => {
    expect(nextStep("complete")).toBe(null);
    expect(prevStep("welcome")).toBe(null);
  });

  it("walks forwards and backwards through the middle", () => {
    expect(nextStep("welcome")).toBe("connect");
    expect(nextStep("connect")).toBe("about-you");
    expect(nextStep("about-you")).toBe("how-you-like");
    expect(prevStep("complete")).toBe("how-you-like");
    expect(prevStep("about-you")).toBe("connect");
  });
});

describe("which steps the server will store", () => {
  it("stores only the two that collect fields", () => {
    // Mirrors settings_store.ONBOARDING_STEP_KEYS, which 400s on anything else.
    expect(STORABLE_STEPS).toEqual(["about-you", "how-you-like"]);
  });

  it.each([
    ["about-you", true],
    ["how-you-like", true],
    // A page, not a question.
    ["welcome", false],
    ["complete", false],
    // Derived from whether a token or grant exists. Storing a claim about it
    // would let the claim disagree with the connections themselves.
    ["connect", false],
  ])("%s -> %s", (step, expected) => {
    expect(isStorableStep(step)).toBe(expected);
  });

  it("names no step the server would reject", () => {
    for (const step of STORABLE_STEPS) {
      expect(ONBOARDING_STEPS).toContain(step);
    }
  });
});
