import { describe, it, expect } from "vitest";
import packs from "@/__fixtures__/packs.json";
import { SEARCH_LIMIT, searchPersona } from "./searchPersona";

const pick = (...keys) => packs.filter((p) => keys.includes(p.key));

describe("searchPersona", () => {
  const data = {
    goals: { goals: [{ id: "goal_1", title: "Lead climb outdoors", why: "Fear of heights" }] },
    lifestyle: {
      hobbies: [{ id: "hobby_1", name: "Bouldering", notes: "Climbing twice a week at the Depot" }],
      values: ["Curiosity", "Climbing honesty"],
      wellness: { sleep: { weekday: { bedtime: "23:00" } } },
    },
    profile: { name: "Maya Ellis", location: "Manchester, UK", education: [] },
  };

  it("finds list entries by any text, plain-list items, and form fields", () => {
    const { results } = searchPersona(pick("goals", "lifestyle", "profile"), data, "CLIMB");
    expect(results.map((r) => [r.place, r.title, r.snippet, r.entityId])).toEqual([
      ["Goals", "Lead climb outdoors", null, "goal_1"],
      ["Lifestyle › Hobbies & activities", "Bouldering", "Climbing twice a week at the Depot", "hobby_1"],
      ["Lifestyle › Values", "Climbing honesty", null, null],
    ]);
    // A plain list and a form are reached by their band, not by an entry id.
    expect(results[2].band).toBe("values");
    const [manchester] = searchPersona(pick("profile"), data, "manch").results;
    expect(manchester).toMatchObject({ place: "Profile › Personal information", title: "Location: Manchester, UK", band: "personal-information" });
  });

  it("shows the match in a snippet when a long field's title is cut before it", () => {
    const bio = "Marketing assistant at a small design studio in Manchester. I write most of the monthly newsletter.";
    const [hit] = searchPersona(pick("profile"), { profile: { bio } }, "newsletter").results;
    expect(hit.title).toMatch(/…$/);
    expect(hit.title).not.toMatch(/newsletter/);
    expect(hit.snippet).toMatch(/monthly newsletter/);
    // Both cut at a space, never through a word.
    expect(hit.title).toBe("Bio: Marketing assistant at a small design studio in Manchester. I write most of the…");
    expect(hit.snippet).toBe("…I write most of the monthly newsletter.");
  });

  it("stays quiet under two characters, and caps what it returns", () => {
    expect(searchPersona(packs, data, "c").results).toEqual([]);
    const many = { goals: { goals: Array.from({ length: 40 }, (_, i) => ({ id: `g${i}`, title: `Goal ${i}` })) } };
    const { results, truncated } = searchPersona(pick("goals"), many, "goal");
    expect(results).toHaveLength(SEARCH_LIMIT);
    expect(truncated).toBe(true);
  });
});
