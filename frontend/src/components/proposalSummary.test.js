import { describe, it, expect } from "vitest";
import { proposalSummary } from "./proposalSummary";
import packs from "@/__fixtures__/packs.json";

const PACKS = [
  {
    key: "lifestyle",
    entities: {
      hobby: {
        actions: ["add"], required: ["name"], optional: ["notes"], identifier: "name",
      },
      hobby_specific: {
        actions: ["add"], required: ["hobby_name", "specific"],
        identifier: "specific", parent: "hobby_name",
      },
    },
  },
  {
    key: "profile",
    entities: {
      preference: {
        actions: ["add", "update"], required: ["key"],
        optional: ["category", "value"], identifier: "key",
      },
      work_experience: {
        actions: ["add", "update"], identifier: "company",
        required: ["company", "role", "type", "period"], optional: ["location"],
      },
    },
  },
];

const row = (entity, data) => ({ id: "x", kind: "entity", action: "add", entity, data });

describe("proposalSummary", () => {
  it("shows just the identifier when nothing else carries a value", () => {
    expect(proposalSummary(row("hobby", { name: "bouldering" }), PACKS))
      .toEqual({ lead: "bouldering", trail: "", extra: 0 });
  });

  it("arrows the identifier to the one other field that has a value", () => {
    expect(proposalSummary(row("preference", { key: "tone", value: "direct" }), PACKS))
      .toEqual({ lead: "tone", trail: "direct", extra: 0 });
  });

  it("puts the parent first, because the parent is the context", () => {
    // Checked before the single-other-field rule on purpose. That rule alone
    // would render `bouldering -> climbing`, backwards.
    expect(proposalSummary(
      row("hobby_specific", { hobby_name: "climbing", specific: "bouldering" }), PACKS))
      .toEqual({ lead: "climbing", trail: "bouldering", extra: 0 });
  });

  it("counts what it cannot show when several fields carry values", () => {
    expect(proposalSummary(row("work_experience", {
      company: "Acme", role: "lead", type: "full-time", period: "2021-2024",
    }), PACKS)).toEqual({ lead: "Acme", trail: "", extra: 3 });
  });

  it("ignores fields that are present but empty", () => {
    expect(proposalSummary(row("preference", { key: "tone", value: "", category: null }), PACKS))
      .toEqual({ lead: "tone", trail: "", extra: 0 });
  });

  it("falls back to the first value when the entity resolves to no pack", () => {
    // A disabled pack, a renamed entity, a proposal left over from an older
    // schema. A blank row would look broken, and it is still approvable.
    expect(proposalSummary(row("domain", { name: "Datadog", level: "advanced" }), PACKS))
      .toEqual({ lead: "Datadog", trail: "", extra: 1 });
  });

  it("reads snake_case values as words", () => {
    expect(proposalSummary(row("preference", { key: "detail_level", value: "high" }), PACKS))
      .toEqual({ lead: "detail level", trail: "high", extra: 0 });
  });

  it("survives a row with no data at all", () => {
    expect(proposalSummary({ entity: "hobby", data: {} }, PACKS))
      .toEqual({ lead: "", trail: "", extra: 0 });
  });
});

describe("proposalSummary against every shipped entity", () => {
  const specs = packs.flatMap((p) =>
    Object.entries(p.entities || {}).map(([name, spec]) => [name, spec]),
  );

  it("has entities to check", () => {
    expect(specs.length).toBeGreaterThan(30);
  });

  it.each(specs)("summarises %s without throwing", (name, spec) => {
    if (!spec.identifier) return;
    const data = {};
    for (const f of spec.required || []) data[f] = `${f}-value`;
    const out = proposalSummary({ entity: name, data }, packs);
    expect(typeof out.lead).toBe("string");
    expect(out.lead).not.toBe("");
    expect(out.extra).toBeGreaterThanOrEqual(0);
  });

  it("reaches all three branches with real entities", () => {
    const reached = new Set();
    for (const [name, spec] of specs) {
      if (!spec.identifier) continue;
      const data = {};
      for (const f of spec.required || []) data[f] = `${f}-value`;
      const { trail, extra } = proposalSummary({ entity: name, data }, packs);
      if (spec.parent) reached.add("parent");
      else if (trail) reached.add("single-other");
      else if (extra > 0) reached.add("counted");
      else reached.add("identifier-only");
    }
    expect(reached).toContain("parent");
    expect(reached).toContain("single-other");
    expect(reached).toContain("counted");
    expect(reached).toContain("identifier-only");
  });
});
