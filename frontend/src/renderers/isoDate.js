/**
 * Converting between a stored `yyyy-mm-dd` string and a JS `Date`.
 *
 * Both directions are traps, and this file exists so the picker walks into
 * neither:
 *
 * `new Date("2026-08-14")` parses as UTC midnight. Anywhere west of Greenwich
 * that is the PREVIOUS local day, so a stored date would render one day early
 * and then be saved back one day early. The suite pins TZ to America/New_York
 * (vitest.config.js says why) precisely so this shows up.
 *
 * `date.toISOString().slice(0, 10)` has the same fault in reverse: it converts
 * to UTC before formatting, so a date picked in the evening in a negative
 * offset is stored as tomorrow.
 *
 * So: parse from the three numbers, format from the local getters, and never
 * let a Date and a UTC instant be treated as the same thing.
 */

// What <input type="date"> accepted and round-tripped, and what the manifest's
// `type: "date"` fields store. Kept here rather than imported from ScalarField
// so this module stays free of anything that renders.
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A stored string as a Date at local midnight, or null.
 *
 * Null for anything that is not a real calendar date, which includes both the
 * free text an MCP client can write ("next spring") and a well-formed
 * impossibility like 2026-02-31 -- the Date constructor rolls that over to
 * March 3rd rather than failing, so it is checked back against its own parts.
 */
export function parseIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** A Date as `yyyy-mm-dd`, from its local parts. Empty string for a non-date. */
export function formatIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The date as a person reads it: "14 August 2026".
 *
 * en-GB rather than the visitor's locale, because the rest of the app's copy is
 * British English and a control that switched format per machine would make the
 * same screen unreproducible. Falls back to the stored string if it is not a
 * date, so a value the picker cannot represent is still shown rather than
 * blanked.
 */
export function formatDateLabel(value) {
  const date = parseIsoDate(value);
  if (!date) return value || "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
