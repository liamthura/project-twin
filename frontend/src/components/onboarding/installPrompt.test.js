import { describe, it, expect } from "vitest";
import { installPrompt } from "./installPrompt.js";

const TEST_URL = "https://example.test/mcp";

describe("installPrompt", () => {
  it("carries the live address rather than a placeholder", () => {
    expect(installPrompt(TEST_URL)).toContain(TEST_URL);
  });

  it("names the transport, because a client that guesses stdio fails silently", () => {
    // Must explicitly say "over HTTP", not just have it in the URL
    const prompt = installPrompt(TEST_URL);
    const withoutUrl = prompt.replace(TEST_URL, "");
    expect(withoutUrl).toMatch(/over HTTP/i);
  });

  it("says there is no token, so nothing goes hunting for one", () => {
    // Must explicitly state no token to paste, not just mention OAuth
    expect(installPrompt(TEST_URL)).toMatch(/no token/i);
  });

  it("asks for the permission the review queue depends on", () => {
    // Must keep suggest permission AND uncheck direct write
    const prompt = installPrompt(TEST_URL);
    expect(prompt).toMatch(/Suggest changes for your approval/);
    expect(prompt).toMatch(/uncheck.*Change your persona directly/i);
  });

  it("uses no dashes as punctuation", () => {
    // House style: regular hyphens only, and none standing in for a comma.
    expect(installPrompt(TEST_URL)).not.toMatch(/[–—]/);
  });
});
