import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import SectionRenderer from "@/renderers/SectionRenderer";
import packs from "@/__fixtures__/packs.json";
import goalsData from "@/__fixtures__/data/goals.json";
import mediaData from "@/__fixtures__/data/media.json";
import aestheticsData from "@/__fixtures__/data/aesthetics.json";
import learningLogData from "@/__fixtures__/data/learning_log.json";
import circleData from "@/__fixtures__/data/circle.json";
import projectsData from "@/__fixtures__/data/projects.json";
import { renderSection } from "@/test/harness";
import { SEGMENTED_MAX } from "@/components/controls";
import { normalizeUi } from "@/renderers/paths";

const goalsPack = packs.find((p) => p.key === "goals");
const mediaPack = packs.find((p) => p.key === "media");
const aestheticsPack = packs.find((p) => p.key === "aesthetics");
const learningLogPack = packs.find((p) => p.key === "learning_log");
const circlePack = packs.find((p) => p.key === "circle");
const projectsPack = packs.find((p) => p.key === "projects");

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

    // Pick a field that is genuinely a free-text input, using the same
    // precedence ListRenderer does. Reading entity.valid_values directly would
    // miss a node's inline enum, and a date field renders as
    // <input type="date">, which ignores typed characters -- either would make
    // the edit below a silent no-op and turn this guard into a coin flip.
    const dateFields = node.date_fields || [];
    const editableField = covered.find(
      (f) =>
        !(node.enum ?? entity?.valid_values)?.[f] &&
        !arrayFields.includes(f) &&
        !dateFields.includes(f) &&
        item[f]
    );
    if (!editableField) {
      throw new Error(
        `no free-text field to edit in ${pack.key}; this guard cannot run`
      );
    }
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

  describe("learning_log", () => {
    describeGuards({ pack: learningLogPack, listKey: "entries", data: learningLogData });

    it("renders newest first even though the stored array is oldest first", () => {
      renderSection({ pack: learningLogPack, initial: learningLogData });
      const rows = screen.getAllByText(/React Server Components|Postgres full-text search/);
      expect(rows.map((r) => r.textContent)).toEqual([
        "Postgres full-text search",
        "React Server Components",
      ]);
    });

    // `expanded` is keyed per row (ListRenderer.jsx), so expanding one entry
    // does not reveal another's fields. The brief's version of this test
    // clicked "React Server Components" (entry 1) but then looked for
    // entry 2's source value ("article") -- an element that is never on
    // screen because entry 2 was never expanded, so it fails to locate the
    // input regardless of whether preservation actually works.
    //
    // The name promises entry 1's own unmodelled fields survive an edit to
    // entry 1, so the edit has to land on entry 1: expand it and type into
    // its own source value ("conversation", unique on screen -- entry 2's is
    // "article"). Editing a sibling instead (as an earlier version of this
    // test did) only proves cross-item isolation, which is a real property
    // but not the one this test's name claims, and it would stay green even
    // if the renderer dropped conversation_metadata from the entry actually
    // being edited.
    it("preserves its own id, timestamp, related_entries and conversation_metadata when a different field is edited", async () => {
      const { user, latest, initial } = renderSection({
        pack: learningLogPack, initial: learningLogData,
      });
      await user.click(screen.getByText("React Server Components"));
      await user.type(screen.getByDisplayValue("conversation"), "s");

      const after = latest();
      const entry = after.entries.find((e) => e.id === "learn_20260115_a1b2c3");
      const before = initial.entries.find((e) => e.id === "learn_20260115_a1b2c3");
      expect(entry.source).toBe("conversations");
      expect(entry.timestamp).toBe(before.timestamp);
      expect(entry.related_entries).toEqual(before.related_entries);
      expect(entry.conversation_metadata).toEqual(before.conversation_metadata);
    });

    it("shows each entry's timestamp, the field it is sorted by", () => {
      renderSection({ pack: learningLogPack, initial: learningLogData });
      for (const entry of learningLogData.entries) {
        const d = new Date(entry.timestamp);
        const p = (n) => String(n).padStart(2, "0");
        const shown =
          `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
          `${p(d.getHours())}:${p(d.getMinutes())}`;
        expect(screen.getByText(shown)).toBeInTheDocument();
      }
    });

    it("lets the title field be corrected in place, without a delete and re-add", async () => {
      const { user, latest, initial } = renderSection({
        pack: learningLogPack, initial: learningLogData,
      });
      await user.click(screen.getByText("React Server Components"));
      const input = screen.getByDisplayValue("React Server Components");
      await user.type(input, "!");

      const after = latest();
      const expected = structuredClone(initial);
      expected.entries[0].topic = "React Server Components!";
      expect(after).toEqual(expected);
      // The id must survive -- it is what related links point at.
      expect(after.entries[0].id).toBe(initial.entries[0].id);
    });
  });

  describe("circle", () => {
    describeGuards({ pack: circlePack, listKey: "connections", data: circleData });

    it("offers the info dialog carried by the manifest", async () => {
      const { user } = renderSection({ pack: circlePack, initial: circleData });
      await user.click(screen.getByRole("button", { name: /about this section/i }));
      expect(screen.getByText(/Track the important people/)).toBeInTheDocument();
      expect(screen.getByText(/The person's full name/)).toBeInTheDocument();
    });

    // The brief's version of this test rendered the section unexpanded and
    // checked for the text "contact" -- but detail_fields (where a mistaken
    // "contact" entry would land) only render once an item is expanded, so
    // that version would pass identically whether or not the manifest
    // declared `contact` as a detail field. It cannot tell correct from
    // broken. Expanding the item first makes it a real guard: with `contact`
    // wrongly included, a "Contact" label (rendered via
    // `f.replace(/_/g, " ")` + CSS `capitalize`, so its DOM text is lowercase
    // "contact") would appear here and fail this assertion.
    it("does not expose `contact`, which is an MCP alias for name and not a stored key", async () => {
      const { user } = renderSection({ pack: circlePack, initial: circleData });
      await user.click(screen.getByText(circleData.connections[0].name));
      expect(screen.queryByText(/^contact$/i)).not.toBeInTheDocument();
    });

    it("lets the title field be corrected in place, without a delete and re-add", async () => {
      const { user, latest, initial } = renderSection({ pack: circlePack, initial: circleData });
      await user.click(screen.getByText("Ada Lovelace"));
      const input = screen.getByDisplayValue("Ada Lovelace");
      await user.type(input, "!");

      const after = latest();
      const expected = structuredClone(initial);
      expected.connections[0].name = "Ada Lovelace!";
      expect(after).toEqual(expected);
      // The id must survive -- it is what related links point at.
      expect(after.connections[0].id).toBe(initial.connections[0].id);
    });
  });

  // -------------------------------------------------------------------------
  // projects (wave 4, Task 5)
  //
  // Two lists in one section, and the first one carries a nested child list.
  // Both facts change how selectors have to be written here:
  //
  //   - `Add` and `Search` exist once per list node, and a third `Add` appears
  //     inside an expanded project row (the References child). None of the
  //     three accessible names is namespaced by level, so anything selecting
  //     one of them scopes by block first -- see `topOfMindBlock` below.
  //   - Both list nodes declare `info`, and this is the first section in the
  //     repo with two. ListRenderer names each info button after its node's
  //     `title`, so they are selectable by name rather than by DOM order --
  //     "About Top of Mind" for the titled node, and the generic "About this
  //     section" for the projects node, which deliberately has no title
  //     (the Card header already reads "Projects").
  //   - Child rows and detail controls only exist once a row is EXPANDED, so
  //     every assertion about them clicks the row first.
  // -------------------------------------------------------------------------
  describe("projects", () => {
    // describeGuards names its tests after the PACK, so running it twice for
    // one pack would produce two identically-named cases and a failure report
    // that cannot say which list broke. Nesting each call under the list key
    // is what keeps them tellable apart.
    describe("projects list", () => {
      describeGuards({ pack: projectsPack, listKey: "projects", data: projectsData });
    });
    describe("top_of_mind list", () => {
      describeGuards({ pack: projectsPack, listKey: "top_of_mind", data: projectsData });
    });

    // The wrapper SectionRenderer draws around a node that declares a
    // `title`: <div><h3>Top of Mind</h3>{list}</div>. Located by the heading
    // rather than by DOM position so it survives a reordering of sections.
    const topOfMindBlock = () => screen.getByText("Top of Mind").parentElement;

    // ---- the top_of_mind trap: stored key is `idea`, manifest says `item` ---

    it("renders each top-of-mind entry's `idea`, the key server.py actually stores", () => {
      renderSection({ pack: projectsPack, initial: projectsData });
      for (const entry of projectsData.top_of_mind) {
        expect(screen.getByText(entry.idea)).toBeInTheDocument();
      }
    });

    // The read-side test above only proves existing rows render. This is the
    // write side, and it is the half that loses data: `execute_modify`
    // dedupes top_of_mind on `idea` (server.py's get_idea_text), so an entry
    // written under `item` is invisible to the dedupe and the same idea can
    // be added without limit. A ui block with title_field "item" passes
    // nothing here -- the new entry would be {item: ...} and both assertions
    // below fail.
    it("writes a new entry under `idea`, the key execute_modify dedupes on -- never the manifest's `item`", async () => {
      const { user, latest, initial } = renderSection({
        pack: projectsPack, initial: projectsData,
      });
      await user.click(within(topOfMindBlock()).getByRole("button", { name: "Add" }));

      const dialog = screen.getByRole("dialog");
      await user.type(within(dialog).getAllByRole("textbox")[0], "Sketch a CLI");
      await user.click(within(dialog).getByRole("button", { name: "Add" }));

      const after = latest();
      // addItem prepends, so the new entry is at index 0.
      expect(after.top_of_mind[0]).toEqual({ idea: "Sketch a CLI" });
      expect(after.top_of_mind[0]).not.toHaveProperty("item");
      // Everything else in the section is untouched.
      expect(after.top_of_mind.slice(1)).toEqual(initial.top_of_mind);
      expect(after.projects).toEqual(initial.projects);
    });

    // Mirrors circle's `contact` guard. `item` would land as a detail-field
    // Label, whose DOM text is the lowercase storage key (CSS capitalizes
    // it), and those only render once the row is expanded -- asserting on a
    // collapsed list would pass whether or not the manifest named `item`.
    it("exposes no control for `item`, which is an MCP input alias and not a stored key", async () => {
      const { user } = renderSection({ pack: projectsPack, initial: projectsData });
      await user.click(screen.getByText(projectsData.top_of_mind[0].idea));
      // Proof the row really expanded.
      expect(
        screen.getByDisplayValue(projectsData.top_of_mind[0].note)
      ).toBeInTheDocument();
      expect(screen.queryByText(/^item$/i)).not.toBeInTheDocument();
    });

    // ---- the references child list ----

    it("round-trips an edit to a `references` child, preserving every other key on the project", async () => {
      const { user, latest, initial } = renderSection({
        pack: projectsPack, initial: projectsData,
      });
      // Two clicks: the project row, then the reference row inside it.
      await user.click(screen.getByText("MyGist"));
      await user.click(screen.getByText("Design doc"));
      await user.type(
        screen.getByDisplayValue("https://example.invalid/mygist-design"),
        "?v=2"
      );

      const after = latest();
      const expected = structuredClone(initial);
      expected.projects[0].references[1].url =
        "https://example.invalid/mygist-design?v=2";
      expect(after).toEqual(expected);
      // Named explicitly because these are exactly the keys a whitelist-based
      // rebuild would drop, and `toEqual` above states it less legibly:
      // machine-written stamps, the link graph, and the three write-only
      // keys server.py's update loop can set that nothing renders.
      const p = after.projects[0];
      expect(p.id).toBe(initial.projects[0].id);
      expect(p.added_date).toBe(initial.projects[0].added_date);
      expect(p.last_updated).toBe(initial.projects[0].last_updated);
      expect(p.related).toEqual(initial.projects[0].related);
      expect(p.url).toBe(initial.projects[0].url);
      expect(p.challenges).toBe(initial.projects[0].challenges);
      expect(p.goals).toBe(initial.projects[0].goals);
    });

    it("renders a project's references only inside its own expanded row", async () => {
      const { user } = renderSection({ pack: projectsPack, initial: projectsData });
      expect(screen.queryByText("References")).not.toBeInTheDocument();
      expect(screen.queryByText("Repo")).not.toBeInTheDocument();

      // The second project stores `references: []`, so expanding it must show
      // the child list's own empty state, not the first project's rows.
      await user.click(screen.getByText("Rangefinder rebuild"));
      expect(screen.getByText("References")).toBeInTheDocument();
      expect(screen.queryByText("Repo")).not.toBeInTheDocument();

      await user.click(screen.getByText("MyGist"));
      expect(screen.getByText("Repo")).toBeInTheDocument();
      expect(screen.getByText("Design doc")).toBeInTheDocument();
    });

    // ---- collapsed-row read-only chips ----

    it("counts references, tags and highlights on the collapsed row, and shows no chip for a project with none", () => {
      renderSection({ pack: projectsPack, initial: projectsData });
      expect(screen.getByText("2 references")).toBeInTheDocument();
      expect(screen.getByText("2 tags")).toBeInTheDocument();
      expect(screen.getByText("2 highlights")).toBeInTheDocument();
      // The second project stores [] for all three: a "0 x" chip on every
      // row that has never used a feature is noise, so none is rendered.
      expect(screen.queryByText(/^0 /)).not.toBeInTheDocument();
    });

    // `added_date` is stored as a plain yyyy-mm-dd calendar date, not an
    // instant, so it is deliberately displayed with NO `display_formats`
    // entry. ListRenderer's "date" format runs the value through
    // `new Date(...)` and reads local-time getters: a date-only string parses
    // as UTC midnight, so in any negative-offset zone (verified:
    // TZ=America/New_York renders "2026-01-12" as "2026-01-11") the badge
    // would show the wrong day. Raw passthrough produces the identical
    // yyyy-mm-dd string with no offset to get wrong.
    //
    // This assertion is only half a guard on its own -- it cannot fail in a
    // UTC or positive-offset zone, which is where this suite runs -- so the
    // manifest's own omission is asserted alongside it.
    it("shows `added_date` verbatim, with no timezone-shifting format applied", () => {
      renderSection({ pack: projectsPack, initial: projectsData });
      for (const project of projectsData.projects) {
        expect(screen.getByText(project.added_date)).toBeInTheDocument();
      }
      const node = normalizeUi(projectsPack).sections.find(
        (s) => s.path[0] === "projects"
      );
      expect(node.display_fields).toEqual(["added_date"]);
      expect(node.display_formats?.added_date).toBeUndefined();
    });

    it("is read-only about `added_date` -- expanding a row exposes no control bound to it", async () => {
      const { user } = renderSection({ pack: projectsPack, initial: projectsData });
      await user.click(screen.getByText("MyGist"));
      expect(screen.getByDisplayValue("MyGist")).toBeInTheDocument(); // really expanded
      expect(screen.queryByDisplayValue("2026-01-12")).not.toBeInTheDocument();
    });

    // ---- facet ----

    it("renders a status filter whose options resolve from the entity's valid_values", () => {
      renderSection({ pack: projectsPack, initial: projectsData });
      // ListRenderer skips a facet field whose options do not resolve, so the
      // group's presence is what proves `facets: ["status"]` names a real
      // enum key -- a typo such as "state" renders nothing here.
      const group = screen.getByRole("group", { name: "Filter by status" });
      // Five statuses plus the leading "All" exceed SEGMENTED_MAX, so this is
      // the dropdown branch; unfiltered, it reads "All".
      expect(within(group).getByRole("combobox").textContent).toBe("All");
    });

    // ---- info dialogs ----

    it("carries both bespoke-editor info dialogs, each reachable by its own name", async () => {
      const { user } = renderSection({ pack: projectsPack, initial: projectsData });

      await user.click(screen.getByRole("button", { name: "About Top of Mind" }));
      expect(screen.getByText(/Capture quick ideas/)).toBeInTheDocument();
      expect(screen.getByText(/A short phrase or sentence/)).toBeInTheDocument();
    });

    it("keeps the projects info dialog on a distinct name, not a second `About this section`", async () => {
      const { user } = renderSection({ pack: projectsPack, initial: projectsData });
      // Two info blocks in one section: if both fell back to the generic
      // name, `getByRole` here would throw on finding two matches -- which is
      // the ambiguity a screen-reader user would hear.
      await user.click(screen.getByRole("button", { name: "About this section" }));
      expect(screen.getByText(/Track your active work/)).toBeInTheDocument();
      expect(screen.getByText(/Clear, descriptive title/)).toBeInTheDocument();
    });
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

  // The React key was `node.path.join(".")`, which collides for two sibling
  // nodes that legitimately share a path (a shape wave 5's `lifestyle` pack
  // is expected to introduce). A duplicate key doesn't throw, doesn't log,
  // and doesn't even drop anything from a plain static render or a stable
  // in-place update -- React's fast reconciliation path matches same-index
  // children by key and both "collide" trivially with themselves. The bug
  // only surfaces when something ahead of the pair changes shape (a node is
  // removed, added, or reordered), which knocks React off that fast path and
  // into its key-based lookahead matching for every remaining sibling at
  // once: building that lookup dumps both duplicate-keyed fibers into the
  // same map slot, the second silently overwrites the first, and the
  // survivor's *internal* state (e.g. which row is expanded) gets handed to
  // the wrong node entirely.
  //
  // This is exercised below via a direct `rerender` (not the stateful
  // harness) with an unrelated leading node removed -- a shape change
  // SectionRenderer itself does not prevent, even though nothing in today's
  // static per-pack section lists happens to trigger it yet.
  describe("sibling nodes sharing a path", () => {
    const entities = { goal: { list: "goals" }, misc: { list: "other" } };
    const nodeOther = {
      kind: "list", path: ["other"], entity: "misc", title: "Other", title_field: "label",
    };
    const nodeFirst = {
      kind: "list", path: ["goals"], entity: "goal",
      title: "First", title_field: "title", detail_fields: ["title"],
    };
    const nodeSecond = {
      kind: "list", path: ["goals"], entity: "goal",
      title: "Second", title_field: "title", detail_fields: ["title"],
    };
    const data = { goals: [{ title: "Ship it" }], other: [{ label: "X" }] };
    const packBefore = {
      key: "reorder_shared_path", title: "Reorder", description: "",
      entities, ui: { sections: [nodeOther, nodeFirst, nodeSecond] },
    };
    const packAfter = { ...packBefore, ui: { sections: [nodeFirst, nodeSecond] } };

    it("renders both nodes, not just one, when they share a path", () => {
      render(<SectionRenderer pack={packBefore} data={data} onChange={() => {}} />);

      expect(screen.getByRole("heading", { name: "First" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Second" })).toBeInTheDocument();
      // Headings alone aren't proof: a key collision drops one node's whole
      // subtree, but if it happened to drop the *content* under a heading
      // that survived some other way, checking only the headings would miss
      // it. Each list renders its own copy of "Ship it", so two nodes
      // sharing a path must produce two, not one.
      expect(screen.getAllByText("Ship it")).toHaveLength(2);
    });

    it("does not leak one node's expanded state onto its sibling when an unrelated earlier node is removed", () => {
      const { rerender } = render(
        <SectionRenderer pack={packBefore} data={data} onChange={() => {}} />
      );

      // Expand only "Second"'s row (the later of the two "Ship it" rows);
      // "First"'s row is left collapsed.
      fireEvent.click(screen.getAllByText("Ship it")[1]);
      expect(screen.getAllByDisplayValue("Ship it")).toHaveLength(1);

      // Removing the unrelated leading node shifts both "goals" nodes up by
      // one position, forcing React off the same-index fast path for the
      // rest of the list. With a bare `path.join(".")` key both "goals"
      // nodes are indistinguishable to the lookahead matcher: the fiber
      // carrying "Second"'s *expanded* state is the one that survives the
      // map collision, and it gets reattached to "First" instead --
      // "First" now wrongly renders as expanded, a live control mounted
      // against the wrong node's data entirely.
      rerender(<SectionRenderer pack={packAfter} data={data} onChange={() => {}} />);

      // Neither row is expected to survive a structural change it had
      // nothing to do with -- that loss is an accepted index-keying
      // trade-off. What must not happen is the *wrong* row ending up
      // expanded, which is what a duplicate key produces.
      expect(screen.queryAllByDisplayValue("Ship it")).toHaveLength(0);
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

    // renderNode returns null for a kind it doesn't support (logging as
    // asserted above), but SectionRenderer's own per-node wrapper -- the
    // `<div className="space-y-3">` and the node.title heading -- must not be
    // emitted around that null. Otherwise a titled node of a not-yet-
    // -implemented kind (e.g. a future `fields` node) renders an empty,
    // heading-bearing div: a heading with no content under it, and a blank
    // ~24px gap contributed by the wrapper even when title is absent.
    it("emits no heading and no wrapper for a node renderNode rejects, while its titled sibling list still renders", () => {
      const pack = {
        key: "mixed",
        title: "Mixed",
        description: "",
        entities: { goal: { list: "goals" } },
        ui: {
          sections: [
            { kind: "fields", path: ["profile"], title: "Basics" },
            { kind: "list", path: ["goals"], entity: "goal", title_field: "title" },
          ],
        },
      };
      const data = { profile: { name: "irrelevant" }, goals: [{ title: "Ship it" }] };

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      renderSection({ pack, initial: data });

      // No heading for the rejected "fields" node -- only the Card's own
      // pack.title heading remains (the list node here declares no title).
      expect(screen.queryByRole("heading", { name: "Basics" })).not.toBeInTheDocument();
      expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Mixed"]);
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
