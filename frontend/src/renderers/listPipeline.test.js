// @vitest-environment node
//
// listPipeline.js is pure sort/filter logic and imports nothing, so the jsdom
// environment every other file needs is dead weight here. See paths.test.js for
// the measurement.
import { describe, it, expect } from "vitest";
import { buildOrder, filterVisible, applyFacets } from "./listPipeline";

describe("buildOrder", () => {
  it("returns stored indexes in original order when no sort is declared", () => {
    const items = [{ name: "c" }, { name: "a" }, { name: "b" }];
    expect(buildOrder(items, undefined)).toEqual([0, 1, 2]);
  });

  it("returns stored indexes in original order when sort has no field", () => {
    const items = [{ name: "c" }, { name: "a" }, { name: "b" }];
    expect(buildOrder(items, { dir: "desc" })).toEqual([0, 1, 2]);
  });

  it("sorts ascending by default and reverses under dir: desc", () => {
    const items = [{ name: "b" }, { name: "a" }, { name: "c" }];
    expect(buildOrder(items, { field: "name" })).toEqual([1, 0, 2]);
    expect(buildOrder(items, { field: "name", dir: "desc" })).toEqual([2, 0, 1]);
  });

  it("compares two real numbers numerically, not lexicographically", () => {
    // Lexicographic comparison of "2" and "10" would put 10 first; numeric
    // comparison must not.
    const items = [{ n: 10 }, { n: 2 }, { n: 1 }];
    expect(buildOrder(items, { field: "n" })).toEqual([2, 1, 0]);
  });

  it("compares numeric-looking strings as text, not numbers", () => {
    // JSON gives no signal a string was meant as a number, so "10" sorts
    // before "2" here -- the opposite of the numeric-type case above.
    const items = [{ n: "2" }, { n: "10" }];
    expect(buildOrder(items, { field: "n" })).toEqual([1, 0]);
  });

  it("sorts a missing key and an empty-string key last, in both directions", () => {
    const items = [
      { name: "" },        // 0: blank
      { name: "b" },        // 1
      {},                   // 2: missing
      { name: "a" },        // 3
    ];
    expect(buildOrder(items, { field: "name", dir: "asc" })).toEqual([3, 1, 0, 2]);
    expect(buildOrder(items, { field: "name", dir: "desc" })).toEqual([1, 3, 0, 2]);
  });

  it("keeps stored order among ties (stable sort)", () => {
    // Three items share the same sort key; a non-stable sort could permute
    // them arbitrarily. They must come back in their original relative order,
    // distinguishable here by the tag field which the comparator never reads.
    const items = [
      { pri: 1, tag: "first" },
      { pri: 1, tag: "second" },
      { pri: 1, tag: "third" },
    ];
    const order = buildOrder(items, { field: "pri" });
    expect(order).toEqual([0, 1, 2]);
    expect(order.map((i) => items[i].tag)).toEqual(["first", "second", "third"]);
  });
});

describe("filterVisible", () => {
  const items = [
    { name: "Ada Lovelace", role: "engineer", tags: ["Math", "Pioneer"] },
    { name: "Grace Hopper", role: "admiral", tags: ["Navy", "Compiler"] },
    { name: "Alan Turing", role: "mathematician", tags: ["Codebreaking"] },
  ];
  const fields = ["name", "role", "tags"];

  it("returns the order unchanged for an empty query", () => {
    const order = [2, 0, 1];
    expect(filterVisible(order, items, "", fields)).toBe(order);
  });

  it("matches the title field case-insensitively", () => {
    expect(filterVisible([0, 1, 2], items, "grace", fields)).toEqual([1]);
  });

  it("matches a detail field case-insensitively", () => {
    expect(filterVisible([0, 1, 2], items, "admiral", fields)).toEqual([1]);
  });

  it("matches array entries elementwise, case-insensitively", () => {
    expect(filterVisible([0, 1, 2], items, "compiler", fields)).toEqual([1]);
  });

  it("matches a badge field case-insensitively", () => {
    const badgeItems = [
      { name: "one", stance: "Like" },
      { name: "two", stance: "dislike" },
    ];
    expect(filterVisible([0, 1], badgeItems, "like", ["name", "stance"])).toEqual([0, 1]);
    expect(filterVisible([0, 1], badgeItems, "dislike", ["name", "stance"])).toEqual([1]);
  });

  it("returns stored indexes, not positions in a reordered `order`", () => {
    // Alphabetically by name: "Ada Lovelace" (0), "Alan Turing" (2), "Grace
    // Hopper" (1) -- so the incoming order is display-sorted, not identity.
    // The match for "grace" sits at position 2 of that order but must be
    // reported as stored index 1, not the position it was found at.
    const sortedOrder = buildOrder(items, { field: "name" });
    expect(sortedOrder).toEqual([0, 2, 1]);
    expect(filterVisible(sortedOrder, items, "grace", fields)).toEqual([1]);
  });
});

describe("applyFacets", () => {
  const items = [
    { name: "Alpha", status: "active", priority: "high" },
    { name: "Beta", status: "idea", priority: "low" },
    { name: "Gamma", status: "active", priority: "low" },
  ];

  it("returns the order unchanged when the node declares no facets", () => {
    const order = [2, 0, 1];
    expect(applyFacets(order, items, undefined, {})).toBe(order);
    expect(applyFacets(order, items, [], {})).toBe(order);
  });

  it("returns the order unchanged when every facet is unselected (the 'All' state)", () => {
    const order = [0, 1, 2];
    expect(applyFacets(order, items, ["status"], {})).toEqual(order);
    expect(applyFacets(order, items, ["status"], { status: undefined })).toEqual(order);
  });

  it("narrows to rows matching the one selected facet value", () => {
    expect(applyFacets([0, 1, 2], items, ["status"], { status: "active" })).toEqual([0, 2]);
  });

  it("composes multiple active facets as AND, not OR", () => {
    expect(
      applyFacets([0, 1, 2], items, ["status", "priority"], {
        status: "active",
        priority: "low",
      })
    ).toEqual([2]);
  });

  it("returns stored indexes, not positions in a reordered `order`", () => {
    // Alphabetical order puts Alpha(0), Beta(1), Gamma(2) already sorted, so
    // build a case where the incoming order is NOT identity: descending by
    // name is Gamma(2), Beta(1), Alpha(0).
    const order = buildOrder(items, { field: "name", dir: "desc" });
    expect(order).toEqual([2, 1, 0]);
    expect(applyFacets(order, items, ["status"], { status: "active" })).toEqual([2, 0]);
  });

  it("a row whose stored value matches no option in the current set (a legacy value) matches only the 'All' state", () => {
    const withLegacy = [...items, { name: "Delta", status: "retired", priority: "low" }];
    // Legacy row (index 3) is excluded once a real facet value is selected...
    expect(applyFacets([0, 1, 2, 3], withLegacy, ["status"], { status: "active" })).toEqual([0, 2]);
    // ...but present under "All".
    expect(applyFacets([0, 1, 2, 3], withLegacy, ["status"], {})).toEqual([0, 1, 2, 3]);
  });

  it("composes with a prior search filter, since it is applied over that filter's output", () => {
    const searched = filterVisible([0, 1, 2], items, "a", ["name"]);
    expect(searched).toEqual([0, 1, 2]); // every name contains "a"
    expect(applyFacets(searched, items, ["status"], { status: "active" })).toEqual([0, 2]);
  });
});
