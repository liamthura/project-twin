import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ListRenderer from "./ListRenderer";

// Shapes mirror the real "aesthetics" pack (frontend/src/__fixtures__/packs.json
// and frontend/src/__fixtures__/data/aesthetics.json): a title field with
// suggestions, two badges (one enum with a VALUE_META icon, one without), a
// long-text field, an array field, and a per-field default.
//
// Every node in this file is a format v2 node: a field's type, vocabulary,
// default, suggestions and positions are stated ON the field, in
// `element.fields`, rather than spread across `title_field`, `badges`,
// `detail_fields`, `array_fields`, `long_text`, `enum`, `field_defaults` and
// `suggestions` on the node. Two consequences worth knowing while reading:
//
//   - `notes` declares `type: "longtext"`. v1 got its textarea from a name
//     heuristic (ScalarField's LONG_TEXT_FIELDS), and that heuristic silently
//     turning into nothing is how six declared textareas became one-line inputs
//     the first time the descriptor path shipped -- see controlCensus.js.
//   - `show` defaults to ["form"], so a field with nothing said about it is an
//     ordinary control in the expanded row and in the Add dialog.
const node = {
  kind: "list",
  path: ["styles"],
  element: {
    entity: "aesthetic",
    identifier: "name",
    fields: [
      { name: "name", role: "title", suggestions: ["Minimalist", "Scandinavian"] },
      { name: "notes", type: "longtext" },
      { name: "references", type: "strings" },
      { name: "domain", type: "enum", values: ["interior", "graphic"], show: ["badge"] },
      {
        name: "stance", type: "enum", values: ["love", "like", "avoid"],
        default: "like", show: ["badge"],
      },
    ],
  },
};

// Rebuilds `node` with one field's descriptor merged or added, so a test that
// varies one field does not have to restate the other four.
function withFields(...fields) {
  const byName = new Map(node.element.fields.map((f) => [f.name, f]));
  for (const f of fields) byName.set(f.name, { ...byName.get(f.name), ...f });
  return { ...node, element: { ...node.element, fields: [...byName.values()] } };
}

// Not read by anything any more: `buildFieldMeta`'s pre-v2 entity-fallback
// branch (the last thing that consulted this object) was deleted in Task 10
// along with the `entity` parameter itself. Kept as the prop it always was so
// these tests pass what renderNode passes -- which two tests below assert has
// no effect, rather than leaving it to inference.
const entity = {
  valid_values: { domain: ["interior", "graphic"], stance: ["love", "like", "avoid"] },
  optional: ["custom_stance"],
  field_defaults: { stance: "like" },
};

const scandinavian = {
  id: "aesthetic_1",
  name: "Scandinavian",
  domain: "interior",
  stance: "love",
  notes: "Light wood, muted tones.",
  references: ["Kinfolk magazine"],
};

// A minimal v2 list node: a `role: "title"` field, plus whatever else the test
// is about. Written as a helper because the descriptor for a title field is the
// same three keys every time, and a dozen tests below care about one row, one
// column, or one label rather than about the node.
const listNode = (path, titleField, fields = [], extra = {}) => ({
  kind: "list",
  path,
  element: {
    entity: extra.entity ?? "thing",
    identifier: titleField,
    fields: [{ name: titleField, role: "title" }, ...fields],
  },
  ...extra.node,
});

// ListRenderer is controlled (items in, onItems reports a replacement array
// out), so any test that needs a real add/remove round-trip renders it
// behind a tiny stateful harness rather than a static items array + spy.
function renderStateful(initialItems) {
  let seen = initialItems;
  function Harness() {
    const [state, setState] = useState(initialItems);
    return (
      <ListRenderer
        node={node}
        entity={entity}
        items={state}
        onItems={(next) => {
          seen = next;
          setState(next);
        }}
      />
    );
  }
  const utils = render(<Harness />);
  return { ...utils, user: userEvent.setup(), latest: () => seen };
}

// The two ways into the Add dialog, picked apart by VISIBLE text rather than
// by accessible name, because they deliberately share one: the header trigger
// reads a bare "Add" beside the heading that names the list and carries an
// aria-label naming what it adds, while the empty panel's call to action
// spells the same thing out on screen. An empty list therefore answers to
// "Add <thing>" twice, and a name-based query cannot say which one it meant.
//
// `headerAdd` is only unambiguous while the dialog is CLOSED -- the dialog's
// own submit button reads a bare "Add" too, which is exactly why the trigger
// needed the aria-label in the first place.
const headerAdd = (scope = screen) => scope.getByText("Add", { selector: "button" });
const emptyPanel = () => screen.getByText(/Nothing here yet/).parentElement;
const panelAdd = () => within(emptyPanel()).getByRole("button", { name: /^Add / });

describe("ListRenderer", () => {
  it("renders each row's title, and badges for fields that take the badge position", () => {
    render(
      <ListRenderer node={node} entity={entity} items={[scandinavian]} onItems={() => {}} />
    );
    expect(screen.getByText("Scandinavian")).toBeInTheDocument();
    expect(screen.getByText("interior")).toBeInTheDocument();
    expect(screen.getByText("love")).toBeInTheDocument();
  });

  it("expands a row on click to reveal its detail fields", async () => {
    const { user } = renderStateful([scandinavian]);
    // Collapsed by default: the detail field isn't on screen yet.
    expect(screen.queryByDisplayValue("Light wood, muted tones.")).not.toBeInTheDocument();

    await user.click(screen.getByText("Scandinavian"));

    expect(screen.getByDisplayValue("Light wood, muted tones.")).toBeInTheDocument();
    expect(screen.getByText("Kinfolk magazine")).toBeInTheDocument();
  });

  it("routes removal through onShowConfirmation and does not call onItems until the confirm callback runs", async () => {
    let confirm;
    const onShowConfirmation = vi.fn((title, body, onConfirm) => {
      confirm = onConfirm;
    });
    const onItems = vi.fn();
    const user = userEvent.setup();
    render(
      <ListRenderer
        node={node}
        entity={entity}
        items={[scandinavian]}
        onItems={onItems}
        onShowConfirmation={onShowConfirmation}
      />
    );

    // The delete button is icon-only (no visible text), but carries an
    // aria-label naming this row -- select by that accessible name rather
    // than by empty textContent.
    const deleteButton = screen.getByRole("button", { name: "Remove Scandinavian" });
    await user.click(deleteButton);

    expect(onShowConfirmation).toHaveBeenCalledTimes(1);
    expect(onShowConfirmation).toHaveBeenCalledWith(
      "Remove Scandinavian?",
      "This can't be undone.",
      expect.any(Function)
    );
    // The deletion must wait on confirmation -- a renderer that deletes
    // immediately and asks afterwards would already have called this.
    expect(onItems).not.toHaveBeenCalled();

    confirm();

    expect(onItems).toHaveBeenCalledTimes(1);
    expect(onItems).toHaveBeenCalledWith([]);
  });

  // Every test in this file renders ListRenderer on its own, with no
  // SectionRenderer above it and therefore no header slot to portal the Add
  // trigger into. The inline fallback is what keeps them all meaningful --
  // without it this component would have no way to add an item at all outside
  // a section card, and the whole add/collision/defaults suite below would be
  // asserting against a button that isn't there.
  it("renders its own Add trigger inline when there is no header slot to portal into", () => {
    render(
      <ListRenderer node={node} entity={entity} items={[scandinavian]} onItems={() => {}} />
    );
    expect(screen.getByRole("button", { name: "Add aesthetic" })).toBeInTheDocument();
  });

  // A section with several list nodes renders one of these triggers per node,
  // and read out of its heading's context a bare "Add" distinguishes none of
  // them. The visible label stays short because the heading beside it is
  // already saying what the list is; only the accessible name spells it out.
  it("tells a screen reader what the header trigger adds, while its visible text stays a bare Add", () => {
    render(
      <ListRenderer node={node} entity={entity} items={[scandinavian]} onItems={() => {}} />
    );
    const trigger = screen.getByRole("button", { name: "Add aesthetic" });
    expect(trigger).toHaveTextContent(/^Add$/);
  });

  it("names an untitled, entityless node's trigger after nothing it does not have", () => {
    // `node.element.entity ?? node.title ?? "item"`, the same fallback chain the
    // empty panel's button uses -- an accessible name of "Add undefined" would be
    // worse than the bare "Add" this replaced. This element names no entity, which
    // is the case the chain exists for.
    const entityless = {
      kind: "list", path: ["goals"],
      element: { identifier: "title", fields: [{ name: "title", role: "title" }] },
    };
    render(<ListRenderer node={entityless} items={[{ title: "Ship it" }]} onItems={() => {}} />);
    expect(screen.getByRole("button", { name: "Add item" })).toBeInTheDocument();
  });

  it("merges a field's declared default into a new item added via the dialog", async () => {
    const { user, latest } = renderStateful([scandinavian]);

    await user.click(headerAdd());
    const dialog = screen.getByRole("dialog");
    const titleInput = within(dialog).getAllByRole("textbox")[0];
    await user.type(titleInput, "Y2K");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(latest()[0]).toMatchObject({ name: "Y2K", stance: "like" });
  });

  it("disables Add and surfaces an inline message when the typed title collides, case-insensitively, instead of silently discarding the draft", async () => {
    const initial = [scandinavian];
    const { user, latest } = renderStateful(initial);

    await user.click(headerAdd());
    const dialog = screen.getByRole("dialog");
    const titleInput = within(dialog).getAllByRole("textbox")[0];
    await user.type(titleInput, "scandinavian");

    expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();

    // The button is disabled, so clicking it must do nothing -- onItems is
    // never called, the dialog stays open, and the harness's seen reference
    // is still the exact array we rendered with.
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(latest()).toBe(initial);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps the rest of the draft on screen when the title collides, so a duplicate name doesn't discard everything else the user typed", async () => {
    const { user } = renderStateful([scandinavian]);

    await user.click(headerAdd());
    const dialog = screen.getByRole("dialog");
    const titleInput = within(dialog).getAllByRole("textbox")[0];
    await user.type(titleInput, "Scandinavian");

    // Index 1: title Input is index 0; domain/stance are EnumControls (no
    // textbox role); notes is the next textbox (a Textarea, because `notes`
    // declares type: "longtext").
    const notesInput = within(dialog).getAllByRole("textbox")[1];
    await user.type(notesInput, "met at a conference");

    expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();

    // Press Enter, the natural submit for the autoFocus'd title input. This is
    // the path that actually discards: the handler used to call addItem (which
    // no-ops on a collision), then close the dialog and setDraft({})
    // unconditionally. Asserting the field's value without submitting proves
    // only that ScalarField binds -- it cannot fail if the guard is removed.
    await user.type(titleInput, "{enter}");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByDisplayValue("met at a conference"))
      .toBeInTheDocument();
  });

  it("a suggestion chip adds an item, and chips for already-present titles are not offered", async () => {
    const { user, latest } = renderStateful([scandinavian]);

    // "Scandinavian" is already present (case-insensitively) -- its chip
    // must not be offered, only "Minimalist"'s.
    expect(screen.queryByText("+ Scandinavian")).not.toBeInTheDocument();
    const chip = screen.getByText("+ Minimalist");

    await user.click(chip);

    expect(latest()[0]).toMatchObject({ name: "Minimalist", stance: "like" });
  });

  // An element that names no entity. v2's schema requires one on a list element,
  // so this guards a hand-built node rather than a shipped shape -- but the crash
  // is real and the guard is cheap: the Add dialog heading did
  // `node.entity.replace(...)` unconditionally and threw on click, with no error
  // boundary anywhere in the app to catch it.
  it("does not throw and shows a sensible Add dialog heading when the node has no entity", async () => {
    const entitylessNode = {
      kind: "list", path: ["goals"],
      element: { identifier: "title", fields: [{ name: "title", role: "title" }] },
    };
    const user = userEvent.setup();
    render(
      <ListRenderer node={entitylessNode} entity={undefined} items={[]} onItems={() => {}} />
    );

    await user.click(headerAdd());

    expect(screen.getByRole("heading", { name: "Add item" })).toBeInTheDocument();
  });

  it("uses node.title, when present, for the Add dialog heading in preference to node.entity", async () => {
    const titledNode = { ...node, title: "Aesthetic style" };
    const user = userEvent.setup();
    render(<ListRenderer node={titledNode} entity={entity} items={[]} onItems={() => {}} />);

    await user.click(headerAdd());

    expect(screen.getByRole("heading", { name: "Add to Aesthetic style" })).toBeInTheDocument();
  });

  it('renders a textarea for a field declaring type: "longtext", whatever it is called', async () => {
    // Was "uses node.long_text (array form) over the default long-text set". v2
    // deleted that node-level array along with the name heuristic it overrode: a
    // field says it is long text or it is not. "summary" is not in ScalarField's
    // default LONG_TEXT_FIELDS set, so this still only renders a Textarea if the
    // declaration is honoured -- the assertion whose absence let six declared
    // textareas become one-line inputs.
    const longTextNode = withFields({ name: "summary", type: "longtext" });
    const item = { ...scandinavian, summary: "A short summary" };
    const user = userEvent.setup();
    render(<ListRenderer node={longTextNode} entity={entity} items={[item]} onItems={() => {}} />);

    await user.click(screen.getByText("Scandinavian"));

    const el = screen.getByDisplayValue("A short summary");
    expect(el.tagName).toBe("TEXTAREA");
  });

  it("draws no custom_* overflow input for an enum that does not declare allow_custom, whatever the entity's optional list says", async () => {
    // Was "gives node.optional precedence over entity.optional". Both halves of
    // that precedence are gone: v2 says `allow_custom: true` on the field, which
    // replaced the `custom_<field>` naming convention a renderer used to match on
    // inside the entity's `optional` list. `entity.optional` still lists
    // custom_stance, and it must now buy nothing.
    const inlineEnumNode = withFields({
      name: "stance", type: "enum", values: ["love", "like", "avoid", "other"],
    });
    const user = userEvent.setup();
    render(
      <ListRenderer
        node={inlineEnumNode}
        entity={entity}
        items={[{ ...scandinavian, stance: "other" }]}
        onItems={() => {}}
      />
    );

    await user.click(screen.getByText("Scandinavian"));

    expect(screen.queryByPlaceholderText("Custom stance…")).not.toBeInTheDocument();
  });

  it("keeps the right row expanded after an earlier row is removed", async () => {
    // `expanded` is keyed by array index. Removing index 0 shifts "Second"
    // down from stored index 1 to index 0 -- if `expanded` isn't remapped
    // alongside the array, the stale key (1) points at nothing and the
    // fresh key (0) was never set, so the row collapses even though the
    // user never touched it.
    const simpleNode = listNode(["items"], "name", [{ name: "note" }]);
    const items = [
      { name: "First", note: "note-1" },
      { name: "Second", note: "note-2" },
    ];
    let current = items;
    const user = userEvent.setup();
    const { rerender } = render(
      <ListRenderer node={simpleNode} items={current} onItems={(n) => { current = n; }} />
    );

    await user.click(screen.getByText("Second"));
    expect(screen.getByDisplayValue("note-2")).toBeInTheDocument();

    // Remove "First" (index 0). "Second" shifts to index 0 and must stay open.
    await user.click(screen.getByRole("button", { name: "Remove First" }));
    rerender(<ListRenderer node={simpleNode} items={current} onItems={vi.fn()} />);

    expect(screen.getByDisplayValue("note-2")).toBeInTheDocument();
  });

  it("keeps the expanded row expanded after adding a new item, since addItem prepends and shifts every stored index up by one", async () => {
    // `expanded` is keyed by array index. addItem prepends (`[item, ...items]`),
    // so the row the user had open at index 0 is now at index 1 -- if
    // `expanded` isn't remapped alongside it, the stale key (0) addresses the
    // brand-new row instead, and the row the user was reading collapses.
    const simpleNode = listNode(["items"], "name", [{ name: "note" }]);
    function Harness() {
      const [state, setState] = useState([
        { name: "React Server Components", note: "note-1" },
      ]);
      return <ListRenderer node={simpleNode} items={state} onItems={setState} />;
    }
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("React Server Components"));
    expect(screen.getByDisplayValue("note-1")).toBeInTheDocument();

    await user.click(headerAdd());
    const dialog = screen.getByRole("dialog");
    const titleInput = within(dialog).getAllByRole("textbox")[0];
    await user.type(titleInput, "New Entry");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    // The originally-expanded row (now shifted to index 1) is still open.
    expect(screen.getByDisplayValue("note-1")).toBeInTheDocument();
  });

  it('falls back to a neutral "Untitled entry" confirmation instead of "Remove undefined?" for a row with no title', async () => {
    const onShowConfirmation = vi.fn();
    const titlelessNode = listNode(["items"], "name");
    const user = userEvent.setup();
    render(
      <ListRenderer
        node={titlelessNode}
        items={[{}]}
        onItems={vi.fn()}
        onShowConfirmation={onShowConfirmation}
      />
    );

    const deleteButton = screen.getByRole("button", { name: "Remove Untitled entry" });
    await user.click(deleteButton);

    expect(onShowConfirmation).toHaveBeenCalledWith(
      "Remove Untitled entry?",
      "This can't be undone.",
      expect.any(Function)
    );
  });

  it("gives the row delete button an accessible name derived from the row's title", () => {
    render(
      <ListRenderer node={node} entity={entity} items={[scandinavian]} onItems={() => {}} />
    );
    // Icon-only (no visible text), but must be announced as more than
    // "button" -- and named after this row specifically, not a generic label
    // every row would share.
    const deleteButton = screen.getByRole("button", { name: "Remove Scandinavian" });
    expect(deleteButton.textContent).toBe("");
  });
});

describe("@now in a field's declared default", () => {
  // `timestamp` declares a default and NO position (`show: []`, the same way
  // knowledge's `created_at` is written): the token has to reach `addItem`
  // through the defaults without any control ever rendering for it, which is the
  // whole reason it needs resolving after the draft is merged.
  const node = listNode(["entries"], "topic", [
    { name: "source", default: "manual" },
    { name: "timestamp", default: "@now", show: [], ui_only: true },
  ]);

  it("resolves @now to an ISO timestamp when an item is added", async () => {
    const onItems = vi.fn();
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={[]} onItems={onItems} />);

    await user.click(headerAdd());
    const dialog = screen.getByRole("dialog");
    const titleInput = within(dialog).getAllByRole("textbox")[0];
    await user.type(titleInput, "React Server Components");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    const [[added]] = onItems.mock.calls;
    expect(added[0].source).toBe("manual");
    // Not the literal token, and parseable back to the same instant.
    expect(added[0].timestamp).not.toBe("@now");
    expect(new Date(added[0].timestamp).toISOString()).toBe(added[0].timestamp);
  });

  it("does not leak the raw token into the add dialog's draft", async () => {
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={[]} onItems={vi.fn()} />);

    await user.click(headerAdd());
    // `timestamp` has no control of its own, but `source` proves defaults still
    // preselect; a literal "@now" anywhere on screen means the token escaped.
    expect(screen.getByDisplayValue("manual")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("@now")).not.toBeInTheDocument();
  });

  it("leaves a value that merely starts with @ alone", async () => {
    const onItems = vi.fn();
    const user = userEvent.setup();
    render(
      <ListRenderer
        node={listNode(["entries"], "topic", [{ name: "source", default: "@channel" }])}
        items={[]}
        onItems={onItems}
      />
    );

    await user.click(headerAdd());
    const dialog = screen.getByRole("dialog");
    const titleInput = within(dialog).getAllByRole("textbox")[0];
    await user.type(titleInput, "T");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(onItems.mock.calls[0][0][0].source).toBe("@channel");
  });

  it("does not overwrite a user-typed literal '@now' in an unrelated field", async () => {
    // The title field has no declared default at all -- typing the token's
    // exact text there is real user data entering a real control, not the
    // token firing. Only a key the manifest itself declared as "@now" (and
    // still holding that value) may be resolved.
    const onItems = vi.fn();
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={[]} onItems={onItems} />);

    await user.click(headerAdd());
    const dialog = screen.getByRole("dialog");
    const titleInput = within(dialog).getAllByRole("textbox")[0];
    await user.type(titleInput, "@now");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    const [[added]] = onItems.mock.calls;
    expect(added[0].topic).toBe("@now");
    // The declared token in `timestamp` still resolves as normal.
    expect(added[0].timestamp).not.toBe("@now");
  });
});

describe("sort", () => {
  // `sort` stays a node key in v2 -- it is display order for the whole list, not
  // a property of one field.
  const node = listNode(["entries"], "topic", [{ name: "source" }], {
    node: { sort: { field: "timestamp", dir: "desc" } },
  });
  const items = [
    { topic: "Oldest", source: "a", timestamp: "2026-01-01T00:00:00.000Z" },
    { topic: "Newest", source: "b", timestamp: "2026-06-01T00:00:00.000Z" },
    { topic: "Middle", source: "c", timestamp: "2026-03-01T00:00:00.000Z" },
  ];

  it("renders rows newest-first without reordering the stored array", async () => {
    const onItems = vi.fn();
    render(<ListRenderer node={node} items={items} onItems={onItems} />);

    const rows = screen.getAllByText(/Oldest|Newest|Middle/);
    expect(rows.map((r) => r.textContent)).toEqual(["Newest", "Middle", "Oldest"]);
    expect(onItems).not.toHaveBeenCalled(); // rendering never writes
  });

  it("edits the row the user actually clicked, not the array position", async () => {
    const onItems = vi.fn();
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={items} onItems={onItems} />);

    // "Newest" displays first but is stored at index 1.
    await user.click(screen.getByText("Newest"));
    await user.type(screen.getByDisplayValue("b"), "X");

    const [[next]] = onItems.mock.calls;
    expect(next[1].source).toBe("bX");
    expect(next[0].source).toBe("a");
    expect(next[2].source).toBe("c");
  });

  it("removes the row the user actually clicked", async () => {
    const onItems = vi.fn();
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={items} onItems={onItems} />);

    // "Newest" displays first (sorted) despite being stored at index 1 --
    // select it by its accessible name, which names the row rather than
    // its position.
    await user.click(screen.getByRole("button", { name: "Remove Newest" }));

    const [[next]] = onItems.mock.calls;
    expect(next.map((i) => i.topic)).toEqual(["Oldest", "Middle"]);
  });

  it("keeps stored order when no sort is declared", () => {
    render(<ListRenderer node={{ ...node, sort: undefined }} items={items} onItems={vi.fn()} />);
    const rows = screen.getAllByText(/Oldest|Newest|Middle/);
    expect(rows.map((r) => r.textContent)).toEqual(["Oldest", "Newest", "Middle"]);
  });

  it("puts items missing the sort field last rather than dropping them", () => {
    const withGap = [...items, { topic: "Undated", source: "d" }];
    render(<ListRenderer node={node} items={withGap} onItems={vi.fn()} />);
    const rows = screen.getAllByText(/Oldest|Newest|Middle|Undated/);
    expect(rows.map((r) => r.textContent)).toEqual([
      "Newest", "Middle", "Oldest", "Undated",
    ]);
  });

  it("compares numeric sort fields numerically, not lexicographically", () => {
    const numericNode = listNode(["entries"], "topic", [{ name: "source" }], {
      node: { sort: { field: "priority", dir: "asc" } },
    });
    const numericItems = [
      { topic: "Ten", source: "a", priority: 10 },
      { topic: "Two", source: "b", priority: 2 },
    ];
    // Lexicographic compare would put "10" before "2"; numeric compare must not.
    render(<ListRenderer node={numericNode} items={numericItems} onItems={vi.fn()} />);
    const rows = screen.getAllByText(/Ten|Two/);
    expect(rows.map((r) => r.textContent)).toEqual(["Two", "Ten"]);
  });

  it("sorts a blank string and a missing key the same way -- both last, neither at the top", () => {
    // Ascending is the direction that actually exposes the bug: `av == null`
    // is false for "", so an unfixed comparator's localeCompare branch treats
    // "" as sorting before any non-empty string, putting the blank row
    // *ahead* of the real value on an ascending list -- the missing-key row
    // trails correctly (that branch isn't sign-dependent), so the two blank-
    // looking rows would land at opposite ends instead of both trailing.
    const ascNode = { ...node, sort: { field: "timestamp", dir: "asc" } };
    const withBlankAndMissing = [
      { topic: "Blank", source: "a", timestamp: "" },
      { topic: "Dated", source: "b", timestamp: "2026-03-01T00:00:00.000Z" },
      { topic: "Missing", source: "c" },
    ];
    render(<ListRenderer node={ascNode} items={withBlankAndMissing} onItems={vi.fn()} />);
    const rows = screen.getAllByText(/Blank|Dated|Missing/);
    // The one real value must lead; neither blank-looking row may precede it.
    expect(rows.map((r) => r.textContent)).toEqual(["Dated", "Blank", "Missing"]);
  });
});

describe("search", () => {
  // `search: true`, not v1's `searchable`: the manifest key and the renderer key
  // are now the same word. `traits` is a `strings` field, which is what puts its
  // entries in the search index.
  const node = listNode(["items"], "name", [
    { name: "relationship" }, { name: "traits", type: "strings" },
  ], { node: { search: true } });
  const items = [
    { name: "Ada Lovelace", relationship: "Mentor", traits: ["maths"] },
    { name: "Grace Hopper", relationship: "Colleague", traits: ["compilers"] },
  ];

  it("is absent when the node does not opt in", () => {
    render(<ListRenderer node={{ ...node, search: false }} items={items} onItems={vi.fn()} />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("is absent when there is nothing to search", () => {
    render(<ListRenderer node={node} items={[]} onItems={vi.fn()} />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("filters on the title field", async () => {
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={items} onItems={vi.fn()} />);
    await user.type(screen.getByRole("searchbox"), "grace");
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });

  it("filters on a detail field and on array entries", async () => {
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={items} onItems={vi.fn()} />);
    const box = screen.getByRole("searchbox");

    await user.type(box, "mentor");
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByText("Grace Hopper")).not.toBeInTheDocument();

    await user.clear(box);
    await user.type(box, "compilers");
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });

  it("says so when nothing matches, rather than looking empty", async () => {
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={items} onItems={vi.fn()} />);
    await user.type(screen.getByRole("searchbox"), "zzzz");
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });

  it("never writes to the data while filtering", async () => {
    const onItems = vi.fn();
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={items} onItems={onItems} />);
    await user.type(screen.getByRole("searchbox"), "ada");
    expect(onItems).not.toHaveBeenCalled();
  });

  it("edits the right row while a filter is active", async () => {
    const onItems = vi.fn();
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={items} onItems={onItems} />);
    await user.type(screen.getByRole("searchbox"), "grace");
    await user.click(screen.getByText("Grace Hopper"));
    await user.type(screen.getByDisplayValue("Colleague"), "!");

    const [[next]] = onItems.mock.calls;
    expect(next[1].relationship).toBe("Colleague!");
    expect(next[0].relationship).toBe("Mentor");
  });

  it("clears the query after successfully adding an item, so the new row is visible", async () => {
    // Regression: onItems prepends the new item to the stored array, but
    // `visible` re-filters on the unchanged query -- a name that doesn't
    // match "grace" would render nowhere, with only the header count
    // ("1 of 2" -> "1 of 3") hinting anything happened at all.
    function Harness() {
      const [state, setState] = useState(items);
      return <ListRenderer node={node} items={state} onItems={setState} />;
    }
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole("searchbox"), "grace");
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();

    await user.click(headerAdd());
    const dialog = screen.getByRole("dialog");
    const titleInput = within(dialog).getAllByRole("textbox")[0];
    await user.type(titleInput, "Bob Smith");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(screen.getByText("Bob Smith")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("keeps the search box mounted after deleting every visible match, so the stranding query can still be cleared", async () => {
    // Regression: the box only rendered on `items.length > 0`. Filtering to
    // both rows and deleting them both drops items to 0, unmounting the box
    // while `query` survives in state -- leaving the empty state stuck on
    // "Clear the search" with no control left to do it.
    function Harness() {
      const [state, setState] = useState(items);
      return <ListRenderer node={node} items={state} onItems={setState} />;
    }
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole("searchbox"), "a");
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();

    // Both rows are visible under the "a" filter, in stored order -- select
    // each delete button by its row's accessible name rather than position.
    await user.click(screen.getByRole("button", { name: "Remove Ada Lovelace" }));
    await user.click(screen.getByRole("button", { name: "Remove Grace Hopper" }));

    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
    // The box is still here, still holding the query that stranded the user --
    // clearing it (not switching tabs or reloading) is the recovery path.
    expect(screen.getByRole("searchbox")).toHaveValue("a");
  });
});

describe("search combined with sort", () => {
  const node = listNode(["entries"], "topic", [{ name: "source" }], {
    node: { search: true, sort: { field: "priority", dir: "asc" } },
  });
  const items = [
    { topic: "Zeta task", source: "z", priority: 3 },
    { topic: "Alpha task", source: "a", priority: 1 },
    { topic: "Beta note", source: "b", priority: 2 },
  ];

  it("keeps filtered rows in sorted order", async () => {
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={items} onItems={vi.fn()} />);
    await user.type(screen.getByRole("searchbox"), "task");

    const rows = screen.getAllByText(/Zeta task|Alpha task|Beta note/);
    expect(rows.map((r) => r.textContent)).toEqual(["Alpha task", "Zeta task"]);
  });

  it("edits the correct stored row when editing a visible row while filtered", async () => {
    const onItems = vi.fn();
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={items} onItems={onItems} />);
    await user.type(screen.getByRole("searchbox"), "task");

    await user.click(screen.getByText("Zeta task"));
    await user.type(screen.getByDisplayValue("z"), "!");

    const [[next]] = onItems.mock.calls;
    expect(next[0].source).toBe("z!");
    expect(next[1].source).toBe("a");
    expect(next[2].source).toBe("b");
  });
});

describe('the "row" position -- read-only values on the collapsed row', () => {
  // v1's `display_fields` + `display_formats`, said once per field: `show:
  // ["row"]` puts the value on the row, `format` says how to render it.
  const dated = (format) =>
    listNode(["entries"], "topic", [
      { name: "details" },
      ...(format === undefined ? [] : [{ name: "timestamp", show: ["row"], format, ui_only: true }]),
    ]);
  const node = dated("datetime");
  const iso = "2026-01-15T09:30:00.000Z";
  // Formatting is local-time, so derive the expectation the same way rather
  // than hardcoding a string that breaks in another timezone.
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  const expected =
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`;
  const items = [{ topic: "RSC", details: "d", timestamp: iso }];

  it("renders the value formatted, not as a raw ISO string", () => {
    render(<ListRenderer node={node} items={items} onItems={vi.fn()} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(iso)).not.toBeInTheDocument();
  });

  it("renders date-only when the format says so", () => {
    render(
      <ListRenderer node={dated("date")} items={items} onItems={vi.fn()} />
    );
    expect(screen.getByText(expected.slice(0, 10))).toBeInTheDocument();
  });

  // A stored yyyy-mm-dd is a CALENDAR DATE, not an instant. `new Date` parses
  // the date-only form as UTC midnight, so formatting it through local-time
  // getters rolls it back a day in every negative-offset zone. The suite is
  // pinned to America/New_York (vitest.config.js) precisely so this is
  // observable: under the pre-fix formatDisplay these render "2026-01-11" and
  // "2025-12-31", and at UTC they would have rendered correctly by accident.
  describe("a calendar date, which carries no instant to convert", () => {
    const dateOnly = [{ topic: "Proj", details: "d", timestamp: "2026-01-12" }];

    it("renders verbatim under the date format, not shifted into local time", () => {
      // Proof the environment can actually see the bug -- without this the
      // assertion below is only as strong as whoever's timezone ran it.
      expect(new Date("2026-01-12").getDate()).toBe(11);

      render(<ListRenderer node={dated("date")} items={dateOnly} onItems={vi.fn()} />);
      expect(screen.getByText("2026-01-12")).toBeInTheDocument();
      expect(screen.queryByText("2026-01-11")).not.toBeInTheDocument();
    });

    it("does not roll a new-year date back into the previous year", () => {
      render(
        <ListRenderer
          node={dated("date")}
          items={[{ topic: "NY", timestamp: "2026-01-01" }]}
          onItems={vi.fn()}
        />
      );
      expect(screen.getByText("2026-01-01")).toBeInTheDocument();
      expect(screen.queryByText("2025-12-31")).not.toBeInTheDocument();
    });

    it("shows no invented midnight under the datetime format either", () => {
      render(
        <ListRenderer node={dated("datetime")} items={dateOnly} onItems={vi.fn()} />
      );
      // There is no time in the stored value, so there is none to display.
      expect(screen.getByText("2026-01-12")).toBeInTheDocument();
      expect(screen.queryByText(/19:00|00:00/)).not.toBeInTheDocument();
    });

    it("still converts a value that really does carry a time", () => {
      // The exemption is on the value's shape, not on the format, so an
      // instant must be unaffected -- this is learning_log's `timestamp`.
      render(<ListRenderer node={node} items={items} onItems={vi.fn()} />);
      expect(screen.getByText(expected)).toBeInTheDocument();
      // 09:30Z is 04:30 in the pinned zone: converted, not passed through.
      expect(expected).toBe("2026-01-15 04:30");
    });
  });

  it("is read-only -- expanding the row exposes no control bound to it", async () => {
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={items} onItems={vi.fn()} />);
    await user.click(screen.getByText("RSC"));
    // `details` proves the row really did expand.
    expect(screen.getByDisplayValue("d")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(iso)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(expected)).not.toBeInTheDocument();
  });

  it("shows an unparseable value as-is rather than hiding it", () => {
    render(
      <ListRenderer node={node} items={[{ topic: "T", timestamp: "next spring" }]} onItems={vi.fn()} />
    );
    expect(screen.getByText("next spring")).toBeInTheDocument();
  });

  it("renders nothing extra for a node with no field in the row position", () => {
    const { container } = render(
      <ListRenderer node={dated(undefined)} items={items} onItems={vi.fn()} />
    );
    expect(screen.queryByText(expected)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".font-mono")).toHaveLength(0);
  });

  it("omits the badge for an item missing the field, without affecting siblings", () => {
    render(
      <ListRenderer node={node} items={[...items, { topic: "No date", details: "x" }]} onItems={vi.fn()} />
    );
    expect(screen.getByText("No date")).toBeInTheDocument();
    expect(screen.getAllByText(expected)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// count_badges -- wave 4, Task 4
//
// Opt-in "N <field>" chips for array-valued storage keys, rendered after
// display_fields and before badges. Read-only: unlike `badges`, nothing here
// should ever bind an editable control. The three fields this wave actually
// uses -- references, tags, highlights -- all singularise correctly by
// trimming a trailing "s" (reference/tag/highlight), so that's what's tested
// below rather than an invented irregular noun.
// ---------------------------------------------------------------------------
describe('the "count" position -- "N <field>" chips', () => {
  // v1's `count_badges`. Each of the three declares `show: ["count"]` and so
  // takes no form position: the chip is the whole of its rendering, which is what
  // the read-only assertions below are about.
  const counted = (...names) =>
    listNode(["entries"], "topic", [
      { name: "notes", type: "longtext" },
      ...names.map((name) => ({ name, type: "strings", show: ["count"] })),
    ]);
  const node = counted("references", "tags", "highlights");

  it("renders 'N <field>' for a field with multiple entries", () => {
    const items = [{ topic: "RSC", references: ["a", "b", "c"] }];
    render(<ListRenderer node={node} items={items} onItems={vi.fn()} />);
    expect(screen.getByText("3 references")).toBeInTheDocument();
  });

  it("singularises to '1 <field>' (trimming the trailing s), not '1 <field>s'", () => {
    const items = [{ topic: "RSC", tags: ["solo"] }];
    render(<ListRenderer node={node} items={items} onItems={vi.fn()} />);
    expect(screen.getByText("1 tag")).toBeInTheDocument();
    expect(screen.queryByText("1 tags")).not.toBeInTheDocument();
  });

  it("renders every field's own count independently on the same row", () => {
    const items = [
      { topic: "RSC", references: ["a", "b"], tags: ["x"], highlights: ["h1", "h2", "h3"] },
    ];
    render(<ListRenderer node={node} items={items} onItems={vi.fn()} />);
    expect(screen.getByText("2 references")).toBeInTheDocument();
    expect(screen.getByText("1 tag")).toBeInTheDocument();
    expect(screen.getByText("3 highlights")).toBeInTheDocument();
  });

  it("renders no badge for an empty array -- a '0 x' chip is noise, not a real count", () => {
    const items = [{ topic: "RSC", references: [] }];
    render(<ListRenderer node={node} items={items} onItems={vi.fn()} />);
    expect(screen.queryByText(/references/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^0/)).not.toBeInTheDocument();
  });

  it("renders no badge for a field the item doesn't have at all", () => {
    const items = [{ topic: "RSC" }];
    render(<ListRenderer node={node} items={items} onItems={vi.fn()} />);
    expect(screen.queryByText(/references|tags|highlights/)).not.toBeInTheDocument();
  });

  it("renders no badge, and does not throw, when the field holds a non-array value", () => {
    const items = [{ topic: "RSC", references: "not-an-array" }];
    expect(() =>
      render(<ListRenderer node={node} items={items} onItems={vi.fn()} />)
    ).not.toThrow();
    expect(screen.queryByText(/references/)).not.toBeInTheDocument();
    expect(screen.getByText("RSC")).toBeInTheDocument();
  });

  it("is read-only -- expanding the row exposes no control bound to it beyond what the form position declares", async () => {
    const items = [{ topic: "RSC", notes: "n", references: ["a", "b"] }];
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={items} onItems={vi.fn()} />);
    expect(screen.getByText("2 references")).toBeInTheDocument();

    await user.click(screen.getByText("RSC"));

    // `notes` proves the row really expanded.
    expect(screen.getByDisplayValue("n")).toBeInTheDocument();
    // No control anywhere shows the raw array value or field name as an
    // editable input -- only a field in the form position (here, "notes").
    expect(screen.queryByDisplayValue("a,b")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^references$/i)).not.toBeInTheDocument();
  });

  it("renders nothing extra for a node with no field in the count position", () => {
    const items = [{ topic: "RSC", references: ["a", "b", "c"] }];
    render(<ListRenderer node={counted()} items={items} onItems={vi.fn()} />);
    expect(screen.queryByText(/references|tags|highlights/)).not.toBeInTheDocument();
  });
});

describe("title field also taking the form position", () => {
  // Step 9 of wave 3 task 8 gave the title field a form position so it renders
  // editable in the expanded row -- but editFields is the badge and form
  // positions unioned, and the Add dialog already renders a dedicated title
  // Label+Input (with suggestion chips and Enter-to-submit) above its
  // editFields.map loop. Without excluding the title field from that loop, the
  // Add dialog shows the same field twice. In v2 this is the DEFAULT shape: a
  // title field with nothing said about its position takes `form`, so every list
  // node in every shipped pack is now this case.
  const node = listNode(["entries"], "topic", [{ name: "source" }]);
  const items = [{ topic: "RSC", source: "conversation" }];

  it("shows exactly one control for the title field in the Add dialog", async () => {
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={items} onItems={vi.fn()} />);
    await user.click(headerAdd());
    const dialog = screen.getByRole("dialog");
    // Both the dedicated title control and a duplicate from editFields.map
    // would carry the literal label text "topic" (the dedicated one is
    // unstyled, the generic one runs it through .replace(/_/g, " "), which
    // is a no-op here) -- exactly one should exist.
    expect(within(dialog).getAllByText(/^topic$/i)).toHaveLength(1);
  });

  it("still exposes the title field as an editable control in the expanded row", async () => {
    // Guards against a future "fix" that strips the title field out of
    // editFields entirely instead of only out of the Add dialog's loop --
    // that would silently undo Step 9's whole point.
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={items} onItems={vi.fn()} />);
    await user.click(screen.getByText("RSC"));
    expect(screen.getByDisplayValue("RSC")).toBeInTheDocument();
  });
});

describe("a field's own `label` overrides the derived one", () => {
  // meta_schema.json's `label` promises "declare it only where [the derived
  // default] reads wrong" -- but ListRenderer ran every field's name through
  // `.replace(/_/g, " ")` unconditionally and never looked at `label` at all,
  // so a pack author's override was accepted by the schema and silently
  // dropped on screen. This pins the fix, not just the schema's promise.
  it("labels a detail-grid field with its descriptor's `label`, not its name", async () => {
    const node = listNode(["entries"], "topic", [
      { name: "source", label: "Where it came from" },
    ]);
    const items = [{ topic: "RSC", source: "conversation" }];
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={items} onItems={vi.fn()} />);

    await user.click(screen.getByText("RSC"));

    expect(screen.getByText("Where it came from")).toBeInTheDocument();
    expect(screen.queryByText(/^source$/i)).not.toBeInTheDocument();
  });
});

describe("row delete button naming", () => {
  // Both the row delete and (before it moved to the heading) the info button
  // were icon-only with empty textContent, so a selector like
  // getAllByRole("button").find(b => b.textContent === "") could silently
  // grab the wrong one. Selecting by accessible name must land on the row.
  it("names a row's delete button after the row", async () => {
    const onShowConfirmation = vi.fn();
    const user = userEvent.setup();
    render(
      <ListRenderer
        node={listNode(["items"], "name")}
        items={[{ name: "Ada" }]}
        onItems={vi.fn()}
        onShowConfirmation={onShowConfirmation}
      />
    );

    await user.click(screen.getByRole("button", { name: "Remove Ada" }));
    expect(onShowConfirmation).toHaveBeenCalledWith(
      "Remove Ada?",
      "This can't be undone.",
      expect.any(Function)
    );
  });
});

describe("detail-grid column spans", () => {
  const base = (...fields) => listNode(["items"], "name", fields);
  const item = { name: "Row", status: "want", stance: "love", notes: "n", tags: ["t"] };

  function cellFor(label) {
    // Each cell is the Label's parent div; the span class lives there.
    return screen.getByText(label).parentElement;
  }

  it("gives a four-option segmented enum the full row", async () => {
    const node = base({
      name: "status", type: "enum",
      values: ["want", "in_progress", "finished", "dropped"],
    });
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={[item]} onItems={vi.fn()} />);
    await user.click(screen.getByText("Row"));

    expect(cellFor("status").className).toContain("sm:col-span-2");
  });

  it("leaves a three-option enum in its column, where it already fits", async () => {
    const node = base({ name: "stance", type: "enum", values: ["love", "like", "avoid"] });
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={[item]} onItems={vi.fn()} />);
    await user.click(screen.getByText("Row"));

    expect(cellFor("stance").className).not.toContain("sm:col-span-2");
  });

  it("leaves a large enum in its column, because it renders as a compact dropdown", async () => {
    const node = base({
      name: "kind", type: "enum",
      values: ["book", "article", "podcast", "show", "film", "game", "video", "music"],
    });
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={[{ ...item, kind: "book" }]} onItems={vi.fn()} />);
    await user.click(screen.getByText("Row"));

    expect(cellFor("kind").className).not.toContain("sm:col-span-2");
  });

  it("still gives long text and array fields the full row", async () => {
    const node = base({ name: "notes", type: "longtext" }, { name: "tags", type: "strings" });
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={[item]} onItems={vi.fn()} />);
    await user.click(screen.getByText("Row"));

    expect(cellFor("notes").className).toContain("sm:col-span-2");
    expect(cellFor("tags").className).toContain("sm:col-span-2");
  });
});

// ---------------------------------------------------------------------------
// block fields -- nested child lists (wave 4, Task 2)
//
// A list node's element may declare a `type: "list"` field with a `label`, which
// renders as its own titled block under the row: its `path` is the field's name
// and resolves against the LIST ITEM rather than the section root. v1 spelled
// this as a nested `children[]` array of whole nodes, which is the ambiguity v2
// deleted -- a child bound against the row while a group's children bound
// against the section root, from the same key. All the tests below expand the
// parent row first: a block only exists inside an expanded row, so an assertion
// made against a collapsed row cannot fail for the reason it claims.
//
// Selector note: with a nested list there are now delete buttons and Add
// buttons at two levels, and neither accessible name is namespaced by level.
// `Remove <title>` names the row's title, so a child item whose title equals
// its parent's yields TWO buttons named `Remove Alpha` -- a nested test must
// use distinct titles or scope by row, never select by name alone. Same for
// `Add` (the parent's and the expanded row's child list both have one) and,
// if both levels are `searchable`, for `searchbox`. The child's Add button is
// scoped below through the child's own `title` label, whose parent element is
// the wrapper the child list renders inside.
//
// That collision is documented here rather than asserted in a test: the only
// way such a test could fail is if someone made the names distinct, i.e. it
// would block the very improvement it describes.
// ---------------------------------------------------------------------------
describe("block fields", () => {
  // The block: an array-of-objects field with a label to sit under. `show: []`
  // because the block IS its rendering -- it takes no position on the row, the
  // same way profile's `clubs` does. `notes` declares longtext, which is where v1
  // got a textarea from the field's name alone.
  const referencesField = {
    name: "references",
    type: "list",
    label: "References",
    show: [],
    element: {
      entity: "reference",
      identifier: "name",
      fields: [
        { name: "name", role: "title" },
        { name: "url" },
        { name: "notes", type: "longtext" },
      ],
    },
  };
  const parentNode = {
    kind: "list",
    path: ["projects"],
    element: {
      entity: "project",
      identifier: "name",
      fields: [{ name: "name", role: "title" }, { name: "status" }, referencesField],
    },
  };
  const entities = {
    project: { optional: [] },
    reference: { optional: [] },
  };
  // Two parents, so every write assertion can check the row that was NOT
  // edited as well as the one that was.
  const alpha = {
    id: "p1",
    name: "Alpha",
    status: "active",
    references: [{ name: "Ref A1", url: "https://a1", notes: "first" }],
  };
  const beta = {
    id: "p2",
    name: "Beta",
    status: "idea",
    references: [
      { name: "Ref B1", url: "https://b1" },
      { name: "Ref B2", url: "https://b2" },
    ],
  };
  const items = [alpha, beta];

  // The wrapper a block renders inside, located by the block's own title label
  // rather than by DOM position.
  // The child's label now sits in its own heading row (label + optional info
  // button) inside the child block, so the block is two levels up rather than
  // one. Explicit rather than a class selector: if the structure changes
  // again this fails loudly instead of silently scoping to the wrong element.
  const childBlock = (title) => screen.getByText(title).parentElement.parentElement;

  function renderStatefulParent(initialItems, node = parentNode) {
    let seen = initialItems;
    function Harness() {
      const [state, setState] = useState(initialItems);
      return (
        <ListRenderer
          node={node}
          entities={entities}
          entity={entities.project}
          packKey="wave4_test"
          items={state}
          onItems={(next) => {
            seen = next;
            setState(next);
          }}
        />
      );
    }
    const utils = render(<Harness />);
    return { ...utils, user: userEvent.setup(), latest: () => seen };
  }

  it("renders a block inside an expanded row, and not inside a collapsed one", async () => {
    const user = userEvent.setup();
    render(
      <ListRenderer
        node={parentNode}
        entities={entities}
        entity={entities.project}
        packKey="wave4_test"
        items={[alpha]}
        onItems={vi.fn()}
      />
    );

    // Collapsed: neither the child's title nor any of its rows exist.
    expect(screen.queryByText("References")).not.toBeInTheDocument();
    expect(screen.queryByText("Ref A1")).not.toBeInTheDocument();

    await user.click(screen.getByText("Alpha"));

    expect(screen.getByText("References")).toBeInTheDocument();
    expect(screen.getByText("Ref A1")).toBeInTheDocument();
  });

  it("edits the correct stored parent index and child index, leaving every other row byte-identical", async () => {
    const onItems = vi.fn();
    const before = JSON.stringify(items);
    const user = userEvent.setup();
    render(
      <ListRenderer
        node={parentNode}
        entities={entities}
        entity={entities.project}
        packKey="wave4_test"
        items={items}
        onItems={onItems}
      />
    );

    // Beta is stored at index 1; Ref B2 is its child index 1.
    await user.click(screen.getByText("Beta"));
    await user.click(screen.getByText("Ref B2"));
    await user.type(screen.getByDisplayValue("https://b2"), "!");

    const [[next]] = onItems.mock.calls;
    expect(next).toEqual([
      alpha,
      {
        id: "p2",
        name: "Beta",
        status: "idea",
        references: [
          { name: "Ref B1", url: "https://b1" },
          { name: "Ref B2", url: "https://b2!" },
        ],
      },
    ]);
    // The input is untouched -- the write replaced, it did not mutate.
    // Neither assertion above can establish that: `toEqual` compares against
    // the same fixture objects the write would have mutated, and `toBe` on an
    // untouched row is satisfied by a mutated object too (it is still the
    // same object). Only a snapshot taken before the interaction catches it.
    expect(JSON.stringify(items)).toBe(before);
    // Structural sharing, a separate property: the untouched parent and the
    // untouched sibling child are the very same objects, not equal copies.
    expect(next[0]).toBe(alpha);
    expect(next[1].references[0]).toBe(beta.references[0]);
  });

  it("adds a child item to row 1 without touching row 0", async () => {
    const before = JSON.stringify(items);
    const { user, latest } = renderStatefulParent(items);

    await user.click(screen.getByText("Beta"));
    await user.click(headerAdd(within(childBlock("References"))));

    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getAllByRole("textbox")[0], "Ref B3");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(latest()).toEqual([
      alpha,
      {
        id: "p2",
        name: "Beta",
        status: "idea",
        references: [
          { name: "Ref B3" },
          { name: "Ref B1", url: "https://b1" },
          { name: "Ref B2", url: "https://b2" },
        ],
      },
    ]);
    expect(JSON.stringify(items)).toBe(before); // replaced, never mutated
    expect(latest()[0]).toBe(alpha);
    expect(screen.getByText("Ref B3")).toBeInTheDocument();
  });

  it("removes a child item, routes it through the parent's confirmation, and leaves every other key on the parent item untouched", async () => {
    const onItems = vi.fn();
    const confirmations = [];
    const before = JSON.stringify(items);
    const user = userEvent.setup();
    render(
      <ListRenderer
        node={parentNode}
        entities={entities}
        entity={entities.project}
        packKey="wave4_test"
        items={items}
        onItems={onItems}
        onShowConfirmation={(title, body, confirm) => {
          confirmations.push(title);
          confirm();
        }}
      />
    );

    await user.click(screen.getByText("Beta"));
    await user.click(screen.getByRole("button", { name: "Remove Ref B1" }));

    // The child's delete went through the parent's confirmation prop, not
    // straight to the data.
    expect(confirmations).toEqual(["Remove Ref B1?"]);
    const [[next]] = onItems.mock.calls;
    expect(next).toEqual([
      alpha,
      {
        id: "p2",
        name: "Beta",
        status: "idea",
        references: [{ name: "Ref B2", url: "https://b2" }],
      },
    ]);
    expect(JSON.stringify(items)).toBe(before); // replaced, never mutated
    expect(next[0]).toBe(alpha);
  });

  it("edits the right child while the parent list is sorted, since the parent index comes from the row, not its display position", async () => {
    const sorted = { ...parentNode, sort: { field: "rank", dir: "desc" } };
    const ranked = [
      { ...alpha, rank: 1 },
      { ...beta, rank: 2 },
    ];
    const onItems = vi.fn();
    const before = JSON.stringify(ranked);
    const user = userEvent.setup();
    render(
      <ListRenderer
        node={sorted}
        entities={entities}
        entity={entities.project}
        packKey="wave4_test"
        items={ranked}
        onItems={onItems}
      />
    );

    // Beta displays first (rank 2, desc) but is stored at index 1.
    const rows = screen.getAllByText(/Alpha|Beta/);
    expect(rows.map((r) => r.textContent)).toEqual(["Beta", "Alpha"]);

    await user.click(screen.getByText("Beta"));
    await user.click(screen.getByText("Ref B1"));
    await user.type(screen.getByDisplayValue("https://b1"), "!");

    const [[next]] = onItems.mock.calls;
    expect(next).toEqual([
      { ...alpha, rank: 1 },
      {
        ...beta,
        rank: 2,
        references: [
          { name: "Ref B1", url: "https://b1!" },
          { name: "Ref B2", url: "https://b2" },
        ],
      },
    ]);
    // Matters more here than anywhere: the expected value above is spread
    // from the same fixtures, so an in-place mutation would appear on both
    // sides of the comparison and pass.
    expect(JSON.stringify(ranked)).toBe(before);
  });

  it("edits the right child while a search filter is active", async () => {
    const searchable = { ...parentNode, search: true };
    const onItems = vi.fn();
    const before = JSON.stringify(items);
    const user = userEvent.setup();
    render(
      <ListRenderer
        node={searchable}
        entities={entities}
        entity={entities.project}
        packKey="wave4_test"
        items={items}
        onItems={onItems}
      />
    );

    // Filter down to Beta only -- it is now the only row on screen, but is
    // still stored at index 1.
    await user.type(screen.getAllByRole("searchbox")[0], "beta");
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();

    await user.click(screen.getByText("Beta"));
    await user.click(screen.getByText("Ref B2"));
    await user.type(screen.getByDisplayValue("https://b2"), "!");

    const [[next]] = onItems.mock.calls;
    expect(next).toEqual([
      alpha,
      {
        ...beta,
        references: [
          { name: "Ref B1", url: "https://b1" },
          { name: "Ref B2", url: "https://b2!" },
        ],
      },
    ]);
    expect(JSON.stringify(items)).toBe(before); // replaced, never mutated
    expect(next[0]).toBe(alpha);
  });

  // DELETED with the format change: "logs a child node of an unsupported kind
  // (naming the pack) and still renders the parent row's own fields".
  //
  // It built `children: [{kind: "table", title: "Meta"}]` -- a whole node, of a
  // kind nothing implements, with no path. A block is no longer a node the
  // manifest writes: it is projected from a field whose `name` is required and
  // whose `type` decides the kind (`list` or `strings`, nothing else), so
  // ListRenderer cannot be handed a block of an unsupported kind or without a
  // path. There is nothing left here to construct.
  //
  // renderNode's guards themselves are unchanged and still covered, directly, by
  // renderNode.test.jsx: "returns null and logs for an unsupported kind, naming
  // the kind and pack" and "logs and returns null for a list node with no valid
  // path, naming the pack".

  it("renders an empty block, without logging, for an item that has no value at the block's path", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const gamma = { id: "p3", name: "Gamma", status: "idea" };
    const user = userEvent.setup();
    render(
      <ListRenderer
        node={parentNode}
        entities={entities}
        entity={entities.project}
        packKey="wave4_test"
        items={[gamma]}
        onItems={vi.fn()}
      />
    );

    await user.click(screen.getByText("Gamma"));

    expect(screen.getByText("References")).toBeInTheDocument();
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
    // A fresh parent is not corruption.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("writes into a parent item that has no key at the block's path at all, without disturbing its other keys", async () => {
    const gamma = { id: "p3", name: "Gamma", status: "idea" };
    const { user, latest } = renderStatefulParent([gamma]);

    await user.click(screen.getByText("Gamma"));
    await user.click(headerAdd(within(childBlock("References"))));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getAllByRole("textbox")[0], "First ref");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(latest()).toEqual([
      { id: "p3", name: "Gamma", status: "idea", references: [{ name: "First ref" }] },
    ]);
  });

});

// ---------------------------------------------------------------------------
// facets -- wave 4, Task 3
//
// A facet is display-only: it narrows `visible` but must never reach
// `onItems`. The facet control and a row's own enum control for the SAME
// field (here, "status") both render on screen once a row is expanded --
// they'd collide under a name-only selector (`getByRole("button", { name:
// "active" })` alone is ambiguous once a row's own status control is on
// screen too). Every facet assertion below scopes into the facet's own
// `role="group"` wrapper (`aria-label="Filter by status"`) rather than
// relying on name uniqueness, and the one test that also expands a row
// selects the facet BEFORE expanding, so no row-level control is on screen
// yet to collide with.
// ---------------------------------------------------------------------------
describe("facets", () => {
  // The entity below declares deliberately wrong options: the facet resolves its
  // chips from the same `meta` ScalarField reads, which is the field's own
  // `values` and nothing else.
  const facetNode = listNode(
    ["projects"],
    "name",
    [
      { name: "status", type: "enum", values: ["active", "paused", "completed"] },
      { name: "notes", type: "longtext" },
    ],
    { node: { search: true, facets: ["status"] } }
  );
  const entity = { valid_values: { status: ["wrong_one", "wrong_two"] } };
  const items = [
    { name: "Alpha", status: "active", notes: "team review" },
    { name: "Bravo", status: "paused", notes: "team retro" },
    { name: "Charlie", status: "active", notes: "solo work" },
  ];

  function facetGroup() {
    return screen.getByRole("group", { name: "Filter by status" });
  }

  it("renders one option per declared value plus an All, ignoring the entity's valid_values", () => {
    render(
      <ListRenderer node={facetNode} entity={entity} items={items} onItems={vi.fn()} />
    );
    const buttons = within(facetGroup()).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "All", "active", "paused", "completed",
    ]);
    // The entity's (wrong) options must not have leaked in anywhere.
    expect(screen.queryByText("wrong_one")).not.toBeInTheDocument();
    expect(screen.queryByText("wrong_two")).not.toBeInTheDocument();
  });

  it("selecting a facet value narrows the visible rows", async () => {
    const user = userEvent.setup();
    render(
      <ListRenderer node={facetNode} entity={entity} items={items} onItems={vi.fn()} />
    );

    await user.click(within(facetGroup()).getByRole("button", { name: "active" }));

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.queryByText("Bravo")).not.toBeInTheDocument();
  });

  it("composes with the search box -- both active narrows further than either alone", async () => {
    const user = userEvent.setup();
    render(
      <ListRenderer node={facetNode} entity={entity} items={items} onItems={vi.fn()} />
    );

    // "team" matches Alpha and Bravo's notes, not Charlie's.
    await user.type(screen.getByRole("searchbox"), "team");
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();

    // Facet "active" then drops Bravo (paused) from that search result too.
    await user.click(within(facetGroup()).getByRole("button", { name: "active" }));

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Bravo")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
  });

  it("clearing the facet (via All) returns every row", async () => {
    const user = userEvent.setup();
    render(
      <ListRenderer node={facetNode} entity={entity} items={items} onItems={vi.fn()} />
    );

    await user.click(within(facetGroup()).getByRole("button", { name: "active" }));
    expect(screen.queryByText("Bravo")).not.toBeInTheDocument();

    await user.click(within(facetGroup()).getByRole("button", { name: "All" }));

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("renders nothing extra for a node that declares no facets", () => {
    const { container } = render(
      <ListRenderer
        node={{ ...facetNode, facets: undefined }}
        entity={entity}
        items={items}
        onItems={vi.fn()}
      />
    );
    expect(screen.queryByRole("group", { name: "Filters" })).not.toBeInTheDocument();
    expect(container.querySelectorAll('[aria-label^="Filter by"]')).toHaveLength(0);
  });

  it("never calls onItems when a facet value is selected or cleared", async () => {
    const onItems = vi.fn();
    const user = userEvent.setup();
    render(<ListRenderer node={facetNode} entity={entity} items={items} onItems={onItems} />);

    await user.click(within(facetGroup()).getByRole("button", { name: "active" }));
    await user.click(within(facetGroup()).getByRole("button", { name: "All" }));

    expect(onItems).not.toHaveBeenCalled();
  });

  it("edits the correct stored row when a facet is active and the list is sorted, so the row's stored index -- not its display position -- receives the write", async () => {
    // Stored order is Charlie(0), Alpha(1), Bravo(2). Sorted ascending by
    // name, the display order is Alpha, Bravo, Charlie. Filtering to
    // status "active" (Alpha, Charlie) hides Bravo, leaving Alpha displayed
    // first even though it is stored at index 1, not 0.
    const sortedNode = { ...facetNode, sort: { field: "name" } };
    const stored = [
      { name: "Charlie", status: "active", notes: "team review" },
      { name: "Alpha", status: "active", notes: "team retro" },
      { name: "Bravo", status: "paused", notes: "solo work" },
    ];
    const before = JSON.stringify(stored);
    const onItems = vi.fn();
    const user = userEvent.setup();
    render(
      <ListRenderer node={sortedNode} entity={entity} items={stored} onItems={onItems} />
    );

    await user.click(within(facetGroup()).getByRole("button", { name: "active" }));
    expect(screen.queryByText("Bravo")).not.toBeInTheDocument();

    await user.click(screen.getByText("Alpha"));
    await user.type(screen.getByDisplayValue("team retro"), "!");

    const [[next]] = onItems.mock.calls;
    expect(next[1]).toMatchObject({ name: "Alpha", notes: "team retro!" });
    expect(next[0]).toMatchObject({ name: "Charlie", notes: "team review" });
    expect(next[2]).toMatchObject({ name: "Bravo", notes: "solo work" });
    // The stored fixture itself was replaced, never mutated in place.
    expect(JSON.stringify(stored)).toBe(before);
  });
});

// Every reference child list in the real packs (project_reference,
// domain_reference, mental_tab_reference) is permanently id-less: none of
// them appear in any manifest's id_lists, so persona_store._assign_ids never
// reaches them. knowledge's `domains` list is legitimately id-less too, per
// its own manifest $comment, until the next save backfills an id. And
// addItem itself never writes an id for a brand-new row. Before this row was
// keyed by its stored index, editing a title field on any of these rows
// remounted the row -- and therefore the input DOM node -- on every single
// keystroke, because the key (`item.id || `${item[titleField]}-${idx}`)
// changed along with the value being typed. The user kept typing into a node
// that was no longer in the document, so only the first keystroke's worth of
// change ever reached the screen. No existing test above catches this
// because every child-edit test types into `url`, never into the title
// field itself.
describe("row identity for a title edit when the row has no stored id", () => {
  function renderStatefulGeneric(node, initialItems) {
    let seen = initialItems;
    function Harness() {
      const [state, setState] = useState(initialItems);
      return (
        <ListRenderer
          node={node}
          items={state}
          onItems={(next) => {
            seen = next;
            setState(next);
          }}
        />
      );
    }
    const utils = render(<Harness />);
    return { ...utils, user: userEvent.setup(), latest: () => seen };
  }

  it("keeps every keystroke, not just the first, typed into a top-level row's title field", async () => {
    const node = listNode(["entries"], "topic", [{ name: "source" }]);
    // No `id` -- the shape addItem itself produces, and the shape every
    // id-less real-pack row has.
    const { user } = renderStatefulGeneric(node, [{ topic: "RSC", source: "conversation" }]);

    await user.click(screen.getByText("RSC"));
    await user.type(screen.getByDisplayValue("RSC"), "sitory");

    expect(screen.getByDisplayValue("RSCsitory")).toBeInTheDocument();
  });

  it("keeps every keystroke typed into a child reference row's name field, mirroring project_reference/domain_reference/mental_tab_reference -- all permanently id-less", async () => {
    const referencesField = {
      name: "references",
      type: "list",
      label: "References",
      show: [],
      element: {
        entity: "project_reference",
        identifier: "name",
        fields: [
          { name: "name", role: "title" },
          { name: "url" },
          { name: "notes", type: "longtext" },
        ],
      },
    };
    const parentNode = {
      kind: "list",
      path: ["projects"],
      element: {
        entity: "project",
        identifier: "name",
        fields: [{ name: "name", role: "title" }, { name: "status" }, referencesField],
      },
    };
    const entities = { project: { optional: [] }, project_reference: { optional: [] } };
    const alpha = {
      id: "p1",
      name: "Alpha",
      status: "active",
      // No `id` on the reference -- exactly what project_reference rows look
      // like, since they never appear in any manifest's id_lists.
      references: [{ name: "Repo", url: "https://example.com/repo" }],
    };

    let seen = [alpha];
    function Harness() {
      const [state, setState] = useState([alpha]);
      return (
        <ListRenderer
          node={parentNode}
          entities={entities}
          entity={entities.project}
          packKey="wave4_test"
          items={state}
          onItems={(next) => {
            seen = next;
            setState(next);
          }}
        />
      );
    }
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("Alpha"));
    await user.click(screen.getByText("Repo"));
    await user.type(screen.getByDisplayValue("Repo"), "sitory");

    expect(screen.getByDisplayValue("Repository")).toBeInTheDocument();
    expect(seen[0].references[0].name).toBe("Repository");
  });
});

// A genuinely empty list is where a new user starts, and until this was fixed
// the panel they were looking at offered no way forward: it told them to "tap
// a suggestion" when only `aesthetics` ships any, and the sole way in was a
// small outline button up in the header. Reported from production for
// projects, knowledge, circle and learning_log -- which is every pack that has
// no suggestions.
describe("empty state offers a way in", () => {
  const node = listNode(["items"], "name");

  it("offers an Add action inside the empty panel, naming what it adds", async () => {
    const user = userEvent.setup();
    render(<ListRenderer node={{ ...node, title: "Mental tab" }} items={[]} onItems={vi.fn()} />);

    const cta = within(emptyPanel()).getByRole("button", { name: "Add thing" });
    await user.click(cta);

    // Opens the same dialog the header trigger does -- one dialog, not two.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("seeds field_defaults identically whether opened from the panel or the header", async () => {
    const withDefaults = listNode(["items"], "name", [{ name: "stance", default: "like" }]);
    const user = userEvent.setup();
    const seeded = () => within(screen.getByRole("dialog")).getByDisplayValue("like");

    const { unmount } = render(<ListRenderer node={withDefaults} items={[]} onItems={vi.fn()} />);
    await user.click(panelAdd());
    expect(seeded()).toBeInTheDocument();

    // A fresh mount, so this asserts the header's FIRST open rather than a
    // reopen -- reopening from either route is pinned separately below.
    unmount();
    render(<ListRenderer node={withDefaults} items={[]} onItems={vi.fn()} />);
    await user.click(headerAdd());
    expect(seeded()).toBeInTheDocument();
  });

  it("does not mention suggestions when the node has none", () => {
    render(<ListRenderer node={node} items={[]} onItems={vi.fn()} />);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
    expect(screen.queryByText(/suggestion/i)).not.toBeInTheDocument();
  });

  it("does mention them when the node has some", () => {
    const withSuggestions = listNode(["items"], "name", [], {
      node: { element: { ...node.element, fields: [{ name: "name", role: "title", suggestions: ["Minimalist"] }] } },
    });
    render(<ListRenderer node={withSuggestions} items={[]} onItems={vi.fn()} />);
    expect(screen.getByText(/tap a suggestion below/)).toBeInTheDocument();
  });

  it("shows the no-matches wording instead when a search hides every row", async () => {
    const searchable = { ...node, search: true };
    const user = userEvent.setup();
    render(<ListRenderer node={searchable} items={[{ name: "Alpha" }]} onItems={vi.fn()} />);

    await user.type(screen.getByRole("searchbox"), "zzz");

    const panel = screen.getByText(/No matches/);
    expect(panel).toBeInTheDocument();
    // The Add call to action is for an empty list, not a filtered-empty one --
    // offering it here would suggest adding is the way to see hidden rows.
    // Asked of the panel rather than the whole screen: the header trigger is
    // still there, and it names what it adds now, so a screen-wide query for
    // "Add thing" would find it and say nothing about this panel.
    expect(within(panel).queryByRole("button")).not.toBeInTheDocument();
  });
});

// The draft has to survive the SECOND open as well as the first, from either
// entry point and after either way out. Radix's `onOpenChange` cannot carry
// that on its own: it fires only for a close/open Radix itself performed, so
// the empty panel's button (which sets `open` in ListRenderer's own state) and
// the dialog's own Cancel button (which calls the `onOpenChange` prop rather
// than Radix's wrapper) both bypassed it. Two shipped consequences, both
// asserted below: reopening from the panel after an Escape showed no defaults,
// and Cancel left the abandoned draft in the fields.
describe("the Add dialog's draft across repeated opens", () => {
  const node = listNode(["items"], "name", [{ name: "stance", default: "like" }], {
    node: { title: "Mental tab" },
  });

  const titleInput = () => within(screen.getByRole("dialog")).getAllByRole("textbox")[0];

  it("re-seeds field_defaults on a reopen from the panel after a close Radix performed", async () => {
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={[]} onItems={vi.fn()} />);

    // First open, from the header trigger: seeded, as it always was.
    await user.click(headerAdd());
    expect(within(screen.getByRole("dialog")).getByDisplayValue("like")).toBeInTheDocument();

    // Escape is a close Radix performed, so its wrapper runs and empties the
    // draft. Nothing re-fills it on the way back in.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(panelAdd());
    expect(within(screen.getByRole("dialog")).getByDisplayValue("like")).toBeInTheDocument();
  });

  it("clears an abandoned draft when the way out was Cancel, not just the built-in close", async () => {
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={[]} onItems={vi.fn()} />);

    await user.click(panelAdd());
    await user.type(titleInput(), "abandoned");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(panelAdd());
    expect(titleInput()).toHaveValue("");
    // And the defaults are back, rather than the abandoned draft's leftovers.
    expect(within(screen.getByRole("dialog")).getByDisplayValue("like")).toBeInTheDocument();
  });
});

// A reader-facing display order, ruled 2026-08-10. Date fields only: the
// control is offered when `display_formats` marks one of the node's
// `display_fields` as datetime/date, which today is exactly one shipped node
// (learning_log/entries).
describe("sort control", () => {
  const sortNode = listNode(
    ["entries"],
    "topic",
    [
      { name: "details" },
      { name: "timestamp", show: ["row"], format: "datetime", ui_only: true },
    ],
    { node: { sort: { field: "timestamp", dir: "desc" } } }
  );
  // Stored deliberately out of order, so a passing assertion cannot be an
  // accident of the array's own sequence. Titles are Greek rather than
  // "Newest"/"Oldest" on purpose: those words are the CONTROL's own labels,
  // and a row named after one would be matched by any query looking for it.
  const entries = [
    { topic: "Beta", timestamp: "2026-02-01T12:00:00Z" },
    { topic: "Gamma", timestamp: "2026-03-01T12:00:00Z" },
    { topic: "Undated" },
    { topic: "Alpha", timestamp: "2026-01-01T12:00:00Z" },
  ];

  // getAllByText returns matches in document order, which is what makes this
  // an order assertion rather than a presence one.
  const shownOrder = () =>
    screen.getAllByText(/^(Alpha|Beta|Gamma|Undated)$/).map((el) => el.textContent);

  const control = () => screen.getByRole("combobox", { name: "Sort" });
  const chooseOrder = async (user, name) => {
    await user.click(control());
    await user.click(screen.getByRole("option", { name }));
  };

  it("offers the control, defaulting to the order the section declares", () => {
    render(<ListRenderer node={sortNode} items={entries} onItems={vi.fn()} />);

    // dir: "desc" is newest-first, so the control opens agreeing with the rows
    // rather than announcing an order the list does not have.
    expect(control()).toHaveTextContent("Newest");
    expect(shownOrder()).toEqual(["Gamma", "Beta", "Alpha", "Undated"]);
  });

  it("is absent for a node with no date field", () => {
    render(<ListRenderer node={node} entity={entity} items={[scandinavian]} onItems={vi.fn()} />);

    expect(screen.queryByRole("combobox", { name: "Sort" })).not.toBeInTheDocument();
  });

  it("is absent when the only date-formatted key is not a display field", () => {
    // This is `knowledge`'s `created_at` shape. That manifest records that its
    // two write paths disagree -- one local time labelled UTC, one real UTC --
    // so ordering by it would be wrong by the offset for half the entries.
    // Sourcing the rule from display_fields is what keeps it out.
    const hidden = listNode(["entries"], "topic", [
      { name: "details" },
      { name: "created_at", show: [], format: "datetime", ui_only: true },
    ]);
    render(<ListRenderer node={hidden} items={entries} onItems={vi.fn()} />);

    expect(screen.queryByRole("combobox", { name: "Sort" })).not.toBeInTheDocument();
  });

  it("reverses the display order when switched to Oldest", async () => {
    const user = userEvent.setup();
    render(<ListRenderer node={sortNode} items={entries} onItems={vi.fn()} />);

    await chooseOrder(user, "Oldest");

    // Undated stays last in BOTH directions -- an undated row is unknown, not
    // oldest, and dropping it off the top of a desc list would hide it.
    expect(shownOrder()).toEqual(["Alpha", "Beta", "Gamma", "Undated"]);
  });

  it("never writes: changing the order is display state only", async () => {
    const user = userEvent.setup();
    const onItems = vi.fn();
    render(<ListRenderer node={sortNode} items={entries} onItems={onItems} />);

    await chooseOrder(user, "Oldest");

    // The schema calls `sort` "display order only ... the stored array is
    // never reordered", and an entity's actions are add|update|remove.
    expect(onItems).not.toHaveBeenCalled();
  });

  it("keeps an expanded row expanded, and on the same row, across a sort change", async () => {
    const user = userEvent.setup();
    render(<ListRenderer node={sortNode} items={entries} onItems={vi.fn()} />);

    // Alpha is the oldest, so it sits third under the declared order and first
    // once reversed -- a display-position bug would strand the expansion.
    await user.click(screen.getByText("Alpha"));
    // Two controls, not one: the title field leads the expanded row and
    // `details` follows it. This node is not `searchable`, so nothing outside
    // the open row contributes a text input.
    const EXPANDED_CONTROLS = 2;
    expect(screen.getAllByRole("textbox")).toHaveLength(EXPANDED_CONTROLS);

    await chooseOrder(user, "Oldest");

    // Still exactly one expanded row, and still Alpha's. This holds because
    // buildOrder sorts STORED indexes and `expanded` is keyed the same way --
    // the invariant that made this feature a one-line change.
    const alphaRow = screen.getByText("Alpha").closest("div.border-b");
    expect(within(alphaRow).getAllByRole("textbox")).toHaveLength(EXPANDED_CONTROLS);
    // Nothing else opened: the count on screen still matches the one row.
    expect(screen.getAllByRole("textbox")).toHaveLength(EXPANDED_CONTROLS);
  });

  // These two exist because the arrangement drifted from the prototype without
  // failing anything: the count was rendered FIRST, so it read immediately left
  // of the Sort control instead of opposite it. Every toolbar row in the Figma
  // file is SPACE_BETWEEN with the count last -- `Order` row 327:1124 and
  // `Filters` row 324:1169. A full suite of 657 tests had nothing to say about
  // it, which is exactly why the assertion is worth writing down.
  const countEl = () => screen.getByText(/^\d+( of \d+)? entr(y|ies)$/);

  it("puts the count last in the row and pushes it to the far right", () => {
    render(<ListRenderer node={sortNode} items={entries} onItems={vi.fn()} />);

    const count = countEl();
    // DOCUMENT_POSITION_FOLLOWING == `count` comes after the control in
    // document order, which is the ordering claim; ml-auto is what turns that
    // ordering into the visual gap between them.
    const rel = control().compareDocumentPosition(count);
    expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(count.className).toContain("ml-auto");
  });

  it("leaves a lone count unpushed, having nothing to sit opposite", () => {
    // No facets, no date field: the row is the count by itself, and shoving it
    // against the right edge would just look like a mistake.
    const plain = listNode(["entries"], "topic");
    render(<ListRenderer node={plain} items={[{ topic: "Alpha" }]} onItems={vi.fn()} />);

    expect(screen.queryByRole("combobox", { name: "Sort" })).not.toBeInTheDocument();
    expect(countEl()).toHaveTextContent("1 entry");
    expect(countEl().className).not.toContain("ml-auto");
  });
});
