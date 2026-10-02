import { describe, it, expect } from "vitest";
import {
  DEFAULT_ONBOARDING_STEP,
  NEEDS_CLIENT,
  ONBOARDING_STEPS,
  isOnboardingRoute,
  normaliseStep,
  phaseOf,
} from "./onboardingSteps.js";

describe("onboarding steps", () => {
  it("has five steps on three phases", () => {
    expect(ONBOARDING_STEPS).toEqual(["assistant", "connect", "handover", "about-you", "complete"]);
    expect(ONBOARDING_STEPS.map(phaseOf)).toEqual([0, 0, 1, 1, 2]);
  });

  it("starts on the choice of assistant", () => {
    expect(DEFAULT_ONBOARDING_STEP).toBe("assistant");
  });

  it("sends old and unknown steps somewhere real", () => {
    expect(normaliseStep("welcome")).toBe("assistant");
    expect(normaliseStep("how-you-like")).toBe("about-you");
    expect(normaliseStep("nonsense")).toBe("assistant");
    expect(normaliseStep(undefined)).toBe("assistant");
    expect(normaliseStep("connect")).toBe("connect");
  });

  it("knows which steps need a chosen assistant", () => {
    expect([...NEEDS_CLIENT]).toEqual(["connect", "handover"]);
  });

  it("names its own route family", () => {
    expect(isOnboardingRoute("onboarding")).toBe(true);
    expect(isOnboardingRoute("profile")).toBe(false);
  });
});
