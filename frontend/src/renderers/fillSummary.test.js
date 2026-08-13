// @vitest-environment node
// Nothing here renders or touches the DOM, and the subject imports nothing --
// so this file skips jsdom construction entirely (~700ms).
import { describe, expect, it } from "vitest";

import { fillSummary } from "./fillSummary";

// Descriptors, not a flat `fields` array: a node states its key set once, in
// `element.fields`, and fillSummary counts the same list FieldsRenderer draws.
const fieldsNode = (...names) => ({
  kind: "fields",
  element: { entity: "communication_default", fields: names.map((name) => ({ name })) },
});
const node = fieldsNode("tone", "detail_level", "locale");

describe("fillSummary", () => {
  it("counts the declared keys that hold a value", () => {
    expect(fillSummary(node, { tone: "direct", locale: "en-GB" })).toEqual({ filled: 2, total: 3 });
  });

  it("counts nothing for a value that is not an object", () => {
    // An MCP client can leave any shape behind; FieldsRenderer already renders
    // empty controls for one rather than throwing. A stray string must not be
    // counted by its characters.
    expect(fillSummary(node, "direct")).toEqual({ filled: 0, total: 3 });
    expect(fillSummary(node, undefined)).toEqual({ filled: 0, total: 3 });
    expect(fillSummary(node, ["direct"])).toEqual({ filled: 0, total: 3 });
  });

  it("does not count blank, whitespace, empty-array or null values as filled", () => {
    expect(fillSummary(node, { tone: "", detail_level: "   ", locale: null })).toEqual({
      filled: 0,
      total: 3,
    });
    expect(fillSummary(fieldsNode("a"), { a: [] })).toEqual({
      filled: 0,
      total: 1,
    });
  });

  it("counts false and 0 as filled, because a switch that is off is answered", () => {
    expect(fillSummary(fieldsNode("a", "b"), { a: false, b: 0 })).toEqual({
      filled: 2,
      total: 2,
    });
  });

  it("ignores stored keys the node does not declare", () => {
    // Otherwise `filled` can exceed `total` on a shape an MCP writer left
    // behind -- `communication.default` really does carry keys older than the
    // node that renders it.
    expect(fillSummary(node, { tone: "direct", surprise: "x" })).toEqual({ filled: 1, total: 3 });
  });

  it("reports a total of 0 for a node declaring no fields", () => {
    // The caller renders nothing at all for this, rather than "0 of 0".
    expect(fillSummary({ kind: "fields" }, {})).toEqual({ filled: 0, total: 0 });
    expect(fillSummary(undefined, undefined)).toEqual({ filled: 0, total: 0 });
  });
});
