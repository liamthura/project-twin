import { describe, it, expect } from "vitest";
import {
  ONBOARDING_STEPS,
  DEFAULT_ONBOARDING_STEP,
  isOnboardingRoute,
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
  it("orders them welcome, about you, how you like, complete", () => {
    expect(ONBOARDING_STEPS).toEqual([
      "welcome",
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
    expect(nextStep("welcome")).toBe("about-you");
    expect(nextStep("about-you")).toBe("how-you-like");
    expect(prevStep("complete")).toBe("how-you-like");
  });
});
