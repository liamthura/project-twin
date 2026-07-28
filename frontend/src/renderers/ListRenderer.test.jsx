import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ListRenderer from "./ListRenderer";

// Shapes mirror the real "aesthetics" pack (frontend/src/__fixtures__/packs.json
// and frontend/src/__fixtures__/data/aesthetics.json): a title field, two
// badges (one enum with a VALUE_META icon, one without), a long-text detail
// field, an array detail field, suggestions, and an entity with valid_values,
// optional custom_* fields and field_defaults.
const node = {
  kind: "list",
  path: ["styles"],
  entity: "aesthetic",
  title_field: "name",
  badges: ["domain", "stance"],
  detail_fields: ["notes", "references"],
  array_fields: ["references"],
  suggestions: { name: ["Minimalist", "Scandinavian"] },
};

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

describe("ListRenderer", () => {
  it("renders each row's title, and badges for fields listed in node.badges", () => {
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

    // The delete button is icon-only (no accessible name), unlike the Add
    // trigger and any suggestion chips, which both carry visible text.
    const deleteButton = screen.getAllByRole("button").find((b) => b.textContent === "");
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

  it("merges entity.field_defaults into a new item added via the dialog", async () => {
    const { user, latest } = renderStateful([scandinavian]);

    await user.click(screen.getByRole("button", { name: "Add" }));
    const dialog = screen.getByRole("dialog");
    const titleInput = within(dialog).getAllByRole("textbox")[0];
    await user.type(titleInput, "Y2K");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(latest()[0]).toMatchObject({ name: "Y2K", stance: "like" });
  });

  it("is a no-op when the added title duplicates an existing one, case-insensitively", async () => {
    const initial = [scandinavian];
    const { user, latest } = renderStateful(initial);

    await user.click(screen.getByRole("button", { name: "Add" }));
    const dialog = screen.getByRole("dialog");
    const titleInput = within(dialog).getAllByRole("textbox")[0];
    await user.type(titleInput, "scandinavian");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    // onItems is never called, so the harness's seen reference is still the
    // exact array we rendered with.
    expect(latest()).toBe(initial);
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

  // A schema-valid node need not carry `entity` at all -- waves 3-6 author
  // exactly such nodes for sections whose storage keys diverge from any
  // entity's manifest names. Before this fix, the Add dialog heading did
  // `node.entity.replace(...)` unconditionally and threw on click with no
  // error boundary anywhere in the app to catch it (see ListRenderer.jsx and
  // the crash this guarded against).
  it("does not throw and shows a sensible Add dialog heading when the node has no entity", async () => {
    const entitylessNode = { kind: "list", path: ["goals"], title_field: "title" };
    const user = userEvent.setup();
    render(
      <ListRenderer node={entitylessNode} entity={undefined} items={[]} onItems={() => {}} />
    );

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("heading", { name: "Add item" })).toBeInTheDocument();
  });

  it("uses node.title, when present, for the Add dialog heading in preference to node.entity", async () => {
    const titledNode = { ...node, title: "Aesthetic style" };
    const user = userEvent.setup();
    render(<ListRenderer node={titledNode} entity={entity} items={[]} onItems={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("heading", { name: "Add Aesthetic style" })).toBeInTheDocument();
  });

  it("uses node.long_text (array form) over the default long-text set to render a textarea", async () => {
    // "summary" has no enum, isn't an array field, and isn't in ScalarField's
    // default LONG_TEXT_FIELDS set, so this only renders a Textarea if the
    // node-declared long_text is honoured.
    const longTextNode = { ...node, detail_fields: ["summary"], long_text: ["summary"] };
    const item = { ...scandinavian, summary: "A short summary" };
    const user = userEvent.setup();
    render(<ListRenderer node={longTextNode} entity={entity} items={[item]} onItems={() => {}} />);

    await user.click(screen.getByText("Scandinavian"));

    const el = screen.getByDisplayValue("A short summary");
    expect(el.tagName).toBe("TEXTAREA");
  });

  it("gives node.optional precedence over entity.optional for the custom_* overflow input", async () => {
    // entity.optional lists custom_stance, but this node declares its own
    // inline enum with no custom_* override -- node.optional (empty) must
    // win, so no custom input appears for value "other".
    const inlineEnumNode = {
      ...node,
      enum: { stance: ["love", "like", "avoid", "other"] },
      optional: [],
    };
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
    const simpleNode = { kind: "list", path: ["items"], title_field: "name", detail_fields: ["note"] };
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
    const deleteButtons = screen.getAllByRole("button").filter((b) => b.textContent === "");
    await user.click(deleteButtons[0]);
    rerender(<ListRenderer node={simpleNode} items={current} onItems={vi.fn()} />);

    expect(screen.getByDisplayValue("note-2")).toBeInTheDocument();
  });
});

describe("@now in field_defaults", () => {
  const node = {
    kind: "list",
    path: ["entries"],
    title_field: "topic",
    detail_fields: ["source"],
    field_defaults: { source: "manual", timestamp: "@now" },
  };

  it("resolves @now to an ISO timestamp when an item is added", async () => {
    const onItems = vi.fn();
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={[]} onItems={onItems} />);

    await user.click(screen.getByRole("button", { name: /add/i }));
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

    await user.click(screen.getByRole("button", { name: /add/i }));
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
        node={{ ...node, field_defaults: { source: "@channel" } }}
        items={[]}
        onItems={onItems}
      />
    );

    await user.click(screen.getByRole("button", { name: /add/i }));
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

    await user.click(screen.getByRole("button", { name: /add/i }));
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
  const node = {
    kind: "list",
    path: ["entries"],
    title_field: "topic",
    detail_fields: ["source"],
    sort: { field: "timestamp", dir: "desc" },
  };
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

    // Delete buttons are icon-only with no accessible name -- this is the
    // selector convention already used at ListRenderer.test.jsx:99-102. The
    // first one on screen belongs to "Newest", which is stored at index 1.
    const deleteButtons = screen.getAllByRole("button").filter((b) => b.textContent === "");
    await user.click(deleteButtons[0]);

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
    const numericNode = {
      kind: "list",
      path: ["entries"],
      title_field: "topic",
      detail_fields: ["source"],
      sort: { field: "priority", dir: "asc" },
    };
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
  const node = {
    kind: "list", path: ["items"], title_field: "name",
    detail_fields: ["relationship"], array_fields: ["traits"], searchable: true,
  };
  const items = [
    { name: "Ada Lovelace", relationship: "Mentor", traits: ["maths"] },
    { name: "Grace Hopper", relationship: "Colleague", traits: ["compilers"] },
  ];

  it("is absent when the node does not opt in", () => {
    render(<ListRenderer node={{ ...node, searchable: false }} items={items} onItems={vi.fn()} />);
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

    await user.click(screen.getByRole("button", { name: "Add" }));
    const dialog = screen.getByRole("dialog");
    const titleInput = within(dialog).getAllByRole("textbox")[0];
    await user.type(titleInput, "Bob Smith");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(screen.getByText("Bob Smith")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
});

describe("search combined with sort", () => {
  const node = {
    kind: "list", path: ["entries"], title_field: "topic",
    detail_fields: ["source"], searchable: true,
    sort: { field: "priority", dir: "asc" },
  };
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

describe("info", () => {
  const info = { overview: "Who matters to you.", tips: ["Name: their name.", "Notes: context."] };
  const node = { kind: "list", path: ["items"], title_field: "name", info };

  it("renders no info button when the node declares none", () => {
    render(<ListRenderer node={{ ...node, info: undefined }} items={[]} onItems={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /about this section/i })).not.toBeInTheDocument();
  });

  it("opens a dialog showing the overview and every tip", async () => {
    const user = userEvent.setup();
    render(<ListRenderer node={node} items={[]} onItems={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /about this section/i }));
    expect(screen.getByText("Who matters to you.")).toBeInTheDocument();
    for (const tip of info.tips) expect(screen.getByText(tip)).toBeInTheDocument();
  });
});
