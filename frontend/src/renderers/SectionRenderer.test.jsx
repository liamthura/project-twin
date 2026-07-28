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
  // Resolved exactly as ListRenderer resolves it -- via node.entity, which
  // SectionRenderer sets from `pack.entities?.[node.entity]` -- not by
  // re-deriving it from legacy list-matching rules. Those rules live inside
  // normalizeUi already; re-implementing them here made this guard
  // consistent with ListRenderer only by coincidence.
  const entity = pack.entities?.[node.entity];
  const arrayFields = node.array_fields || [];
  const covered = [...new Set([...(node.badges || []), ...(node.detail_fields || [])])];
  const item = data[listKey][0];

  function expectFieldOnScreen(field) {
    const value = item[field];
    if (value === undefined) return;
    // Same precedence ListRenderer gives an inline node.enum over the
    // entity's valid_values -- a plain `entity.valid_values?.[field]` read
    // would classify a wave-3 node's inline enum as a plain input.
    const options = (node.enum ?? entity?.valid_values)?.[field];
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

  // node.title is accepted by the schema but wasn't rendered anywhere.
  // Wave 5's `lifestyle` packs four lists into one section with nothing to
  // tell them apart, so a node-level heading is needed above each list's
  // own content -- distinct from the section's own pack.title (Card
  // heading), which must keep rendering unchanged for packs (all three
  // today) that declare no node.title.
  describe("node.title", () => {
    const pack = {
      key: "lifestyle_like",
      title: "Lifestyle",
      description: "",
      entities: { goal: { list: "goals" } },
      ui: {
        sections: [
          { kind: "list", path: ["goals"], entity: "goal", title: "Goals", title_field: "title" },
        ],
      },
    };
    const data = { goals: [{ title: "Ship it" }] };

    it("renders node.title as a heading above the section's content when present", () => {
      renderSection({ pack, initial: data });
      expect(screen.getByRole("heading", { name: "Goals" })).toBeInTheDocument();
      // The Card/pack.title heading still renders alongside it.
      expect(screen.getByRole("heading", { name: "Lifestyle" })).toBeInTheDocument();
    });

    it("adds no extra heading when node.title is absent, as with today's three generic packs", () => {
      renderSection({ pack: goalsPack, initial: goalsData });
      // Only the Card's pack.title heading exists -- no node-level heading.
      expect(screen.getAllByRole("heading")).toHaveLength(1);
    });
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

    it("does not throw when an unsupported-kind node has a malformed path, because the kind guard runs first", () => {
      // Before the fix, `node.path.join(".")` computed the React key before
      // the kind check ran, so a node like this one (no `path` at all)
      // threw on the very first render -- guard or no guard.
      const pack = {
        key: "mixed2",
        title: "Mixed2",
        description: "",
        entities: { goal: { list: "goals" } },
        ui: {
          sections: [
            { kind: "fields" },
            { kind: "list", path: ["goals"], entity: "goal", title_field: "title" },
          ],
        },
      };
      const data = { goals: [{ title: "Ship it" }] };

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => renderSection({ pack, initial: data })).not.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("fields"));
      expect(screen.getByText("Ship it")).toBeInTheDocument();

      errorSpy.mockRestore();
    });
  });

  // Byte-parity with the old component: a non-array found where a list is
  // expected renders as an empty list rather than crashing. But it is the
  // exact silent-data-loss failure the spec names, so unlike a plain
  // coercion it must log loudly, naming the pack key and the path, rather
  // than disappearing without a trace.
  describe("a non-array value at a list node's path", () => {
    const pack = {
      key: "corrupted",
      title: "Corrupted",
      description: "",
      entities: { goal: { list: "goals" } },
      ui: {
        sections: [{ kind: "list", path: ["goals"], entity: "goal", title_field: "title" }],
      },
    };
    const data = { goals: "not a list" };

    it("logs an error naming the pack key and path, and renders as an empty list", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      renderSection({ pack, initial: data });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("corrupted")
      );
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("goals"));
      expect(screen.getByText("Nothing here yet. Use Add, or tap a suggestion.")).toBeInTheDocument();

      errorSpy.mockRestore();
    });

    it("does not log when the path is simply absent (undefined) -- that's a fresh, unpopulated section, not corruption", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      renderSection({ pack, initial: {} });

      expect(errorSpy).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });
  });
});
