import { describe, it, expect } from "vitest";
import packs from "@/__fixtures__/packs.json";
import { restoreChanges } from "./historyDiff";

const pack = (key) => packs.find((p) => p.key === key);

describe("restoreChanges", () => {
  it("says which entries come back, which go, and which fields change back", () => {
    const current = { goals: [
      { id: "goal_2", title: "Learn Portuguese", status: "paused", notes: "Twice a week", last_updated: "2026-09-01" },
      { id: "goal_3", title: "Run a half marathon", status: "active" },
    ] };
    const version = { goals: [
      { id: "goal_1", title: "Lead climb outdoors", status: "achieved" },
      { id: "goal_2", title: "Learn Portuguese", status: "active", notes: "Weekly", last_updated: "2026-03-01" },
    ] };
    expect(restoreChanges(pack("goals"), current, version)).toEqual([{
      title: "Goals",
      back: ["Lead climb outdoors"],
      removed: ["Run a half marathon"],
      changed: [{ name: "Learn Portuguese", fields: [
        { field: "Status", from: "paused", to: "active" },
        { field: "Notes", from: "Twice a week", to: "Weekly" },
      ] }],
    }]);
  });

  it("compares plain lists by item and forms by their own fields only", () => {
    const base = { hobbies: [], values: ["Honesty"], wellness: { sleep: { weekday: { bedtime: "23:00" } } } };
    const version = { ...base, values: ["Honesty", "Curiosity"], wellness: { sleep: { weekday: { bedtime: "22:30" } } } };
    expect(restoreChanges(pack("lifestyle"), base, version)).toEqual([
      { title: "Values", back: ["Curiosity"], removed: [], changed: [] },
      { title: "Sleep on weekdays", back: [], removed: [], changed: [
        { name: null, fields: [{ field: "Bedtime", from: "23:00", to: "22:30" }] },
      ] },
    ]);
    // Personal information sits at the root, beside every list in the section.
    const profileNow = { name: "Maya", education: [{ id: "e1", institution: "Leeds" }] };
    const profileThen = { name: "Maya Ellis", education: [{ id: "e1", institution: "Leeds" }] };
    expect(restoreChanges(pack("profile"), profileNow, profileThen)).toEqual([
      { title: "Personal information", back: [], removed: [], changed: [
        { name: null, fields: [{ field: "Name", from: "Maya", to: "Maya Ellis" }] },
      ] },
    ]);
  });

  it("finds nothing when the version matches, bookkeeping aside", () => {
    const now = { goals: [{ id: "g", title: "Ship", last_updated: "2026-09-01" }] };
    const then = { goals: [{ id: "g", title: "Ship", last_updated: "2026-01-01" }] };
    expect(restoreChanges(pack("goals"), now, then)).toEqual([]);
  });
});
