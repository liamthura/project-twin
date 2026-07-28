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
import knowledgeData from "@/__fixtures__/data/knowledge.json";
import { renderSection } from "@/test/harness";
import { SEGMENTED_MAX } from "@/components/controls";
import { normalizeUi } from "@/renderers/paths";

const goalsPack = packs.find((p) => p.key === "goals");
const mediaPack = packs.find((p) => p.key === "media");
const aestheticsPack = packs.find((p) => p.key === "aesthetics");
const learningLogPack = packs.find((p) => p.key === "learning_log");
const circlePack = packs.find((p) => p.key === "circle");
const projectsPack = packs.find((p) => p.key === "projects");
const knowledgePack = packs.find((p) => p.key === "knowledge");

// Shared reasons for the two exclusion entries nearly every pack needs --
// spelled out once so every call site's exclusion map still requires a real,
// non-empty reason (the check in describeGuards below) without retyping the
// same sentence at every one of them.
const MACHINE_ID =
  "machine-written identifier; nothing in the UI reads it back or offers a control to edit it.";
const LINK_GRAPH =
  "the link graph -- written only by _execute_link and rendered nowhere.";

// The coverage guard and the round-trip guard, factored so every pack with a
// generic item list gets both without copying the test bodies. A ui block
// that omits a field would leave that field unreachable in the UI -- and
// therefore silently unsaveable -- which is the failure mode the whole
// consolidation has to avoid; a renderer that mutates its `data` prop or
// drops a field it doesn't model would corrupt or lose data on every edit.
//
// "covered" comes from the pack's own ui spec (badges + detail_fields), not a
// hand-copied list, so a renderer that stops wiring up a field fails this
// even if nobody updates the test. But that only checks the renderer against
// the manifest -- it says nothing about whether the manifest itself still
// names every key the fixture actually stores. Deleting a field from
// detail_fields shrinks `covered` right along with it, so this half of the
// guard would still pass with the field gone. `exclusions` below is the other
// half: it checks the manifest against the DATA, so removing a field from
// detail_fields (or never having added it) fails loudly instead of shrinking
// the guard's own expectations to match.
//
// `exclusions` is required (pass `{}` if truly nothing is deliberately
// unbound) and maps each fixture key that is NOT bound by the ui block to a
// non-empty reason string -- adding to it has to be a deliberate, reviewable
// act, not a way to quiet a failing test. A key that is neither bound nor
// listed here fails the guard below.
function describeGuards({ pack, listKey, data, exclusions }) {
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

  // Fail fast, at suite-definition time rather than inside an `it`, on a
  // malformed exclusions map -- a missing map or a reason-less entry would
  // otherwise let a key silently drop out of both halves of the guard.
  if (!exclusions) {
    throw new Error(
      `describeGuards({ pack: "${pack.key}", listKey: "${listKey}" }) needs an ` +
        `\`exclusions\` map (pass {} if every fixture key is bound) naming every ` +
        `deliberately-unbound fixture key and why.`
    );
  }
  for (const [key, reason] of Object.entries(exclusions)) {
    if (typeof reason !== "string" || !reason.trim()) {
      throw new Error(
        `exclusions["${key}"] for ${pack.key}/${listKey} needs a real reason ` +
          `string, not ${JSON.stringify(reason)} -- an exclusion with no reason ` +
          `is indistinguishable from a way to make this guard stop complaining.`
      );
    }
  }

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

  // The guard the two tests above cannot provide: they check the RENDERER
  // against the MANIFEST (does every field the manifest names actually make
  // it onto the screen), never the MANIFEST against the DATA (does the
  // manifest still name every field the data actually carries). Deleting a
  // real, editable stored key from detail_fields shrinks `covered` right
  // along with the deletion, so the tests above keep passing -- this is the
  // one that would have caught task-6's `mental_tab.status` omission.
  //
  // Built from every item in the fixture list, not just `item` (data[listKey]
  // [0]) above: knowledge's `domains` list is the reason -- the `knowledge`
  // entity's shape (added_date/last_updated, no id) only shows up on
  // domains[1], and a check scoped to domains[0] would never see it.
  it(`accounts for every stored key on every fixture item -- bound by the ui block or explicitly excluded (${pack.key})`, () => {
    const bound = new Set([
      node.title_field,
      ...(node.badges || []),
      ...(node.detail_fields || []),
      // display_fields and count_badges render read-only, but they DO render
      // -- a badge showing a date, or a "N references" chip -- so a fixture
      // key named there is reachable on screen and is not an omission.
      ...(node.display_fields || []),
      ...(node.count_badges || []),
    ]);
    const allFixtureKeys = new Set();
    for (const row of data[listKey]) {
      for (const key of Object.keys(row)) allFixtureKeys.add(key);
    }
    for (const key of allFixtureKeys) {
      if (bound.has(key)) continue;
      expect(
        Object.prototype.hasOwnProperty.call(exclusions, key),
        `"${key}" (${pack.key}/${listKey}) is neither bound by the ui block ` +
          `nor on the exclusions list passed to describeGuards -- bind it, or ` +
          `add a commented exclusion explaining why it is deliberately unbound.`
      ).toBe(true);
    }
  });
}

describe("SectionRenderer", () => {
  it("renders every item's title", () => {
    renderSection({ pack: goalsPack, initial: goalsData });
    expect(screen.getByText("Ship MyGist v3")).toBeInTheDocument();
    expect(screen.getByText("Learn Rust properly")).toBeInTheDocument();
  });

  describe("goals", () => {
    describeGuards({
      pack: goalsPack, listKey: "goals", data: goalsData,
      exclusions: { id: MACHINE_ID },
    });
  });

  // Media and aesthetics are the only packs with array_fields, field_defaults
  // and suggestions -- these fixtures give FieldInput's ArrayInput branch and
  // the enum/dropdown split real coverage for the first time.
  describe("media", () => {
    describeGuards({
      pack: mediaPack, listKey: "items", data: mediaData,
      exclusions: { id: MACHINE_ID, related: LINK_GRAPH },
    });
  });

  describe("aesthetics", () => {
    describeGuards({
      pack: aestheticsPack, listKey: "styles", data: aestheticsData,
      exclusions: { id: MACHINE_ID, related: LINK_GRAPH },
    });
  });

  describe("learning_log", () => {
    describeGuards({
      pack: learningLogPack, listKey: "entries", data: learningLogData,
      exclusions: {
        id: MACHINE_ID,
        // Named explicitly in "preserves its own id, timestamp,
        // related_entries and conversation_metadata..." below: both are
        // structured data the backend writes and nothing renders.
        related_entries: "structured cross-entity link data; no control models it, it only has to survive an edit untouched.",
        conversation_metadata: "write-only diagnostic blob (model, turn count); no control models it, it only has to survive an edit untouched.",
      },
    });

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
    describeGuards({
      pack: circlePack, listKey: "connections", data: circleData,
      exclusions: { id: MACHINE_ID, related: LINK_GRAPH },
    });

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
      describeGuards({
        pack: projectsPack, listKey: "projects", data: projectsData,
        exclusions: {
          id: MACHINE_ID,
          related: LINK_GRAPH,
          // Only `added_date` is in this list's display_fields -- last_updated
          // is a real machine-written stamp with no on-screen rendering at all.
          last_updated: "machine-written stamp; this list's display_fields names only added_date, not this one, and no control models it.",
          // Named explicitly in "round-trips an edit to a `references`
          // child..." below, and in the fixture's own _note: write-only keys
          // server.py's project update loop can set verbatim, with no
          // coercion and nothing reading them back.
          url: "write-only key set by server.py's project update loop; no control models it.",
          challenges: "write-only key set by server.py's project update loop; no control models it (shape is a guess -- see __fixtures__/data/projects.json's _note).",
          goals: "write-only key set by server.py's project update loop; no control models it (shape is a guess -- see __fixtures__/data/projects.json's _note).",
        },
      });
    });
    describe("top_of_mind list", () => {
      describeGuards({
        pack: projectsPack, listKey: "top_of_mind", data: projectsData,
        exclusions: { id: MACHINE_ID, related: LINK_GRAPH },
      });
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

  // -------------------------------------------------------------------------
  // knowledge (wave 4, Task 6)
  //
  // Same two-lists-with-a-child shape as projects, so the same selector rules
  // apply (scope by block; expand before asserting on detail fields or child
  // rows). What is specific to this pack:
  //
  //   - `mental_tab` stores `title`. FIELD_ALIASES lists four other spellings
  //     and the legacy `topic` among them, and only `title` is ever written.
  //   - `topic` is READ by four fallbacks in server.py and written by none.
  //     persona_store._normalize backfills `title` from it on load; the
  //     fixture keeps a raw, un-backfilled entry anyway, because the renderer
  //     must not lose the key whatever state the blob is in.
  //   - `domains` holds two different stored shapes (entity `domain` writes an
  //     id and no dates; entity `knowledge`, category defaulting to "domains",
  //     writes dates and no id). Both have to survive an edit byte for byte.
  //   - both list nodes declare `title`, so both info buttons are named.
  // -------------------------------------------------------------------------
  describe("knowledge", () => {
    describe("domains list", () => {
      describeGuards({
        pack: knowledgePack, listKey: "domains", data: knowledgeData,
        exclusions: {
          // Covers both shapes in this list: the `domain` entity's id is a
          // plain machine-written identifier, and the `knowledge` entity's
          // rows have no id at all until the next backend save backfills one
          // (see the manifest's own $comment on this node) -- either way,
          // nothing renders or edits it here.
          id: MACHINE_ID,
          related: LINK_GRAPH,
        },
      });
    });
    describe("mental_tabs list", () => {
      describeGuards({
        pack: knowledgePack, listKey: "mental_tabs", data: knowledgeData,
        exclusions: {
          id: MACHINE_ID,
          related: LINK_GRAPH,
          // The two write paths disagree by the local UTC offset (server.py
          // vs. the client-side @now stamp) -- see the manifest's own
          // $comment on this node -- so it is deliberately never displayed or
          // bound, per "never displays or binds a control to `created_at`"
          // below.
          created_at: "the two write paths for this stamp disagree by the local UTC offset; deliberately never displayed or bound.",
          // Legacy alias for `title`, read as a fallback by server.py and
          // written by nothing -- see the manifest's own $comment and the
          // "legacy topic entry" tests below. Bound nowhere on purpose so a
          // control never writes back under the wrong key.
          topic: "legacy alias for `title`; deliberately bound nowhere so the renderer's only job for it is to not destroy it.",
        },
      });
    });

    const domainsBlock = () => screen.getByText("Skills & Domains").parentElement;
    const mentalTabsBlock = () => screen.getByText("Mental Tabs").parentElement;
    const tabsNode = () =>
      normalizeUi(knowledgePack).sections.find((s) => s.path[0] === "mental_tabs");
    const domainsNode = () =>
      normalizeUi(knowledgePack).sections.find((s) => s.path[0] === "domains");

    // ---- the mental_tab trap: stored key is `title`, aliases are name/topic --

    it("renders each mental tab under `title`, the only one of five spellings server.py stores", () => {
      renderSection({ pack: knowledgePack, initial: knowledgeData });
      expect(screen.getByText("Places to eat in Newcastle")).toBeInTheDocument();
      expect(screen.getByText("Gift ideas")).toBeInTheDocument();
    });

    // The write side, and the half that loses data. `execute_modify` dedupes
    // on `title or topic` and looks tabs up by `title` first, so a tab written
    // under `name` (FIELD_ALIASES' first element, and the natural wrong guess)
    // is invisible to every one of those paths: unfindable, un-updatable,
    // un-removable over MCP, and blank in the UI that wrote it.
    it("writes a new tab under `title`, never the alias `name` or the legacy `topic`", async () => {
      const { user, latest, initial } = renderSection({
        pack: knowledgePack, initial: knowledgeData,
      });
      await user.click(within(mentalTabsBlock()).getByRole("button", { name: "Add" }));

      const dialog = screen.getByRole("dialog");
      await user.type(within(dialog).getAllByRole("textbox")[0], "Reading list");
      await user.click(within(dialog).getByRole("button", { name: "Add" }));

      const after = latest();
      const added = after.mental_tabs[0]; // addItem prepends
      expect(added.title).toBe("Reading list");
      expect(added).not.toHaveProperty("name");
      expect(added).not.toHaveProperty("topic");
      // Everything else in the section is untouched.
      expect(after.mental_tabs.slice(1)).toEqual(initial.mental_tabs);
      expect(after.domains).toEqual(initial.domains);
    });

    // `created_at` is stamped client-side on add by the bespoke editor.
    // field_defaults with the "@now" token is what carries that behaviour
    // across to the generic renderer -- without it a tab added through the UI
    // has no creation stamp at all, and with the token left unresolved it
    // would store the literal string "@now".
    it("stamps `created_at` on a tab added through the UI, resolving the @now token", async () => {
      const { user, latest } = renderSection({
        pack: knowledgePack, initial: knowledgeData,
      });
      await user.click(within(mentalTabsBlock()).getByRole("button", { name: "Add" }));
      const dialog = screen.getByRole("dialog");
      await user.type(within(dialog).getAllByRole("textbox")[0], "Reading list");
      await user.click(within(dialog).getByRole("button", { name: "Add" }));

      const added = latest().mental_tabs[0];
      expect(added.created_at).not.toBe("@now");
      expect(Number.isNaN(Date.parse(added.created_at))).toBe(false);
      expect(tabsNode().field_defaults).toEqual({ created_at: "@now" });
    });

    // Mirrors circle's `contact` guard and projects' `item` guard. A wrongly
    // bound alias lands as a detail-field Label whose DOM text is the
    // lowercase storage key -- and those only exist once the row is expanded,
    // so asserting on a collapsed list would pass either way.
    it("exposes no control for `name` or `topic`, which are MCP input aliases and not stored keys", async () => {
      const { user } = renderSection({ pack: knowledgePack, initial: knowledgeData });
      await user.click(screen.getByText("Places to eat in Newcastle"));
      // Proof the row really expanded.
      expect(
        screen.getByDisplayValue("Places to eat in Newcastle")
      ).toBeInTheDocument();
      const block = within(mentalTabsBlock());
      expect(block.queryByText(/^topic$/i)).not.toBeInTheDocument();
      expect(block.queryByText(/^name$/i)).not.toBeInTheDocument();
    });

    // `created_at` disagrees with itself across its two write paths: server.py
    // stamps `datetime.now().isoformat() + "Z"` (local time labelled UTC), the
    // editor stamps a real UTC `toISOString()`. Rendering it -- formatted or
    // raw -- would show half the tabs shifted by the local offset, so it is
    // written and never displayed.
    it("never displays or binds a control to `created_at`", async () => {
      const { user } = renderSection({ pack: knowledgePack, initial: knowledgeData });
      const stamp = knowledgeData.mental_tabs[0].created_at;
      expect(screen.queryByText(stamp)).not.toBeInTheDocument();

      await user.click(screen.getByText("Places to eat in Newcastle"));
      expect(screen.queryByDisplayValue(stamp)).not.toBeInTheDocument();
      expect(within(mentalTabsBlock()).queryByText(/^created at$/i)).not.toBeInTheDocument();
      expect(tabsNode().display_fields).toBeUndefined();
    });

    // ---- the legacy `topic` entry ----

    // The accepted degradation, stated so it cannot regress into silent key
    // loss: an un-backfilled entry renders with a blank title (nothing binds
    // `topic`, by design), but every key it carries survives an edit. The
    // backend repairs the blank title on load -- see
    // persona_store._normalize and its tests -- which is where a data change
    // belongs; the renderer's job is only to not destroy anything.
    it("keeps a legacy `topic` entry's keys intact through an edit, even though its title renders blank", async () => {
      const { user, latest, initial } = renderSection({
        pack: knowledgePack, initial: knowledgeData,
      });
      // The topic value is bound by nothing, so it is nowhere on screen.
      expect(screen.queryByText("Old bookmarks")).not.toBeInTheDocument();

      // The row has no title text to click, which is the whole problem -- it
      // is reachable only through the remove button's generated label.
      const row = screen.getByRole("button", { name: "Remove Untitled entry" })
        .parentElement;
      await user.click(row);
      await user.type(
        screen.getByDisplayValue(knowledgeData.mental_tabs[2].notes),
        "!"
      );

      const after = latest();
      const expected = structuredClone(initial);
      expected.mental_tabs[2].notes = initial.mental_tabs[2].notes + "!";
      expect(after).toEqual(expected);
      // Named explicitly: `topic` is exactly the key a title_field bound to it
      // -- or a whitelist rebuild -- would mangle or drop.
      expect(after.mental_tabs[2].topic).toBe("Old bookmarks");
      expect(after.mental_tabs[2]).not.toHaveProperty("title");
      expect(after.mental_tabs[2].id).toBe(initial.mental_tabs[2].id);
    });

    // The on-screen assertions above cannot fail if the manifest quietly
    // started binding `topic` somewhere that does not render a labelled
    // control (long_text, sort, display_fields...), so assert the block's own
    // shape too.
    it("binds `title` and names the legacy `topic` in no construct at all", () => {
      const node = tabsNode();
      expect(node.title_field).toBe("title");
      const named = [
        ...(node.badges || []), ...(node.detail_fields || []),
        ...(node.array_fields || []), ...(node.long_text || []),
        ...(node.facets || []), ...(node.count_badges || []),
        ...(node.display_fields || []), ...(node.date_fields || []),
        ...Object.keys(node.field_defaults || {}),
        ...Object.keys(node.enum || {}),
        node.title_field, node.sort?.field,
      ].filter(Boolean);
      expect(named).not.toContain("topic");
      expect(named).not.toContain("name");
    });

    // ---- two stored shapes in one `domains` list ----

    // The `knowledge` entity writes into `domains` too, with dates and no id;
    // `domain` writes an id and no dates. An edit to either must leave the
    // other's keys exactly as they were -- including NOT inventing an `id` for
    // the entry that has none (persona_store backfills that on the next
    // backend save, not the renderer).
    it("round-trips the id-less, date-carrying domain shape the `knowledge` entity writes", async () => {
      const { user, latest, initial } = renderSection({
        pack: knowledgePack, initial: knowledgeData,
      });
      await user.click(screen.getByText("Postgres"));
      await user.type(screen.getByDisplayValue(knowledgeData.domains[1].notes), "!");

      const after = latest();
      const expected = structuredClone(initial);
      expected.domains[1].notes = initial.domains[1].notes + "!";
      expect(after).toEqual(expected);
      const d = after.domains[1];
      expect(d.added_date).toBe(initial.domains[1].added_date);
      expect(d.last_updated).toBe(initial.domains[1].last_updated);
      expect(d).not.toHaveProperty("id");
      // The neighbouring `domain`-entity shape keeps its id and its link graph
      // and gains no dates.
      expect(after.domains[0]).toEqual(initial.domains[0]);
    });

    // ---- collapsed-row read-only chips ----

    it("shows the domain dates verbatim, with no timezone-shifting format applied", () => {
      renderSection({ pack: knowledgePack, initial: knowledgeData });
      expect(screen.getByText("2026-01-12")).toBeInTheDocument();
      expect(screen.getByText("2026-07-20")).toBeInTheDocument();
      // Both are plain yyyy-mm-dd calendar dates, not instants. formatDisplay
      // exempts that shape from `new Date()` + local getters, but only because
      // wave 4 Task 5 fixed it -- declaring a format here would still be
      // asking for a conversion that has no meaning, so the manifest declares
      // none. This assertion is the half that can fail in any timezone.
      const node = domainsNode();
      expect(node.display_fields).toEqual(["added_date", "last_updated"]);
      expect(node.display_formats).toBeUndefined();
    });

    it("is read-only about the domain dates -- expanding a row exposes no control bound to them", async () => {
      const { user } = renderSection({ pack: knowledgePack, initial: knowledgeData });
      await user.click(screen.getByText("Postgres"));
      expect(screen.getByDisplayValue("Postgres")).toBeInTheDocument(); // really expanded
      expect(screen.queryByDisplayValue("2026-01-12")).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue("2026-07-20")).not.toBeInTheDocument();
    });

    it("counts references and tags on the collapsed rows, and shows no chip where there are none", () => {
      renderSection({ pack: knowledgePack, initial: knowledgeData });
      expect(screen.getByText("2 references")).toBeInTheDocument(); // Python
      expect(screen.getByText("1 reference")).toBeInTheDocument();  // first tab
      expect(screen.getByText("2 tags")).toBeInTheDocument();
      expect(screen.getByText("1 tag")).toBeInTheDocument();
      // Postgres and "Gift ideas" store [] for theirs.
      expect(screen.queryByText(/^0 /)).not.toBeInTheDocument();
    });

    // ---- facets ----

    it("renders a level filter and a status filter, both resolving from entity valid_values", () => {
      renderSection({ pack: knowledgePack, initial: knowledgeData });
      // ListRenderer skips a facet whose options do not resolve, so each
      // group's presence is what proves the field name is a real enum key.
      const level = screen.getByRole("group", { name: "Filter by level" });
      // Five levels plus "All" exceed SEGMENTED_MAX -> dropdown branch.
      expect(within(level).getByRole("combobox").textContent).toBe("All");
      const status = screen.getByRole("group", { name: "Filter by status" });
      // Three statuses plus "All" fit -> segmented branch.
      expect(
        within(status).getByRole("button", { name: "All", pressed: true })
      ).toBeInTheDocument();
    });

    // ---- the references children ----

    it("renders each list's references only inside its own expanded row", async () => {
      const { user } = renderSection({ pack: knowledgePack, initial: knowledgeData });
      expect(screen.queryByText("Fluent Python")).not.toBeInTheDocument();
      expect(screen.queryByText("Cafe list")).not.toBeInTheDocument();

      // Postgres stores `references: []`, so it shows the child's own empty
      // state -- never the other domain's rows.
      await user.click(screen.getByText("Postgres"));
      expect(within(domainsBlock()).getByText("References")).toBeInTheDocument();
      expect(screen.queryByText("Fluent Python")).not.toBeInTheDocument();

      await user.click(screen.getByText("Python"));
      expect(screen.getByText("Fluent Python")).toBeInTheDocument();
      expect(screen.getByText("asyncio docs")).toBeInTheDocument();
      // A domain's references never leak into the mental-tab list.
      expect(screen.queryByText("Cafe list")).not.toBeInTheDocument();
    });

    it("round-trips an edit to a domain's `references` child, preserving every other key", async () => {
      const { user, latest, initial } = renderSection({
        pack: knowledgePack, initial: knowledgeData,
      });
      await user.click(screen.getByText("Python"));
      await user.click(screen.getByText("asyncio docs"));
      await user.type(
        screen.getByDisplayValue("https://example.invalid/asyncio"),
        "#tasks"
      );

      const after = latest();
      const expected = structuredClone(initial);
      expected.domains[0].references[1].url =
        "https://example.invalid/asyncio#tasks";
      expect(after).toEqual(expected);
      // `related` is written only by _execute_link and rendered nowhere -- a
      // whitelist rebuild would drop it without a trace.
      expect(after.domains[0].related).toEqual(initial.domains[0].related);
      expect(after.domains[0].id).toBe(initial.domains[0].id);
    });

    // All three reference entities persist `name`; all three manifests call it
    // `ref_name`. Bound as `name` via the child's fields_outside_entity.
    it("binds a reference's `name`, exposing no control for the manifest's `ref_name`", async () => {
      const { user } = renderSection({ pack: knowledgePack, initial: knowledgeData });
      await user.click(screen.getByText("Places to eat in Newcastle"));
      await user.click(screen.getByText("Cafe list"));
      expect(screen.getByDisplayValue("Cafe list")).toBeInTheDocument();
      expect(screen.queryByText(/^ref name$/i)).not.toBeInTheDocument();
    });

    // ---- info dialogs ----

    it("carries both bespoke-editor info dialogs, each reachable by its own name", async () => {
      const { user } = renderSection({ pack: knowledgePack, initial: knowledgeData });

      await user.click(screen.getByRole("button", { name: "About Skills & Domains" }));
      expect(screen.getByText(/tracks your technical and professional skills/)).toBeInTheDocument();
      expect(screen.getByText(/Be specific/)).toBeInTheDocument();
    });

    it("keeps the mental tabs info dialog on a distinct name, not a second generic one", async () => {
      const { user } = renderSection({ pack: knowledgePack, initial: knowledgeData });
      // Two info blocks in one section: if either fell back to the generic
      // name, `getByRole` would throw on two matches -- the same ambiguity a
      // screen-reader user would hear.
      expect(
        screen.queryByRole("button", { name: "About this section" })
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "About Mental Tabs" }));
      expect(screen.getByText(/personal knowledge snippets/)).toBeInTheDocument();
      expect(screen.getByText(/A short, memorable name/)).toBeInTheDocument();
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
      expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();

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
