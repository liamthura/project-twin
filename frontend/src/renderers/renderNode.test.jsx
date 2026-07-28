import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderNode } from "./renderNode";

// renderNode is the seam wave 4 calls for a nested node. These tests drive it
// directly, without a Card or a pack, which is exactly the call shape a child
// node needs and the old inline dispatch could not offer.
describe("renderNode", () => {
  const listNode = { kind: "list", path: ["items"], title_field: "name", detail_fields: ["note"] };

  it("renders a list node against the value it is handed, not a section root", () => {
    renderResult({ node: listNode, value: [{ name: "Row", note: "n" }] });
    expect(screen.getByText("Row")).toBeInTheDocument();
  });

  it("reports edits through onValue as a replacement value", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    renderResult({ node: listNode, value: [{ name: "Row", note: "n" }], onValue });

    await user.click(screen.getByText("Row"));
    await user.type(screen.getByDisplayValue("n"), "X");

    expect(onValue).toHaveBeenCalled();
    expect(onValue.mock.calls.at(-1)[0]).toEqual([{ name: "Row", note: "nX" }]);
  });

  it("resolves its entity from the entities map it is given", async () => {
    const user = userEvent.setup();
    const node = { ...listNode, entity: "thing", detail_fields: ["stance"] };
    renderResult({
      node,
      value: [{ name: "Row", stance: "love" }],
      entities: { thing: { valid_values: { stance: ["love", "like"] } } },
    });
    // detail_fields only render once the row is expanded -- same as every
    // other renderResult test here that inspects a detail field.
    await user.click(screen.getByText("Row"));
    // An enum renders as a pressed segmented button, not a text input.
    expect(screen.getByRole("button", { name: "love", pressed: true })).toBeInTheDocument();
  });

  it("returns null and logs for an unsupported kind, naming the kind and pack", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = renderNode({ node: { kind: "fields" }, value: {}, onValue: vi.fn(), packKey: "p" });
    expect(out).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("fields"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("p"));
    errorSpy.mockRestore();
  });

  it("does not throw when an unsupported node has no path at all", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      renderNode({ node: { kind: "fields" }, value: undefined, onValue: vi.fn(), packKey: "p" })
    ).not.toThrow();
    errorSpy.mockRestore();
  });

  it("logs and returns null for a list node with no valid path, naming the pack", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = renderNode({ node: { kind: "list" }, value: undefined, onValue: vi.fn(), packKey: "p" });
    expect(out).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("p"));
    errorSpy.mockRestore();
  });

  it("renders nothing at all for a list node with no valid path -- not even an empty list", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = renderResult({ node: { kind: "list" }, value: undefined, packKey: "p" });
    expect(container).toBeEmptyDOMElement();
    // Distinct from the non-array-*value* case below: there is nowhere to
    // write an edit back to without a path, so this must not fall back to
    // ListRenderer's own empty-list UI either -- that would be a control
    // bound to nowhere, which is worse than no control.
    expect(screen.queryByText(/Nothing here yet/)).not.toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("logs and renders empty when a list node's value is not an array", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderResult({ node: listNode, value: "not a list", packKey: "corrupted" });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("corrupted"));
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("does not log when the value is simply absent -- that is a fresh section", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderResult({ node: listNode, value: undefined });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  function renderResult(args) {
    return render(<>{renderNode({ onValue: () => {}, ...args })}</>);
  }
});
