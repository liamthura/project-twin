// @vitest-environment node
//
// No DOM: these are strings in and strings out. Run in node so a rule cannot
// accidentally come to depend on one.
import { describe, it, expect } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  validateUsername,
  validatePassword,
  validateConfirmPassword,
  validateResetEmail,
  validateServerUrl,
} from "./authValidation.js";

describe("validateUsername", () => {
  it("accepts something typed", () => {
    expect(validateUsername("liamthura")).toBeNull();
  });

  it.each([[""], ["   "], [undefined], [null]])("asks for one when given %s", (value) => {
    expect(validateUsername(value)).toBe("Enter a username.");
  });

  it("names both identifiers where both are accepted", () => {
    // Sign-in takes either; sign-up and detached mode take a username only.
    // The message has to match the label above it or one of the two is lying.
    expect(validateUsername("", { acceptsEmail: true })).toBe("Enter a username or email.");
  });

  it("does not check the shape of what was typed", () => {
    // Whether an identifier exists is the server's answer, not this function's.
    expect(validateUsername("not an email@", { acceptsEmail: true })).toBeNull();
  });
});

describe("validatePassword", () => {
  it("accepts an existing password of any length", () => {
    // Signing in with an old short password must still be possible. A length
    // rule applied here would lock out any account that predates the rule.
    expect(validatePassword("abc")).toBeNull();
  });

  it.each([[""], [undefined], [null]])("asks for one when given %s", (value) => {
    expect(validatePassword(value)).toBe("Enter a password.");
  });

  it("holds a new password to the minimum", () => {
    expect(validatePassword("abc", { isNew: true })).toBe(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  });

  it("accepts a new password at exactly the minimum", () => {
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH), { isNew: true })).toBeNull();
  });

  it("does not trim a password", () => {
    // Spaces are characters. Trimming here would accept a password the server
    // then rejects, or worse, quietly change the one being set.
    expect(validatePassword("   ", { isNew: false })).toBeNull();
  });
});

describe("validateConfirmPassword", () => {
  it("accepts a match", () => {
    expect(validateConfirmPassword("a-good-password", "a-good-password")).toBeNull();
  });

  it("reports a mismatch", () => {
    expect(validateConfirmPassword("a-good-password", "a-good-passwerd")).toBe(
      "Passwords do not match.",
    );
  });

  it("asks for the field rather than calling an empty box a mismatch", () => {
    expect(validateConfirmPassword("", "a-good-password")).toBe("Re-enter your password.");
  });

  it("is quiet while there is nothing to match against", () => {
    // Blurring Confirm before Password is typed is not an error the reader
    // made, and a mismatch message there points at the wrong field.
    expect(validateConfirmPassword("", "")).toBeNull();
  });
});

describe("validateResetEmail", () => {
  it("accepts an address", () => {
    expect(validateResetEmail("someone@example.com")).toBeNull();
  });

  it("asks for one", () => {
    expect(validateResetEmail("  ")).toBe("Enter the email on your account.");
  });

  it("rejects something that is not an address", () => {
    // This field is email-only: a reset cannot be sent to a username, so
    // accepting one buys a round trip and a silent nothing.
    expect(validateResetEmail("liamthura")).toBe("That does not look like an email address.");
  });

  it("ignores surrounding space", () => {
    expect(validateResetEmail("  someone@example.com  ")).toBeNull();
  });
});

describe("validateServerUrl", () => {
  it("accepts a URL", () => {
    expect(validateServerUrl("https://mygist.example.com/api")).toBeNull();
  });

  it("asks for one", () => {
    expect(validateServerUrl("")).toBe("Server URL is required.");
  });

  it("does not judge the shape", () => {
    // The connection test is what finds out whether a URL works. Guessing here
    // would reject a hostname, a port, or a path someone is legitimately using.
    expect(validateServerUrl("localhost:8000")).toBeNull();
  });
});
