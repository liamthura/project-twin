import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FieldsRenderer } from "./FieldsRenderer";

// The three fields are descriptors on `element` rather than a flat `fields`
// array, and the entity moves inside it -- the node's own `description` is
// on-screen text, the element's is what an MCP client reads.
const node = {
  kind: "fields",
  path: ["communication", "default"],
  element: {
    entity: "communication_default",
    fields: [{ name: "tone" }, { name: "detail_level" }, { name: "locale" }],
  },
};
const entity = { optional: ["tone", "detail_level", "locale"] };

// One field's descriptor replaced, by name, leaving the rest of the node alone.
const withField = (name, extra) => ({
  ...node,
  element: {
    ...node.element,
    fields: node.element.fields.map((f) => (f.name === name ? { ...f, ...extra } : f)),
  },
});

function renderFields(props = {}) {
  return render(
    <FieldsRenderer node={node} entity={entity} value={{}} onValue={() => {}} {...props} />
  );
}

describe("FieldsRenderer", () => {
  it("renders one labelled control per declared field", () => {
    renderFields();
    expect(screen.getByLabelText("Tone")).toBeInTheDocument();
    expect(screen.getByLabelText("Detail level")).toBeInTheDocument();
    expect(screen.getByLabelText("Locale")).toBeInTheDocument();
  });

  it("prefers a field's own `label` over the title-cased name", () => {
    // meta_schema.json's `label` promises exactly this: "declare it only where
    // [the title-cased default] reads wrong." Before this, only a block field's
    // title ever consulted `label` -- a scalar field's was accepted by the
    // schema and then silently dropped, so this pins the fix rather than the
    // schema's mere promise.
    const labelledNode = withField("detail_level", { label: "How much detail" });
    render(<FieldsRenderer node={labelledNode} entity={entity} value={{}} onValue={() => {}} />);

    expect(screen.getByLabelText("How much detail")).toBeInTheDocument();
    expect(screen.queryByLabelText("Detail level")).not.toBeInTheDocument();
  });

  it("renders nothing for a field the node does not declare", () => {
    renderFields({ value: { mood_overrides: [] } });
    expect(screen.queryByLabelText(/mood/i)).not.toBeInTheDocument();
  });

  it("shows the stored value for each field", () => {
    renderFields({ value: { tone: "warm", locale: "British English" } });
    expect(screen.getByLabelText("Tone")).toHaveValue("warm");
    expect(screen.getByLabelText("Locale")).toHaveValue("British English");
  });

  it("writes one field without dropping its siblings", async () => {
    const onValue = vi.fn();
    renderFields({ value: { tone: "warm", locale: "British English" }, onValue });

    await userEvent.type(screen.getByLabelText("Detail level"), "b");

    expect(onValue).toHaveBeenCalledWith({
      tone: "warm",
      locale: "British English",
      detail_level: "b",
    });
  });

  it("preserves stored keys the node does not declare", async () => {
    // This renderer writes a whole OBJECT, so a write that forgets unknown
    // keys silently deletes stored data on the first keystroke. These objects
    // are shared with MCP writers that may know keys the manifest does not.
    const onValue = vi.fn();
    renderFields({ value: { tone: "warm", legacy_key: "keep me" }, onValue });

    await userEvent.type(screen.getByLabelText("Locale"), "x");

    expect(onValue.mock.calls.at(-1)[0].legacy_key).toBe("keep me");
  });

  it("renders an enum field as an enum control, not a text input", () => {
    // Pins that buildFieldMeta is actually wired in -- without it every field
    // would fall through to a plain Input.
    // The vocabulary is the field's own `values` now, not a node-level `enum` map.
    const enumNode = withField("tone", {
      type: "enum",
      values: ["warm", "neutral", "direct"],
    });
    render(<FieldsRenderer node={enumNode} entity={entity} value={{}} onValue={() => {}} />);

    expect(screen.getByRole("button", { name: "warm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "neutral" })).toBeInTheDocument();
  });

  it("ignores an entity's valid_values -- the field's own descriptor is the only vocabulary", () => {
    // Was "takes the entity's valid_values when the node declares no enum".
    // v2 deleted that fallback along with the second copy it read: a field
    // declares its vocabulary or has none, and the entity's `valid_values` is
    // DERIVED from that declaration rather than being a source for it. An entity
    // that disagrees (here, one offering options for a plain text field) must
    // change nothing on screen.
    render(
      <FieldsRenderer
        node={node}
        entity={{ ...entity, valid_values: { tone: ["warm", "direct"] } }}
        value={{}}
        onValue={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: "warm" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Tone")).toHaveValue("");
  });

  it("writes the value an enum control reports", async () => {
    const onValue = vi.fn();
    const enumNode = withField("tone", { type: "enum", values: ["warm", "neutral"] });
    render(
      <FieldsRenderer node={enumNode} entity={entity} value={{ locale: "en" }} onValue={onValue} />
    );

    await userEvent.click(screen.getByRole("button", { name: "warm" }));

    expect(onValue).toHaveBeenCalledWith({ locale: "en", tone: "warm" });
  });

  it("gives each field a distinct control, so editing one does not write another", async () => {
    const onValue = vi.fn();
    renderFields({ value: {}, onValue });

    await userEvent.type(screen.getByLabelText("Tone"), "a");

    expect(onValue).toHaveBeenCalledWith({ tone: "a" });
  });

  it("treats a missing stored object as empty rather than throwing", () => {
    expect(() => renderFields({ value: undefined })).not.toThrow();
    expect(screen.getByLabelText("Tone")).toHaveValue("");
  });

  it("does not spread a non-object stored value into the write", async () => {
    // Spreading a string would explode into {0: "o", 1: "l", ...} indexed keys
    // and persist them.
    const onValue = vi.fn();
    renderFields({ value: "oops", onValue });

    await userEvent.type(screen.getByLabelText("Tone"), "a");

    expect(onValue).toHaveBeenCalledWith({ tone: "a" });
  });

  it("renders nothing but an empty grid when the node declares no fields", () => {
    const { container } = render(
      <FieldsRenderer node={{ kind: "fields", path: [] }} value={{}} onValue={() => {}} />
    );
    expect(container.querySelectorAll("input")).toHaveLength(0);
  });

  it("survives a node with no entity, which is what profile's scalars will be", () => {
    expect(() =>
      render(
        <FieldsRenderer
          node={{ kind: "fields", path: [], element: { entity: "basic_info", fields: [{ name: "name" }] } }}
          entity={undefined}
          value={{ name: "Ada" }}
          onValue={() => {}}
        />
      )
    ).not.toThrow();
    expect(screen.getByLabelText("Name")).toHaveValue("Ada");
  });
});
