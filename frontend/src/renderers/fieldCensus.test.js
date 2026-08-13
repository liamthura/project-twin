// @vitest-environment node
import { describe, expect, it } from "vitest";
import packs from "@/__fixtures__/packs.json";
import frozen from "@/__fixtures__/field-census-v1.json";
import { fieldCensus } from "./fieldCensus";

// The one node where format v2 changes what renders, and the only reason this
// comparison is not exact. profile/Education asked for two orders a single field
// list cannot both hold -- its blocks stack Highlights above Coursework, its
// count chips read Coursework then Highlights -- so the blocks won and the two
// chips swapped. See `_ORDER_CONFLICTS` in backend/tools/manifest_v1_to_v2.py.
// Order is compared everywhere else, including in this node's other six fields.
const CHIPS_SWAPPED = { profile: "Education" };

const normalise = (key, census) => {
  const node = CHIPS_SWAPPED[key];
  if (!node || !census[node]) return census;
  return { ...census, [node]: [...census[node]].sort() };
};

describe("the rendered-field census", () => {
  it("matches the frozen record for every pack", () => {
    for (const pack of packs) {
      expect(normalise(pack.key, fieldCensus(pack))).toEqual(
        normalise(pack.key, frozen[pack.key])
      );
    }
  });

  it("swaps Education's two count chips and nothing else", () => {
    // Asserted outright rather than only tolerated above, so the difference is
    // recorded rather than hidden by the normalising.
    const profile = packs.find((p) => p.key === "profile");
    expect(fieldCensus(profile).Education).toEqual([
      "institution", "degree_level", "field_of_study", "start_year", "end_year",
      "status", "highlights", "coursework",
    ]);
  });

  it("does not list a field that renders nowhere", () => {
    // The MCP-only names. If any appears here, the census itself is wrong and
    // would bless a regression rather than catch it.
    const all = packs.flatMap((p) => Object.values(fieldCensus(p)).flat());
    for (const name of ["conversation_metadata", "related_entries", "day_type",
                        "new_topic", "new_label", "ref_name", "course", "custom_type"]) {
      expect(all).not.toContain(name);
    }
  });
});
