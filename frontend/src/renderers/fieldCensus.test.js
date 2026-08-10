// @vitest-environment node
import { describe, expect, it } from "vitest";
import packs from "@/__fixtures__/packs.json";
import frozen from "@/__fixtures__/field-census-v1.json";
import { fieldCensus } from "./fieldCensus";

describe("the rendered-field census", () => {
  it("matches the frozen record for every pack", () => {
    for (const pack of packs) expect(fieldCensus(pack)).toEqual(frozen[pack.key]);
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
