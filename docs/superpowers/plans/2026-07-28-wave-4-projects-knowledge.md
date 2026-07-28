# Wave 4: `projects` and `knowledge` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `projects` and `knowledge` onto the renderer kit, deleting 2,159 lines, and add the three renderer capabilities they need: nested child lists, filter facets, and count badges.

**Architecture:** Task 1 closes the seam gap the wave 4 prerequisites left. Task 2 adds `children` — the wave's headline capability, and the reason the `renderNode` seam exists. Tasks 3 and 4 add `facets` and `count_badges`. Tasks 5–6 declare the manifests. Task 7 deletes the editors.

**Tech Stack:** React 18, Vite 7, Vitest 4 + Testing Library + Storybook 10, Tailwind 3, Python 3.11/3.13 with `jsonschema` manifest validation.

## Global Constraints

- **`ui` declares storage keys, never manifest `entities` field names.** The verified table is below. Do not re-derive from `entities`.
- **No stored JSON changes.** Every key not modelled by a `ui` block must survive an edit byte-identical.
- **Every `ui` schema addition is optional**, so `goals`, `media`, `aesthetics`, `learning_log` and `circle` keep rendering byte-identically.
- New UI from existing primitives only; semantic Tailwind colour tokens; `FOCUS_RING` on any interactive element that is not already a shadcn primitive.
- Backend green: `cd backend && ./venv/bin/python -m pytest -q` (485 tests, ~3.5 min).
- Frontend green: `cd frontend && npm test` (149) and `npm run build`.
- **The Bash tool defaults to a 120s timeout and AUTO-BACKGROUNDS past it.** Pass an explicit timeout ≥400000 ms for the backend suite and run it in the FOREGROUND. Never wire a Monitor to poll a test run.
- Line references are from `bfb516d`. Tasks 1–4 all edit `ListRenderer.jsx`; locate code by symbol, never by line number.

**Known hazards that have cost time before — read these before writing a test:**

- A row's `detail_fields` only render once the row is **expanded**. A test asserting on a detail control without clicking the row first cannot fail for the reason it claims. This has happened four times.
- `project` add **requires `description`** (`server.py:1862`) — `execute_modify("add","project",{name,status})` is rejected and stores nothing. A test that omits it fails for the wrong reason.
- The add-dialog title input has **no label association**; `getByLabelText` throws. Use `within(screen.getByRole("dialog")).getAllByRole("textbox")[0]`.
- Row delete buttons now carry `aria-label="Remove <title>"`. Select by accessible name, not `textContent === ""`.
- **Before trusting any test you write, ask what you would have to break to make it fail.** If the answer is "nothing", rewrite it. This project has shipped nine such tests.

## Established storage keys

Read from the bespoke editors and `execute_modify`. **This is the authority.**

`projects.json`:

| Path | Keys | Notes |
| --- | --- | --- |
| `projects[]` | `id`, `name`, `description`, `status`, `notes`, `added_date`, `tags[]`, `references[]`, `highlights[]` | `server.py:1866-1871` |
| `projects[].references[]` | `{name, url, notes}` | `server.py:2304`. **No ids** |
| `projects[].tags[]`, `.highlights[]` | bare strings | `server.py:2279`, `:2347` |
| `top_of_mind[]` | `id`, **`idea`**, `note` | `server.py:1891` |

`knowledge.json`:

| Path | Keys | Notes |
| --- | --- | --- |
| `domains[]` | `id`, `name`, `level`, `notes`, `references[]`, and `added_date`/`last_updated` on entries written by the `knowledge` entity | `server.py:1756`, `:2377`, `:2392` |
| `mental_tabs[]` | `id`, **`title`**, `context`, `tags[]`, `references[]`, `created_at` | `server.py:1786-1795` |
| `*.references[]` | `{name, url, notes}` | `server.py:2417`, `:2457`. **No ids** |

**Traps confirmed by reading — do not fall into them:**

- **`top_of_mind` stores `idea`, not `item`.** The manifest's identifier is `item`. A `ui` block with `title_field: "item"` renders every existing entry blank and writes a parallel `item` key that `execute_modify`'s dedupe (`server.py:1883`) cannot see — silent duplicate explosion.
- **`mental_tab` stores `title`, not `name` or `topic`.** `FIELD_ALIASES["mental_tab"]` starts with `name`; only `title` is written (`server.py:1793`).
- **`mental_tabs[].topic` is a legacy key that is read but never written** (`server.py:1790`, `:1802`, `:1816`, `:2447`). An old entry carrying `topic` renders as blank under `title_field: "title"`. Out of scope to migrate; see Task 6 step 2.
- All three `*_reference` entities persist `name`, never the `ref_name` their manifests declare (`server.py:2304`, `:2417`, `:2457`).

---

### Task 1: Thread `entities` and `packKey` into `ListRenderer`

The wave 4 prerequisites left `renderNode` callable but not callable *from a row*: `ListRenderer` receives a single resolved `entity` object and no `packKey`, while `renderNode` needs the whole `entities` map and the pack key. Calling it today would pass `entities: undefined`, silently degrading every child enum to a free-text box.

**Files:** `frontend/src/renderers/ListRenderer.jsx`, `renderNode.jsx`, `SectionRenderer.jsx`, and their tests.

**Interfaces:**
- Produces: `ListRenderer` gains `entities` and `packKey` props. `entity` stays for backwards compatibility with existing call sites and tests.

- [ ] **Step 1: Write the failing test**

In `renderNode.test.jsx`, assert that a list node rendered through `renderNode` passes both onward — the observable proxy is that a **child** node's enum resolves. Since children do not exist until Task 2, assert it directly instead: render `renderNode` with an `entities` map and a `packKey`, then assert `ListRenderer` received them by checking that an enum field renders as a pressed segmented button (proving `entities` arrived) and that a deliberately malformed sibling logs the real pack key rather than `undefined` (proving `packKey` arrived).

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run --project unit src/renderers/renderNode.test.jsx`
Expected: FAIL — the pack key logs as `undefined`.

- [ ] **Step 3: Implement**

`renderNode` already receives both. Pass them down:

```jsx
<ListRenderer
  node={node}
  entity={entities?.[node.entity]}
  entities={entities}
  packKey={packKey}
  items={Array.isArray(value) ? value : []}
  onItems={onValue}
  onShowConfirmation={onShowConfirmation}
/>
```

And widen `ListRenderer`'s signature:

```jsx
export default function ListRenderer({
  node, entity, entities, packKey, items, onItems, onShowConfirmation,
})
```

Nothing consumes them yet — Task 2 does. Import `setAt` from `./paths` now as well; Task 2 needs it and the import is inert until then.

- [ ] **Step 4: Verify and commit**

Run: `cd frontend && npm test`. All 149 existing tests must pass unmodified.

```bash
git add frontend/src/renderers
git commit -m "refactor: thread entities and packKey into ListRenderer for child dispatch"
```

---

### Task 2: `children` — nested child lists

The wave's headline capability. Three reference lists across the two sections share one item shape `{name, url, notes}`, so one child node kind covers all of them.

**Files:** `frontend/src/renderers/ListRenderer.jsx`, `backend/section_packs/meta_schema.json`, tests.

**Interfaces:**
- Consumes: Task 1's `entities`/`packKey`, `renderNode`, `setAt`.
- Produces: `node.children[]` renders inside an expanded row, each child's `path` resolving **against the item**, not the section root.

**The critical property:** a child node's path is item-relative. `updateItem(idx, changes)` takes a flat field map and cannot express a nested path, so a new writer is needed:

```jsx
// Writes `value` at an item-relative path. updateItem takes a flat field map
// and cannot reach inside an item, which is what a child node needs. Uses the
// same immutable setAt the section root uses, so the item is replaced rather
// than mutated and every sibling key survives.
const updateItemAt = (idx, path, value) => {
  const next = [...items];
  next[idx] = setAt(next[idx] ?? {}, path, value);
  onItems(next);
};
```

- [ ] **Step 1: Write the failing tests**

Cover, and verify each fails first:

1. A child list renders inside an **expanded** row and not inside a collapsed one.
2. Editing a child item writes to the correct **stored** parent index and the correct child index — assert the whole array, not just the edited value.
3. Adding a child item to row 1 does not touch row 0.
4. Removing a child item leaves every other key on the parent item untouched.
5. A parent with a `sort` or an active search filter still edits the right child — the parent index must come from `visible`/`order`, never a display position.
6. A child node of an unsupported kind logs via `renderNode` and does not break the parent row.
7. An item with no value at the child path renders an empty child list without logging — a fresh parent is not corruption.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

Inside the expanded-row body, after the `editFields` grid:

```jsx
{(node.children || []).map((child, i) => (
  <div key={`${i}:${child.path.join(".")}`} className="mt-3 space-y-2">
    {child.title && (
      <Label className="text-xs capitalize">{child.title}</Label>
    )}
    {renderNode({
      node: child,
      value: getAt(item, child.path),
      onValue: (next) => updateItemAt(idx, child.path, next),
      entities,
      packKey,
      onShowConfirmation,
    })}
  </div>
))}
```

`renderNode` imports `ListRenderer` and `ListRenderer` now imports `renderNode`. That cycle is fine in ESM because both references live inside render-time function bodies, never at module init — but it has never been exercised. **If the build or the tests show an undefined-component error, say so and report it rather than working around it.**

- [ ] **Step 4: Add `children` to the schema**

`$defs.uiSection.properties.children` already exists and `$ref`s `uiSection`, so the `allOf` requiring `entity` on list nodes applies to children too. Confirm that is true and that both new manifests satisfy it.

- [ ] **Step 5: Verify and commit**

Run both suites. Commit.

---

### Task 3: `facets`

**Files:** `ListRenderer.jsx`, `meta_schema.json`, tests.

**Interfaces:** `node.facets: string[]` — each names an enum field; the renderer draws a filter above the list and narrows `visible`.

- [ ] **Step 1: Write the failing tests**

Cover: a facet renders one option per enum value plus an "All"; selecting one narrows the rows; the facet composes with the search box (both active narrows further); clearing returns every row; a node declaring no `facets` renders nothing extra; **selecting a facet never calls `onItems`**; and editing a row while a facet is active writes to the correct stored index.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

Options come from the same precedence `ScalarField` uses — `node.enum ?? entity?.valid_values` — so a facet on a node with an inline enum works. Apply the facet **after** `order` and alongside the query, producing stored indexes exactly as `visible` already does. Render with `EnumControl` so the control matches every other enum in the app.

- [ ] **Step 4: Schema, verify, commit**

```json
"facets": {
  "type": "array",
  "items": { "type": "string" },
  "description": "Storage keys with enum values, rendered as a filter above the list. Display only; never writes."
}
```

---

### Task 4: `count_badges`

**Files:** `ListRenderer.jsx`, `meta_schema.json`, tests.

**Interfaces:** `node.count_badges: string[]` — array-valued storage keys rendered as `N <field>` chips on the collapsed row.

- [ ] **Step 1: Write the failing tests**

Cover: a field with 3 entries renders `3 references`; a field with 1 entry renders `1 reference` (singular); an empty or absent field renders **no** badge rather than `0`; a non-array value renders no badge and does not throw; the badge is read-only — expanding the row exposes no control bound to it beyond whatever `detail_fields` already declares; and a node declaring none renders nothing extra.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

Render in the collapsed row's badge strip, after `display_fields` and before `badges`. Singularise by trimming a trailing `s` only when the count is 1, and replace `_` with a space, matching the label treatment used elsewhere.

- [ ] **Step 4: Schema, verify, commit**

---

### Task 5: `projects` manifest `ui` block

**Files:** `backend/section_packs/projects/manifest.json`, `frontend/src/__fixtures__/data/projects.json`, `SectionRenderer.test.jsx`, regenerate `packs.json`.

- [ ] **Step 1: Author the `ui` block**

Two sections. `projects[]` with `title_field: "name"`, `badges: ["status"]`, `detail_fields: ["name", "description", "notes", "tags", "highlights"]`, `array_fields: ["tags", "highlights"]`, `long_text: ["description", "notes"]`, `facets: ["status"]`, `count_badges: ["references", "tags", "highlights"]`, `searchable: true`, and one child node over `["references"]` with `title_field: "name"` and `detail_fields: ["name", "url", "notes"]`.

Then `top_of_mind[]` with **`title_field: "idea"`** — not `item` — and `detail_fields: ["idea", "note"]`.

`id` and `added_date` are absent from both: not user-editable, must round-trip. Consider `display_fields: ["added_date"]` with `display_formats: {added_date: "date"}` so the row shows when a project was added, matching what the bespoke editor implied through its badges.

- [ ] **Step 2: Create the fixture**

Every stored key present, including `id` and `added_date`, and at least one project carrying all three array fields plus two `references`, so the child-list guards have something to bite on. Include a `top_of_mind` entry.

- [ ] **Step 3: Regenerate, wire guards, add wave tests**

`npm run fixtures`, then `describeGuards` for both lists, plus a test that a `references` child round-trips and one asserting `top_of_mind` renders its `idea` text (which would fail immediately if `title_field` were `item`).

- [ ] **Step 4: Add `projects` to the backend guard list and run both suites**

---

### Task 6: `knowledge` manifest `ui` block

**Files:** as Task 5, for `knowledge`.

- [ ] **Step 1: Author the `ui` block**

`domains[]` — `title_field: "name"`, `badges: ["level"]`, `facets: ["level"]`, `detail_fields: ["name", "level", "notes"]`, `long_text: ["notes"]`, `count_badges: ["references"]`, one child over `["references"]`.

`mental_tabs[]` — **`title_field: "title"`**, `detail_fields: ["title", "context", "tags"]`, `array_fields: ["tags"]`, `long_text: ["context"]`, `count_badges: ["references", "tags"]`, `field_defaults: {"created_at": "@now"}`, one child over `["references"]`.

`added_date`, `last_updated`, `created_at` and `id` stay out of `detail_fields`.

- [ ] **Step 2: Record the `topic` legacy key**

An old `mental_tabs` entry may carry `topic` with no `title`, and would render blank. **Do not migrate it** — that is a backend data change and out of scope. Add a comment in the manifest noting it, and a fixture entry carrying `topic` plus a test asserting the entry's other keys survive an edit untouched. The blank title is accepted; silent key loss is not.

- [ ] **Step 3–4: Fixture, regenerate, guards, backend guard list, both suites**

---

### Task 7: Delete both editors

**Files:** delete `ProjectsEditor.jsx` (1,021) and `KnowledgeEditor.jsx` (1,138); modify `App.jsx`.

- [ ] **Step 1: Remove the wiring**

Drop `"projects"` and `"knowledge"` from `BESPOKE_EDITORS`; delete both imports, both state hooks, both load lines, both change handlers, both `saveAll` keys, both `TabsTrigger`s and both `TabsContent`s. Add `projects` and `knowledge` to `PACK_ICONS` so the tabs keep their icons, and confirm the icons those triggers used are still imported.

- [ ] **Step 2: Prove nothing dangles**

```bash
cd frontend && grep -rn "ProjectsEditor\|KnowledgeEditor\|handleProjectsChange\|handleKnowledgeChange\|setProjects\|setKnowledge" src/ || echo clean
```

- [ ] **Step 3: Suites, build, and a hand check**

`npm test`, `npm run build`, backend suite. Then `./scripts/local-preview.sh` and confirm both tabs render, a nested reference list opens inside an expanded project, and the facets filter.

- [ ] **Step 4: Commit**

---

## Verification

```bash
cd frontend && npm test && npm run build
cd backend && ./venv/bin/python -m pytest -q
git diff --stat main...HEAD
```

Expected: 2,159 lines deleted from `frontend/src/editors/`, three files left there.

## Notes for the reviewer

- Deliberately dropped per the convergence decision: the two-level reference sub-accordion collapses into the normal one-level row expand that recursion gives for free; `originalIndex` identity by object reference; the `tags || tech_stack` legacy fallback; "Untitled project"/"Untitled reference" placeholders; opposite insert order between the two knowledge lists; and `KnowledgeEditor`'s dead `addDomain` function, which has no call site.
- Deliberately **kept**, against wave 3's precedent, at the user's decision: filter facets and count badges. These sections carry far more nested content per row than `goals` or `circle`, so a bare title-plus-status row loses more here.
- The `knowledge` `category` router (`server.py:2366`) is recorded as a known smell for the deferred backend reconciliation, not fixed here. `setAt` preserves sibling keys, so an undeclared top-level list survives editing — it is invisible, not lost.
- Per the entity field schema spec, each entity read during this wave should have its findings written down as `fields`. The storage-key tables above are that reading; carrying them into the manifests is optional this wave and free to defer.
