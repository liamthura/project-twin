# Wave 5 — `lifestyle` and `preferences` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire `LifestyleEditor.jsx` (1,165 lines) and `PreferencesEditor.jsx` (478 lines) onto the manifest-driven renderer kit, building the two node kinds — `strings` and `fields` — that the kit has declared since wave 2 but never implemented.

**Architecture:** `renderNode` currently dispatches `kind: "list"` and logs anything else. This wave adds two sibling renderers beside `ListRenderer`, each thin because `ScalarField` already owns every control they need: `StringsRenderer` binds a bare `string[]` at a path to `ArrayInput`; `FieldsRenderer` binds named keys of the object at a path to `ScalarField`. The `meta` object both need is extracted from `ListRenderer` first, so the three renderers resolve enums, long text, dates and array fields through one shared function rather than three drifting copies.

**Tech Stack:** React 18, Tailwind 3, Vitest 4 (`unit` jsdom project), Testing Library, Storybook 10, Vite 7; backend Python 3.11/3.13, pytest, `jsonschema` Draft 2020-12.

## Global Constraints

- **`entities` is an MCP input vocabulary, not a storage schema.** Every `ui` field name must be a key some `execute_modify` branch actually writes. The committed reading for this wave is [`2026-07-29-wave-5-storage-keys-reference.md`](2026-07-29-wave-5-storage-keys-reference.md) — it is the authority for every field name below, and no task may introduce a field name absent from it.
- **Stored indexes, never display positions.** `buildOrder` → `filterVisible` → `applyFacets` take and return *stored* indexes. A display position reaching `updateItemAt`/`removeItem` is silent data corruption.
- **No behaviour may be lost.** Each migrated section must reach parity with the editor it replaces, field for field and control for control. Where parity is deliberately broken, the plan says so explicitly and the node carries a `$comment`.
- **Manifests are validated** by `backend/tests/test_ui_schema.py` against `backend/section_packs/meta_schema.json`. A new manifest key requires a schema change in the same commit.
- **`TZ` is pinned to `America/New_York`** in `vitest.config.js`. Do not change it; date bugs are invisible under UTC.
- **Backend test suite takes ~3.5 minutes.** Run it with an explicit `timeout` of at least `400000` ms or the harness backgrounds it.
- **Tests must be able to fail.** No `assert isinstance(x, bool)`, no test that passes for a reason other than the one it names. State in each report which assertion would break if the change were reverted.
- **UI sourcing:** prefer adapting a shadcn-registry component over hand-rolling. Any new primitive must match the existing design language (tokens, spacing, `tap-target`, dark-mode parity).

## PR grouping

Three branches, merged in order. Each is independently reviewable and leaves `main` working.

| PR | Tasks | Deliverable |
|---|---|---|
| **A** | 1–5 | Backend `paused` fix; both node kinds; guards extended. No manifest migrated yet. |
| **B** | 6 | `lifestyle` migrated; `LifestyleEditor.jsx` deleted. |
| **C** | 7 | `preferences` migrated; `PreferencesEditor.jsx` deleted. |

---

### Task 1: `hobby.status` stops collapsing `"paused"`

The manifest declares `["active", "inactive", "paused"]` and the current editor
offers all three, but the write branch folds `"paused"` into `"inactive"`.
`"paused"` is already a member of `INACTIVE_STATUSES` (`server.py:1074`), so the
*read* path already treats it as a distinct status — the write path is the
defect. See the reference doc §1.1.1.

**Files:**
- Modify: `backend/server.py:1708-1712`
- Test: `backend/tests/test_execute_modify.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `"paused"` becomes a storable `hobby.status` value. Task 6 binds the full three-value enum on the strength of this.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_execute_modify.py`:

```python
def test_hobby_add_stores_paused_status(tmp_persona):
    execute_modify("add", "hobby", {"name": "Bouldering", "status": "paused"})
    hobbies = load_json("lifestyle.json")["hobbies"]
    assert hobbies[0]["status"] == "paused"


def test_hobby_update_stores_paused_status(tmp_persona):
    execute_modify("add", "hobby", {"name": "Bouldering"})
    execute_modify("update", "hobby", {"name": "Bouldering", "status": "paused"})
    hobbies = load_json("lifestyle.json")["hobbies"]
    assert hobbies[0]["status"] == "paused"


def test_hobby_still_normalises_inactive_spellings(tmp_persona):
    # The other members of the old collapse list must keep collapsing --
    # this fix narrows the list, it does not remove it.
    for spelling in ["inactive", "stopped", "not_active", "false"]:
        execute_modify("add", "hobby", {"name": f"H-{spelling}", "status": spelling})
    hobbies = load_json("lifestyle.json")["hobbies"]
    assert {h["status"] for h in hobbies} == {"inactive"}


def test_hobby_unknown_status_still_falls_back_to_active(tmp_persona):
    execute_modify("add", "hobby", {"name": "Chess", "status": "banana"})
    assert load_json("lifestyle.json")["hobbies"][0]["status"] == "active"
```

Use whatever fixture the existing tests in that file use for an isolated
persona directory; do not invent a new one. If no such fixture exists, follow
the isolation pattern the file's other `execute_modify` tests already use.

- [ ] **Step 2: Run them and watch the first two fail**

```bash
cd backend && timeout 400 python -m pytest tests/test_execute_modify.py -k hobby -v
```

Expected: the two `paused` tests FAIL with `assert 'inactive' == 'paused'`; the
other two PASS already. If the fallback test fails, stop and report — the
branch does not behave as this plan describes.

- [ ] **Step 3: Narrow the collapse list**

`backend/server.py:1708-1712`, replacing the existing four lines:

```python
        status = get_field(data, "status", "state", "is_active", default="active")
        # "paused" is a status in its own right: the manifest declares it, the
        # editor offers it, and _filter_inactive already treats it as distinct
        # (INACTIVE_STATUSES, :1074). It used to be folded into "inactive"
        # here, so a user's "paused" survived only until the next AI edit to
        # that hobby silently rewrote it.
        if status in ["paused", "on_hold"]:
            status = "paused"
        elif status in ["inactive", "stopped", "not_active", "false", False]:
            status = "inactive"
        else:
            status = "active"
```

- [ ] **Step 4: Run the hobby tests, then the whole suite**

```bash
cd backend && timeout 400 python -m pytest tests/test_execute_modify.py -k hobby -v
cd backend && timeout 400 python -m pytest -q
```

Expected: all four hobby tests PASS; the full suite has no new failures. Report
the before/after counts.

- [ ] **Step 5: Commit**

```bash
git add backend/server.py backend/tests/test_execute_modify.py
git commit -m "fix: hobby status 'paused' is stored, not collapsed to 'inactive'"
```

---

### Task 2: Extract `buildFieldMeta` from `ListRenderer`

`ListRenderer` builds a `meta` object (`ListRenderer.jsx:117-131`) that resolves
node-level overrides against the entity's vocabulary before handing it to
`ScalarField`. Tasks 3 and 4 need the identical object. Extract it now, so the
three renderers share one resolution rule instead of three copies that drift.

This is a **pure refactor**: no behaviour change, no test changes beyond the new
unit tests for the extracted function. `ListRenderer` is 604 lines against the
spec's ~200 budget; this is the first motivated cut.

**Files:**
- Create: `frontend/src/renderers/fieldMeta.js`
- Create: `frontend/src/renderers/fieldMeta.test.js`
- Modify: `frontend/src/renderers/ListRenderer.jsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildFieldMeta(node, entity) → meta` — the object `ScalarField` reads as its `meta` prop. Tasks 3 and 4 both call it.

- [ ] **Step 1: Read the current construction**

Read `frontend/src/renderers/ListRenderer.jsx:90-135`. The extracted function
must produce a **byte-identical** object for the same inputs. Do not "improve"
the precedence rules while moving them — node-level keys win over entity-level
ones, and that ordering is load-bearing for every already-migrated pack.

- [ ] **Step 2: Write the failing test**

`frontend/src/renderers/fieldMeta.test.js`:

```js
import { describe, expect, it } from "vitest";
import { buildFieldMeta } from "./fieldMeta";
import { LONG_TEXT_FIELDS } from "./ScalarField";

describe("buildFieldMeta", () => {
  it("takes valid_values from the entity when the node declares no enum", () => {
    const meta = buildFieldMeta({}, { valid_values: { status: ["a", "b"] } });
    expect(meta.valid_values).toEqual({ status: ["a", "b"] });
  });

  it("lets a node-level enum win over the entity's", () => {
    const meta = buildFieldMeta(
      { enum: { status: ["x"] } },
      { valid_values: { status: ["a", "b"] } }
    );
    expect(meta.valid_values).toEqual({ status: ["x"] });
  });

  it("falls back to the default long-text set when the node declares none", () => {
    expect(buildFieldMeta({}, {}).long_text).toBe(LONG_TEXT_FIELDS);
  });

  it("turns a node-declared long_text array into a Set", () => {
    const meta = buildFieldMeta({ long_text: ["summary"] }, {});
    expect(meta.long_text.has("summary")).toBe(true);
    expect(meta.long_text.has("notes")).toBe(false);
  });

  it("defaults array_fields and date_fields to empty arrays", () => {
    const meta = buildFieldMeta({}, {});
    expect(meta.array_fields).toEqual([]);
    expect(meta.date_fields).toEqual([]);
  });

  it("survives a null entity", () => {
    expect(() => buildFieldMeta({}, null)).not.toThrow();
  });
});
```

Adjust the assertions to match what you actually read in Step 1 — these are
written from the plan author's reading and the implementation is the authority.
If any assertion contradicts the current construction, **keep the current
behaviour and fix the test**, then say so in your report.

- [ ] **Step 3: Run it to verify it fails**

```bash
cd frontend && npx vitest run --project unit src/renderers/fieldMeta.test.js
```

Expected: FAIL, cannot resolve `./fieldMeta`.

- [ ] **Step 4: Create the module**

`frontend/src/renderers/fieldMeta.js` — move the construction verbatim:

```js
// The `meta` object ScalarField reads, resolved once for all three node
// renderers. Node-level keys (enum, long_text, date_fields...) win over the
// entity's vocabulary: a section whose manifest field names are not its
// storage keys declares the difference on the node, and that override is the
// whole reason ScalarField takes a pre-resolved meta instead of an entity.
import { LONG_TEXT_FIELDS } from "./ScalarField";

export function buildFieldMeta(node, entity) {
  // ...moved verbatim from ListRenderer.jsx:117-131
}
```

- [ ] **Step 5: Point `ListRenderer` at it**

Replace the inline construction with a `buildFieldMeta(node, entity)` call and
import it. Delete the now-dead local variables (`longText`, `arrayFields`, …)
only if nothing else in the file reads them — several are read again further
down, so check every use before deleting.

- [ ] **Step 6: Run the full frontend suite**

```bash
cd frontend && npx vitest run --project unit
```

Expected: every pre-existing test still passes, unchanged. A refactor that
needed a test edit was not a refactor — if you had to change an existing
assertion, stop and report why.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/renderers/fieldMeta.js frontend/src/renderers/fieldMeta.test.js frontend/src/renderers/ListRenderer.jsx
git commit -m "refactor: extract buildFieldMeta so all node renderers share one resolution"
```

---

### Task 3: `kind: "strings"` — `StringsRenderer`

Nine of this wave's nodes bind a **bare `string[]`** at a path:
`personality_traits`, `values`, `wellness.energy_peaks`,
`wellness.stress_triggers`, `code_style.{preferred_languages,frameworks,tools}`,
`learning_style.{preferred,avoid}`. No objects, no per-item fields, no entity.

`ArrayInput` already exists and is what the current editors use for exactly
these keys, so this renderer is a binding, not a new control.

**Files:**
- Create: `frontend/src/renderers/StringsRenderer.jsx`
- Create: `frontend/src/renderers/StringsRenderer.test.jsx`
- Modify: `frontend/src/renderers/renderNode.jsx`
- Modify: `frontend/src/renderers/renderNode.test.jsx`

**Interfaces:**
- Consumes: `buildFieldMeta` is *not* needed here — there are no named fields.
- Produces: `renderNode` returns a `StringsRenderer` for `kind: "strings"`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/renderers/StringsRenderer.test.jsx`:

```jsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StringsRenderer } from "./StringsRenderer";

const node = { kind: "strings", path: ["values"], title: "Values" };

describe("StringsRenderer", () => {
  it("renders every stored string", () => {
    render(<StringsRenderer node={node} items={["honesty", "curiosity"]} onItems={() => {}} />);
    expect(screen.getByText("honesty")).toBeInTheDocument();
    expect(screen.getByText("curiosity")).toBeInTheDocument();
  });

  it("appends a new string without mutating the array it was given", async () => {
    const items = ["honesty"];
    const onItems = vi.fn();
    render(<StringsRenderer node={node} items={items} onItems={onItems} />);
    await userEvent.type(screen.getByPlaceholderText(/add value/i), "curiosity{Enter}");
    expect(onItems).toHaveBeenCalledWith(["honesty", "curiosity"]);
    expect(items).toEqual(["honesty"]); // caller's array untouched
  });

  it("renders an empty, usable input when nothing is stored", () => {
    render(<StringsRenderer node={node} items={[]} onItems={() => {}} />);
    expect(screen.getByPlaceholderText(/add value/i)).toBeEnabled();
  });

  it("treats a non-array value as empty rather than throwing", () => {
    expect(() =>
      render(<StringsRenderer node={node} items={undefined} onItems={() => {}} />)
    ).not.toThrow();
  });
});
```

The placeholder text above assumes the renderer derives "Add value…" from the
node. Match `ListRenderer`'s existing `addLabel` convention —
`node.entity ?? node.title ?? "item"`, de-underscored, and **singular**: these
nodes have no entity, so a `title` of "Values" must not produce "Add Values…".
Decide the singularisation rule, write it down in the module comment, and make
the test assert the exact string you chose.

- [ ] **Step 2: Run to verify it fails**

```bash
cd frontend && npx vitest run --project unit src/renderers/StringsRenderer.test.jsx
```

Expected: FAIL, cannot resolve `./StringsRenderer`.

- [ ] **Step 3: Write the renderer**

`frontend/src/renderers/StringsRenderer.jsx`:

```jsx
// A node whose stored value is a bare string[] -- lifestyle's values and
// personality_traits, preferences' code_style lists. There are no per-item
// fields and no entity to bind against, so this renderer takes only a path's
// worth of strings and hands them to ArrayInput, which is the control both
// retired editors used for exactly these keys.
import { ArrayInput } from "@/components/ArrayInput";

export function StringsRenderer({ node, items, onItems }) {
  const list = Array.isArray(items) ? items : [];
  // ...derive the singular add label; render ArrayInput bound to onItems
}
```

Pass a **new array** to `onItems` on every change — never mutate `items`.

- [ ] **Step 4: Dispatch it from `renderNode`**

In `renderNode.jsx`, add a `kind === "strings"` branch **before** the existing
`kind !== "list"` rejection. Keep the rejection's `console.error` for kinds that
are still unsupported. A `strings` node requires a non-empty `path` (an empty
one addresses and would replace the containing object); log and return `null`
if `path` is missing or empty, matching how the list branch guards itself.

Add a case to `renderNode.test.jsx` asserting a `kind: "strings"` node renders
and does **not** log an error.

- [ ] **Step 5: Run both test files, then the suite**

```bash
cd frontend && npx vitest run --project unit src/renderers/StringsRenderer.test.jsx src/renderers/renderNode.test.jsx
cd frontend && npx vitest run --project unit
```

Expected: all PASS, no pre-existing test changed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/renderers/StringsRenderer.jsx frontend/src/renderers/StringsRenderer.test.jsx frontend/src/renderers/renderNode.jsx frontend/src/renderers/renderNode.test.jsx
git commit -m "feat: renderNode dispatches kind: strings via StringsRenderer"
```

---

### Task 4: `kind: "fields"` — `FieldsRenderer`

Three of this wave's nodes bind **named keys of the object at a path**:
`communication.default` (`tone`, `detail_level`, `locale`) and
`wellness.sleep.weekday` / `wellness.sleep.weekend` (`bedtime`, `wakeup`).
`profile` (wave 6) is entirely this shape, so this renderer carries beyond
wave 5.

Unlike `strings`, a `fields` node **may** name an entity, and when it does the
guards in Task 5 can check its field names.

**Files:**
- Create: `frontend/src/renderers/FieldsRenderer.jsx`
- Create: `frontend/src/renderers/FieldsRenderer.test.jsx`
- Modify: `frontend/src/renderers/renderNode.jsx`
- Modify: `frontend/src/renderers/renderNode.test.jsx`

**Interfaces:**
- Consumes: `buildFieldMeta(node, entity)` from Task 2; `ScalarField` from the kit.
- Produces: `renderNode` returns a `FieldsRenderer` for `kind: "fields"`. Task 6 and 7 both use it.

- [ ] **Step 1: Write the failing tests**

`frontend/src/renderers/FieldsRenderer.test.jsx`:

```jsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FieldsRenderer } from "./FieldsRenderer";

const node = {
  kind: "fields",
  path: ["communication", "default"],
  entity: "communication_default",
  fields: ["tone", "detail_level", "locale"],
};
const entity = { optional: ["tone", "detail_level", "locale"] };

describe("FieldsRenderer", () => {
  it("renders one labelled control per declared field", () => {
    render(<FieldsRenderer node={node} entity={entity} value={{}} onValue={() => {}} />);
    expect(screen.getByLabelText(/tone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/detail level/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/locale/i)).toBeInTheDocument();
  });

  it("shows the stored value for each field", () => {
    render(
      <FieldsRenderer node={node} entity={entity} value={{ tone: "warm" }} onValue={() => {}} />
    );
    expect(screen.getByLabelText(/tone/i)).toHaveValue("warm");
  });

  it("writes one field without dropping its siblings", async () => {
    const onValue = vi.fn();
    render(
      <FieldsRenderer
        node={node}
        entity={entity}
        value={{ tone: "warm", locale: "British English" }}
        onValue={onValue}
      />
    );
    await userEvent.type(screen.getByLabelText(/detail level/i), "b");
    expect(onValue).toHaveBeenCalledWith({
      tone: "warm",
      locale: "British English",
      detail_level: "b",
    });
  });

  it("preserves stored keys the node does not declare", async () => {
    const onValue = vi.fn();
    render(
      <FieldsRenderer
        node={node}
        entity={entity}
        value={{ tone: "warm", legacy_key: "keep me" }}
        onValue={onValue}
      />
    );
    await userEvent.type(screen.getByLabelText(/locale/i), "x");
    expect(onValue.mock.calls.at(-1)[0].legacy_key).toBe("keep me");
  });

  it("renders an enum field as an enum control, not a text input", () => {
    const enumNode = { ...node, enum: { tone: ["warm", "neutral", "direct"] } };
    render(<FieldsRenderer node={enumNode} entity={entity} value={{}} onValue={() => {}} />);
    expect(screen.getByRole("button", { name: "warm" })).toBeInTheDocument();
  });

  it("treats a missing stored object as empty rather than throwing", () => {
    expect(() =>
      render(<FieldsRenderer node={node} entity={entity} value={undefined} onValue={() => {}} />)
    ).not.toThrow();
  });
});
```

The **fourth test is the important one**: `FieldsRenderer` writes a whole
object, so a spread that forgets unknown keys silently deletes stored data on
first edit. The **fifth** pins that `buildFieldMeta` is actually being used —
without it every field would render as a plain `Input`.

The enum-control assertion must match how `EnumControl` actually renders;
check `frontend/src/components/controls` and fix the query to match rather than
changing the component.

- [ ] **Step 2: Run to verify it fails**

```bash
cd frontend && npx vitest run --project unit src/renderers/FieldsRenderer.test.jsx
```

Expected: FAIL, cannot resolve `./FieldsRenderer`.

- [ ] **Step 3: Write the renderer**

`frontend/src/renderers/FieldsRenderer.jsx`:

```jsx
// A node whose stored value is a single OBJECT whose named keys are edited in
// place -- preferences' communication.default, lifestyle's per-day sleep
// times, and (wave 6) profile's top-level scalars. No list, no add/remove:
// the keys are fixed by the manifest.
//
// Every write spreads the CURRENT stored object first, so keys the node does
// not declare survive the edit. These objects are shared with MCP writers that
// may know keys this node does not.
import { ScalarField } from "./ScalarField";
import { buildFieldMeta } from "./fieldMeta";

export function FieldsRenderer({ node, entity, value, onValue }) {
  const stored = value && typeof value === "object" ? value : {};
  const meta = buildFieldMeta(node, entity);
  // ...one labelled ScalarField per node.fields entry;
  //    onChange -> onValue({ ...stored, [field]: next })
}
```

Label each control with the field name de-underscored and sentence-cased, and
associate it with `htmlFor`/`id` so `getByLabelText` resolves — the tests above
depend on a real label association, not placeholder text.

- [ ] **Step 4: Dispatch it from `renderNode`**

Add a `kind === "fields"` branch. **`fields` nodes legitimately use
`path: []`** (the section root — `profile` needs this, and
`meta_schema.json` makes the non-empty-path rule conditional on
`kind: "list"` for exactly this reason). So this branch must **not** reject an
empty path. It must still reject a non-array path.

Add a `renderNode.test.jsx` case for a `kind: "fields"` node with `path: []`
asserting it renders and logs nothing.

- [ ] **Step 5: Run both files, then the suite**

```bash
cd frontend && npx vitest run --project unit src/renderers/FieldsRenderer.test.jsx src/renderers/renderNode.test.jsx
cd frontend && npx vitest run --project unit
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/renderers/FieldsRenderer.jsx frontend/src/renderers/FieldsRenderer.test.jsx frontend/src/renderers/renderNode.jsx frontend/src/renderers/renderNode.test.jsx
git commit -m "feat: renderNode dispatches kind: fields via FieldsRenderer"
```

---

### Task 5: Extend the `ui` guards to non-list nodes

Both guards in `test_ui_schema.py` read `node.get("entity")` and skip when it
is absent (`:763`, `:801`). Every node bound in waves 2–4 was a list and every
list carries an entity, so nothing has slipped through yet. Wave 5 adds eleven
non-list nodes; two of them (`communication_default`, `sleep`) **do** name an
entity and should be checked exactly as a list node's fields are.

Read reference doc §3 before starting. It states plainly what this change does
**not** buy: `sleep`'s entity declares `day_type`, which is a router and is
never stored, so the spelling guard would still accept a node binding it. This
closes the alias hole, not the phantom-key hole. Do not claim otherwise in the
docstring.

**Files:**
- Modify: `backend/tests/test_ui_schema.py`
- Modify: `backend/section_packs/meta_schema.json` (only if `$comment` needs to become required on entity-less nodes — see Step 4)

**Interfaces:**
- Consumes: nothing.
- Produces: guards that no longer skip `kind: "fields"` / `kind: "strings"`. Tasks 6 and 7 ship manifests that must pass them.

- [ ] **Step 1: Read the two guards**

`backend/tests/test_ui_schema.py:758-830`. Understand precisely why each skips a
node, and what "fields" means for each node kind: a `list` node's field names
live in `fields`/`badges`/`detail_fields`/`array_fields`/`date_fields`/
`long_text`; a `fields` node's live in `fields`; a `strings` node has **none**.

- [ ] **Step 2: Write the failing tests**

Add to `backend/tests/test_ui_schema.py`:

```python
def test_fields_node_naming_an_mcp_input_alias_is_caught():
    """A kind:"fields" node that binds an input-only alias must be rejected
    just as a list node is. `mental_tab` stores `title`; `name` is an alias
    that is never persisted."""
    manifest = _manifest_with_sections([
        {"kind": "fields", "path": ["x"], "entity": "mental_tab", "fields": ["name"]}
    ])
    with pytest.raises(AssertionError, match="name"):
        _assert_no_mcp_input_alias(manifest)


def test_fields_node_naming_a_stored_key_is_accepted():
    manifest = _manifest_with_sections([
        {"kind": "fields", "path": ["x"], "entity": "mental_tab", "fields": ["title"]}
    ])
    _assert_no_mcp_input_alias(manifest)  # must not raise


def test_strings_node_is_not_checked_for_field_names():
    """A kind:"strings" node binds a path, not field names -- there is
    nothing to check and it must not be treated as a violation."""
    manifest = _manifest_with_sections([{"kind": "strings", "path": ["values"]}])
    _assert_no_mcp_input_alias(manifest)  # must not raise
```

These call helpers that do not exist yet. **Restructuring the two guards into
callable helpers is part of this task** — today their logic is inline in
parametrised tests. Extract it so both the shipped-manifest parametrisation and
these synthetic cases drive the same code. Name the helpers to match whatever
already reads naturally in that module.

- [ ] **Step 3: Run to verify they fail**

```bash
cd backend && timeout 400 python -m pytest tests/test_ui_schema.py -v
```

Expected: the three new tests FAIL (missing helpers). Every pre-existing test
in the file still PASSES.

- [ ] **Step 4: Extend the guards**

Stop skipping non-list nodes. Concretely: a node is checked when it names an
`entity`, whatever its kind; the set of field names to check is derived per
kind as described in Step 1; a node with no entity is still skipped, because
there is no vocabulary to check against.

For entity-less `strings` nodes, the reference doc's recommendation is to carry
the reading in the manifest via `$comment`. **Decide whether to make that
mandatory** — a `test_ui_schema.py` assertion that every entity-less node
carries a non-empty `$comment` — and say which you chose and why in your
report. If you make it mandatory, Tasks 6 and 7 must satisfy it, so it must
also be stated in the schema's `$comment` documentation.

- [ ] **Step 5: Run the file, then the suite**

```bash
cd backend && timeout 400 python -m pytest tests/test_ui_schema.py -v
cd backend && timeout 400 python -m pytest -q
```

Expected: all PASS. Report the count.

- [ ] **Step 6: Update the module docstring**

The docstring at `test_ui_schema.py:42-56` currently states that `fields` and
`strings` nodes are "SKIPPED WHOLESALE by both". That is about to be false.
Rewrite that paragraph to describe the new rule **and** its remaining limit
(the `day_type` case from reference §3). Do not delete the paragraph — the
blind spot it documents still exists in narrowed form.

- [ ] **Step 7: Commit**

```bash
git add backend/tests/test_ui_schema.py backend/section_packs/meta_schema.json
git commit -m "test: ui guards no longer skip fields/strings nodes that name an entity"
```

**→ Open PR A here** (tasks 1–5). Title: `Wave 5a: strings and fields node kinds; hobby status fix`.

---

### Task 6: Migrate `lifestyle`

**Files:**
- Modify: `backend/section_packs/lifestyle/manifest.json`
- Delete: `frontend/src/editors/LifestyleEditor.jsx` (1,165 lines)
- Modify: the editor registry that maps section key → component (find it; waves 2–4 each touched it)
- Create: `frontend/src/renderers/__tests__/lifestyle.test.jsx` (match the naming waves 3–4 used for their per-section tests)

**Interfaces:**
- Consumes: `StringsRenderer` (Task 3), `FieldsRenderer` (Task 4), the extended guards (Task 5), `"paused"` being storable (Task 1).
- Produces: `lifestyle` rendered entirely by `SectionRenderer`.

- [ ] **Step 1: Inventory the editor before deleting it**

Read `frontend/src/editors/LifestyleEditor.jsx` in full and write a parity
checklist into your report file: every field, control type, enum, search box,
filter, collapse toggle, empty state and info block it renders. The migration
is judged against this list, not against the manifest.

Known from the plan author's reading — confirm each and add anything missed:

| Group | Path | Node kind | Notes |
|---|---|---|---|
| Hobbies | `hobbies` | `list`, entity `hobby` | `title_field: name`; enum `skill_level` (5) + `status` (3, now all storable); `notes` long text; `specifics` via `array_fields`; `references` as a child list, entity `hobby_reference`, **stored key `name` not `ref_name`** (reference §1.1) |
| Interests | `interests` | `list`, entity `interest` | already has a `ui` block — keep `title_field`/`badges`/`detail_fields` exactly |
| Personality traits | `personality_traits` | `strings` | bare strings; entity declares `trait`, which is **not a stored key** |
| Values | `values` | `strings` | bare strings |
| Sleep | `wellness.sleep.weekday`, `wellness.sleep.weekend` | `fields` ×2, entity `sleep` | bind `bedtime`, `wakeup` only. **Do not bind `day_type`** — it is a router, never stored (reference §1.5) |
| Energy peaks | `wellness.energy_peaks` | `strings` | bare strings |
| Stress triggers | `wellness.stress_triggers` | `strings` | **no entity, no MCP write path** — `$comment` must record this (reference §1.7) |

- [ ] **Step 2: Write the failing section test**

Cover, at minimum:

```
- hobbies render, and adding one writes {name, status, notes, specifics: [], references: []}
- a hobby's status can be set to "paused" and reads back as "paused"
- a hobby's `specifics` renders as an ArrayInput and appends without touching sibling hobbies
- a hobby's `references` child list adds a row storing `name` (NOT `ref_name`)
- renaming a hobby keeps focus (the stored-index row key)
- editing hobby #2 after a search filters the list writes to hobby #2, not display row #2
- personality_traits / values / energy_peaks / stress_triggers each render and append
- sleep weekday bedtime writes wellness.sleep.weekday.bedtime and leaves weekend untouched
- interests keep their kind badge and notes detail
- every group renders a usable Add control when its stored value is empty
```

The **stored-index test is mandatory** — it is the failure mode this project
has hit repeatedly, and a list with a search box is where it bites.

The **empty-state test is mandatory** — waves 3 and 4 both shipped sections
with no reachable Add control on a new account.

- [ ] **Step 3: Run to verify it fails**

```bash
cd frontend && npx vitest run --project unit src/renderers/__tests__/lifestyle.test.jsx
```

- [ ] **Step 4: Write the `ui` block**

Replace `lifestyle/manifest.json`'s `ui` with the explicit `ui.sections` form.
Give each node a `title` and, where the retired editor had one, an `info`
block — carry the existing copy across verbatim from
`LifestyleEditor.jsx:72-120` rather than rewriting it.

Order the sections as the editor did. Confirm the order by reading the JSX, not
by assuming.

- [ ] **Step 5: Validate the manifest**

```bash
cd backend && timeout 400 python -m pytest tests/test_ui_schema.py -q
```

Expected: PASS. A failure here means a field name is not a storage key — go
back to the reference doc, do not weaken the guard.

- [ ] **Step 6: Delete the editor and repoint the registry**

Remove `LifestyleEditor.jsx`, its import, and its registry entry. Grep for
`LifestyleEditor` across `frontend/src` and confirm zero remaining references,
including in tests and stories.

- [ ] **Step 7: Run everything**

```bash
cd frontend && npx vitest run --project unit
cd frontend && npm run build
cd backend && timeout 400 python -m pytest -q
```

- [ ] **Step 8: Verify in a browser**

```bash
PORT=9000 ./scripts/local-preview.sh
```

Click through every group: add, edit, remove, search, collapse, empty state,
mobile width (375px). Confirm the enum controls do not overflow — waves 3 and 4
both shipped overflow bugs at this width. Report what you exercised.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: lifestyle renders from its manifest; LifestyleEditor deleted"
```

**→ Open PR B here.** Title: `Wave 5b: lifestyle on the renderer kit`.

---

### Task 7: Migrate `preferences`

**Files:**
- Modify: `backend/section_packs/preferences/manifest.json` (`ui` is currently `null`)
- Delete: `frontend/src/editors/PreferencesEditor.jsx` (478 lines)
- Modify: the editor registry
- Create: `frontend/src/renderers/__tests__/preferences.test.jsx`
- Modify: `backend/tests/` — a test for the existing flat→nested `communication` migration

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces: `preferences` rendered by `SectionRenderer`. Wave 6 (`profile`) then faces only `kind: "fields"`, already built.

- [ ] **Step 1: Inventory the editor**

Same as Task 6 Step 1. Known groups — confirm and extend:

| Group | Path | Node kind | Notes |
|---|---|---|---|
| Code style | `code_style.preferred_languages`, `.frameworks`, `.tools` | `strings` ×3 | **no entity, no MCP write path**; the generic `preference` entity would *overwrite these arrays with a scalar* (reference §2.4). `$comment` each |
| Communication default | `communication.default` | `fields`, entity `communication_default` | `tone`, `detail_level`, `locale` |
| Mood overrides | `communication.mood_overrides` | `list`, entity `mood_override` | `title_field: mood`; `tone`/`detail_level` frequently absent |
| Learning style | `learning_style.preferred`, `.avoid` | `strings` ×2 | no entity, no MCP path |
| Likes & dislikes | `likes_dislikes` | `list`, entities `like`/`dislike` | `title_field: item`; **`stance` is the discriminator and is in neither entity's `required` nor `optional`** — bind it as an enum/facet and **declare the divergence** (reference §2.3) |

- [ ] **Step 2: Handle `stance` deliberately**

`stance` is a real stored key that the spelling guard will reject, because
neither `like` nor `dislike` lists it. This is the second instance of the guard
being anti-correlated with the risk (after `timestamp` in wave 3).

Use the existing declared-divergence mechanism —
`test_ui_schema.py::test_declared_divergence_is_accepted_by_the_schema` (`:598`)
already establishes how a manifest declares a field the vocabulary omits. Read
that test, follow the mechanism it proves, and record in the node's `$comment`
that `stance` is written by both the `like` and `dislike` branches.

Do **not** add `stance` to the entities' `optional` lists to dodge the guard —
that changes the MCP vocabulary as a side effect of a UI change. Reference §4.4
carries it as a backend follow-up.

- [ ] **Step 3: Write the failing section test**

Cover, at minimum:

```
- the three code_style lists render and append independently of each other
- communication default tone/detail_level/locale render and write into
  communication.default, leaving communication.mood_overrides untouched
- a mood override adds with {mood} and optional tone/detail_level
- learning_style preferred/avoid render and append
- a like adds with stance "like"; a dislike adds with stance "dislike";
  both land in the SAME likes_dislikes list
- flipping a row's stance rewrites only that row
- every group renders a usable Add control when empty
```

The like/dislike-share-one-list test is the one that catches a wrong `path`.

- [ ] **Step 4: Add the missing migration test**

`persona_store._normalize:234-247` already migrates flat `communication` to the
nested shape. The spec assumed this lands in wave 5; it is already there and
**untested against an old-shape record**. Write that test — feed `_normalize` a
`preferences` record whose `communication` is the old flat
`{tone, detail_level, locale}` and assert it comes back as
`{default: {...}, mood_overrides: []}` with the values preserved.

Do **not** re-implement the migration. If the test passes on the first run,
that is the correct outcome; say so.

- [ ] **Step 5: Write the `ui` block**

`preferences/manifest.json`'s `ui` is `null` — this is a from-scratch
`ui.sections` block. Carry the editor's section titles and any info copy
verbatim.

- [ ] **Step 6: Validate, delete, repoint**

```bash
cd backend && timeout 400 python -m pytest tests/test_ui_schema.py -q
```

Then delete `PreferencesEditor.jsx`, its import and registry entry; grep for
zero remaining references.

- [ ] **Step 7: Run everything**

```bash
cd frontend && npx vitest run --project unit
cd frontend && npm run build
cd backend && timeout 400 python -m pytest -q
```

- [ ] **Step 8: Verify in a browser**

```bash
PORT=9000 ./scripts/local-preview.sh
```

Exercise every group at desktop and 375px. Confirm the likes/dislikes stance
control and the communication enums do not overflow.

- [ ] **Step 9: Update the spec**

Add a "State after wave 5" section to
`docs/superpowers/specs/2026-07-27-section-editor-consolidation-design.md`:
which node kinds now exist, the running deleted-lines total (3,243 + 1,643 =
**4,886**), what wave 6 (`profile`, 1,446 lines) faces, and any deferred minors
this wave parked.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: preferences renders from its manifest; PreferencesEditor deleted"
```

**→ Open PR C here.** Title: `Wave 5c: preferences on the renderer kit`.

---

## Carried forward to wave 6

- `profile` (1,446 lines) is entirely `kind: "fields"` — Task 4 is its foundation.
- The `day_type` phantom-key hole (reference §3) survives this wave. Wave 6's entry criterion should be a decision on whether `fields` nodes need a stored-key authority, since `profile` binds top-level scalars against no entity at all.
- `ListRenderer.jsx` is 604 lines against a ~200 budget. Task 2 takes the first cut; the badge-strip and `editFields` extractions are still outstanding.
- Backend follow-ups 2–5 in the reference doc are unclaimed.
