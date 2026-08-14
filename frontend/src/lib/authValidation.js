/**
 * What is wrong with one auth field, as a sentence, or null.
 *
 * Pure and DOM-free on purpose. These rules were previously an if-chain inside
 * each of two components' submit handlers, which is why the sign-up form and
 * the reset form had two declarations of the same minimum length.
 *
 * Two limits on what belongs here:
 *
 *   1. Shape only. Whether an account exists, whether a password is right,
 *      whether a server answers -- those are answers, they arrive after a round
 *      trip, and they belong on the form-level line.
 *   2. Nothing that would reject an input the server accepts. A length rule on
 *      an EXISTING password would lock out every account older than the rule;
 *      a URL pattern would reject a port or a path somebody is really using.
 */
import { looksLikeEmail } from "@/lib/session.js";

/** Matches MIN_PASSWORD_LENGTH in backend/main.py and Better Auth's own floor. */
export const MIN_PASSWORD_LENGTH = 8;

const isBlank = (value) => !String(value ?? "").trim();

/**
 * `acceptsEmail` follows the label: sign-in takes either identifier, sign-up
 * and detached mode take a username only. The message and the label have to
 * agree or one of them is lying.
 */
export function validateUsername(value, { acceptsEmail = false } = {}) {
  if (isBlank(value)) {
    return acceptsEmail ? "Enter a username or email." : "Enter a username.";
  }
  return null;
}

/** `isNew` is signing up or resetting; the minimum applies only then. */
export function validatePassword(value, { isNew = false } = {}) {
  if (!value) return "Enter a password.";
  if (isNew && value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/**
 * Silent while the password above is still empty: blurring Confirm first is not
 * a mistake anyone made, and a mismatch message there points at the wrong box.
 */
export function validateConfirmPassword(value, password) {
  if (!password) return null;
  if (!value) return "Re-enter your password.";
  if (value !== password) return "Passwords do not match.";
  return null;
}

/**
 * The forgot-password field, which is email-only -- unlike sign-in, a reset
 * cannot be sent to a username. `looksLikeEmail` is session.js's, so this
 * screen and the sign-in router cannot drift apart on what an address is.
 */
export function validateResetEmail(value) {
  if (isBlank(value)) return "Enter the email on your account.";
  if (!looksLikeEmail(value)) return "That does not look like an email address.";
  return null;
}

export function validateServerUrl(value) {
  if (isBlank(value)) return "Server URL is required.";
  return null;
}
