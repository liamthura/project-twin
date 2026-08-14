import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ScalarField } from "./ScalarField";
import { controlFor } from "./controlCensus";

// `controlFor` is a hand-written copy of ScalarField's if-chain, and the census
// it feeds is only as trustworthy as that copy. Nothing else compares the two:
// `controlCensus.test.js` runs in the `node` environment and never renders
// anything, so it can only ever compare `controlFor` against itself. A review of
// the commit that added it proved the gap by reversing `controlFor`'s branch
// order and watching every test stay green -- no shipped field is currently
// ambiguous across two branches, so the order was unobserved.
//
// This file closes that. It renders the real component and reads the control kind
// back out of the DOM by markup alone, then asserts the two agree -- including
// for deliberately AMBIGUOUS metas, which is what makes the ORDER observable.
// Reverse either chain and this fails.

// The DOM -> kind mapping, derived from markup and nothing else. Written without
// reference to `controlFor` on purpose: if both sides consulted the same source
// this would be a tautology.
function renderedKind(container) {
  if (container.querySelector("textarea")) return "longtext";
  // The date control is a popover trigger, not an input: Radix marks it
  // aria-haspopup="dialog", which nothing else ScalarField renders does. It
  // used to be `input[type="date"]`, before the native picker was replaced.
  if (container.querySelector('button[aria-haspopup="dialog"]')) return "date";
  if (container.querySelector('input[type="time"]')) return "time";
  if (container.querySelector('[role="switch"]')) return "bool";
  // EnumControl: SegmentedControl draws one aria-pressed button per option;
  // above SEGMENTED_MAX (or on a narrow screen) it draws a listbox trigger
  // instead. `enum+custom` adds a free-text input beside it, which is the only
  // way an enum and a text input appear together.
  const pressed = container.querySelectorAll("[aria-pressed]");
  const trigger = container.querySelector('[role="combobox"], select');
  if (pressed.length > 0 || trigger) {
    return container.querySelector("input") ? "enum+custom" : "enum";
  }
  // ArrayInput is an Input plus an add Button. A plain text field has no button.
  if (container.querySelector("input") && container.querySelector("button")) return "array";
  return "text";
}

// Each case is a `meta` and the field to ask about. The last four are ambiguous
// across two of ScalarField's branches, which no shipped pack currently is --
// they exist so that the branch ORDER is asserted rather than assumed.
const CASES = [
  ["a plain field", { field: "title", meta: {}, value: "x" }],
  ["long text", { field: "notes", meta: { long_text: new Set(["notes"]) }, value: "x" }],
  ["a date", { field: "when", meta: { date_fields: ["when"] }, value: "2026-01-01" }],
  ["a time", { field: "at", meta: { time_fields: ["at"] }, value: "07:30" }],
  ["a boolean", { field: "on", meta: { bool_fields: ["on"] }, value: true }],
  ["an array", { field: "tags", meta: { array_fields: ["tags"] }, value: ["a"] }],
  ["an enum", { field: "status", meta: { valid_values: { status: ["a", "b"] } }, value: "a" }],
  [
    "an enum with an overflow box, via allow_custom",
    {
      field: "type",
      meta: { valid_values: { type: ["a", "other"] }, allow_custom: ["type"] },
      value: "other",
    },
  ],
  [
    "an enum with an overflow box, via the pre-v2 custom_ convention",
    {
      field: "type",
      meta: { valid_values: { type: ["a", "other"] }, optional: ["custom_type"] },
      value: "other",
    },
  ],
  // --- ambiguous: two branches match, and only the order decides ---
  [
    "an enum that is also long text -- the enum wins",
    {
      field: "notes",
      meta: { valid_values: { notes: ["a", "b"] }, long_text: new Set(["notes"]) },
      value: "a",
    },
  ],
  [
    "an array that is also long text -- the array wins",
    { field: "tags", meta: { array_fields: ["tags"], long_text: new Set(["tags"]) }, value: ["a"] },
  ],
  [
    "a date that is also long text -- the date wins",
    {
      field: "when",
      meta: { date_fields: ["when"], long_text: new Set(["when"]) },
      value: "2026-01-01",
    },
  ],
  [
    "a boolean that is also a time -- the boolean wins",
    { field: "on", meta: { bool_fields: ["on"], time_fields: ["on"] }, value: true },
  ],
];

describe("the census agrees with what ScalarField actually renders", () => {
  for (const [label, { field, meta, value }] of CASES) {
    it(`for ${label}`, () => {
      const { container } = render(
        <ScalarField field={field} value={value} meta={meta} onChange={() => {}} />
      );
      expect(controlFor(meta, field)).toBe(renderedKind(container));
    });
  }

  it("distinguishes all seven kinds, so agreement is not agreement on one answer", () => {
    // Without this, a `renderedKind` that returned "text" for everything and a
    // `controlFor` that did the same would agree on every case above.
    const kinds = new Set(CASES.map(([, c]) => controlFor(c.meta, c.field)));
    expect([...kinds].sort()).toEqual([
      "array", "bool", "date", "enum", "enum+custom", "longtext", "text", "time",
    ]);
  });
});
