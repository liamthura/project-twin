import { describe, it, expect } from "vitest";
import { installPrompt } from "./installPrompt.js";

const TEST_URL = "https://example.test/mcp";

describe("installPrompt", () => {
  it("carries the live address rather than a placeholder", () => {
    expect(installPrompt(TEST_URL)).toContain(TEST_URL);
  });

  it("names the transport, because a client that guesses stdio fails silently", () => {
    expect(installPrompt(TEST_URL)).toMatch(/http/i);
  });

  it("says there is no token, so nothing goes hunting for one", () => {
    expect(installPrompt(TEST_URL)).toMatch(/oauth/i);
  });

  it("asks for the permission the review queue depends on", () => {
    expect(installPrompt(TEST_URL)).toMatch(/suggest/i);
  });

  it("uses no dashes as punctuation", () => {
    // House style: regular hyphens only, and none standing in for a comma.
    expect(installPrompt(TEST_URL)).not.toMatch(/[–—]/);
  });
});
