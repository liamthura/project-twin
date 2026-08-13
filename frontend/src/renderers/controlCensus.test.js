// @vitest-environment node
import { describe, expect, it } from "vitest";
import packs from "@/__fixtures__/packs.json";
import frozen from "@/__fixtures__/control-census-v1.json";
import { controlCensus } from "./controlCensus";

describe("the control census", () => {
  // DELETED with the shim: "chooses the same control from a descriptor as from
  // the v1 node it replaced". It walked `shim-parity.json` -- which held both
  // shapes of every shipped node side by side -- and compared the control each
  // field got from its v2 descriptor against the control it got from the v1
  // node's parallel arrays. Both the fixture and the v1 side are gone, so there
  // is nothing left to compare against; the frozen record below IS that
  // comparison, taken while both shapes still existed and agreed.
  //
  // That is the whole reason `control-census-v1.json` exists. The gate the shim
  // parity test replaced was a census of field NAMES, which could not see six
  // fields quietly stop being textareas.
  it("matches the frozen record for every pack", () => {
    for (const pack of packs) expect(controlCensus(pack)).toEqual(frozen[pack.key]);
  });

  it("puts every shipped field on a real control", () => {
    // A typo in `controlFor`'s chain would fall through to "text" for everything
    // and the frozen comparison above would still pass on a freshly-regenerated
    // fixture.
    // The shipped packs use six of the seven kinds; `bool` is absent because the
    // only boolean any pack declares is a pinned flag, which renders as the star
    // that claims the slot rather than as a switch.
    const seen = new Set(
      packs.flatMap((p) => Object.values(controlCensus(p)).flatMap((n) => Object.values(n)))
    );
    expect([...seen].sort()).toEqual([
      "array", "date", "enum", "enum+custom", "longtext", "text", "time",
    ]);
  });

  it("records goals' target_date as a picker and its why as long text", () => {
    // One spot-check written out by hand, so the fixture cannot be believed
    // purely because it agrees with the code that generated it. `why` is the
    // field that used to get its textarea from a name heuristic and now declares
    // `type: "longtext"`; `type` is the pack's only allow_custom enum.
    const goals = controlCensus(packs.find((p) => p.key === "goals"));
    expect(goals.goals).toEqual({
      title: "text",
      target_date: "date",
      why: "longtext",
      notes: "longtext",
      type: "enum+custom",
      status: "enum",
    });
  });
});
