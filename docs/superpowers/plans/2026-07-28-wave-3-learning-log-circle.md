# Wave 3: `learning_log` and `circle` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the `learning_log` and `circle` sections off their bespoke editors onto the renderer kit, deleting 802 lines, and add the four renderer capabilities those two sections need.

**Architecture:** Four additive capabilities land in `ListRenderer` first (each with its own tests, each independently useful), then the two manifests declare `ui` blocks, then the editors and their `App.jsx` wiring are deleted. `SectionRenderer` is untouched except where noted — the dispatch refactor is a wave 4 prerequisite, not this wave's, because both sections here are flat lists with no `children`.

**Tech Stack:** React 18, Vite 7, Vitest 4 + Testing Library + Storybook 10, Tailwind 3, Python 3.11/3.13 backend with `jsonschema` manifest validation.

## Global Constraints

- **`ui` declares storage keys, never manifest `entities` field names.** Verified for this wave: see "Established stored keys" below. `entities` is the MCP input vocabulary and stays untouched.
- **No stored JSON changes.** Every key not modelled by the `ui` block must survive an edit byte-identical. The round-trip guard is what proves it.
- **Converge, do not achieve parity.** Bespoke affordances not listed in this plan are dropped deliberately. Do not port them.
- **New UI comes from existing primitives.** `frontend/src/components/ui/*` and `frontend/src/components/controls.jsx`. Any interactive element that is not already a shadcn primitive spreads `FOCUS_RING` (`frontend/src/components/controls.jsx:82`). Semantic colour tokens only. See the spec's "Sourcing UI primitives".
- **Every `ui` schema addition is optional**, so the three already-migrated packs and any third-party pack keep validating unchanged.
- **Backend suite stays green** (449 tests) — `cd backend && ./venv/bin/python -m pytest -q`. `pytest` is **not** on PATH; the venv is required. Takes ~3 minutes.
- **Frontend suite stays green** — `cd frontend && npm test`. The fast inner loop is `npx vitest run --project unit` (~2s). Never background either one; they finish well inside a normal tool timeout, and polling a background job is how the last wave stalled.
- `timeout(1)` does not exist on this macOS shell. Do not wrap commands in it.
- Fixtures are generated, never hand-edited: `cd frontend && npm run fixtures`.

**Line references in this plan are from `main` at the time of writing.** Tasks 1–4 all edit `frontend/src/renderers/ListRenderer.jsx`, so every line number in a later task's **Files** block has already drifted by the time that task runs. Locate code by reading the file and matching on the named symbol (`addItem`, `removeItem`, the item loop, the header row), never by jumping to a line number. The `App.jsx` references in Task 7 are the exception — nothing before Task 7 touches that file.

**Test selector conventions in `ListRenderer.test.jsx`** — follow them; deviating is what breaks these tests:

- The add-dialog title input has **no label association**. `getByLabelText("topic")` throws. Use `within(screen.getByRole("dialog")).getAllByRole("textbox")[0]`.
- Row delete buttons are icon-only with no accessible name. Select with
  `screen.getAllByRole("button").filter((b) => b.textContent === "")`.
- Task 4 adds an icon-only Info button. It carries `aria-label="About this section"`, so it has an accessible name and is excluded from a `{ name: "" }` query — but its `textContent` is also `""`. Any test written after Task 4 that selects delete buttons by `textContent` on a node declaring `info` must account for it.

## Established stored keys

Read from the bespoke editors and `backend/server.py` `execute_modify`. **This is the authority for the `ui` blocks — do not re-derive from `entities`.**

`learning_log.entries[]` (`server.py:1986-2056`, `LearningLogEditor.jsx`):

| Key | Shape | In `ui`? |
| --- | --- | --- |
| `id` | string, `learn_<date>_<hex>` | no — must survive edits |
| `topic` | string | yes, `title_field` |
| `details` | long text | yes |
| `source` | string, defaults `"conversation"` (MCP) / `"manual"` (UI) | yes |
| `tags` | string[] | yes |
| `key_decisions` | string[] | yes |
| `followup_items` | string[] | yes |
| `timestamp` | ISO 8601 string | no — set on add, sorted by |
| `related_entries` | `{type, id}[]` | no — must survive edits |
| `conversation_metadata` | object | no — must survive edits |

`circle.connections[]` (`server.py:1940-1983`, `CircleEditor.jsx`):

| Key | Shape | In `ui`? |
| --- | --- | --- |
| `id` | string, `connection_<…>` | no — must survive edits |
| `name` | string | yes, `title_field` |
| `relationship` | string | yes |
| `traits` | string[] | yes |
| `notes` | long text | yes |

**Traps confirmed by reading, do not fall into them:**

- `entities.connection.optional` lists **`contact`**. It is *not* a stored key — `server.py:1109` and `server.py:1945` show it is an input alias for `name`. A `ui` block declaring `contact` would write a key nothing reads.
- `entities.learning_entry.optional` lists **`new_topic`**. It is an update verb that renames `topic` (`server.py:2039-2041`), not a stored key.

---

### Task 1: `@now` token in `field_defaults`

New entries need `timestamp` set at add time. `field_defaults` is static JSON, so a token is resolved by the renderer.

**Files:**
- Modify: `frontend/src/renderers/ListRenderer.jsx:35` (`fieldDefaults`) and `:53-58` (`addItem`), `:92` (dialog-open draft)
- Modify: `backend/section_packs/meta_schema.json` — `$defs.uiSection.properties.field_defaults` description
- Test: `frontend/src/renderers/ListRenderer.test.jsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `resolveDefaults(fieldDefaults)` — module-private in `ListRenderer.jsx`, returns a plain object with `"@now"` values replaced by `new Date().toISOString()`. Task 5 depends on the token being honoured; nothing imports it.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/renderers/ListRenderer.test.jsx`:

```jsx
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
    await user.type(within(dialog).getAllByRole("textbox")[0], "React Server Components");
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
    await user.type(within(dialog).getAllByRole("textbox")[0], "T");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(onItems.mock.calls[0][0][0].source).toBe("@channel");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run --project unit src/renderers/ListRenderer.test.jsx -t "@now"`
Expected: FAIL — `added[0].timestamp` is the literal `"@now"`.

- [ ] **Step 3: Implement**

In `frontend/src/renderers/ListRenderer.jsx`, above the component:

```jsx
// `field_defaults` is static JSON in a manifest, so a created-at stamp has to
// be expressed as a token the renderer resolves at add time. Exact-match only:
// a value that merely starts with "@" is real user data, not a token.
function resolveDefaults(defaults) {
  const out = {};
  for (const [k, v] of Object.entries(defaults)) {
    out[k] = v === "@now" ? new Date().toISOString() : v;
  }
  return out;
}
```

Then in `addItem`, replace `const item = { ...fieldDefaults, ...base };` with:

```jsx
const item = { ...resolveDefaults(fieldDefaults), ...base };
```

Leave the dialog-open `setDraft(o ? { ...fieldDefaults } : {})` reading the raw
defaults — a token has no control of its own, so it never reaches the screen, and
resolving at open time would stamp the moment the dialog opened rather than the
moment the entry was created.

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run --project unit src/renderers/ListRenderer.test.jsx`
Expected: PASS, all existing tests in the file still green.

- [ ] **Step 5: Document the token in the schema**

In `backend/section_packs/meta_schema.json`, `$defs.uiSection.properties.field_defaults`, add:

```json
"description": "Values preselected on a new item. The exact value \"@now\" is replaced by an ISO 8601 timestamp at add time; every other value is used literally."
```

Add the same `description` to `$defs.entity.properties.field_defaults`, which feeds
the same code path via `entity?.field_defaults`.

- [ ] **Step 6: Run the backend suite**

Run: `cd backend && pytest -q`
Expected: PASS (449 tests). The schema change is a description only.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/renderers/ListRenderer.jsx frontend/src/renderers/ListRenderer.test.jsx backend/section_packs/meta_schema.json
git commit -m "feat: resolve @now in field_defaults to an ISO timestamp at add time"
```

---

### Task 2: `sort` on a list node

`learning_log` is append-only, so array order puts the newest entry last. The bespoke editor sorted newest-first; the renderer needs the same, without breaking edit targeting.

**Files:**
- Modify: `frontend/src/renderers/ListRenderer.jsx` — item iteration at `:187`
- Modify: `backend/section_packs/meta_schema.json` — `$defs.uiSection.properties.sort`
- Test: `frontend/src/renderers/ListRenderer.test.jsx`

**Interfaces:**
- Consumes: nothing.
- Produces: node property `sort: {field: string, dir?: "asc" | "desc"}`, consumed by Task 5's manifest.

**Critical:** sort the *indexes*, not the items. `updateItem(idx, …)` and `removeItem(idx)` index into the real `items` array; sorting a copy of the array and passing display positions to them would edit the wrong row.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/renderers/ListRenderer.test.jsx`:

```jsx
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
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run --project unit src/renderers/ListRenderer.test.jsx -t "sort"`
Expected: FAIL — rows render in stored order.

- [ ] **Step 3: Implement**

In `ListRenderer.jsx`, above the `return`:

```jsx
// Display order only. The indexes are sorted, never the array, because
// updateItem/removeItem address the real stored position -- sorting a copy and
// handing them display positions would edit the wrong row.
const order = items.map((_, i) => i);
if (node.sort?.field) {
  const { field, dir = "asc" } = node.sort;
  const sign = dir === "desc" ? -1 : 1;
  order.sort((a, b) => {
    const av = items[a]?.[field];
    const bv = items[b]?.[field];
    // A missing key sorts last in both directions: an undated row is not
    // "oldest", it is unknown, and dropping it off the top of a desc list
    // would hide it.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return sign * String(av).localeCompare(String(bv));
  });
}
```

Then change the item loop from `items.map((item, idx) => (` to:

```jsx
{order.map((idx) => {
  const item = items[idx];
  return (
```

and close it with `);\n})}` instead of `))}`. Everything inside the loop body is
unchanged — it already reads `item` and `idx`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run --project unit src/renderers/ListRenderer.test.jsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Add `sort` to the schema**

In `backend/section_packs/meta_schema.json`, `$defs.uiSection.properties`:

```json
"sort": {
  "type": "object",
  "required": ["field"],
  "additionalProperties": false,
  "description": "Display order only. Rows are sorted by this storage key; the stored array is never reordered. Items missing the key sort last.",
  "properties": {
    "field": { "type": "string" },
    "dir": { "enum": ["asc", "desc"] }
  }
}
```

- [ ] **Step 6: Run the backend suite**

Run: `cd backend && pytest -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/renderers/ListRenderer.jsx frontend/src/renderers/ListRenderer.test.jsx backend/section_packs/meta_schema.json
git commit -m "feat: optional display sort on a list node"
```

---

### Task 3: Fix expanded-row tracking across removal

Pre-existing latent bug, in scope because `LearningLogEditor.jsx:63-71` handles it and deleting that editor without an equivalent is a regression. `expanded` is keyed by array index, so removing a row leaves every higher index pointing at a different item.

**Files:**
- Modify: `frontend/src/renderers/ListRenderer.jsx` — `expanded` state, `removeItem`
- Test: `frontend/src/renderers/ListRenderer.test.jsx`

**Interfaces:**
- Consumes: Task 2's `order` loop (this task edits the same component; rebase on it).
- Produces: nothing external.

- [ ] **Step 1: Write the failing test**

```jsx
it("keeps the right row expanded after an earlier row is removed", async () => {
  const node = {
    kind: "list", path: ["items"], title_field: "name", detail_fields: ["note"],
  };
  const items = [
    { name: "First", note: "note-1" },
    { name: "Second", note: "note-2" },
  ];
  let current = items;
  const user = userEvent.setup();
  const { rerender } = render(
    <ListRenderer node={node} items={current} onItems={(n) => { current = n; }} />
  );

  await user.click(screen.getByText("Second"));
  expect(screen.getByDisplayValue("note-2")).toBeInTheDocument();

  // Remove "First" (index 0). "Second" shifts to index 0 and must stay open.
  const deleteButtons = screen.getAllByRole("button").filter((b) => b.textContent === "");
  await user.click(deleteButtons[0]);
  rerender(<ListRenderer node={node} items={current} onItems={vi.fn()} />);

  expect(screen.getByDisplayValue("note-2")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run --project unit src/renderers/ListRenderer.test.jsx -t "right row expanded"`
Expected: FAIL — index 1 is still marked expanded, but nothing is at index 1 any more, so `note-2` is collapsed.

- [ ] **Step 3: Implement**

In `removeItem`, remap the expansion map the same way the array shifts:

```jsx
const removeItem = (idx) => {
  const doRemove = () => {
    onItems(items.filter((_, i) => i !== idx));
    // `expanded` is keyed by array index, so every index above the removed one
    // now addresses a different item. Shift them down to follow their rows.
    setExpanded((prev) => {
      const next = {};
      for (const [k, v] of Object.entries(prev)) {
        const i = Number(k);
        if (i < idx) next[i] = v;
        else if (i > idx) next[i - 1] = v;
      }
      return next;
    });
  };
  if (onShowConfirmation) {
    onShowConfirmation(
      `Remove ${items[idx][titleField]}?`,
      "This can't be undone.",
      doRemove
    );
  } else doRemove();
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run --project unit src/renderers/ListRenderer.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderers/ListRenderer.jsx frontend/src/renderers/ListRenderer.test.jsx
git commit -m "fix: expanded rows follow their items when an earlier row is removed"
```

---

### Task 4: Search and info tips

Both are promoted into the renderer by the spec, because both exist in the editors being deleted and convergence would otherwise lose them. Both are opt-in per node so the three migrated packs are unaffected.

**Files:**
- Modify: `frontend/src/renderers/ListRenderer.jsx` — header row
- Modify: `backend/section_packs/meta_schema.json` — `searchable`, `info`
- Test: `frontend/src/renderers/ListRenderer.test.jsx`

**Interfaces:**
- Consumes: Task 2's `order`; search filters `order`, after sorting.
- Produces: node properties `searchable: boolean` and `info: {overview: string, tips: string[]}`, both consumed by Task 5 and Task 6 manifests.

Search matches against the title field, every badge and detail field, and every
entry of an array field — the union of what both bespoke editors searched.

`InfoDialog` already exists at `frontend/src/components/ui/info-dialog.jsx`; reuse
it rather than building a dialog.

- [ ] **Step 1: Write the failing tests**

```jsx
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run --project unit src/renderers/ListRenderer.test.jsx -t "search"`
Expected: FAIL — no searchbox is rendered.

- [ ] **Step 3: Implement**

Imports to add in `ListRenderer.jsx`:

```jsx
import { Plus, Trash2, ChevronDown, Info } from "lucide-react";
import { InfoDialog } from "@/components/ui/info-dialog";
import { DialogFooter } from "@/components/ui/dialog"; // already imported; keep one import statement
```

State and filtering, beside the existing `useState` calls:

```jsx
const [query, setQuery] = useState("");
const [infoOpen, setInfoOpen] = useState(false);
```

After the `order` block from Task 2:

```jsx
// The union of what both deleted editors searched: title, badges, detail
// fields, and every entry of an array field.
const searchFields = [...new Set([titleField, ...badges, ...detailFields])];
const q = query.trim().toLowerCase();
const visible = !q
  ? order
  : order.filter((i) => {
      const item = items[i];
      return searchFields.some((f) => {
        const v = item?.[f];
        if (Array.isArray(v)) return v.some((e) => String(e).toLowerCase().includes(q));
        return v != null && String(v).toLowerCase().includes(q);
      });
    });
```

Change the item loop to `visible.map((idx) => {`.

In the header row, before the entry count, the info button:

```jsx
{node.info && (
  <Button
    variant="ghost"
    size="icon"
    className="h-7 w-7 text-muted-foreground hover:text-foreground"
    aria-label="About this section"
    onClick={() => setInfoOpen(true)}
  >
    <Info className="h-4 w-4" />
  </Button>
)}
```

Change the entry count to report the filter honestly:

```jsx
<div className="text-sm text-muted-foreground">
  {q ? `${visible.length} of ${items.length}` : items.length}{" "}
  {items.length === 1 ? "entry" : "entries"}
</div>
```

The search box, rendered below the header row and above the suggestions block,
only when the node opts in and there is something to search:

```jsx
{node.searchable && items.length > 0 && (
  <Input
    type="search"
    role="searchbox"
    aria-label="Search"
    placeholder="Search…"
    value={query}
    onChange={(e) => setQuery(e.target.value)}
    className="h-9"
  />
)}
```

The empty state must distinguish "nothing here" from "nothing matched":

```jsx
{visible.length === 0 ? (
  <EmptyState>
    {q
      ? "No matches. Clear the search to see everything."
      : "Nothing here yet. Use Add, or tap a suggestion."}
  </EmptyState>
) : (
```

The dialog, before the component's closing `</div>`:

```jsx
{node.info && (
  <InfoDialog
    open={infoOpen}
    onOpenChange={setInfoOpen}
    title={node.title ?? "About this section"}
    description={node.info.overview}
  >
    <p className="font-medium text-foreground">Tips for filling this section:</p>
    <ul className="space-y-2 text-muted-foreground">
      {(node.info.tips || []).map((tip, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-primary">•</span>
          <span>{tip}</span>
        </li>
      ))}
    </ul>
    <DialogFooter>
      <Button onClick={() => setInfoOpen(false)}>Got it</Button>
    </DialogFooter>
  </InfoDialog>
)}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run --project unit src/renderers/ListRenderer.test.jsx`
Expected: PASS. If `role="searchbox"` is rejected as redundant on `type="search"`, drop the explicit `role` — `getByRole("searchbox")` resolves from the input type.

- [ ] **Step 5: Add both to the schema**

In `$defs.uiSection.properties`:

```json
"searchable": {
  "type": "boolean",
  "description": "Renders a search box filtering rows on the title field, badges, detail fields and array-field entries."
},
"info": {
  "type": "object",
  "required": ["overview", "tips"],
  "additionalProperties": false,
  "description": "Content for the section's info dialog.",
  "properties": {
    "overview": { "type": "string", "minLength": 1 },
    "tips": { "type": "array", "items": { "type": "string" } }
  }
}
```

- [ ] **Step 6: Run the backend suite**

Run: `cd backend && pytest -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/renderers/ListRenderer.jsx frontend/src/renderers/ListRenderer.test.jsx backend/section_packs/meta_schema.json
git commit -m "feat: opt-in search box and info dialog on a list node"
```

---

### Task 5: `learning_log` manifest `ui` block

**Files:**
- Modify: `backend/section_packs/learning_log/manifest.json`
- Create: `frontend/src/__fixtures__/data/learning_log.json`
- Modify: `frontend/src/renderers/SectionRenderer.test.jsx`
- Regenerate: `frontend/src/__fixtures__/packs.json` (via `npm run fixtures`)

**Interfaces:**
- Consumes: `@now` (Task 1), `sort` (Task 2), `searchable` (Task 4).
- Produces: nothing for later tasks beyond the fixture.

- [ ] **Step 1: Add the `ui` block**

Append to `backend/section_packs/learning_log/manifest.json`, after `entities`:

```json
"ui": {
  "sections": [
    {
      "kind": "list",
      "path": ["entries"],
      "entity": "learning_entry",
      "title_field": "topic",
      "badges": ["source"],
      "detail_fields": ["details", "source", "tags", "key_decisions", "followup_items"],
      "array_fields": ["tags", "key_decisions", "followup_items"],
      "long_text": ["details"],
      "field_defaults": { "source": "manual", "timestamp": "@now" },
      "sort": { "field": "timestamp", "dir": "desc" },
      "searchable": true
    }
  ]
}
```

`id`, `timestamp`, `related_entries` and `conversation_metadata` are deliberately
absent — they are not user-editable and must round-trip untouched.

- [ ] **Step 2: Create the fixture**

`frontend/src/__fixtures__/data/learning_log.json` — every stored key present,
including the four the `ui` does not model, so the round-trip guard can prove they
survive:

```json
{
  "entries": [
    {
      "id": "learn_20260115_a1b2c3",
      "topic": "React Server Components",
      "details": "Rendering on the server removes the client bundle cost for data-only components.",
      "source": "conversation",
      "tags": ["react", "architecture"],
      "key_decisions": ["Adopt RSC for the docs site only"],
      "followup_items": ["Read the migration guide"],
      "timestamp": "2026-01-15T09:30:00.000Z",
      "related_entries": [{ "type": "project", "id": "proj_mygist" }],
      "conversation_metadata": { "model": "claude-opus-4", "turns": 12 }
    },
    {
      "id": "learn_20260320_d4e5f6",
      "topic": "Postgres full-text search",
      "details": "tsvector plus a GIN index beats trigram for prefix-heavy queries.",
      "source": "article",
      "tags": ["postgres"],
      "timestamp": "2026-03-20T14:05:00.000Z"
    }
  ]
}
```

- [ ] **Step 3: Regenerate the pack fixture**

Run: `cd frontend && npm run fixtures`
Expected: `src/__fixtures__/packs.json` gains the `learning_log` pack with its `ui` block.

- [ ] **Step 4: Wire both guards plus the wave-specific tests**

In `frontend/src/renderers/SectionRenderer.test.jsx`, add the import and the
`describeGuards` call:

```jsx
import learningLogData from "@/__fixtures__/data/learning_log.json";
const learningLogPack = packs.find((p) => p.key === "learning_log");

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

  it("preserves id, timestamp, related_entries and conversation_metadata across an edit", async () => {
    const { user, latest, initial } = renderSection({
      pack: learningLogPack, initial: learningLogData,
    });
    await user.click(screen.getByText("React Server Components"));
    await user.type(screen.getByDisplayValue("article"), "s");

    const after = latest();
    const entry = after.entries.find((e) => e.id === "learn_20260115_a1b2c3");
    const before = initial.entries.find((e) => e.id === "learn_20260115_a1b2c3");
    expect(entry.timestamp).toBe(before.timestamp);
    expect(entry.related_entries).toEqual(before.related_entries);
    expect(entry.conversation_metadata).toEqual(before.conversation_metadata);
  });
});
```

Note the edit targets `"article"` (entry 2's `source`), which is unambiguous —
entry 1's source is `"conversation"`.

- [ ] **Step 5: Run the frontend suite**

Run: `cd frontend && npm test`
Expected: PASS. The coverage guard proves every declared field is reachable; the
round-trip guard proves the four unmodelled keys survive.

- [ ] **Step 6: Run the backend suite**

Run: `cd backend && pytest -q`
Expected: PASS — the manifest must still validate against `meta_schema.json`.

- [ ] **Step 7: Commit**

```bash
git add backend/section_packs/learning_log/manifest.json frontend/src/__fixtures__ frontend/src/renderers/SectionRenderer.test.jsx
git commit -m "feat: declare the learning_log ui block"
```

---

### Task 6: `circle` manifest `ui` block

**Files:**
- Modify: `backend/section_packs/circle/manifest.json`
- Create: `frontend/src/__fixtures__/data/circle.json`
- Modify: `frontend/src/renderers/SectionRenderer.test.jsx`
- Regenerate: `frontend/src/__fixtures__/packs.json`

**Interfaces:**
- Consumes: `searchable` and `info` (Task 4).
- Produces: nothing.

- [ ] **Step 1: Add the `ui` block**

Append to `backend/section_packs/circle/manifest.json`, after `entities`. The
`info` text is lifted verbatim from `CircleEditor.jsx:46-58`, minus the `contact`
trap:

```json
"ui": {
  "sections": [
    {
      "kind": "list",
      "path": ["connections"],
      "entity": "connection",
      "title_field": "name",
      "detail_fields": ["relationship", "traits", "notes"],
      "array_fields": ["traits"],
      "long_text": ["notes"],
      "searchable": true,
      "info": {
        "overview": "Track the important people in your life and your relationships with them. This helps AI understand your social context and tailor suggestions accordingly.",
        "tips": [
          "Name: The person's full name or preferred name.",
          "Relationship: How you know them - e.g., 'Friend from university', 'Colleague at Google', 'Mentor', 'Family member'.",
          "Traits: Key characteristics or tags that describe them - personality, interests, expertise, etc.",
          "Notes: Context about your relationship, shared experiences, important details to remember."
        ]
      }
    }
  ]
}
```

**Do not add `contact`** — it is an MCP input alias for `name` (`server.py:1109`),
not a stored key.

`badges` is deliberately empty: the bespoke editor's badges were computed counts
("3 traits", "notes"), which the renderer does not model, and a raw `relationship`
string in a badge reads badly at real lengths. `relationship` is a detail field.

- [ ] **Step 2: Create the fixture**

`frontend/src/__fixtures__/data/circle.json`:

```json
{
  "connections": [
    {
      "id": "connection_20260102_aa11bb",
      "name": "Ada Lovelace",
      "relationship": "Mentor from the analytical engine days",
      "traits": ["mathematical", "patient"],
      "notes": "Introduced me to the idea that a machine could manipulate symbols, not just numbers."
    },
    {
      "id": "connection_20260214_cc22dd",
      "name": "Grace Hopper",
      "relationship": "Colleague",
      "traits": ["pragmatic"],
      "notes": "Insists the hardest thing is convincing people to stop doing it the old way."
    }
  ]
}
```

- [ ] **Step 3: Regenerate the pack fixture**

Run: `cd frontend && npm run fixtures`

- [ ] **Step 4: Wire the guards plus the info-dialog test**

```jsx
import circleData from "@/__fixtures__/data/circle.json";
const circlePack = packs.find((p) => p.key === "circle");

describe("circle", () => {
  describeGuards({ pack: circlePack, listKey: "connections", data: circleData });

  it("offers the info dialog carried by the manifest", async () => {
    const { user } = renderSection({ pack: circlePack, initial: circleData });
    await user.click(screen.getByRole("button", { name: /about this section/i }));
    expect(screen.getByText(/Track the important people/)).toBeInTheDocument();
    expect(screen.getByText(/The person's full name/)).toBeInTheDocument();
  });

  it("does not expose `contact`, which is an MCP alias for name and not a stored key", () => {
    renderSection({ pack: circlePack, initial: circleData });
    expect(screen.queryByText(/^contact$/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run both suites**

Run: `cd frontend && npm test` then `cd backend && pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/section_packs/circle/manifest.json frontend/src/__fixtures__ frontend/src/renderers/SectionRenderer.test.jsx
git commit -m "feat: declare the circle ui block"
```

---

### Task 7: Delete both editors and their `App.jsx` wiring

Only now, with both `ui` blocks proven by the guards, do the editors go.

**Files:**
- Delete: `frontend/src/editors/LearningLogEditor.jsx` (331), `frontend/src/editors/CircleEditor.jsx` (471)
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: Tasks 5 and 6.
- Produces: nothing.

- [ ] **Step 1: Remove the wiring**

Every site, from `frontend/src/App.jsx`:

| Line(s) | Change |
| --- | --- |
| 53-54 | delete both `import … from "@/editors/…"` |
| 81 | drop `"circle"` and `"learning_log"` from `BESPOKE_EDITORS` |
| 148-149 | delete `circle` / `learningLog` state |
| 201-202 | delete both `setCircle` / `setLearningLog` load lines |
| 270-277 | delete `handleCircleChange` and `handleLearningLogChange` |
| 294-295 | delete `circle,` and `learning_log: learningLog,` from `saveAll` — `...packData` now carries both |
| 590-599 | delete the `circle` and `learning` `TabsTrigger`s |
| 659-674 | delete the `circle` and `learning` `TabsContent`s |

Removing them from `BESPOKE_EDITORS` is what makes both flow into `packData`
(`App.jsx:203-208`) and render through the `dynamicPacks` loops for the trigger
(`:604`) and the content (`:681`).

- [ ] **Step 2: Keep the tab icons**

`dynamicPacks` picks its icon from `PACK_ICONS`, which would otherwise fall back to
the generic `Package`. Extend it so both tabs keep the icon they have today:

```jsx
const PACK_ICONS = { goals: Target, media: Film, aesthetics: Palette, circle: Users, learning_log: BookOpen };
```

`Users` and `BookOpen` are already imported for the triggers being deleted — verify
they are still imported after step 1 and re-add to the `lucide-react` import if not.

- [ ] **Step 3: Delete the files**

```bash
git rm frontend/src/editors/LearningLogEditor.jsx frontend/src/editors/CircleEditor.jsx
```

- [ ] **Step 4: Prove nothing still references them**

Run:
```bash
cd frontend && grep -rn "CircleEditor\|LearningLogEditor\|handleCircleChange\|handleLearningLogChange\|setLearningLog\|setCircle" src/ || echo "clean"
```
Expected: `clean`.

- [ ] **Step 5: Run both suites and the build**

Run: `cd frontend && npm test && npm run build`, then `cd backend && pytest -q`
Expected: PASS. The build is the check that no dangling import survived.

- [ ] **Step 6: Verify the tab behaviour by hand**

Run `npm run dev` and confirm:
- Circle and Learning Log tabs appear (now after Preferences, ordered by manifest `position`: circle 60, learning_log 70) with their original icons.
- The Learning Log tab's value changed from `"learning"` to `"learning_log"`. Nothing persists the active tab (`App.jsx:557` is `defaultValue="profile"`), so no migration is needed — confirm the tab still opens.
- Disabling Circle in Manage Sections hides its tab, via `p.enabled` rather than the deleted `disabledSections` guard.
- Adding a learning entry stamps a timestamp and the row lands at the top.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src
git commit -m "refactor: render learning_log and circle through the renderer kit

Deletes LearningLogEditor (331) and CircleEditor (471)."
```

---

### Task 8: Read-only display fields — RUNS BEFORE TASK 7

Added after Task 5's review. `learning_log` sorts newest-first on `timestamp`, but nothing renders it, so the list would arrive sorted by an invisible field. The user asked for a date/time on each entry "for a sense of control over their log". This must land **before** Task 7 deletes `LearningLogEditor.jsx`, so no parity gap ever exists on `main`.

**Why a new concept rather than `badges: ["timestamp"]`:** `ListRenderer` computes `editFields = [...new Set([...badges, ...detailFields])]` and renders a `ScalarField` for every one of them. Adding `timestamp` to `badges` would therefore also put a free-text input on it in the expanded row, letting a user hand-edit the machine-written sort key and silently reorder their own log. A read-only concept is required.

**Files:**
- Modify: `frontend/src/renderers/ListRenderer.jsx` — badge strip in the collapsed row
- Modify: `backend/section_packs/meta_schema.json` — `display_fields`, `display_formats`
- Modify: `backend/section_packs/learning_log/manifest.json`
- Test: `frontend/src/renderers/ListRenderer.test.jsx`, `frontend/src/renderers/SectionRenderer.test.jsx`

**Interfaces:**
- Consumes: nothing from Tasks 1–6 beyond the existing badge strip.
- Produces: node properties `display_fields: string[]` and `display_formats: {[field]: "date" | "datetime"}`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/renderers/ListRenderer.test.jsx`:

```jsx
describe("display_fields", () => {
  const node = {
    kind: "list",
    path: ["entries"],
    title_field: "topic",
    detail_fields: ["details"],
    display_fields: ["timestamp"],
    display_formats: { timestamp: "datetime" },
  };
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
      <ListRenderer
        node={{ ...node, display_formats: { timestamp: "date" } }}
        items={items}
        onItems={vi.fn()}
      />
    );
    expect(screen.getByText(expected.slice(0, 10))).toBeInTheDocument();
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

  it("renders nothing extra for a node that declares no display_fields", () => {
    const { container } = render(
      <ListRenderer node={{ ...node, display_fields: undefined, display_formats: undefined }}
        items={items} onItems={vi.fn()} />
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run --project unit src/renderers/ListRenderer.test.jsx -t "display_fields"`
Expected: FAIL — nothing renders the timestamp.

- [ ] **Step 3: Implement**

Above the component in `ListRenderer.jsx`:

```jsx
// Read-only display of a machine-written key (a created-at stamp, an id).
// Local time and locale-free: the stored value is UTC, showing it raw would
// be wrong by the offset, and a locale-formatted string would make the same
// log read differently on two machines. An unparseable value is shown
// verbatim rather than dropped -- nothing validates these on write, and
// hiding a value the user can see in their own JSON is worse than an odd
// looking badge.
function formatDisplay(value, format) {
  const raw = String(value);
  if (!format) return raw;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return raw;
  const p = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return format === "date" ? date : `${date} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
```

In the collapsed row's badge `<span>`, **before** the existing `badges.filter(...)` map so the stamp reads first, exactly as the bespoke editor ordered it:

```jsx
{(node.display_fields || [])
  .filter((f) => item[f] != null && item[f] !== "")
  .map((f) => (
    <Badge key={f} variant="secondary" className="gap-1 text-[10px] font-mono">
      {formatDisplay(item[f], node.display_formats?.[f])}
    </Badge>
  ))}
```

Do **not** add `display_fields` to `editFields`. That is the entire point of the concept.

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run --project unit`
Expected: PASS, all pre-existing tests still green.

- [ ] **Step 5: Add both properties to the schema**

In `backend/section_packs/meta_schema.json`, `$defs.uiSection.properties`:

```json
"display_fields": {
  "type": "array",
  "items": { "type": "string" },
  "description": "Storage keys shown read-only as badges on the collapsed row. Unlike `badges`, these are never rendered as editable controls -- use for machine-written values such as a created-at stamp."
},
"display_formats": {
  "type": "object",
  "additionalProperties": { "enum": ["date", "datetime"] },
  "description": "Optional per-field formatting for `display_fields`. Values are parsed as dates and rendered in local time; an unparseable value is shown verbatim."
}
```

- [ ] **Step 6: Declare it on `learning_log`**

In `backend/section_packs/learning_log/manifest.json`, add to the list node:

```json
"display_fields": ["timestamp"],
"display_formats": { "timestamp": "datetime" }
```

Then regenerate: `cd frontend && npm run fixtures`

- [ ] **Step 7: Add the section-level test**

`display_fields` is deliberately absent from `describeGuards`'s `covered` set — that guard asserts fields are reachable via `getByDisplayValue`, which cannot match a badge. So the pack needs its own assertion. In `SectionRenderer.test.jsx`'s `learning_log` describe block:

```jsx
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
```

- [ ] **Step 8: Run both suites**

Run: `cd frontend && npm test`, then `cd backend && ./venv/bin/python -m pytest -q` with an explicit Bash timeout of at least 400000 ms.
Expected: PASS.

**Read `backend/tests/test_ui_schema.py::test_ui_fields_are_covered_by_the_entity` before running, and report which of these two you find:**

`timestamp` is a real stored key (`server.py:2003` writes it on every add) but it is **not** in `entities.learning_entry`'s `required` or `optional` — MCP clients cannot set it, so it is absent from the input vocabulary. This is exactly the `entities` ≠ storage divergence the spec describes, and it means:

- If that guard collects `display_fields` into the set it checks, it will **fail** on `timestamp`. The correct fix is to exclude `display_fields` from that check with a comment explaining why — never to drop `timestamp` from the manifest to make the test green.
- If the guard does not know about `display_fields` (most likely, since the property is new), it will pass silently, and `display_fields` is then **unguarded** against a phantom key. Say so in your report rather than treating a green run as coverage.

- [ ] **Step 9: Make the title field editable on both packs**

Found by Task 6's review. `ListRenderer` computes `editFields` as `badges ∪ detail_fields`. Neither manifest lists its `title_field` there, so the title renders as a plain `<span>` in the row header and as an input **only in the Add dialog**. Both bespoke editors being deleted in Task 7 have a real edit control for it — `LearningLogEditor.jsx` labels it "Topic", `CircleEditor.jsx` labels it "Name".

Failure scenario without this: a user adds "Ada Lovelacce", spots the typo, expands the row, and finds no Name field. The only recourse is delete-and-re-add, which discards the row's `id` — and `id` is what `execute_link` (`server.py:1298`) points `related` entries at, so every cross-section link to that person breaks. Data loss on the workaround path.

Fix is manifest-only, no renderer change. Add the title field to `detail_fields` in both:

- `backend/section_packs/learning_log/manifest.json` → `"detail_fields": ["topic", "details", "source", "tags", "key_decisions", "followup_items"]`
- `backend/section_packs/circle/manifest.json` → `"detail_fields": ["name", "relationship", "traits", "notes"]`

Put it first so the expanded row leads with the title, as both bespoke editors do.

Regenerate fixtures, then add one test per pack in `SectionRenderer.test.jsx` asserting the title is editable in place and that editing it changes only that field:

```jsx
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
```

Write the equivalent for `learning_log` against `topic`.

Note the `describeGuards` coverage guard will now also cover the title field, since `covered` is `badges ∪ detail_fields`. That is intended.

- [ ] **Step 10: Run both suites**

Run: `cd frontend && npm test`, then `cd backend && ./venv/bin/python -m pytest -q` with an explicit Bash timeout of at least 400000 ms.

- [ ] **Step 11: Commit**

```bash
git add frontend/src backend/section_packs
git commit -m "feat: read-only display fields, learning log timestamp, editable title fields"
```

---

## Verification

After Task 7:

```bash
cd frontend && npm test && npm run build
cd backend && pytest -q
git diff --stat main...HEAD
```

Expected: 802 lines deleted from `frontend/src/editors/`, both suites green,
`frontend/src/editors/` down to five files.

## Notes for the reviewer

- The three already-migrated packs (`goals`, `media`, `aesthetics`) declare none of
  `sort`, `searchable`, `info` or `@now`. Their rendering must be byte-identical to
  `main` — every schema addition is optional and every renderer branch is guarded.
- `describeGuards` picks its round-trip edit field by excluding enums, array fields
  and date fields. `learning_log` and `circle` both have plain string detail fields
  (`source`, `relationship`), so the guard can run. If it throws
  "no free-text field to edit", the `ui` block is wrong, not the guard.
- Deliberately dropped, per the convergence decision: computed count badges
  ("3 traits", "2 tags", "N follow-ups"), the date badge derived from `timestamp`,
  the `related_entries` chip strip, the `id · timestamp` footer, the relationship
  subtitle under each name, the two-column notes layout, per-section collapse, and
  the "Clear filters" button. None of these touch stored data.
