// @vitest-environment node
//
// No DOM here: these are string/Date conversions. The environment that matters
// is the TIMEZONE, which vitest.config.js pins to America/New_York -- a
// negative offset that observes DST, chosen so an unhandled UTC conversion
// cannot pass by accident. At UTC+0 every test below passes with or without the
// bug.
import { describe, it, expect } from "vitest";
import { parseIsoDate, formatIsoDate, formatDateLabel, ISO_DATE } from "./isoDate.js";

describe("the timezone trap", () => {
  it("keeps the day a stored date names", () => {
    // new Date("2026-08-14") is UTC midnight, which is 2026-08-13 20:00 in
    // New York -- so a naive parse renders and re-saves the 13th.
    expect(parseIsoDate("2026-08-14").getDate()).toBe(14);
    expect(parseIsoDate("2026-08-14").getMonth()).toBe(7);
    expect(parseIsoDate("2026-08-14").getFullYear()).toBe(2026);
  });

  it("round-trips every stored date unchanged", () => {
    for (const value of [
      "2026-01-01",
      "2026-08-14",
      "2026-12-31",
      // Both sides of a DST transition in the pinned zone.
      "2026-03-08",
      "2026-11-01",
      // A leap day, and the day either side of it.
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]) {
      expect(formatIsoDate(parseIsoDate(value))).toBe(value);
    }
  });

  it("does not shift a date built late in the local day", () => {
    // 23:30 local in a negative offset is already tomorrow in UTC, so
    // toISOString would store the next day.
    const late = new Date(2026, 7, 14, 23, 30);
    expect(formatIsoDate(late)).toBe("2026-08-14");
  });

  it("does not shift one built early in the local day", () => {
    const early = new Date(2026, 7, 14, 0, 30);
    expect(formatIsoDate(early)).toBe("2026-08-14");
  });
});

describe("parseIsoDate", () => {
  it.each([
    // The free text an MCP client can write into a date field. Nothing
    // validates these on write.
    ["next spring"],
    ["Q2 2027"],
    ["sometime in August"],
    // Shapes that are close but not the stored format.
    ["14/08/2026"],
    ["2026-8-14"],
    ["2026-08-14T10:00:00Z"],
    [""],
    [null],
    [undefined],
    [20260814],
  ])("returns null for %s", (value) => {
    expect(parseIsoDate(value)).toBeNull();
  });

  it("rejects a date that looks well-formed and does not exist", () => {
    // The Date constructor rolls this over to March rather than failing, so
    // without the check-back it would silently become 2026-03-03.
    expect(parseIsoDate("2026-02-31")).toBeNull();
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("2026-00-10")).toBeNull();
  });

  it("accepts a leap day that exists and rejects one that does not", () => {
    expect(parseIsoDate("2024-02-29")).not.toBeNull();
    expect(parseIsoDate("2026-02-29")).toBeNull();
  });
});

describe("formatIsoDate", () => {
  it.each([[null], [undefined], ["2026-08-14"], [new Date("nonsense")]])(
    "returns an empty string for %s",
    (value) => {
      expect(formatIsoDate(value)).toBe("");
    },
  );
});

describe("formatDateLabel", () => {
  it("reads the way British English writes a date", () => {
    expect(formatDateLabel("2026-08-14")).toBe("14 August 2026");
  });

  it("shows a value it cannot parse rather than blanking it", () => {
    // The alternative is an empty control over a stored value, which is how a
    // reader loses text without being told.
    expect(formatDateLabel("next spring")).toBe("next spring");
  });

  it("is empty when there is nothing stored", () => {
    expect(formatDateLabel("")).toBe("");
    expect(formatDateLabel(undefined)).toBe("");
  });
});

describe("ISO_DATE", () => {
  it("is anchored, so it cannot match a date inside a longer string", () => {
    expect(ISO_DATE.test("2026-08-14")).toBe(true);
    expect(ISO_DATE.test("on 2026-08-14 at noon")).toBe(false);
  });
});
