import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import packs from "@/__fixtures__/packs.json";
import goalsData from "@/__fixtures__/data/goals.json";
import { renderSection } from "@/test/harness";
import { SEGMENTED_MAX } from "@/components/controls";

const goalsPack = packs.find((p) => p.key === "goals");
const goalEntity = goalsPack.entities.goal;

describe("GenericSectionEditor", () => {
  it("renders every item's title", () => {
    renderSection({ pack: goalsPack, initial: goalsData });
    expect(screen.getByText("Ship MyGist v3")).toBeInTheDocument();
    expect(screen.getByText("Learn Rust properly")).toBeInTheDocument();
  });

  // The coverage guard. A ui block that omits a field would leave that field
  // unreachable in the UI -- and therefore silently unsaveable -- which is the
  // failure mode the whole consolidation has to avoid. Derived from the
  // pack's own ui spec (badges + detail_fields), not a hand-copied list, so a
  // renderer that stops wiring up a field fails this even if nobody updates
  // the test.
  it("exposes every detail field of an expanded item", async () => {
    const { user } = renderSection({ pack: goalsPack, initial: goalsData });
    await user.click(screen.getByText("Ship MyGist v3"));

    const goal = goalsData.goals[0];
    const uiSpec = goalsPack.ui.goals;
    const covered = [...new Set([...(uiSpec.badges || []), ...(uiSpec.detail_fields || [])])];

    for (const field of covered) {
      const value = goal[field];
      const options = goalEntity.valid_values?.[field];
      if (options) {
        // type/status are enums rendered by EnumControl, not plain inputs, so
        // getByDisplayValue can't find them. EnumControl picks its control by
        // option count: <= SEGMENTED_MAX renders real <button>s whose
        // aria-pressed reflects binding (status, 4 options); more than that
        // renders a Radix combobox trigger whose accessible name comes from
        // its label (none here), not its content, so it has to be matched by
        // the text it displays instead (type, 7 options). Either way this is
        // the strongest on-screen proof available that the control is
        // present and bound to the item's current value.
        const display = String(value).replace(/_/g, " ");
        if (options.length > SEGMENTED_MAX) {
          const combo = screen
            .getAllByRole("combobox")
            .find((el) => el.textContent === display);
          expect(combo, `field "${field}" is not bound to "${value}" in the UI`).toBeTruthy();
        } else {
          expect(
            screen.getByRole("button", { name: display, pressed: true }),
            `field "${field}" is not reachable in the UI`
          ).toBeInTheDocument();
        }
      } else {
        expect(
          screen.getByDisplayValue(value),
          `field "${field}" is not reachable in the UI`
        ).toBeInTheDocument();
      }
    }
  });

  // The round-trip guard. Catches drop-on-write: an edit that quietly discards
  // fields the renderer does not know about.
  it("preserves every other field when one is edited", async () => {
    const { user, latest, initial } = renderSection({ pack: goalsPack, initial: goalsData });
    await user.click(screen.getByText("Ship MyGist v3"));

    const input = screen.getByDisplayValue(goalsData.goals[0].target_date);
    await user.type(input, "X");

    const after = latest();
    // Built from the harness's pristine `initial`, not from the module-cached
    // `goalsData` import -- see harness.jsx for why sharing that reference
    // would let an in-place mutation corrupt this expectation and pass.
    const expected = structuredClone(initial);
    expected.goals[0].target_date = goalsData.goals[0].target_date + "X";
    expect(after).toEqual(expected);
  });
});
