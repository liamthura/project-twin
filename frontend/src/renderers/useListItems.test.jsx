// The list-editing invariants, tested without rendering a list.
//
// Every one of these was previously reachable only through a full render: click
// a row open, click Add, read the harness's `latest()`. That works, and those
// tests stay -- but it means an invariant about ARRAY INDEXES is asserted
// through the DOM, so a failure reports "the wrong row is expanded" rather than
// "the expanded map was not shifted". These name the rule directly.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useListItems } from "./useListItems";

function setup(overrides = {}) {
  const onItems = vi.fn();
  const setExpanded = vi.fn();
  const setQuery = vi.fn();
  const items = overrides.items ?? [
    { name: "first", note: "a" },
    { name: "second", note: "b" },
    { name: "third", note: "c" },
  ];
  const { result } = renderHook(() =>
    useListItems({
      items,
      onItems,
      titleField: "name",
      fieldDefaults: overrides.fieldDefaults ?? {},
      exclusiveFields: overrides.exclusiveFields ?? [],
      pinnedField: overrides.pinnedField,
      existingTitles: new Set(items.map((i) => (i.name || "").toLowerCase())),
      setExpanded,
      setQuery,
      onShowConfirmation: overrides.onShowConfirmation,
    })
  );
  return { api: result.current, onItems, setExpanded, setQuery, items };
}

// The setState callbacks are what actually move the expanded map, so the tests
// run them the way React would rather than asserting on the function identity.
const applyUpdater = (mock, prev) => mock.mock.calls[0][0](prev);

describe("addItem", () => {
  it("prepends the new row", () => {
    const { api, onItems } = setup();
    act(() => api.addItem({ name: "fourth" }));
    expect(onItems.mock.calls[0][0][0]).toEqual({ name: "fourth" });
    expect(onItems.mock.calls[0][0]).toHaveLength(4);
  });

  it("shifts every expanded key UP, because the new row takes index 0", () => {
    const { api, setExpanded } = setup();
    act(() => api.addItem({ name: "fourth" }));
    // The user had row 0 open. After a prepend it is row 1, and leaving the key
    // alone would silently expand the brand-new row instead.
    expect(applyUpdater(setExpanded, { 0: true, 2: true })).toEqual({ 1: true, 3: true });
  });

  it("does not auto-expand the new row", () => {
    const { api, setExpanded } = setup();
    act(() => api.addItem({ name: "fourth" }));
    expect(applyUpdater(setExpanded, {})).toEqual({});
  });

  it("clears a stale query, which would otherwise filter the new row out", () => {
    const { api, setQuery } = setup();
    act(() => api.addItem({ name: "fourth" }));
    expect(setQuery).toHaveBeenCalledWith("");
  });

  it("refuses a row with no title", () => {
    const { api, onItems } = setup();
    act(() => api.addItem({ note: "orphan" }));
    expect(onItems).not.toHaveBeenCalled();
  });

  it("refuses a duplicate title, case-insensitively", () => {
    const { api, onItems } = setup();
    act(() => api.addItem({ name: "FIRST" }));
    expect(onItems).not.toHaveBeenCalled();
  });

  it("resolves an @now default that no control rendered", () => {
    const { api, onItems } = setup({ fieldDefaults: { created: "@now" } });
    act(() => api.addItem({ name: "fourth" }));
    const created = onItems.mock.calls[0][0][0].created;
    expect(created).not.toBe("@now");
    expect(Number.isNaN(Date.parse(created))).toBe(false);
  });

  it("leaves a literally-typed @now alone", () => {
    // The token is resolved only where the merged value is still the untouched
    // default. Someone typing "@now" into a real control is entering data.
    const { api, onItems } = setup({ fieldDefaults: { created: "@now" } });
    act(() => api.addItem({ name: "@now" }));
    expect(onItems.mock.calls[0][0][0].name).toBe("@now");
  });
});

describe("updateItem", () => {
  it("writes a field", () => {
    const { api, onItems } = setup();
    act(() => api.updateItem(1, { note: "changed" }));
    expect(onItems.mock.calls[0][0][1]).toEqual({ name: "second", note: "changed" });
  });

  it("treats an empty string as a deletion", () => {
    const { api, onItems } = setup();
    act(() => api.updateItem(1, { note: "" }));
    expect(onItems.mock.calls[0][0][1]).toEqual({ name: "second" });
  });

  it("leaves every other row untouched by reference", () => {
    const { api, onItems, items } = setup();
    act(() => api.updateItem(1, { note: "changed" }));
    const next = onItems.mock.calls[0][0];
    expect(next[0]).toBe(items[0]);
    expect(next[2]).toBe(items[2]);
  });
});

describe("exclusive fields", () => {
  const items = [
    { name: "first" },
    { name: "second", primary: true },
    { name: "third" },
  ];

  it("clears the flag from every other row", () => {
    const { api, onItems } = setup({ items, exclusiveFields: ["primary"] });
    act(() => api.updateItem(0, { primary: true }));
    const next = onItems.mock.calls[0][0];
    expect(next[0].primary).toBe(true);
    expect(next[1].primary).toBeUndefined();
  });

  it("DELETES the flag rather than setting it false", () => {
    // Absent is how a row that never claimed it already looks; setting false
    // would leave two shapes that render identically.
    const { api, onItems } = setup({ items, exclusiveFields: ["primary"] });
    act(() => api.updateItem(0, { primary: true }));
    expect("primary" in onItems.mock.calls[0][0][1]).toBe(false);
  });

  it("does not fire when the flag is set to anything but true", () => {
    const { api, onItems } = setup({ items, exclusiveFields: ["primary"] });
    act(() => api.updateItem(0, { name: "renamed" }));
    expect(onItems.mock.calls[0][0][1].primary).toBe(true);
  });

  it("promote routes through the same rule", () => {
    const { api, onItems } = setup({
      items, exclusiveFields: ["primary"], pinnedField: "primary",
    });
    act(() => api.promote(2));
    const next = onItems.mock.calls[0][0];
    expect(next[2].primary).toBe(true);
    expect("primary" in next[1]).toBe(false);
  });
});

describe("updateItemAt", () => {
  it("writes at an item-relative path", () => {
    const { api, onItems } = setup({ items: [{ name: "first", refs: [] }] });
    act(() => api.updateItemAt(0, ["refs"], [{ name: "r" }]));
    expect(onItems.mock.calls[0][0][0].refs).toEqual([{ name: "r" }]);
  });

  it("keeps an empty array, unlike updateItem's empty string", () => {
    // A child renderer writing [] is recording "the user removed the last
    // entry" -- it is a value, not a blanked scalar.
    const { api, onItems } = setup({ items: [{ name: "first", refs: [{ name: "r" }] }] });
    act(() => api.updateItemAt(0, ["refs"], []));
    expect(onItems.mock.calls[0][0][0].refs).toEqual([]);
  });

  it("preserves sibling keys", () => {
    const { api, onItems } = setup({ items: [{ name: "first", note: "keep", refs: [] }] });
    act(() => api.updateItemAt(0, ["refs"], [1]));
    expect(onItems.mock.calls[0][0][0].note).toBe("keep");
  });
});

describe("removeItem", () => {
  it("drops the row", () => {
    const { api, onItems } = setup();
    act(() => api.removeItem(1));
    expect(onItems.mock.calls[0][0].map((i) => i.name)).toEqual(["first", "third"]);
  });

  it("shifts expanded keys DOWN past the removed row, and drops its own", () => {
    const { api, setExpanded } = setup();
    act(() => api.removeItem(1));
    expect(applyUpdater(setExpanded, { 0: true, 1: true, 2: true })).toEqual({
      0: true, 1: true,
    });
  });

  it("asks for confirmation when a handler is supplied, and does not write first", () => {
    const onShowConfirmation = vi.fn();
    const { api, onItems } = setup({ onShowConfirmation });
    act(() => api.removeItem(1));
    expect(onItems).not.toHaveBeenCalled();
    expect(onShowConfirmation).toHaveBeenCalledWith(
      "Remove second?", "This can't be undone.", expect.any(Function)
    );
    act(() => onShowConfirmation.mock.calls[0][2]());
    expect(onItems.mock.calls[0][0]).toHaveLength(2);
  });

  it("names an untitled row in the confirmation prompt", () => {
    const onShowConfirmation = vi.fn();
    const { api } = setup({ items: [{ note: "no title" }], onShowConfirmation });
    act(() => api.removeItem(0));
    expect(onShowConfirmation.mock.calls[0][0]).toBe("Remove Untitled entry?");
  });
});
