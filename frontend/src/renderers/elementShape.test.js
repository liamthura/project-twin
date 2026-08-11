// @vitest-environment node
//
// elementShape.js documents itself as "Pure and React-free", like paths.js --
// no DOM access, no side effects. See paths.test.js for why that earns the
// node environment instead of jsdom.
import { describe, it, expect } from "vitest";
import { elementShape, isBlockField, blockNode } from "./elementShape";

const node = (fields) => ({
  kind: "list",
  path: ["items"],
  element: { entity: "thing", identifier: "name", fields },
});

describe("elementShape: a block field never takes the `form` position", () => {
  // The one-line rule this pins: `if (isBlock && position === "form")
  // continue`. A block (a labelled `strings`/`list` field) draws its own
  // titled control under the row -- that control IS the field's input, so an
  // inline text box over an array beside it would be incoherent. Nothing
  // stated this rule anywhere else until the backend cross-check added
  // alongside this test: meta_schema.json alone would happily accept
  // `{label, type: "strings", show: ["form"]}`, and this is the code that
  // would otherwise draw it wrong. Pinned independently of the loader, per
  // the round's report: this is the renderer's OWN behaviour, not a proxy for
  // whether the manifest happens to validate.
  it("gives a labelled strings field no form position even when `form` is declared", () => {
    const shape = elementShape(
      node([
        { name: "name", role: "title" },
        { name: "steps", type: "strings", label: "Steps", show: ["form", "count"] },
      ])
    );
    expect(shape.form).not.toContain("steps");
    // The non-form position it also declared must still take effect -- this
    // rule withholds exactly `form`, nothing else.
    expect(shape.count).toContain("steps");
  });

  it("gives a labelled list field no form position", () => {
    const shape = elementShape(
      node([
        { name: "name", role: "title" },
        {
          name: "coursework",
          type: "list",
          label: "Coursework",
          show: ["form"],
          element: { entity: "coursework", identifier: "title", fields: [{ name: "title", role: "title" }] },
        },
      ])
    );
    expect(shape.form).not.toContain("coursework");
  });

  it("still gives an UNlabelled strings field the form position -- it is an inline chip control, not a block", () => {
    const shape = elementShape(
      node([
        { name: "name", role: "title" },
        { name: "tags", type: "strings", show: ["form"] },
      ])
    );
    expect(shape.form).toContain("tags");
    expect(isBlockField({ name: "tags", type: "strings" })).toBe(false);
  });

  it("still lists the field in `blocks`, so its titled control renders regardless of the withheld form position", () => {
    const field = { name: "steps", type: "strings", label: "Steps", show: ["form"] };
    const shape = elementShape(node([{ name: "name", role: "title" }, field]));
    expect(shape.blocks).toContainEqual(field);
    expect(blockNode(field).title).toBe("Steps");
  });
});
