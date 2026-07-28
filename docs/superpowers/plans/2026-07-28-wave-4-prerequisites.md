# Wave 4 Prerequisites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the three structural changes the spec names as wave 4 prerequisites, so wave 4's child-list work is not improvised on top of them.

**Architecture:** No user-visible behaviour changes anywhere. The dispatch that picks a renderer for a node moves out of `SectionRenderer` into its own module so it can be called for a nested node; `ListRenderer`'s derived pipeline moves into pure functions; the backend guard that was supposed to catch phantom `ui` fields is reworked to point the right way.

**Tech Stack:** React 18, Vite 7, Vitest 4 + Testing Library + Storybook 10, Tailwind 3, Python 3.11/3.13 with `jsonschema` manifest validation.

## Global Constraints

- **No behaviour changes.** Every existing test must pass unmodified except where a task explicitly says otherwise. If a test needs editing to stay green, that is a signal the refactor changed behaviour — stop and report it.
- **`ui` declares storage keys, never manifest `entities` field names.** That rule is what task 3 is trying to enforce mechanically.
- New UI comes from existing primitives; semantic Tailwind colour tokens only.
- Backend suite stays green: `cd backend && ./venv/bin/python -m pytest -q` (451 tests, ~3 min).
- Frontend stays green: `cd frontend && npm test` (122 tests) and `npm run build`.
- **The Bash tool defaults to a 120s timeout and AUTO-BACKGROUNDS past it.** Pass an explicit timeout of at least 400000 ms for the backend suite and run it in the foreground. Six agents in wave 3 stalled by backgrounding it and polling.
- Line references below are from `25ef0d2`. Tasks 1 and 2 both edit `ListRenderer.jsx`; locate code by symbol, not line number.
- **Before trusting any test you write, ask what you would have to break to make it fail.** If the answer is "nothing", rewrite it. Wave 3 shipped five such tests, three of them tautologies that passed against a deliberately broken manifest.

---

### Task 1: Extract the node dispatch into its own module

**Files:**
- Create: `frontend/src/renderers/renderNode.jsx`
- Modify: `frontend/src/renderers/SectionRenderer.jsx`
- Test: `frontend/src/renderers/renderNode.test.jsx` (create)

**Interfaces:**
- Consumes: `ListRenderer` (default export), `getAt`/`setAt` from `./paths`.
- Produces: `renderNode({ node, value, onValue, entities, packKey, onShowConfirmation })` → a React element or `null`. Wave 4 calls this for `node.children` against a list *item*; that is the entire reason it exists.

**Why:** the `kind` switch currently lives as inline JSX inside `SectionRenderer`'s `CardContent.map`, so it cannot be invoked for a node that is not a direct child of the section root without dragging the `Card` wrapper along. It also binds every path to the section root (`getAt(data, node.path)`), with no way to resolve a child's path against a list item instead.

**Scope honesty:** this task creates the seam and proves the existing rendering is unchanged. It does **not** implement `children` — that is wave 4. The import cycle the spec worries about (`ListRenderer` → `renderNode` → `ListRenderer`) therefore does not exist yet and cannot be tested yet. Do not add a speculative import to manufacture it. Note this in your report.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/renderers/renderNode.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderNode } from "./renderNode";

// renderNode is the seam wave 4 calls for a nested node. These tests drive it
// directly, without a Card or a pack, which is exactly the call shape a child
// node needs and the old inline dispatch could not offer.
describe("renderNode", () => {
  const listNode = { kind: "list", path: ["items"], title_field: "name", detail_fields: ["note"] };

  it("renders a list node against the value it is handed, not a section root", () => {
    renderResult({ node: listNode, value: [{ name: "Row", note: "n" }] });
    expect(screen.getByText("Row")).toBeInTheDocument();
  });

  it("reports edits through onValue as a replacement value", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    renderResult({ node: listNode, value: [{ name: "Row", note: "n" }], onValue });

    await user.click(screen.getByText("Row"));
    await user.type(screen.getByDisplayValue("n"), "X");

    expect(onValue).toHaveBeenCalled();
    expect(onValue.mock.calls.at(-1)[0]).toEqual([{ name: "Row", note: "nX" }]);
  });

  it("resolves its entity from the entities map it is given", () => {
    const node = { ...listNode, entity: "thing", detail_fields: ["stance"] };
    renderResult({
      node,
      value: [{ name: "Row", stance: "love" }],
      entities: { thing: { valid_values: { stance: ["love", "like"] } } },
    });
    // An enum renders as a pressed segmented button, not a text input.
    expect(screen.getByRole("button", { name: "love", pressed: true })).toBeInTheDocument();
  });

  it("returns null and logs for an unsupported kind, naming the kind and pack", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = renderNode({ node: { kind: "fields" }, value: {}, onValue: vi.fn(), packKey: "p" });
    expect(out).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("fields"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("p"));
    errorSpy.mockRestore();
  });

  it("does not throw when an unsupported node has no path at all", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      renderNode({ node: { kind: "fields" }, value: undefined, onValue: vi.fn(), packKey: "p" })
    ).not.toThrow();
    errorSpy.mockRestore();
  });

  it("logs and renders empty when a list node's value is not an array", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderResult({ node: listNode, value: "not a list", packKey: "corrupted" });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("corrupted"));
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("does not log when the value is simply absent -- that is a fresh section", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderResult({ node: listNode, value: undefined });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  function renderResult(args) {
    return render(<>{renderNode({ onValue: () => {}, ...args })}</>);
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run --project unit src/renderers/renderNode.test.jsx`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Create `frontend/src/renderers/renderNode.jsx`. Move the dispatch out of `SectionRenderer` **unchanged in behaviour** — same guards, same order, same log wording:

```jsx
// Picks a renderer for one ui node. Extracted from SectionRenderer's inline
// CardContent.map so a node that is NOT a direct child of the section root
// can be dispatched too: wave 4 calls this for `node.children` against a list
// item, where the path resolves against the item rather than the section.
//
// The seam is a plain function, not a component, so a caller can decide where
// its output goes -- inside a Card, inside a row, or nowhere.
import ListRenderer from "./ListRenderer";

export function renderNode({ node, value, onValue, entities, packKey, onShowConfirmation }) {
  // The kind check runs first, before anything reads node.path -- a node of
  // an unsupported kind is not guaranteed to carry a well-formed path (or any
  // path at all), and the guard exists precisely to make an unsupported node
  // harmless rather than a crash.
  if (node.kind !== "list") {
    console.error(`renderNode: unsupported node kind "${node.kind}" in pack "${packKey}"`);
    return null;
  }
  if (value !== undefined && !Array.isArray(value)) {
    console.error(
      `renderNode: expected an array at path ${JSON.stringify(node.path)} ` +
        `in pack "${packKey}", got ${typeof value} -- rendering as empty`
    );
  }
  return (
    <ListRenderer
      node={node}
      entity={entities?.[node.entity]}
      items={Array.isArray(value) ? value : []}
      onItems={onValue}
      onShowConfirmation={onShowConfirmation}
    />
  );
}
```

Then rewrite `SectionRenderer` to call it. `SectionRenderer` keeps the Card, the `node.title` heading, the React key, and the path binding — those are section-root concerns, not dispatch concerns:

```jsx
{sections.map((node, i) => {
  // key by index as well as path: two sibling nodes may legitimately share
  // a path, and a bare path join collides for them.
  const key = `${i}:${Array.isArray(node.path) ? node.path.join(".") : ""}`;
  return (
    <div key={key} className="space-y-3">
      {node.title && (
        <h3 className="text-sm font-semibold text-foreground">{node.title}</h3>
      )}
      {renderNode({
        node,
        value: Array.isArray(node.path) ? getAt(data, node.path) : undefined,
        onValue: (next) => onChange(setAt(data || {}, node.path, next)),
        entities: pack.entities,
        packKey: pack.key,
        onShowConfirmation,
      })}
    </div>
  );
})}
```

Note the key change also closes the `key={node.path.join(".")}` collision the spec flagged. `SectionRenderer` no longer imports `ListRenderer`.

**Existing `SectionRenderer.test.jsx` asserts the old log wording** (`"SectionRenderer: unsupported node kind"`). Those assertions use `expect.stringContaining("fields")` and `stringContaining("mixed")`, so the prefix change does not break them — verify that rather than assuming. If any assertion does break, the log wording it pins is the thing to preserve, not the test.

- [ ] **Step 4: Run to verify everything passes**

Run: `cd frontend && npm test`
Expected: PASS, 122 existing + 7 new. **No existing test may need editing.**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderers
git commit -m "refactor: extract node dispatch into a callable renderNode seam"
```

---

### Task 2: Extract `ListRenderer`'s derived pipeline into pure functions

**Files:**
- Create: `frontend/src/renderers/listPipeline.js`
- Modify: `frontend/src/renderers/ListRenderer.jsx`
- Test: `frontend/src/renderers/listPipeline.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `buildOrder(items, sort)` → array of stored indexes in display order.
  - `filterVisible(order, items, query, fields)` → subset of `order`, stored indexes preserved.

**Why:** `ListRenderer.jsx` is 455 lines against the spec's ~200-line budget, and its four-stage derived pipeline is the densest part. Extracted, the sort comparator and the search matcher become directly testable without rendering, and wave 4's `children` work lands in a smaller file.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/renderers/listPipeline.test.js`. Cover, at minimum: no sort returns identity order; `desc` reverses; two numbers compare numerically (`2` before `10`, not lexicographically); missing and empty-string keys sort last in **both** directions; ties keep stored order; the filter matches title, badges, detail fields and array entries case-insensitively; the filter returns stored indexes not positions; an empty query returns the order unchanged.

Each of those is a property the wave 3 tests currently prove only through the DOM — pin them directly here.

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run --project unit src/renderers/listPipeline.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Move the logic verbatim out of `ListRenderer` — same comparator, same missing/blank handling, same search field union. Do not "improve" it while moving; behaviour must be identical. Keep the explanatory comments with the code they explain.

Then have `ListRenderer` call them:

```jsx
const order = buildOrder(items, node.sort);
const searchFields = [...new Set([titleField, ...badges, ...detailFields, ...arrayFields])];
const q = query.trim().toLowerCase();
const visible = filterVisible(order, items, q, searchFields);
```

- [ ] **Step 4: Run both to verify**

Run: `cd frontend && npm test`
Expected: PASS. Every existing `ListRenderer` test still green **unmodified** — they are the proof the move was behaviour-preserving.

Report `ListRenderer.jsx`'s line count before and after.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderers
git commit -m "refactor: extract the list order and search pipeline into pure functions"
```

---

### Task 3: Make the backend `ui` guard point the right way

**Files:**
- Modify: `backend/tests/test_ui_schema.py`
- Test: same file

**Interfaces:**
- Consumes: `backend/server.py`'s `FIELD_ALIASES`.
- Produces: nothing importable.

**Why:** `test_ui_fields_are_covered_by_the_entity` asserts a `ui` block's fields are a subset of `entity.required + entity.optional`. That is wrong on both sides, and wave 3's whole-branch review demonstrated it:

- It **accepts** MCP-only input aliases. `contact` is in `connection.optional`, so a `ui` block declaring `contact` — the exact trap the spec warns about, which would write a key nothing reads — passes green.
- It **rejects** legitimate storage keys absent from the entity vocabulary. `timestamp` is written by `server.py` on every learning-log add but is not in `entities.learning_entry`, which is why `display_fields` had to be left out of the check.

Wave 4 migrates `projects`, `knowledge` and `profile` — the sections where manifest names and storage keys deliberately diverge — so this must be fixed before, not worked around by dropping packs from the list.

**Design:** `FIELD_ALIASES[entity]` is a list whose **first element is the canonical stored key** and whose remaining elements are input aliases (`"connection": ["name", "person", "contact", "connection_name"]`, consumed by `get_field(data, *names)` which returns the first present). That gives a real, derivable authority for one class of phantom: a `ui` field that appears in an entity's alias list at any index after the first is an MCP input alias, not a storage key.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_ui_schema.py` a test that a `ui` block naming a non-canonical alias is rejected. Build it against a synthetic manifest so it does not depend on a shipped pack staying wrong, and assert on the real `FIELD_ALIASES` for `connection` so it cannot drift from the source:

```python
def test_ui_may_not_name_an_mcp_input_alias():
    """FIELD_ALIASES[entity][0] is the stored key; the rest are input aliases
    that execute_modify resolves and never persists. A ui block naming one
    would render a control writing a key nothing reads."""
    from server import FIELD_ALIASES

    aliases = FIELD_ALIASES["connection"]
    assert aliases[0] == "name", "canonical key moved; this guard needs updating"
    assert "contact" in aliases[1:], "contact is no longer an alias; pick another"

    offenders = ui_fields_that_are_aliases(
        entity="connection",
        named={"name", "relationship", "contact"},
    )
    assert offenders == {"contact"}
```

Also add the positive case: the shipped `circle` manifest names no alias.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && ./venv/bin/python -m pytest -q tests/test_ui_schema.py` with an explicit Bash timeout of at least 300000 ms.
Expected: FAIL — the helper does not exist.

- [ ] **Step 3: Implement**

Add the helper and wire a parametrized check over every pack that ships a `ui` block — not a hand-maintained list, since a hand-maintained list is exactly how a pack gets quietly omitted to keep a suite green. Discover the packs from disk.

- [ ] **Step 4: Retarget the existing subset check honestly**

`test_ui_fields_are_covered_by_the_entity` keeps its value as a **spelling** check for packs whose manifest names happen to equal their storage keys, but its name overclaims and its `GENERIC_PACKS` list will be wrong for wave 4. Rename it to say what it checks, and replace the hand-maintained list with a per-manifest opt-out so a divergent pack must *declare* its divergence rather than silently vanish from the list. Document, in the module docstring, both directions this check gets wrong and why the alias check above exists alongside it.

Also make the `display_fields` omission explicit rather than incidental: state in a comment that `display_fields` is deliberately outside the subset check because it names real storage keys the entity vocabulary does not carry, and that it is consequently unguarded.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && ./venv/bin/python -m pytest -q` with an explicit Bash timeout of at least 400000 ms.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/test_ui_schema.py
git commit -m "test: guard ui blocks against MCP input aliases, not entity membership"
```

---

### Task 4: Give the row delete button an accessible name

**Files:**
- Modify: `frontend/src/renderers/ListRenderer.jsx`
- Test: `frontend/src/renderers/ListRenderer.test.jsx`

**Why:** the delete button is icon-only with no accessible name, so screen readers announce nothing useful, and tests select it with `getAllByRole("button").filter(b => b.textContent === "")`. The info button added in wave 3 is also icon-only and renders **before** the rows, so the first wave 4 test that needs a delete button on a node declaring `info` will click Info instead — failing confusingly, or passing for the wrong reason.

- [ ] **Step 1: Write the failing test**

Assert the delete button for a row has an accessible name naming that row, and that on a node declaring `info` the delete button and the info button are distinguishable by name.

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Implement**

Add `aria-label={\`Remove ${item[titleField] || "entry"}\`}` to the row delete `Button`. The empty-title fallback must match the confirmation text's existing `"Untitled entry"` behaviour — read it and be consistent rather than inventing a second wording.

- [ ] **Step 4: Update the three existing `textContent === ""` selectors**

They are in `ListRenderer.test.jsx`. Adding an `aria-label` does **not** change `textContent`, so they still pass — but they are now the fragile pattern this task exists to remove. Switch them to select by the accessible name. Confirm they still pass afterwards.

- [ ] **Step 5: Run the frontend suite and commit**

```bash
git add frontend/src/renderers
git commit -m "a11y: give the row delete button an accessible name"
```

---

## Verification

```bash
cd frontend && npm test && npm run build
cd backend && ./venv/bin/python -m pytest -q
```

Then confirm nothing regressed visually with `./scripts/local-preview.sh`.

## Notes for the reviewer

- This plan should produce **zero** user-visible change. Any diff hunk that alters rendered output is a defect unless a task names it.
- Task 1 deliberately does not implement `children`, so the `ListRenderer` → `renderNode` import cycle is not yet exercised. That is wave 4's first job, and the seam exists so it is a one-liner rather than a refactor.
- The `display_fields` gap is documented, not closed. Closing it needs an authority on storage keys, which is the deferred backend reconciliation project.
