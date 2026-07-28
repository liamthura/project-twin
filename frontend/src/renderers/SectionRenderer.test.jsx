import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import packs from "@/__fixtures__/packs.json";
import goalsData from "@/__fixtures__/data/goals.json";
import mediaData from "@/__fixtures__/data/media.json";
import aestheticsData from "@/__fixtures__/data/aesthetics.json";
import { renderSection } from "@/test/harness";
import { SEGMENTED_MAX } from "@/components/controls";
import { normalizeUi } from "@/renderers/paths";

const goalsPack = packs.find((p) => p.key === "goals");
const mediaPack = packs.find((p) => p.key === "media");
const aestheticsPack = packs.find((p) => p.key === "aesthetics");

// The entity that owns a given ui list: either the one entity whose manifest
// `list` names it explicitly, or -- when a pack has exactly one entity and no
// `list` is given at all (goals) -- that sole entity by fallback. Mirrors
// normalizeUi's own entity resolution.
function entityFor(pack, listKey) {
  const names = Object.keys(pack.entities);
  const named = names.find((n) => pack.entities[n].list === listKey);
  if (named) return pack.entities[named];
  if (names.length === 1) return pack.entities[names[0]];
  throw new Error(`no entity maps to list "${listKey}" in pack "${pack.key}"`);
}

// The coverage guard and the round-trip guard, factored so every pack with a
// generic item list gets both without copying the test bodies. A ui block
// that omits a field would leave that field unreachable in the UI -- and
// therefore silently unsaveable -- which is the failure mode the whole
// consolidation has to avoid; a renderer that mutates its `data` prop or
// drops a field it doesn't model would corrupt or lose data on every edit.
//
// "covered" comes from the pack's own ui spec (badges + detail_fields), not a
// hand-copied list, so a renderer that stops wiring up a field fails this
// even if nobody updates the test.
function describeGuards({ pack, listKey, data }) {
  const node = normalizeUi(pack).sections.find((s) => s.path[0] === listKey);
  const entity = entityFor(pack, listKey);
  const arrayFields = node.array_fields || [];
  const covered = [...new Set([...(node.badges || []), ...(node.detail_fields || [])])];
  const item = data[listKey][0];

  function expectFieldOnScreen(field) {
    const value = item[field];
    if (value === undefined) return;
    const options = entity.valid_values?.[field];
    if (options) {
      // Enums render via EnumControl, not plain inputs, so getByDisplayValue
      // can't find them. EnumControl picks its control by option count:
      // <= SEGMENTED_MAX renders real <button>s whose aria-pressed reflects
      // binding; more than that renders a Radix combobox trigger whose
      // accessible name comes from a label (none here), not its content, so
      // it has to be matched by the text it displays instead. Either way
      // this is the strongest on-screen proof available that the control is
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
    } else if (arrayFields.includes(field)) {
      // ArrayInput renders each entry as a chip of its own text -- there's no
      // single input value to read, so presence of every entry's text is the
      // strongest available proof.
      for (const v of value) {
        expect(
          screen.getByText(v),
          `field "${field}" item "${v}" is not reachable in the UI`
        ).toBeInTheDocument();
      }
    } else {
      expect(
        screen.getByDisplayValue(value),
        `field "${field}" is not reachable in the UI`
      ).toBeInTheDocument();
    }
  }

  it(`exposes every detail field of an expanded item (${pack.key})`, async () => {
    const { user } = renderSection({ pack, initial: data });
    await user.click(screen.getByText(item[node.title_field]));
    for (const field of covered) expectFieldOnScreen(field);
  });

  // Catches drop-on-write: an edit that quietly discards fields the renderer
  // does not know about (badges/detail_fields don't cover every key -- id,
  // the title field itself, and any unmodeled field like `related` all have
  // to survive an edit untouched too).
  it(`preserves every other field when one is edited (${pack.key})`, async () => {
    const { user, latest, initial } = renderSection({ pack, initial: data });
    await user.click(screen.getByText(item[node.title_field]));

    const editableField = covered.find(
      (f) => !entity.valid_values?.[f] && !arrayFields.includes(f) && item[f]
    );
    const input = screen.getByDisplayValue(item[editableField]);
    await user.type(input, "X");

    const after = latest();
    // Built from the harness's pristine `initial`, not from the module-cached
    // fixture import -- see harness.jsx for why sharing that reference would
    // let an in-place mutation corrupt this expectation and pass.
    const expected = structuredClone(initial);
    expected[listKey][0][editableField] = item[editableField] + "X";
    expect(after).toEqual(expected);
  });
}

describe("SectionRenderer", () => {
  it("renders every item's title", () => {
    renderSection({ pack: goalsPack, initial: goalsData });
    expect(screen.getByText("Ship MyGist v3")).toBeInTheDocument();
    expect(screen.getByText("Learn Rust properly")).toBeInTheDocument();
  });

  describe("goals", () => {
    describeGuards({ pack: goalsPack, listKey: "goals", data: goalsData });
  });

  // Media and aesthetics are the only packs with array_fields, field_defaults
  // and suggestions -- these fixtures give FieldInput's ArrayInput branch and
  // the enum/dropdown split real coverage for the first time.
  describe("media", () => {
    describeGuards({ pack: mediaPack, listKey: "items", data: mediaData });
  });

  describe("aesthetics", () => {
    describeGuards({ pack: aestheticsPack, listKey: "styles", data: aestheticsData });
  });

  // A node kind other than "list" is unimplemented in this wave. It must not
  // throw (one bad node shouldn't blank an entire section) and must not fail
  // silently either -- a silently skipped node is how a migrated section
  // loses a whole list without anyone noticing. So it logs loudly (naming
  // both the offending kind and the pack key) while its sibling nodes still
  // render normally.
  describe("an unknown node kind", () => {
    it("logs an error naming the kind and pack key, and still renders sibling list nodes", () => {
      const pack = {
        key: "mixed",
        title: "Mixed",
        description: "",
        entities: { goal: { list: "goals" } },
        ui: {
          sections: [
            { kind: "fields", path: ["profile"] },
            { kind: "list", path: ["goals"], entity: "goal", title_field: "title" },
          ],
        },
      };
      const data = { profile: { name: "irrelevant" }, goals: [{ title: "Ship it" }] };

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      renderSection({ pack, initial: data });

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("fields"));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("mixed"));
      expect(screen.getByText("Ship it")).toBeInTheDocument();

      errorSpy.mockRestore();
    });
  });
});
