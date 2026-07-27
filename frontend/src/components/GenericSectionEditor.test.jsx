import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import packs from "@/__fixtures__/packs.json";
import goalsData from "@/__fixtures__/data/goals.json";
import { renderSection } from "@/test/harness";

const goalsPack = packs.find((p) => p.key === "goals");

describe("GenericSectionEditor", () => {
  it("renders every item's title", () => {
    renderSection({ pack: goalsPack, initial: goalsData });
    expect(screen.getByText("Ship MyGist v3")).toBeInTheDocument();
    expect(screen.getByText("Learn Rust properly")).toBeInTheDocument();
  });

  // The coverage guard. A ui block that omits a field would leave that field
  // unreachable in the UI -- and therefore silently unsaveable -- which is the
  // failure mode the whole consolidation has to avoid.
  it("exposes every detail field of an expanded item", async () => {
    const { user } = renderSection({ pack: goalsPack, initial: goalsData });
    await user.click(screen.getByText("Ship MyGist v3"));

    const goal = goalsData.goals[0];
    for (const field of ["target_date", "why", "notes"]) {
      expect(
        screen.getByDisplayValue(goal[field]),
        `field "${field}" is not reachable in the UI`
      ).toBeInTheDocument();
    }
  });

  // The round-trip guard. Catches drop-on-write: an edit that quietly discards
  // fields the renderer does not know about.
  it("preserves every other field when one is edited", async () => {
    const { user, latest } = renderSection({ pack: goalsPack, initial: goalsData });
    await user.click(screen.getByText("Ship MyGist v3"));

    const input = screen.getByDisplayValue(goalsData.goals[0].target_date);
    await user.type(input, "X");

    const after = latest();
    const expected = structuredClone(goalsData);
    expected.goals[0].target_date = goalsData.goals[0].target_date + "X";
    expect(after).toEqual(expected);
  });
});
