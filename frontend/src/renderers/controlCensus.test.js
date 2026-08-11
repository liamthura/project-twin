// @vitest-environment node
import { describe, expect, it } from "vitest";
import packs from "@/__fixtures__/packs.json";
import parity from "@/__fixtures__/shim-parity.json";
import frozen from "@/__fixtures__/control-census-v1.json";
import { controlCensus, controlFor, controlledFields } from "./controlCensus";
import { buildFieldMeta } from "./fieldMeta";
import { v1Shape } from "./v2Node";

describe("the control census", () => {
  // The gate that matters, and the one that has to run while `shim-parity.json`
  // still holds both shapes: the control a field gets from its v2 DESCRIPTOR
  // must be the control it got from the v1 node's parallel arrays. This is the
  // assertion whose absence let six textareas turn into one-line inputs -- the
  // frozen field-name census could not see it, because the name did not change.
  it("chooses the same control from a descriptor as from the v1 node it replaced", () => {
    const differences = [];
    for (const [key, pack] of Object.entries(parity)) {
      const entities = pack.entities;
      const walk = (v1Node, v2Node) => {
        if (v1Node.kind === "group") {
          (v1Node.sections ?? []).forEach((sub, i) =>
            walk(sub, (v2Node.sections ?? [])[i] ?? {})
          );
          return;
        }
        if (v1Node.kind !== "strings") {
          const before = buildFieldMeta(v1Node, entities[v1Node.entity]);
          const after = buildFieldMeta(v2Node, entities[v2Node.entity]);
          for (const field of controlledFields(v1Node)) {
            const was = controlFor(before, field);
            const now = controlFor(after, field);
            if (was !== now) {
              differences.push(`${key}/${v1Node.title ?? v1Node.path}: ${field} ${was} -> ${now}`);
            }
          }
        }
        (v1Node.children ?? []).forEach((child, i) =>
          walk(child, (v2Node.children ?? [])[i] ?? {})
        );
      };
      pack.v1.forEach((node, i) => walk(node, v1Shape(pack.v2[i])));
    }
    expect(differences).toEqual([]);
  });

  // ...and the half that survives the shim's deletion. Once `v2Node.js` and
  // `shim-parity.json` go, the v1 side no longer exists to compare against, so
  // the agreed-upon answer is frozen here instead. Regenerating this fixture is
  // how a deliberate control change gets recorded; doing it to make a red test
  // green is how the next regression ships.
  it("matches the frozen record for every pack", () => {
    for (const pack of packs) expect(controlCensus(pack)).toEqual(frozen[pack.key]);
  });

  it("puts every shipped field on a real control", () => {
    // A typo in `controlFor`'s chain would fall through to "text" for everything
    // and both tests above would still pass on a freshly-regenerated fixture.
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
