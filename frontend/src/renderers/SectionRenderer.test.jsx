import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import SectionRenderer from "@/renderers/SectionRenderer";
import packs from "@/__fixtures__/packs.json";
import goalsData from "@/__fixtures__/data/goals.json";
import mediaData from "@/__fixtures__/data/media.json";
import aestheticsData from "@/__fixtures__/data/aesthetics.json";
import learningLogData from "@/__fixtures__/data/learning_log.json";
import circleData from "@/__fixtures__/data/circle.json";
import projectsData from "@/__fixtures__/data/projects.json";
import knowledgeData from "@/__fixtures__/data/knowledge.json";
import lifestyleData from "@/__fixtures__/data/lifestyle.json";
import preferencesData from "@/__fixtures__/data/preferences.json";
import profileData from "@/__fixtures__/data/profile.json";
import { renderSection } from "@/test/harness";
import { SEGMENTED_MAX } from "@/components/controls";
import { normalizeUi, outline } from "@/renderers/paths";

const goalsPack = packs.find((p) => p.key === "goals");
const mediaPack = packs.find((p) => p.key === "media");
const aestheticsPack = packs.find((p) => p.key === "aesthetics");
const learningLogPack = packs.find((p) => p.key === "learning_log");
const circlePack = packs.find((p) => p.key === "circle");
const projectsPack = packs.find((p) => p.key === "projects");
const knowledgePack = packs.find((p) => p.key === "knowledge");
const lifestylePack = packs.find((p) => p.key === "lifestyle");
const preferencesPack = packs.find((p) => p.key === "preferences");
const profilePack = packs.find((p) => p.key === "profile");

// A list's header Add trigger, found by its VISIBLE text rather than by
// accessible name. It reads a bare "Add" beside the heading that already names
// the list, and carries an aria-label naming what it adds -- the same name the
// empty panel's call to action spells out on screen. So an empty list answers
// to "Add <thing>" twice and a name-based query cannot say which one it meant,
// while the visible text tells them apart. Only unambiguous while the dialog
// is closed: its submit button reads a bare "Add" too.
const headerAdd = (scope = screen) => scope.getByText("Add", { selector: "button" });

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
// Scope to one ui node by its title, via the `data-ui-node` attribute
// SectionRenderer stamps on each node's wrapper. Walking up from the heading
// text with .parentElement used to work and broke the moment the heading
// gained a wrapper for `description` -- this names the node instead of
// describing where it sits.
function uiNode(title) {
  const el = document.querySelector(`[data-ui-node="${title}"]`);
  if (!el) throw new Error(`no ui node titled "${title}" is rendered`);
  return el;
}

// Walk from the pack's ui down to the node these guards are about, collecting
// every node passed through and the fixture rows each one is bound to.
//
// `keys` is a path of `path[0]` segments. One segment addresses a top-level
// list; two address a list nested inside a row of the first, which is how
// education's `coursework`/`clubs` and the four `references` lists are
// declared. Until wave 10 this function took a single string and had no way to
// name a child node -- so six entity-bearing nested lists had neither the
// coverage guard nor the round-trip guard, including `hobby_reference`, whose
// declared-versus-stored divergence wave 5 had to record by hand.
//
// A nested level is resolved through row 0 of its parent, which is also the row
// the tests expand to reach it.
function resolveChain(pack, keys, data) {
  // Search through `group` nodes, which nest real nodes and carry no `path`
  // of their own -- a bare `.find` over the top level both throws on them and
  // misses everything under them.
  const flatten = (nodes) =>
    (nodes || []).flatMap((n) => (n.kind === "group" ? flatten(n.sections) : [n]));

  const chain = [];
  let nodes = normalizeUi(pack).sections;
  for (const [i, key] of keys.entries()) {
    const node = flatten(nodes).find((s) => Array.isArray(s.path) && s.path[0] === key);
    if (!node) {
      throw new Error(
        `${pack.key}: no ui node with path[0]="${key}"` +
          (i ? ` under "${keys.slice(0, i).join("/")}"` : "")
      );
    }
    const rows = i === 0 ? data[key] : chain[i - 1].rows[0]?.[key];
    if (!Array.isArray(rows)) {
      throw new Error(
        `${pack.key}/${keys.slice(0, i + 1).join("/")}: the fixture holds no array ` +
          `there, so these guards would assert nothing.`
      );
    }
    chain.push({ node, rows });
    nodes = node.children || [];
  }
  return chain;
}

function describeGuards({ pack, listKey, data, exclusions }) {
  // `listKey` stays a bare string for the top-level case, which is most of
  // them; an array addresses a nested node.
  const keys = Array.isArray(listKey) ? listKey : [listKey];
  const label = keys.join("/");
  const chain = resolveChain(pack, keys, data);
  const ancestors = chain.slice(0, -1);
  const { node, rows } = chain[chain.length - 1];
  // Resolved exactly as ListRenderer resolves it -- via node.entity, which
  // SectionRenderer sets from `pack.entities?.[node.entity]` -- not by
  // re-deriving it from legacy list-matching rules. Those rules live inside
  // normalizeUi already; re-implementing them here made this guard
  // consistent with ListRenderer only by coincidence.
  const entity = pack.entities?.[node.entity];
  const arrayFields = node.array_fields || [];
  const covered = [...new Set([...(node.badges || []), ...(node.detail_fields || [])])];
  const item = rows[0];

  // A nested node only renders once its ancestors' rows are expanded, so every
  // guard below opens the chain before it looks for anything.
  const openChain = async (user) => {
    for (const link of ancestors) {
      await user.click(screen.getByText(link.rows[0][link.node.title_field]));
    }
  };

  // A fixture that is easier than production is worse than no fixture. Wave 6
  // bound education's `coursework` and `clubs` as chip controls on the strength
  // of a fixture that held bare strings; the real shape is objects, and the
  // chip control throws "Objects are not valid as a React child" on them. Every
  // test passed while the crash was never exercised.
  //
  // So: an array-valued key a node declares in `array_fields` must actually
  // hold strings in the fixture. If it holds objects, the node is the wrong
  // kind -- it wants a nested list, not a chip control.
  for (const field of node.array_fields || []) {
    const value = item[field];
    if (!Array.isArray(value)) continue;
    const objects = value.filter((v) => v !== null && typeof v === "object");
    if (objects.length) {
      throw new Error(
        `${pack.key}/${label}: node declares array_fields: ["${field}"], which ` +
          `renders each entry as a chip -- but the fixture holds ${objects.length} ` +
          `OBJECT entr${objects.length === 1 ? "y" : "ies"} there, which React ` +
          `cannot render as a child. This field wants a nested list node, not ` +
          `array_fields.`
      );
    }
  }

  // Fail fast, at suite-definition time rather than inside an `it`, on a
  // malformed exclusions map -- a missing map or a reason-less entry would
  // otherwise let a key silently drop out of both halves of the guard.
  if (!exclusions) {
    throw new Error(
      `describeGuards({ pack: "${pack.key}", listKey: "${label}" }) needs an ` +
        `\`exclusions\` map (pass {} if every fixture key is bound) naming every ` +
        `deliberately-unbound fixture key and why.`
    );
  }
  for (const [key, reason] of Object.entries(exclusions)) {
    if (typeof reason !== "string" || !reason.trim()) {
      throw new Error(
        `exclusions["${key}"] for ${pack.key}/${label} needs a real reason ` +
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

  it(`exposes every detail field of an expanded item (${pack.key}/${label})`, async () => {
    const { user } = renderSection({ pack, initial: data });
    await openChain(user);
    await user.click(screen.getByText(item[node.title_field]));
    for (const field of covered) expectFieldOnScreen(field);
  });

  // Catches drop-on-write: an edit that quietly discards fields the renderer
  // does not know about (badges/detail_fields don't cover every key -- id,
  // the title field itself, and any unmodeled field like `related` all have
  // to survive an edit untouched too).
  it(`preserves every other field when one is edited (${pack.key}/${label})`, async () => {
    const { user, latest, initial } = renderSection({ pack, initial: data });
    await openChain(user);
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
        `no free-text field to edit in ${pack.key}/${label}; this guard cannot run`
      );
    }
    const input = screen.getByDisplayValue(item[editableField]);
    await user.type(input, "X");

    const after = latest();
    // Built from the harness's pristine `initial`, not from the module-cached
    // fixture import -- see harness.jsx for why sharing that reference would
    // let an in-place mutation corrupt this expectation and pass.
    const expected = structuredClone(initial);
    // Walk the same chain in the expectation: a nested node's edit lands on
    // row 0 of each ancestor, which is the row openChain expanded.
    let target = expected;
    for (const key of keys.slice(0, -1)) target = target[key][0];
    target[keys[keys.length - 1]][0][editableField] = item[editableField] + "X";
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
  it(`accounts for every stored key on every fixture item -- bound by the ui block or explicitly excluded (${pack.key}/${label})`, () => {
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
    for (const row of rows) {
      for (const key of Object.keys(row)) allFixtureKeys.add(key);
    }
    for (const key of allFixtureKeys) {
      if (bound.has(key)) continue;
      expect(
        Object.prototype.hasOwnProperty.call(exclusions, key),
        `"${key}" (${pack.key}/${label}) is neither bound by the ui block ` +
          `nor on the exclusions list passed to describeGuards -- bind it, or ` +
          `add a commented exclusion explaining why it is deliberately unbound.`
      ).toBe(true);
    }
  });
}

describe("SectionRenderer", () => {
  // ---------------------------------------------------------------------------
  // wave 12: the title field is a renderer guarantee, not a manifest opt-in
  //
  // `editFields` came from badges + detail_fields, so a node that omitted its
  // own title_field from detail_fields offered no control for it: the Add
  // dialog (which has always given the title its own input) could name a row,
  // and nothing could ever rename it. Three shipped nodes did exactly that --
  // goals, media, aesthetics. Fixing it in the renderer rather than in three
  // manifests is what stops the fourth one happening.
  // ---------------------------------------------------------------------------
  describe("title field is always editable", () => {
    const cases = [
      ["goals", goalsPack, goalsData, "goals", "title", "Ship MyGist v3"],
      ["media", mediaPack, mediaData, "items", "title", undefined],
      ["aesthetics", aestheticsPack, aestheticsData, "styles", "name", undefined],
    ];

    for (const [label, pack, data, listKey, titleField] of cases) {
      it(`renders a control for ${label}'s ${titleField}, which detail_fields omits`, async () => {
        const node = normalizeUi(pack).sections.find(
          (s) => Array.isArray(s.path) && s.path[0] === listKey
        );
        // The premise of this test: if a manifest later adds the title to
        // detail_fields, this case is no longer testing the renderer.
        expect(node.detail_fields || []).not.toContain(titleField);

        const first = data[listKey][0];
        const { user } = renderSection({ pack, initial: data });
        await user.click(screen.getByText(first[titleField]));
        expect(screen.getByDisplayValue(first[titleField])).toBeInTheDocument();
      });
    }

    it("round-trips a rename through the body control", async () => {
      const { user, latest } = renderSection({ pack: goalsPack, initial: goalsData });
      await user.click(screen.getByText("Ship MyGist v3"));
      await user.type(screen.getByDisplayValue("Ship MyGist v3"), "!");
      expect(latest().goals.map((g) => g.title)).toContain("Ship MyGist v3!");
    });

    it("does not render the title twice when detail_fields DOES name it", async () => {
      // learning_log names `topic` in detail_fields. The title must lead the
      // body, not appear once from the guarantee and once from detail_fields.
      const { user } = renderSection({ pack: learningLogPack, initial: learningLogData });
      await user.click(screen.getByText("React Server Components"));
      expect(screen.getAllByDisplayValue("React Server Components")).toHaveLength(1);
    });
  });

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
        // Both were `array_fields` chips on this node until wave 12. They are
        // sentences, not word-like tags, so they became child `strings` nodes
        // with item_control:"input" -- one editable row each, the treatment
        // profile's work highlights already had. Bound by those child nodes,
        // not by this one.
        key_decisions: "a child strings node, not a field of the parent row -- an editable row per entry, like work highlights.",
        followup_items: "a child strings node, not a field of the parent row -- an editable row per entry, like work highlights.",
      },
    });

    // -----------------------------------------------------------------------
    // wave 12: what an expanded entry shows and what it lets you edit
    // -----------------------------------------------------------------------

    it("shows the full timestamp in the body, not only as a collapsed-row chip", async () => {
      // The chip is a glance. The body is where an entry is read, and a
      // learning entry's time of day was reachable nowhere once the chip
      // rendered a date-shaped value.
      const { user } = renderSection({ pack: learningLogPack, initial: learningLogData });
      await user.click(screen.getByText("React Server Components"));
      // TZ is pinned to America/New_York for the suite, so 09:30Z is 04:30.
      expect(screen.getAllByText("2026-01-15 04:30").length).toBeGreaterThan(1);
    });

    it("labels the body timestamp so it reads as a field, not a stray string", async () => {
      const { user } = renderSection({ pack: learningLogPack, initial: learningLogData });
      await user.click(screen.getByText("React Server Components"));
      expect(screen.getByText("timestamp")).toBeInTheDocument();
    });

    it("gives each key decision its own editable row", async () => {
      // They were ArrayInput chips until wave 12, so fixing a typo meant
      // deleting the chip and retyping the whole sentence.
      const { user, latest } = renderSection({ pack: learningLogPack, initial: learningLogData });
      await user.click(screen.getByText("React Server Components"));
      const row = screen.getByDisplayValue("Adopt RSC for the docs site only");
      await user.type(row, "!");
      expect(latest().entries[0].key_decisions).toEqual([
        "Adopt RSC for the docs site only!",
      ]);
    });

    it("gives each follow-up item its own editable row", async () => {
      const { user, latest } = renderSection({ pack: learningLogPack, initial: learningLogData });
      await user.click(screen.getByText("React Server Components"));
      const row = screen.getByDisplayValue("Read the migration guide");
      await user.type(row, "!");
      expect(latest().entries[0].followup_items).toEqual(["Read the migration guide!"]);
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
      await user.click(screen.getByRole("button", { name: "About Circle" }));
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
    describe("projects.references child list", () => {
      describeGuards({
        pack: projectsPack, listKey: ["projects", "references"], data: projectsData,
        exclusions: {},
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
    const topOfMindBlock = () => uiNode("Top of Mind");

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
      await user.click(headerAdd(within(topOfMindBlock())));

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
      await user.click(screen.getByRole("button", { name: "About Projects" }));
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
    // The four `references` child lists across the packs are the same entity
    // shape (`*_reference`) and had no coverage guard at all before wave 10.
    // `hobby_reference` is the reason this matters: its entity declares
    // `ref_name` as the identifier while the row stores `name`, a divergence
    // wave 5 had to record in the manifest by hand because no guard saw it.
    describe("domains.references child list", () => {
      describeGuards({
        pack: knowledgePack, listKey: ["domains", "references"], data: knowledgeData,
        exclusions: {},
      });
    });
    describe("mental_tabs.references child list", () => {
      describeGuards({
        pack: knowledgePack, listKey: ["mental_tabs", "references"], data: knowledgeData,
        exclusions: {},
      });
    });

    const domainsBlock = () => uiNode("Skills & Domains");
    const mentalTabsBlock = () => uiNode("Mental Tabs");
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
      await user.click(headerAdd(within(mentalTabsBlock())));

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
      await user.click(headerAdd(within(mentalTabsBlock())));
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
      // No heading of the node's OWN, which is the point -- but two now read the
      // pack's name: the page title block (h2) and the card that node borrows it
      // for (h3). The prototype duplicates it exactly this way, Figma 114:604.
      expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Goals", "Goals"]);
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
            { kind: "table", path: ["profile"] },
            { kind: "list", path: ["goals"], entity: "goal", title_field: "title" },
          ],
        },
      };
      const data = { profile: { name: "irrelevant" }, goals: [{ title: "Ship it" }] };

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      renderSection({ pack, initial: data });

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("table"));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("mixed"));
      expect(screen.getByText("Ship it")).toBeInTheDocument();

      errorSpy.mockRestore();
    });

    // renderNode returns null for a kind it doesn't support (logging as
    // asserted above), but SectionRenderer's own per-node wrapper -- the
    // `<div className="space-y-3">` and the node.title heading -- must not be
    // emitted around that null. Otherwise a titled node of a not-yet-
    // -implemented kind renders an empty,
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
            { kind: "table", path: ["profile"], title: "Basics" },
            { kind: "list", path: ["goals"], entity: "goal", title_field: "title" },
          ],
        },
      };
      const data = { profile: { name: "irrelevant" }, goals: [{ title: "Ship it" }] };

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      renderSection({ pack, initial: data });

      // No heading for the rejected "fields" node. Two remain, both the pack's
      // name: the page title block, and the untitled list's card, which borrows
      // the pack title because that card is the only header it has.
      expect(screen.queryByRole("heading", { name: "Basics" })).not.toBeInTheDocument();
      expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Mixed", "Mixed"]);
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
            { kind: "table" },
            { kind: "list", path: ["goals"], entity: "goal", title_field: "title" },
          ],
        },
      };
      const data = { goals: [{ title: "Ship it" }] };

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => renderSection({ pack, initial: data })).not.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("table"));
      expect(screen.getByText("Ship it")).toBeInTheDocument();

      errorSpy.mockRestore();
    });
  });

  // The two kinds wave 5 added, exercised end to end through SectionRenderer
  // rather than through renderNode alone -- the piece neither renderer's own
  // tests can cover is `onChange(setAt(data, node.path, next))`, which is what
  // puts an edit back at a NESTED path without disturbing its siblings.
  describe("strings and fields nodes", () => {
    const pack = {
      key: "wellness",
      title: "Wellness",
      description: "",
      entities: { sleep: { optional: ["bedtime", "wakeup"] } },
      ui: {
        sections: [
          {
            kind: "fields",
            path: ["wellness", "sleep", "weekday"],
            entity: "sleep",
            fields: ["bedtime", "wakeup"],
            title: "Weekday",
          },
          {
            kind: "strings",
            path: ["wellness", "energy_peaks"],
            title: "Energy peaks",
            placeholder: "e.g. Early morning...",
          },
        ],
      },
    };
    const data = {
      wellness: {
        sleep: { weekday: { bedtime: "23:30", wakeup: "07:00" }, weekend: { bedtime: "01:00" } },
        energy_peaks: ["late night"],
      },
    };

    it("renders both kinds under their own headings", () => {
      renderSection({ pack, initial: data });

      expect(screen.getByRole("heading", { name: "Weekday" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Energy peaks" })).toBeInTheDocument();
      expect(screen.getByLabelText("Bedtime")).toHaveValue("23:30");
      expect(screen.getByText("late night")).toBeInTheDocument();
    });

    it("writes a fields edit back at its nested path, leaving its siblings alone", async () => {
      const { user, latest } = renderSection({ pack, initial: data });

      await user.clear(screen.getByLabelText("Wakeup"));
      await user.type(screen.getByLabelText("Wakeup"), "06:30");

      const wellness = latest().wellness;
      expect(wellness.sleep.weekday.wakeup).toBe("06:30");
      // The sibling day, and the sibling key beside it, are untouched.
      expect(wellness.sleep.weekday.bedtime).toBe("23:30");
      expect(wellness.sleep.weekend).toEqual({ bedtime: "01:00" });
      expect(wellness.energy_peaks).toEqual(["late night"]);
    });

    it("writes a strings edit back at its nested path, leaving its siblings alone", async () => {
      const { user, latest } = renderSection({ pack, initial: data });

      await user.type(screen.getByPlaceholderText("e.g. Early morning..."), "early morning{Enter}");

      expect(latest().wellness.energy_peaks).toEqual(["late night", "early morning"]);
      expect(latest().wellness.sleep.weekday.bedtime).toBe("23:30");
    });

    it("renders both kinds for a section with no stored data at all", async () => {
      // A new account. Waves 3 and 4 both shipped sections that rendered
      // nothing usable here.
      const { user, latest } = renderSection({ pack, initial: {} });

      expect(screen.getByLabelText("Bedtime")).toHaveValue("");
      await user.type(screen.getByPlaceholderText("e.g. Early morning..."), "dawn{Enter}");

      expect(latest().wellness.energy_peaks).toEqual(["dawn"]);
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

// Two UI changes requested after wave 4 shipped: the info "i" belongs beside
// the heading that explains it rather than inside the list body, and Top of
// Mind reads better as a named sub-section above Projects than as an
// afterthought below it.
describe("section headings and info placement", () => {
  it("puts Top of Mind above Projects, each under its own heading", () => {
    renderSection({ pack: projectsPack, initial: projectsData });

    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    // The Card title comes first, then the two sub-sections in manifest order.
    expect(headings.indexOf("Top of Mind")).toBeGreaterThan(-1);
    expect(headings.indexOf("Top of Mind")).toBeLessThan(headings.indexOf("Projects", 1));
  });

  it("puts each list's info button beside its own heading, not in the list body", () => {
    renderSection({ pack: projectsPack, initial: projectsData });

    for (const title of ["Top of Mind", "Projects"]) {
      const heading = screen.getAllByRole("heading", { name: title }).at(-1);
      const button = screen.getByRole("button", { name: `About ${title}` });
      // Same heading row, so the icon reads as belonging to that heading.
      expect(heading.parentElement).toBe(button.parentElement);
    }
  });


  // -------------------------------------------------------------------------
  // lifestyle (wave 5) -- the first section that is not all lists. It exercises
  // every node kind at once: two `list` nodes (one with a child list), four
  // `strings` nodes and two `fields` nodes.
  //
  // Three traps this pack carries, all recorded in
  // docs/superpowers/plans/2026-07-29-wave-5-storage-keys-reference.md:
  //   - `personality_traits`/`values`/`energy_peaks`/`stress_triggers` store
  //     BARE STRINGS. The entities' `trait`/`value` field names are MCP input
  //     spellings that are never stored (CANONICAL_STORED_KEY maps both to
  //     None), so those nodes bind no entity and name no fields.
  //   - a hobby's `references` rows store `name`, not the `ref_name` the
  //     entity declares as its identifier -- declared via
  //     fields_outside_entity.
  //   - `sleep`'s `day_type` is a router selecting which fixed sub-object to
  //     write; it is never itself stored, so no node binds it.
  // -------------------------------------------------------------------------
  describe("lifestyle", () => {
    describe("hobbies list", () => {
      describeGuards({
        pack: lifestylePack, listKey: "hobbies", data: lifestyleData,
        exclusions: {
          id: MACHINE_ID,
          last_updated: "machine-written stamp (server.py:1743); no control models it and this node names no display_fields.",
          references: "a child list node, not a field of the parent row -- covered by the reference round-trip test below.",
        },
      });
    });
    describe("hobbies.references child list", () => {
      describeGuards({
        pack: lifestylePack, listKey: ["hobbies", "references"], data: lifestyleData,
        exclusions: {},
      });
    });
    describe("interests list", () => {
      describeGuards({
        pack: lifestylePack, listKey: "interests", data: lifestyleData,
        exclusions: {},
      });
    });

    // Located by heading rather than DOM position so these survive a
    // reordering of the manifest's sections.
    const block = uiNode;

    it("renders every node kind the pack declares", () => {
      renderSection({ pack: lifestylePack, initial: lifestyleData });

      // list
      expect(screen.getByText("Bouldering")).toBeInTheDocument();
      expect(screen.getByText("Typography")).toBeInTheDocument();
      // strings -- bare strings, rendered as their own text
      expect(screen.getByText("analytical")).toBeInTheDocument();
      expect(screen.getByText("integrity")).toBeInTheDocument();
      expect(screen.getByText("early morning")).toBeInTheDocument();
      expect(screen.getByText("context switching")).toBeInTheDocument();
      // fields
      expect(within(block("Sleep — weekdays")).getByLabelText("Bedtime")).toHaveValue("23:30");
      expect(within(block("Sleep — weekends")).getByLabelText("Wakeup")).toHaveValue("09:30");
    });

    it("renders a hobby's stored `paused` status, which the manifest now declares in full", async () => {
      // Until 2026-07-29 execute_modify collapsed "paused" to "inactive" on
      // write, so this value could exist in storage but never be written by
      // an AI client. Both halves are fixed; this pins the read half -- as a
      // read-only chip on the collapsed row, and as a bound, selected control
      // once the row is expanded.
      const { user } = renderSection({ pack: lifestylePack, initial: lifestyleData });

      expect(screen.getByText("paused")).toBeInTheDocument();

      await user.click(screen.getByText("Film photography"));
      expect(screen.getByRole("button", { name: "paused", pressed: true })).toBeInTheDocument();
    });

    it("round-trips an edit to a hobby's `references` child, storing `name`", async () => {
      const { user, latest } = renderSection({ pack: lifestylePack, initial: lifestyleData });

      await user.click(screen.getByText("Bouldering"));
      // A child row shows its title as text until it too is expanded.
      const refs = uiNode("References & URLs");
      await user.click(within(refs).getByText("Local gym"));
      await user.type(within(refs).getByDisplayValue("Local gym"), " B");

      const stored = latest().hobbies[0].references[0];
      expect(stored.name).toBe("Local gym B");
      expect(stored).not.toHaveProperty("ref_name");
      expect(stored.url).toBe("https://example.invalid/gym");
    });

    it("round-trips a hobby's `specifics` array without touching sibling hobbies", async () => {
      const { user, latest } = renderSection({ pack: lifestylePack, initial: lifestyleData });

      await user.click(screen.getByText("Bouldering"));
      // Edit-field labels render lowercase (CSS `capitalize` does the rest).
      // An edit-field label sits directly beside its control:
      // <div><Label>specifics</Label><ScalarField/></div>. That is one level
      // shallower than the section wrappers `block` walks.
      const specifics = screen.getByText("specifics").parentElement;
      await user.type(within(specifics).getByRole("textbox"), "crimps{Enter}");

      expect(latest().hobbies[0].specifics).toEqual(["overhangs", "slab", "crimps"]);
      expect(latest().hobbies[2].specifics).toEqual(["sourdough"]);
    });

    it("writes a strings edit to the right path, leaving the other strings nodes alone", async () => {
      const { user, latest } = renderSection({ pack: lifestylePack, initial: lifestyleData });

      await user.type(
        within(block("Values")).getByRole("textbox"),
        "curiosity{Enter}"
      );

      expect(latest().values).toEqual(["integrity", "growth", "curiosity"]);
      expect(latest().personality_traits).toEqual(["analytical", "detail-oriented"]);
      expect(latest().wellness.energy_peaks).toEqual(["early morning", "late evening"]);
    });

    it("writes a sleep edit into one day only", async () => {
      const { user, latest } = renderSection({ pack: lifestylePack, initial: lifestyleData });

      const bedtime = within(block("Sleep — weekdays")).getByLabelText("Bedtime");
      await user.clear(bedtime);
      await user.type(bedtime, "22:45");

      expect(latest().wellness.sleep.weekday).toEqual({ bedtime: "22:45", wakeup: "07:00" });
      expect(latest().wellness.sleep.weekend).toEqual({ bedtime: "01:00", wakeup: "09:30" });
    });

    it("never stores `day_type`, which is a router and not a storage key", async () => {
      const { user, latest } = renderSection({ pack: lifestylePack, initial: lifestyleData });

      const wakeup = within(block("Sleep — weekends")).getByLabelText("Wakeup");
      await user.clear(wakeup);
      await user.type(wakeup, "10:00");

      expect(latest().wellness.sleep.weekend).not.toHaveProperty("day_type");
      expect(screen.queryByLabelText(/day type/i)).not.toBeInTheDocument();
    });

    it("renders sleep times as time pickers, and a non-HH:MM value as text", () => {
      const odd = {
        ...lifestyleData,
        wellness: {
          ...lifestyleData.wellness,
          sleep: { weekday: { bedtime: "after midnight", wakeup: "07:00" }, weekend: {} },
        },
      };
      renderSection({ pack: lifestylePack, initial: odd });

      const weekday = block("Sleep — weekdays");
      // Nothing validates these on write, so a picker would show the free-text
      // value as empty and persist that emptiness on the next edit.
      // shadcn's Input renders no `type` attribute at all when it is a plain
      // text field, so this asserts the absence of the picker rather than the
      // presence of type="text".
      expect(within(weekday).getByLabelText("Bedtime")).not.toHaveAttribute("type", "time");
      expect(within(weekday).getByLabelText("Bedtime")).toHaveValue("after midnight");
      expect(within(weekday).getByLabelText("Wakeup")).toHaveAttribute("type", "time");
    });

    it("gives every group a usable control on a brand-new account", () => {
      // Waves 3 and 4 both shipped sections with no reachable way to add a
      // first item, so each migration asserts the empty state explicitly.
      renderSection({ pack: lifestylePack, initial: {} });

      // Two each, on an empty list: the header trigger (visibly a bare "Add",
      // labelled for a screen reader) and the empty panel's call to action.
      expect(screen.getAllByRole("button", { name: "Add hobby" })).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: "Add interest" })).toHaveLength(2);
      for (const heading of ["Personality Traits", "Values", "Energy Peaks", "Stress Triggers"]) {
        expect(within(block(heading)).getByRole("textbox")).toBeEnabled();
      }
      expect(within(block("Sleep — weekdays")).getByLabelText("Bedtime")).toHaveValue("");
    });

    it("adds the first value on an empty account at the right path", async () => {
      const { user, latest } = renderSection({ pack: lifestylePack, initial: {} });

      await user.type(within(block("Values")).getByRole("textbox"), "integrity{Enter}");

      expect(latest().values).toEqual(["integrity"]);
    });
  });


  // -------------------------------------------------------------------------
  // preferences (wave 5) -- five `strings` nodes, one `fields` node and two
  // `list` nodes, and the section that carries this wave's second live bug.
  //
  // The retired editor wrote a mood override's name under `when_feeling`;
  // execute_modify has always written `mood` (server.py:2247). Every MCP
  // lookup resolves on `o.get("mood")`, so a UI-written override could never
  // be updated or removed and a second add for the same mood duplicated it,
  // while an AI-written one rendered as "Untitled mood". The manifest binds
  // `mood`; persona_store._normalize backfills the legacy key.
  // -------------------------------------------------------------------------
  describe("preferences", () => {
    // No describeGuards for mood_overrides: it locates a node by `path[0]`,
    // which cannot distinguish the two nodes under `communication` (the
    // `default` fields node and the `mood_overrides` list). The explicit
    // tests below cover that list instead.
    describe("likes_dislikes list", () => {
      describeGuards({
        pack: preferencesPack, listKey: "likes_dislikes", data: preferencesData,
        exclusions: {},
      });
    });

    const block = uiNode;

    it("renders every node kind the pack declares", () => {
      renderSection({ pack: preferencesPack, initial: preferencesData });

      expect(screen.getByText("Python")).toBeInTheDocument();
      expect(screen.getByText("hands-on examples")).toBeInTheDocument();
      expect(screen.getByLabelText("Tone")).toHaveValue("friendly but direct");
      expect(screen.getByText("stressed")).toBeInTheDocument();
      expect(screen.getByText("worked examples")).toBeInTheDocument();
    });

    it("renders a mood override by its stored `mood`, not the retired `when_feeling`", () => {
      renderSection({ pack: preferencesPack, initial: preferencesData });
      for (const o of preferencesData.communication.mood_overrides) {
        expect(screen.getByText(o.mood)).toBeInTheDocument();
      }
      expect(screen.queryByText("Untitled mood")).not.toBeInTheDocument();
    });

    it("writes a new mood override under `mood`, the key execute_modify reads", async () => {
      // The write half, and the half that loses data: an override stored
      // under `when_feeling` is unreachable by every MCP lookup.
      const { user, latest } = renderSection({ pack: preferencesPack, initial: preferencesData });

      await user.click(headerAdd(within(block("When I'm feeling..."))));
      const dialog = screen.getByRole("dialog");
      await user.type(within(dialog).getAllByRole("textbox")[0], "tired");
      await user.click(within(dialog).getByRole("button", { name: "Add" }));

      const added = latest().communication.mood_overrides.find((o) => o.mood === "tired");
      expect(added).toBeTruthy();
      expect(added).not.toHaveProperty("when_feeling");
    });

    it("never binds `locale` on a mood override -- no branch stores it there", () => {
      // The retired editor wrote it; server.py:2245-2249 writes only tone and
      // detail_level. Binding it would render a control whose edits no AI
      // client can ever see.
      renderSection({ pack: preferencesPack, initial: preferencesData });
      const moods = block("When I'm feeling...");
      expect(within(moods).queryByLabelText(/locale/i)).not.toBeInTheDocument();
    });

    it("keeps likes and dislikes in ONE list, discriminated by stance", () => {
      renderSection({ pack: preferencesPack, initial: preferencesData });
      const list = block("Likes & Dislikes");

      expect(within(list).getByText("worked examples")).toBeInTheDocument();
      expect(within(list).getByText("unsolicited sales tone")).toBeInTheDocument();
    });

    it("flips a row's stance without disturbing the other rows", async () => {
      const { user, latest } = renderSection({ pack: preferencesPack, initial: preferencesData });

      await user.click(screen.getByText("worked examples"));
      // `stance` is also a facet, so the filter bar renders its own "stance"
      // label and its own like/dislike buttons. Scope to this row via its
      // remove button, whose accessible name carries the row's title -- the
      // one handle in the markup that is unique per row.
      const row = screen
        .getByRole("button", { name: "Remove worked examples" })
        .closest("div").parentElement;
      await user.click(within(row).getByRole("button", { name: "dislike" }));

      expect(latest().likes_dislikes[0]).toEqual({
        item: "worked examples",
        stance: "dislike",
      });
      expect(latest().likes_dislikes[1]).toEqual({
        item: "unsolicited sales tone",
        stance: "dislike",
      });
    });

    it("writes the communication default without touching the overrides beside it", async () => {
      const { user, latest } = renderSection({ pack: preferencesPack, initial: preferencesData });

      const locale = screen.getByLabelText("Locale");
      await user.clear(locale);
      await user.type(locale, "American English");

      expect(latest().communication.default.locale).toBe("American English");
      expect(latest().communication.default.tone).toBe("friendly but direct");
      expect(latest().communication.mood_overrides).toHaveLength(2);
    });

    it("keeps the three code_style lists independent of each other", async () => {
      const { user, latest } = renderSection({ pack: preferencesPack, initial: preferencesData });

      await user.type(within(block("Tools")).getByRole("textbox"), "tmux{Enter}");

      expect(latest().code_style.tools).toEqual(["VS Code", "Docker", "tmux"]);
      expect(latest().code_style.frameworks).toEqual(["FastAPI", "React"]);
      expect(latest().learning_style.preferred).toEqual(["hands-on examples", "diagrams"]);
    });

    it("renders detail_level as a textarea, as the retired editor did", () => {
      renderSection({ pack: preferencesPack, initial: preferencesData });
      expect(screen.getByLabelText("Detail level").tagName).toBe("TEXTAREA");
    });

    it("gives every group a usable control on a brand-new account", () => {
      renderSection({ pack: preferencesPack, initial: {} });

      for (const heading of ["Preferred Languages", "Frameworks", "Tools",
                             "Preferred Methods", "Things to Avoid"]) {
        expect(within(block(heading)).getByRole("textbox")).toBeEnabled();
      }
      expect(screen.getByLabelText("Tone")).toHaveValue("");
      expect(screen.getAllByRole("button", { name: "Add mood override" })).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: "Add like" })).toHaveLength(2);
    });
  });


  // -------------------------------------------------------------------------
  // kind: "group" -- the two-level structure the hand-written editors had.
  // Every retired editor rendered several Cards, each a named group over a few
  // controls ("Code Style" over its three lists, "Wellness" over sleep/energy/
  // stress). Waves 2-4 had no section that needed it; wave 5's two both did,
  // and flattening them lost the group names entirely.
  // -------------------------------------------------------------------------
  describe("a group node", () => {
    const pack = {
      key: "grouped",
      title: "Grouped",
      description: "",
      entities: {},
      ui: {
        sections: [
          {
            kind: "group",
            title: "Code Style",
            description: "Languages, frameworks and tools",
            sections: [
              { kind: "strings", path: ["code_style", "frameworks"], title: "Frameworks" },
              { kind: "strings", path: ["code_style", "tools"], title: "Tools" },
            ],
          },
          { kind: "strings", path: ["loose"], title: "Ungrouped" },
        ],
      },
    };
    const data = { code_style: { frameworks: ["React"], tools: ["Docker"] }, loose: ["x"] };

    it("renders the group's heading and description over its children", () => {
      renderSection({ pack, initial: data });

      expect(screen.getByRole("heading", { name: "Code Style" })).toBeInTheDocument();
      expect(screen.getByText("Languages, frameworks and tools")).toBeInTheDocument();
      expect(within(uiNode("Code Style")).getByText("React")).toBeInTheDocument();
      expect(within(uiNode("Code Style")).getByText("Docker")).toBeInTheDocument();
    });

    it("keeps a grouped node's path resolving against the SECTION root", async () => {
      // A group is a visual container, not a data scope -- unlike a list
      // node's `children`, whose paths resolve against the row's item.
      const { user, latest } = renderSection({ pack, initial: data });

      await user.type(within(uiNode("Frameworks")).getByRole("textbox"), "Vue{Enter}");

      expect(latest().code_style.frameworks).toEqual(["React", "Vue"]);
      expect(latest().code_style.tools).toEqual(["Docker"]);
    });

    it("leaves an ungrouped sibling at the top level", () => {
      renderSection({ pack, initial: data });
      expect(within(uiNode("Ungrouped")).getByText("x")).toBeInTheDocument();
      expect(uiNode("Code Style")).not.toContainElement(uiNode("Ungrouped"));
    });

    it("gives a grouped child a lower-level heading than a top-level node", () => {
      renderSection({ pack, initial: data });

      expect(screen.getByRole("heading", { name: "Code Style", level: 3 })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Frameworks", level: 4 })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Ungrouped", level: 3 })).toBeInTheDocument();
    });

    it("renders nothing, and logs, for a group with no sections", () => {
      // A heading over an empty space is the same defect as a heading over a
      // rejected node, and gets the same treatment.
      const empty = {
        ...pack,
        ui: { sections: [{ kind: "group", title: "Hollow", sections: [] }] },
      };
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      renderSection({ pack: empty, initial: {} });

      expect(screen.queryByText("Hollow")).not.toBeInTheDocument();
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("grouped"));
      spy.mockRestore();
    });

    it("renders nothing for a group whose every child is rejected", () => {
      const allBad = {
        ...pack,
        ui: {
          sections: [
            { kind: "group", title: "Hollow", sections: [{ kind: "table", path: ["x"] }] },
          ],
        },
      };
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      renderSection({ pack: allBad, initial: {} });

      expect(screen.queryByRole("heading", { name: "Hollow" })).not.toBeInTheDocument();
      spy.mockRestore();
    });


    // The separator suite that stood here is gone with the rules themselves.
    // A group used to be a heading inside one big card, so an `<hr>` after each
    // one -- but only where something followed it -- was what made the boundary
    // visible. The eyebrow band carries its own rule now and a 32px gap ends the
    // run, so there is nothing left to place conditionally. What the deleted
    // tests protected is covered instead by "the section's structure" below:
    // no separator survives, one band per group, and a leaf after a group starts
    // its own run rather than sitting under that group's label.

    it("draws a node's `description` for every kind, not only strings", () => {
      // It used to live in StringsRenderer alone, so the copy declared on
      // preferences' communication-default (fields) and mood-overrides (list)
      // nodes rendered nowhere at all.
      const mixed = {
        key: "mixed",
        title: "Mixed",
        description: "",
        entities: {},
        ui: {
          sections: [
            {
              kind: "fields",
              path: ["comm"],
              title: "Default",
              description: "always active",
              fields: ["tone"],
            },
          ],
        },
      };
      renderSection({ pack: mixed, initial: {} });
      expect(screen.getByText("always active")).toBeInTheDocument();
    });
  });


  // -------------------------------------------------------------------------
  // profile (wave 6) -- the last bespoke editor, and the section whose entity
  // vocabulary turned out to be substantially fiction: it declared seven field
  // names nothing stored and omitted seven that were stored. Wave 6 corrected
  // the vocabulary rather than declaring the divergences, which is why this
  // pack ships zero `fields_outside_entity`.
  //
  // Two beliefs the reading overturned: `profile` is not "entirely kind:
  // fields" (one fields node, four lists), and there is NO second level of
  // child list -- education.coursework is a bare string array, not objects.
  // -------------------------------------------------------------------------
  describe("profile", () => {
    const CHILD_NODE =
      "a child node, not a field of the parent row -- covered by the nesting tests below.";
    describe("education list", () => {
      describeGuards({
        pack: profilePack, listKey: "education", data: profileData,
        exclusions: { coursework: CHILD_NODE, clubs: CHILD_NODE, highlights: CHILD_NODE },
      });
    });
    // The child lists themselves. `CHILD_NODE` above says these are "covered by
    // the nesting tests below" -- until wave 10 that was true only of the
    // hand-written nesting tests, which check that the child renders and round
    // trips, not that the manifest still names every key the data carries.
    // These are entity-bearing nodes and now get the same two-way guard every
    // top-level list has had since wave 2.
    describe("education.coursework child list", () => {
      describeGuards({
        pack: profilePack, listKey: ["education", "coursework"], data: profileData,
        exclusions: {},
      });
    });
    describe("education.clubs child list", () => {
      describeGuards({
        pack: profilePack, listKey: ["education", "clubs"], data: profileData,
        exclusions: {},
      });
    });
    describe("work_experience list", () => {
      describeGuards({
        pack: profilePack, listKey: "work_experience", data: profileData,
        exclusions: { highlights: CHILD_NODE, skills: CHILD_NODE },
      });
    });
    describe("languages_spoken list", () => {
      describeGuards({
        pack: profilePack, listKey: "languages_spoken", data: profileData, exclusions: {},
      });
    });

    it("binds the seven top-level scalars through a fields node at the section root", () => {
      renderSection({ pack: profilePack, initial: profileData });

      expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
      expect(screen.getByLabelText("Preferred name")).toHaveValue("Ada");
      expect(screen.getByLabelText("Bio").tagName).toBe("TEXTAREA");
    });

    it("writes a root-level scalar without replacing the whole section", async () => {
      // path: [] means setAt returns the new value outright, so this only
      // works because FieldsRenderer spreads the stored object first. If it
      // did not, the first keystroke would discard education, work and contact.
      const { user, latest } = renderSection({ pack: profilePack, initial: profileData });

      const preferred = screen.getByLabelText("Preferred name");
      await user.clear(preferred);
      await user.type(preferred, "Ada L");

      expect(latest().preferred_name).toBe("Ada L");
      expect(latest().name).toBe("Ada Lovelace");
      expect(latest().education).toHaveLength(1);
      expect(latest().contact.emails).toHaveLength(1);
    });

    it("binds education's real stored keys, never the phantoms it used to declare", async () => {
      const { user } = renderSection({ pack: profilePack, initial: profileData });
      await user.click(screen.getByText("Northumbria University"));

      expect(screen.getByDisplayValue("BSc")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Computer Science")).toBeInTheDocument();
      // `period` mapped to TWO stored keys, so no control could ever bind it.
      expect(screen.queryByText("period")).not.toBeInTheDocument();
      expect(screen.queryByText("degree")).not.toBeInTheDocument();
      expect(screen.queryByText("field")).not.toBeInTheDocument();
    });

    // ---- the two-level nesting: education -> coursework -> topics ----------
    //
    // The spec's wave table called this out from the start; a reading of
    // execute_modify alone denied it, because that branch appended a bare
    // string while the editor wrote {name, topics} objects into the same list.
    // Reading only the backend is what made this look flat.

    it("renders coursework as objects with their own nested topics", async () => {
      const { user } = renderSection({ pack: profilePack, initial: profileData });
      await user.click(screen.getByText("Northumbria University"));

      const coursework = uiNode("Coursework / Modules");
      expect(within(coursework).getByText("Compilers")).toBeInTheDocument();
      expect(within(coursework).getByText("Distributed Systems")).toBeInTheDocument();

      await user.click(within(coursework).getByText("Compilers"));
      expect(screen.getByText("parsing")).toBeInTheDocument();
      expect(screen.getByText("codegen")).toBeInTheDocument();
    });

    it("writes a nested topic into the right course, two levels down", async () => {
      const { user, latest } = renderSection({ pack: profilePack, initial: profileData });
      await user.click(screen.getByText("Northumbria University"));
      await user.click(within(uiNode("Coursework / Modules")).getByText("Compilers"));

      const topics = screen.getByText("topics").parentElement;
      await user.type(within(topics).getByRole("textbox"), "optimisation{Enter}");

      const cw = latest().education[0].coursework;
      expect(cw[0]).toEqual({ name: "Compilers", topics: ["parsing", "codegen", "optimisation"] });
      expect(cw[1]).toEqual({ name: "Distributed Systems", topics: [] });
    });

    it("stores a course under `name`, never the entity's input spelling `course`", async () => {
      const { user, latest } = renderSection({ pack: profilePack, initial: profileData });
      await user.click(screen.getByText("Northumbria University"));

      const coursework = uiNode("Coursework / Modules");
      await user.click(headerAdd(within(coursework)));
      const dialog = screen.getByRole("dialog");
      await user.type(within(dialog).getAllByRole("textbox")[0], "Type Theory");
      await user.click(within(dialog).getByRole("button", { name: "Add" }));

      const added = latest().education[0].coursework.find((c) => c.name === "Type Theory");
      expect(added).toBeTruthy();
      expect(added).not.toHaveProperty("course");
    });

    it("renders clubs as objects with their own activities", async () => {
      const { user } = renderSection({ pack: profilePack, initial: profileData });
      await user.click(screen.getByText("Northumbria University"));

      const clubs = uiNode("Clubs & Societies");
      await user.click(within(clubs).getByText("Hackathon Society"));
      expect(screen.getByText("mentoring")).toBeInTheDocument();
    });

    it("edits a highlight in place rather than making the user retype it", async () => {
      // The retired editor gave each highlight its own input. Binding them as
      // chips meant deleting and retyping a whole sentence to fix a typo.
      const { user, latest } = renderSection({ pack: profilePack, initial: profileData });
      await user.click(screen.getByText("Acme"));

      const highlights = uiNode("Highlights");
      await user.type(within(highlights).getByDisplayValue("Halved the ingest latency"), "!");

      expect(latest().work_experience[0].highlights[0]).toBe("Halved the ingest latency!");
      expect(latest().work_experience[0].highlights[1]).toBe("Shipped the pack loader");
    });

    it("appends an empty highlight row ready to type into", async () => {
      const { user, latest } = renderSection({ pack: profilePack, initial: profileData });
      await user.click(screen.getByText("Acme"));

      await user.click(within(uiNode("Highlights")).getByRole("button", { name: /Add highlight/i }));

      expect(latest().work_experience[0].highlights).toEqual([
        "Halved the ingest latency", "Shipped the pack loader", "",
      ]);
    });

    it("binds work experience's `location` and `description`, real as of wave 6", async () => {
      const { user, latest } = renderSection({ pack: profilePack, initial: profileData });
      await user.click(screen.getByText("Acme"));

      expect(screen.getByDisplayValue("Remote")).toBeInTheDocument();
      await user.type(screen.getByDisplayValue("Backend work on the ingest pipeline."), "!");

      expect(latest().work_experience[0].description).toBe("Backend work on the ingest pipeline.!");
      expect(latest().work_experience[1].company).toBe("Bean There");
    });


    it("renders a role's skills as chips, beside its highlights", async () => {
      // Chips, not editable rows: skills are short, word-like values you add
      // and drop but never revise, and chips show many at a glance. A
      // highlight is a sentence where a typo means retyping the lot, which is
      // why that one is item_control: "input".
      const { user } = renderSection({ pack: profilePack, initial: profileData });
      await user.click(screen.getByText("Acme"));

      const skills = uiNode("Skills");
      expect(within(skills).getByText("Python")).toBeInTheDocument();
      expect(within(skills).getByText("PostgreSQL")).toBeInTheDocument();
      // Read the hint from the manifest rather than repeating it: placeholder
      // copy is wording, and a test that pins wording turns every copy edit
      // into a failing test for no behavioural reason.
      const node = normalizeUi(profilePack)
        .sections.flatMap((n) => n.children ?? [])
        .find((n) => n.title === "Skills");
      expect(within(skills).getByPlaceholderText(node.placeholder)).toBeInTheDocument();
    });

    it("appends a skill without touching highlights or the sibling role", async () => {
      // Both are bare-string lists on the same row, so a wrong path here would
      // write into the other one silently.
      const { user, latest } = renderSection({ pack: profilePack, initial: profileData });
      await user.click(screen.getByText("Acme"));

      await user.type(within(uiNode("Skills")).getByRole("textbox"), "Go{Enter}");

      const jobs = latest().work_experience;
      expect(jobs[0].skills).toEqual(["Python", "PostgreSQL", "Go"]);
      expect(jobs[0].highlights).toEqual(["Halved the ingest latency", "Shipped the pack loader"]);
      expect(jobs[1].skills).toEqual([]);
    });

    it("offers a usable skills control on a role that has none", async () => {
      const { user, latest } = renderSection({ pack: profilePack, initial: profileData });
      await user.click(screen.getByText("Bean There"));

      await user.type(within(uiNode("Skills")).getByRole("textbox"), "Latte art{Enter}");

      expect(latest().work_experience[1].skills).toEqual(["Latte art"]);
      expect(latest().work_experience[0].skills).toEqual(["Python", "PostgreSQL"]);
    });

    it("stores a language's `fluency`, never the alias `proficiency`", async () => {
      const { user, latest } = renderSection({ pack: profilePack, initial: profileData });
      await user.click(screen.getByText("Welsh"));

      const row = screen.getByRole("button", { name: "Remove Welsh" }).closest("div").parentElement;
      await user.click(within(row).getByRole("button", { name: "fluent" }));

      expect(latest().languages_spoken[1]).toEqual({ name: "Welsh", fluency: "fluent" });
      expect(latest().languages_spoken[0]).toEqual({ name: "English", fluency: "native" });
    });

    it("groups emails and links under Contact & Links", () => {
      renderSection({ pack: profilePack, initial: profileData });

      const contact = uiNode("Contact & Links");
      expect(within(contact).getByText("ada@example.invalid")).toBeInTheDocument();
      expect(within(contact).getByText("GitHub")).toBeInTheDocument();
    });

    it("stores an email's `purpose`, the key its add branch requires", async () => {
      const { user, latest } = renderSection({ pack: profilePack, initial: profileData });
      await user.click(screen.getByText("ada@example.invalid"));

      const purpose = screen.getByText("purpose").parentElement;
      await user.type(within(purpose).getByRole("textbox"), "!");

      expect(latest().contact.emails[0].purpose).toBe("primary!");
      expect(latest().contact.emails[0]).not.toHaveProperty("label");
    });

    it("gives every group a usable Add on a brand-new account", () => {
      renderSection({ pack: profilePack, initial: {} });

      expect(screen.getByLabelText("Name")).toHaveValue("");
      for (const label of ["Add education", "Add work experience", "Add email",
                           "Add link", "Add language"]) {
        // The header trigger and the empty panel's button, both naming what
        // they add -- neither route leaves a screen reader with a bare "Add".
        expect(screen.getAllByRole("button", { name: label })).toHaveLength(2);
      }
    });

    it("writes the first scalar on an empty account without inventing siblings", async () => {
      const { user, latest } = renderSection({ pack: profilePack, initial: {} });

      await user.type(screen.getByLabelText("Name"), "Ada");

      expect(latest()).toEqual({ name: "Ada" });
    });
  });

  it("keeps an untitled section's info beside the card title, where its only heading is", () => {
    renderSection({ pack: circlePack, initial: circleData });

    const button = screen.getByRole("button", { name: "About Circle" });
    // Beside the heading, not inside it. The pack title used to render the "i"
    // INSIDE its CardTitle, which put the button's own label into the heading's
    // accessible name; every node-level heading already did it this way.
    const cardTitle = screen.getByRole("heading", { name: "Circle", level: 3 });
    expect(cardTitle.parentElement).toContainElement(button);
  });

  it("labels each Add button with the singular entity, not the plural heading", () => {
    // Empty, so both ways into each list are on screen: the header trigger and
    // the empty panel's call to action. They name the same action, so they name
    // it the same way -- the trigger via aria-label, the panel visibly.
    renderSection({ pack: knowledgePack, initial: {} });

    // The headings are "Skills & Domains" and "Mental Tabs"; the buttons add
    // one thing each, so they name the entity.
    expect(screen.getAllByRole("button", { name: "Add domain" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Add mental tab" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Add Skills & Domains/ })).not.toBeInTheDocument();
    // And nothing is left announcing a bare "Add", which is what several list
    // nodes in one section used to give a screen reader: "Add", then "Add".
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Where the Add trigger sits, and where the count sits
//
// Two placements the design review asked for: the Add action moves out of the
// list body and up into the header row that NAMES the list, and the count
// moves down beside the filter whose effect it reports.
//
// The Add action is not built here even though the header is. Adding an item
// runs through useListItems.addItem, which needs ListRenderer's own `expanded`
// and `query` state to keep three invariants (see useListItems.js) -- so the
// trigger stays in ListRenderer and is portalled into a slot SectionRenderer
// places in the header. These tests pin the outcome (which row the button is
// in), never the mechanism, so the portal could be replaced by anything that
// lands the button in the same row.
// ---------------------------------------------------------------------------
describe("the Add trigger and the entry count", () => {
  // NodeHeading lays its row out as {title + info} | {action}, so the row is
  // the heading's grandparent: <div row><div>{h}{i}</div>{action}</div>.
  const headingRowOf = (nodeEl) =>
    nodeEl.querySelector("h3, h4").closest("div").parentElement;

  it("puts a titled list node's Add trigger in that node's own heading row, not in the list body", () => {
    renderSection({ pack: preferencesPack, initial: preferencesData });
    const nodeEl = uiNode("Likes & Dislikes");

    expect(
      headerAdd(within(headingRowOf(nodeEl)))
    ).toBeInTheDocument();
    // Exactly one: it MOVED, rather than gaining a second copy in the body.
    expect(within(nodeEl).getAllByText("Add", { selector: "button" })).toHaveLength(1);
  });

  it("puts an untitled node's Add trigger in its own card's header row, the only heading it has", () => {
    // Same reason the untitled node's "i" sits there: a node with no title of
    // its own is the section's main list, so the heading that describes it is
    // the one its card borrows from the pack. Scoped to level 3 because the page
    // title block above now reads the same word at h2.
    renderSection({ pack: goalsPack, initial: goalsData });

    const cardTitle = screen.getByRole("heading", { name: /Goals/, level: 3 });
    const headerRow = cardTitle.parentElement.parentElement;
    expect(headerRow).toContainElement(headerAdd());
    // The row is the header's, not the whole Card's -- otherwise this would
    // pass with the button still sitting down in the list body.
    expect(headerRow).not.toContainElement(screen.getByText("Ship MyGist v3"));
    expect(screen.getAllByText("Add", { selector: "button" })).toHaveLength(1);
  });

  it("does not let a child list inside an expanded row hijack its parent's header slot", async () => {
    // A child list is dispatched through the same seam from inside a row, so
    // it sees the same header slot its parent claimed. Both portalling into it
    // would put two Adds in the header and leave the child with none.
    const { user } = renderSection({ pack: projectsPack, initial: projectsData });
    await user.click(screen.getByText("MyGist"));

    expect(
      headerAdd(within(uiNode("References")))
    ).toBeInTheDocument();
    expect(
      within(headingRowOf(uiNode("Projects"))).getAllByText("Add", { selector: "button" })
    ).toHaveLength(1);
  });

  it("shows the entry count beside the filter row rather than above the list", () => {
    renderSection({ pack: preferencesPack, initial: preferencesData });
    const nodeEl = uiNode("Likes & Dislikes");

    const count = within(nodeEl).getByText(/\d+ entr(y|ies)/);
    // Same row as the filters, so the count reads as feedback on them.
    expect(count.parentElement).toContainElement(
      within(nodeEl).getByRole("group", { name: "Filters" })
    );
  });

  it("still shows the count for a list with no filters and no search box", () => {
    // It is the only thing telling the reader how long the list is, so it is
    // not conditional on there being a filter to sit beside.
    renderSection({ pack: preferencesPack, initial: preferencesData });
    const nodeEl = uiNode("When I'm feeling...");

    expect(within(nodeEl).queryByRole("group", { name: "Filters" })).not.toBeInTheDocument();
    expect(within(nodeEl).getByText(/2 entries/)).toBeInTheDocument();
  });
});

// The scroll-spy foothold, landed here in slice 1 so the rail merges with real
// anchors under it. Slice 2 restructures what sits INSIDE these wrappers (one
// card per subsection, under eyebrow bands); the contract the rail reads is
// stamped now, and does not change when that happens.
describe("scroll-spy anchors", () => {
  it("stamps every titled top-level node with its outline id, in order", () => {
    render(<SectionRenderer pack={preferencesPack} data={preferencesData} onChange={vi.fn()} />);
    const ids = [...document.querySelectorAll("[data-band]")].map((el) => el.dataset.band);
    // Asserted against outline() rather than a hand-written list: two
    // derivations of the same ids is the one thing this contract cannot afford.
    expect(ids).toEqual(outline(preferencesPack).map((b) => b.id));
    expect(ids).toEqual(["code-style", "communication", "learning-style", "likes-dislikes"]);
  });

  it("clears the sticky header, so clicking a rail item does not hide the heading under it", () => {
    render(<SectionRenderer pack={preferencesPack} data={preferencesData} onChange={vi.fn()} />);
    expect(document.querySelector("[data-band]").className).toContain("scroll-mt-[60px]");
  });

  it("keeps the wrapper's own spacing class rather than replacing it", () => {
    // The band attribute rides on the existing wrapper. Overwriting className
    // instead of extending it would strip space-y-4 and silently reflow every
    // grouped section in the app.
    render(<SectionRenderer pack={preferencesPack} data={preferencesData} onChange={vi.fn()} />);
    expect(document.querySelector('[data-band="code-style"]').className).toContain("space-y-4");
  });

  it("stamps nothing on a section whose only node is untitled", () => {
    render(<SectionRenderer pack={learningLogPack} data={learningLogData} onChange={vi.fn()} />);
    expect(document.querySelectorAll("[data-band]")).toHaveLength(0);
  });

  it("does not stamp a nested title -- a card heading is not a rail destination", () => {
    render(<SectionRenderer pack={preferencesPack} data={preferencesData} onChange={vi.fn()} />);
    const ids = [...document.querySelectorAll("[data-band]")].map((el) => el.dataset.band);
    // Response Format is a `strings` node INSIDE the Communication group.
    expect(ids).not.toContain("response-format");
  });

  it("stamps a node of every kind, not only groups", () => {
    // profile's top level is fields, list, list, group, list -- so this fails if
    // the stamp were attached to the group branch alone.
    render(<SectionRenderer pack={profilePack} data={profileData} onChange={vi.fn()} />);
    const ids = [...document.querySelectorAll("[data-band]")].map((el) => el.dataset.band);
    expect(ids).toEqual(outline(profilePack).map((b) => b.id));
    expect(ids).toContain("education");
    expect(ids).toContain("contact-links");
  });
});

// ---------------------------------------------------------------------------
// Migration slice 2. The section stopped being one Card holding every node
// under nested headings: it is now a page title block, then one card per
// subsection, with a group's cards under an eyebrow band. Two visual tiers,
// capped -- no manifest, however deeply nested, can produce a third.
//
// Geometry is asserted through classes, which only proves the intent; the
// values themselves are checked against the Figma nodes named in
// docs/superpowers/plans/2026-08-10-section-editor.md and eyeballed in the
// preview, because Tailwind emits nothing for a class no file mentions.
// ---------------------------------------------------------------------------
describe("the section's structure", () => {
  const cards = () => [...document.querySelectorAll("[data-subsection-card]")];
  const bands = () => [...document.querySelectorAll("[data-eyebrow-rule]")];

  it("puts the section's name and description in a title block, outside every card", () => {
    render(<SectionRenderer pack={preferencesPack} data={preferencesData} onChange={vi.fn()} />);

    const title = screen.getByRole("heading", { name: preferencesPack.title, level: 2 });
    expect(title).toBeInTheDocument();
    // h2, and above the h3s: the old layout titled the Card h3 and every node
    // h3 as well, which read as a flat list of peers.
    expect(screen.getByText(preferencesPack.description)).toBeInTheDocument();
    for (const card of cards()) expect(card).not.toContainElement(title);
  });

  it("gives every renderable node its own card, and nests none of them", () => {
    render(<SectionRenderer pack={preferencesPack} data={preferencesData} onChange={vi.fn()} />);

    // preferences: three groups (3 + 3 + 2 children) and one top-level list.
    expect(cards()).toHaveLength(9);
    for (const outer of cards()) {
      for (const inner of cards()) {
        if (outer !== inner) expect(outer).not.toContainElement(inner);
      }
    }
  });

  it("labels a group with an eyebrow band and puts its cards beneath it", () => {
    render(<SectionRenderer pack={preferencesPack} data={preferencesData} onChange={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Code Style", level: 3 }).className).toContain(
      "font-mono"
    );
    const group = uiNode("Code Style");
    expect(group.querySelector("[data-eyebrow-rule]")).not.toBeNull();
    expect(
      within(group).getByRole("heading", { name: "Preferred Languages", level: 4 })
    ).toBeInTheDocument();
  });

  it("gives an ungrouped node a card and no eyebrow of its own", () => {
    // The umbrella spec's phrase "a top-level list renders as its own band"
    // means it is a rail destination, not that it gets a label: the prototype
    // shows Likes & Dislikes, and all four of profile's leaves, as bare cards.
    render(<SectionRenderer pack={preferencesPack} data={preferencesData} onChange={vi.fn()} />);

    const likes = uiNode("Likes & Dislikes");
    expect(likes.hasAttribute("data-subsection-card")).toBe(true);
    expect(likes.querySelector("[data-eyebrow-rule]")).toBeNull();
    // One band per group, and no more.
    expect(bands()).toHaveLength(3);
  });

  it("rules nothing between anything -- the eyebrow's own rule replaced the hr", () => {
    render(<SectionRenderer pack={preferencesPack} data={preferencesData} onChange={vi.fn()} />);
    expect(screen.queryAllByRole("separator")).toHaveLength(0);
    expect(document.querySelectorAll("hr")).toHaveLength(0);
  });

  it("titles an untitled node's card with the pack's own name", () => {
    // Figma 114:604 does exactly this -- "Goals" at 20px in the title block and
    // again at 16px in the card header. The card is the only header that node
    // has, and it is where its Add and its info have to live.
    renderSection({ pack: goalsPack, initial: goalsData });

    expect(screen.getByRole("heading", { name: goalsPack.title, level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: goalsPack.title, level: 3 })).toBeInTheDocument();
    expect(cards()).toHaveLength(1);
    expect(within(cards()[0]).getByText("Add", { selector: "button" })).toBeInTheDocument();
  });

  it("spaces runs 32px apart and cards within a run 16px", () => {
    // A run is one group, or one consecutive stretch of ungrouped leaves.
    render(<SectionRenderer pack={profilePack} data={profileData} onChange={vi.fn()} />);

    const column = screen.getByRole("heading", { level: 2 }).parentElement.parentElement;
    expect(column.className).toContain("space-y-8");
    // profile: [Personal Information, Education, Work Experience], [Contact &
    // Links], [Languages] -- the group is its own run, and the leaf after it
    // starts another rather than joining it.
    expect(column.children).toHaveLength(4); // title block + three runs
    expect(uiNode("Contact & Links").className).toContain("space-y-4");
  });

  it("starts a new run for a leaf that follows a group, rather than tucking it under the band", () => {
    // Divergence from the file, deliberate: Figma trails Languages inside the
    // CONTACT & LINKS frame at 16px, which reads as membership the manifest
    // does not have and the rail does not show.
    render(<SectionRenderer pack={profilePack} data={profileData} onChange={vi.fn()} />);
    expect(uiNode("Contact & Links")).not.toContainElement(uiNode("Languages"));
  });

  it("lays a group's cards two-across, except where the group holds a fields node", () => {
    // Derived from all four groups in the file: CODE STYLE (3 strings) wraps
    // 2+1, CONTACT & LINKS and LEARNING STYLE pair, and COMMUNICATION -- the
    // only group with a `fields` child -- is full width throughout. A `fields`
    // card carries its own two-column field grid and would collapse to one
    // column in half a row.
    render(<SectionRenderer pack={preferencesPack} data={preferencesData} onChange={vi.fn()} />);

    const grid = (title) => uiNode(title).querySelector("[data-card-grid]");
    expect(grid("Code Style").className).toContain("lg:grid-cols-2");
    expect(grid("Learning Style").className).toContain("lg:grid-cols-2");
    expect(grid("Communication").className).not.toContain("grid-cols-2");
    // lg, not md: at md the rail is already 240px of a 768px viewport, which
    // would leave two cards about 230px wide.
    expect(grid("Code Style").className).not.toContain("md:grid-cols-2");
  });

  it("never grids a run of ungrouped leaves", () => {
    render(<SectionRenderer pack={profilePack} data={profileData} onChange={vi.fn()} />);
    const run = uiNode("Education").parentElement;
    expect(run.className).not.toContain("grid-cols-2");
  });

  describe("the two-tier cap", () => {
    // No shipping manifest nests a group inside a group. This is the path that
    // stops a future one inventing a third tier, and it is why the design says
    // a third level is a label inside a card rather than another band.
    const nested = {
      key: "nested",
      title: "Nested",
      description: "",
      entities: {},
      ui: {
        sections: [
          {
            kind: "group",
            title: "Outer",
            sections: [
              { kind: "strings", path: ["first"], title: "First" },
              {
                kind: "group",
                title: "Inner",
                sections: [
                  { kind: "strings", path: ["second"], title: "Second" },
                  { kind: "strings", path: ["third"], title: "Third" },
                ],
              },
            ],
          },
        ],
      },
    };
    const data = { first: ["a"], second: ["b"], third: ["c"] };

    it("renders a nested group as a label inside a card, not as a second band", () => {
      render(<SectionRenderer pack={nested} data={data} onChange={vi.fn()} />);

      expect(bands()).toHaveLength(1);
      const inner = uiNode("Inner");
      expect(inner.hasAttribute("data-subsection-card")).toBe(true);
      expect(screen.getByRole("heading", { name: "Inner", level: 4 })).toBeInTheDocument();
      expect(inner.querySelector("[data-eyebrow-rule]")).toBeNull();
    });

    it("puts the nested group's children inside that one card, each with its own label", () => {
      render(<SectionRenderer pack={nested} data={data} onChange={vi.fn()} />);

      const inner = uiNode("Inner");
      // One card for the whole inner group -- its children are labelled rows in
      // it, not cards of their own.
      expect(inner.querySelectorAll("[data-subsection-card]")).toHaveLength(0);
      expect(within(inner).getByRole("heading", { name: "Second", level: 5 })).toBeInTheDocument();
      expect(within(inner).getByText("b")).toBeInTheDocument();
      expect(within(inner).getByText("c")).toBeInTheDocument();
    });

    it("keeps a nested node's path resolving against the section root", async () => {
      const { user, latest } = renderSection({ pack: nested, initial: data });
      await user.type(within(uiNode("Second")).getByRole("textbox"), "d{Enter}");
      expect(latest().second).toEqual(["b", "d"]);
      expect(latest().third).toEqual(["c"]);
    });

    it("flattens a fourth level into the same card rather than nesting further", () => {
      const deeper = {
        ...nested,
        ui: {
          sections: [
            {
              kind: "group",
              title: "Outer",
              sections: [
                {
                  kind: "group",
                  title: "Inner",
                  sections: [
                    {
                      kind: "group",
                      title: "Deepest",
                      sections: [{ kind: "strings", path: ["second"], title: "Second" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      };
      render(<SectionRenderer pack={deeper} data={data} onChange={vi.fn()} />);

      expect(cards()).toHaveLength(1);
      expect(bands()).toHaveLength(1);
      // The heading level keeps descending even though the tier does not, so a
      // screen reader still hears the nesting the manifest declares.
      expect(screen.getByRole("heading", { name: "Deepest", level: 5 })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Second", level: 6 })).toBeInTheDocument();
    });
  });
});

// The card header's right-hand slot, decided by whether the node has a
// denominator rather than by judgement. `fields` is the only kind that has one,
// which is why it is the only kind with a count: the manifest fixes its key set,
// so "6 of 7" says one key is still blank. `list` and `strings` are unbounded --
// "3 set" would only restate the rows already on screen, and it would occupy the
// one place in the card where the reader needs an affordance.
describe("the fields count in a card header", () => {
  const cardOf = (title) => document.querySelector(`[data-ui-node="${title}"]`);
  const summaryOf = (title) => cardOf(title).querySelector("[data-fill-summary]");

  const pack = {
    key: "counted",
    title: "Counted",
    description: "",
    entities: {},
    ui: {
      sections: [
        {
          kind: "fields",
          path: ["comm"],
          title: "Default style",
          fields: ["tone", "detail_level", "locale"],
        },
      ],
    },
  };

  it("reports how many of the declared keys are filled", () => {
    render(
      <SectionRenderer
        pack={pack}
        data={{ comm: { tone: "direct", detail_level: "concise", locale: "en-GB" } }}
        onChange={vi.fn()}
      />
    );
    expect(summaryOf("Default style").textContent).toBe("3 of 3");
  });

  it("counts only what is answered", () => {
    render(<SectionRenderer pack={pack} data={{ comm: { tone: "direct" } }} onChange={vi.fn()} />);
    expect(summaryOf("Default style").textContent).toBe("1 of 3");
  });

  it("says Nothing yet rather than 0 of 3", () => {
    // "0 of 3" is a progress bar with no progress; the sentence says the same
    // thing without asking the reader to do the arithmetic.
    render(<SectionRenderer pack={pack} data={{}} onChange={vi.fn()} />);
    expect(summaryOf("Default style").textContent).toBe("Nothing yet");
  });

  it("sets the count in Geist Regular, not mono", () => {
    // A count is a sentence fragment. Mono is reserved for strings that really
    // are machine output -- the build hash, the eyebrow labels -- and tracked
    // mono is exactly what made the old onboarding summaries read as debug
    // output.
    render(<SectionRenderer pack={pack} data={{ comm: { tone: "direct" } }} onChange={vi.fn()} />);
    const summary = summaryOf("Default style");
    expect(summary.className).not.toContain("font-mono");
    expect(summary.className).toContain("tabular-nums");
  });

  it("puts it in the header row, opposite the title", () => {
    render(<SectionRenderer pack={pack} data={{ comm: { tone: "direct" } }} onChange={vi.fn()} />);
    const header = cardOf("Default style").querySelector("[data-card-header]");
    expect(header).toContainElement(summaryOf("Default style"));
  });

  it("gives a list node an Add button and no count", () => {
    renderSection({ pack: preferencesPack, initial: preferencesData });
    const likes = uiNode("Likes & Dislikes");
    expect(likes.querySelector("[data-fill-summary]")).toBeNull();
    expect(within(likes).getByText("Add", { selector: "button" })).toBeInTheDocument();
  });

  it("gives a strings node neither", () => {
    renderSection({ pack: preferencesPack, initial: preferencesData });
    const tools = uiNode("Tools");
    expect(tools.querySelector("[data-fill-summary]")).toBeNull();
    expect(within(tools).queryByText("Add", { selector: "button" })).not.toBeInTheDocument();
  });

  it("counts profile's Personal Information against its own declared key set", () => {
    // The real case, and the one the prototype shows at 6 of 7 (114:366). It
    // binds path [] -- the section root -- so a count computed from the whole
    // data object rather than the node's fields would be wrong here first.
    renderSection({ pack: profilePack, initial: profileData });
    const summary = summaryOf("Personal Information");
    const declared = profilePack.ui.sections[0].fields.length;
    expect(summary.textContent).toMatch(new RegExp(`^\\d+ of ${declared}$`));
  });

  it("renders nothing at all for a fields node declaring no keys", () => {
    const empty = {
      ...pack,
      ui: { sections: [{ kind: "fields", path: ["comm"], title: "Default style", fields: [] }] },
    };
    render(<SectionRenderer pack={empty} data={{}} onChange={vi.fn()} />);
    // Not "0 of 0", and not "Nothing yet" either: there is nothing to fill.
    expect(summaryOf("Default style")).toBeNull();
  });
});

// The per-card save tick, which replaced a "Saved" toast per autosave flush.
// Editing three fields in a row used to stack three toasts for something the
// reader never doubted; toasts are for things that happened away from their
// attention. A failure still interrupts.
describe("the save tick", () => {
  const tick = () => document.querySelector("[data-save-tick]");
  const cardOf = (title) => document.querySelector(`[data-ui-node="${title}"]`);

  const pack = {
    key: "ticked",
    title: "Ticked",
    description: "",
    entities: {},
    ui: {
      sections: [
        { kind: "strings", path: ["a"], title: "First" },
        { kind: "strings", path: ["b"], title: "Second" },
      ],
    },
  };

  function TickHarness({ pack: p = pack, initial = { a: [], b: [] } }) {
    const [data, setData] = useState(initial);
    const [savedAt, setSavedAt] = useState(null);
    return (
      <>
        <button onClick={() => setSavedAt(new Date())}>flush</button>
        <SectionRenderer pack={p} data={data} onChange={setData} savedAt={savedAt} />
      </>
    );
  }

  it("lands on the card whose node was edited, and on no other", async () => {
    const user = userEvent.setup();
    render(<TickHarness />);

    await user.type(within(cardOf("Second")).getByRole("textbox"), "x{Enter}");
    await user.click(screen.getByText("flush"));

    expect(cardOf("Second").querySelector("[data-save-tick]")).not.toBeNull();
    expect(cardOf("First").querySelector("[data-save-tick]")).toBeNull();
  });

  it("moves rather than multiplying when the next edit is elsewhere", async () => {
    const user = userEvent.setup();
    render(<TickHarness />);

    await user.type(within(cardOf("Second")).getByRole("textbox"), "x{Enter}");
    await user.click(screen.getByText("flush"));
    await user.type(within(cardOf("First")).getByRole("textbox"), "y{Enter}");
    await user.click(screen.getByText("flush"));

    expect(document.querySelectorAll("[data-save-tick]")).toHaveLength(1);
    expect(cardOf("First").querySelector("[data-save-tick]")).not.toBeNull();
  });

  it("shows nothing when a save lands with no edit behind it", () => {
    // Switching section remounts this component with App's existing lastSaved
    // already set. A tick then would claim a save the reader did not cause.
    render(<SectionRenderer pack={pack} data={{ a: [], b: [] }} onChange={vi.fn()} savedAt={new Date()} />);
    expect(tick()).toBeNull();
  });

  it("holds, then fades, then goes", async () => {
    // 200ms in, 1.2s hold, 200ms out. The hold is a JS timer because the
    // reduced-motion block forces animation-duration to 1ms on everything -- a
    // keyframed hold would be erased for exactly the users least able to catch
    // a flash.
    vi.useFakeTimers();
    try {
      // fireEvent, not userEvent: userEvent awaits promises that vitest's fake
      // clock also owns, so `type` never settles here and the test times out
      // before reaching an assertion. The edit is one keystroke and a commit,
      // which fireEvent expresses exactly.
      render(<TickHarness />);
      const input = within(cardOf("First")).getByRole("textbox");
      fireEvent.change(input, { target: { value: "x" } });
      // The chip input commits on ArrayInput's own add button. Not Enter: that
      // handler is bound to onKeyPress, which fireEvent.keyDown does not reach.
      fireEvent.click(within(cardOf("First")).getByRole("button"));
      fireEvent.click(screen.getByText("flush"));

      expect(tick().className).toContain("animate-save-tick-in");
      act(() => vi.advanceTimersByTime(1399));
      expect(tick().className).not.toContain("opacity-0");
      act(() => vi.advanceTimersByTime(2));
      expect(tick().className).toContain("opacity-0");
      act(() => vi.advanceTimersByTime(200));
      expect(tick()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
