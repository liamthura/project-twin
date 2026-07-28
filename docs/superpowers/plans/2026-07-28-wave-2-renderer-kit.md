# Wave 2: Renderer Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `GenericSectionEditor` with a small recursive renderer kit driven by a validated `ui.sections` schema, proven against the three packs that already render generically — so waves 3-6 extend a tested kit rather than a 282-line monolith.

**Architecture:** Five small units under `frontend/src/renderers/`. `paths.js` holds pure immutable path helpers and the `ui` normaliser. `ScalarField` picks a control for one field. `ListRenderer` renders a list of objects. `SectionRenderer` dispatches nodes by `kind`. Wave 2 implements `kind: "list"` only — `fields`, `strings` and nested `children` arrive in waves 4-5, and an unknown kind must fail loudly rather than render nothing.

**Tech Stack:** React 18, Vite 7.3.6, Vitest 4, Testing Library, Storybook 10, Tailwind 3.4, Python 3.11 + jsonschema (backend manifest validation).

## Global Constraints

- **No stored JSON changes.** Every pack keeps its exact on-disk data shape. This wave changes rendering only.
- **Parity is proven by the wave 1 guards.** `frontend/src/components/GenericSectionEditor.test.jsx` currently runs a coverage guard and a round-trip guard over `goals`, `media` and `aesthetics`. Those tests must pass against the new renderer with their assertions unchanged. Moving the file and swapping the imported component is expected; weakening an assertion to make it pass is a task failure.
- **`ui` declares storage keys.** Field names in a `ui` node are the keys written to storage. For these three packs the entity's field names happen to be the storage keys, so `entity` may supply metadata; that is not true for the seven legacy sections and must not be assumed in later waves.
- Wave 2 implements `kind: "list"` only. Do not implement `fields`, `strings`, or `children`.
- Plain JavaScript. No TypeScript, no `tsconfig.json`.
- Node floor is `^22.22.2 || >=24.15.0`. Local Node may be below it; `EBADENGINE` warnings on install are expected, not failures.
- `timeout` is not available on this machine — background long-running processes and kill by PID.
- Branch: `feature/wave-2-renderer-kit`, from `main`. Pushes use the `liamthura` account.

## Refinement of the spec

The spec (§ The `ui` schema) says enum options come from an inline `enum` map or an `enum_from: "<entity>"` reference. This plan uses a single `entity: "<name>"` key instead, which supplies **all** entity-derived metadata a node needs — `valid_values`, `field_defaults`, and the `optional` list that gates `custom_*` overflow fields — rather than three separate reference keys.

The spec's concern was that a node must not inherit *field names* from `entities`, because for the legacy sections those names are an MCP vocabulary rather than storage keys. That concern is preserved: the node still lists its own field names, and `entity` is consulted only for metadata looked up **by** those names. Where a legacy section's names diverge, waves 3-6 put an inline `enum` and `field_defaults` on the node, which take precedence over anything `entity` provides.

---

### Task 1: Path helpers and the `ui` normaliser

Pure functions, no React. These are the foundation every later wave builds on, so they get real TDD.

**Files:**
- Create: `frontend/src/renderers/paths.js`
- Create: `frontend/src/renderers/paths.test.js`

**Interfaces:**
- Produces `getAt(obj, path)` — returns the value at an array path, or `undefined` if any segment is missing. Never throws.
- Produces `setAt(obj, path, value)` — returns a **new** object with `value` at `path`, structurally sharing everything off the path. Creates intermediate objects as needed. Never mutates its input.
- Produces `removeAt(obj, path)` — returns a new object with the key at `path` deleted. Never mutates.
- Produces `normalizeUi(pack)` — returns `{ sections: [...] }` for any pack, accepting both the new explicit form and the legacy flat map. Tasks 2-5 depend on all four.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/renderers/paths.test.js`:

```js
import { describe, it, expect } from "vitest";
import { getAt, setAt, removeAt, normalizeUi } from "./paths";

describe("getAt", () => {
  it("reads a nested value", () => {
    expect(getAt({ a: { b: { c: 1 } } }, ["a", "b", "c"])).toBe(1);
  });
  it("returns undefined for a missing branch instead of throwing", () => {
    expect(getAt({ a: {} }, ["a", "b", "c"])).toBeUndefined();
    expect(getAt(undefined, ["a"])).toBeUndefined();
  });
  it("returns the object itself for an empty path", () => {
    const o = { a: 1 };
    expect(getAt(o, [])).toBe(o);
  });
});

describe("setAt", () => {
  it("does not mutate its input", () => {
    const before = { a: { b: 1 }, keep: [1, 2] };
    const frozen = structuredClone(before);
    Object.freeze(before);
    Object.freeze(before.a);
    const after = setAt(before, ["a", "b"], 2);
    expect(before).toEqual(frozen);
    expect(after.a.b).toBe(2);
  });
  it("structurally shares branches off the path", () => {
    const before = { a: { b: 1 }, other: { deep: {} } };
    const after = setAt(before, ["a", "b"], 2);
    expect(after.other).toBe(before.other);
  });
  it("creates intermediate objects", () => {
    expect(setAt({}, ["x", "y"], 3)).toEqual({ x: { y: 3 } });
  });
  it("replaces the whole object for an empty path", () => {
    expect(setAt({ a: 1 }, [], { b: 2 })).toEqual({ b: 2 });
  });
});

describe("removeAt", () => {
  it("deletes the key without mutating", () => {
    const before = { a: { b: 1, c: 2 } };
    Object.freeze(before);
    Object.freeze(before.a);
    const after = removeAt(before, ["a", "b"]);
    expect(after).toEqual({ a: { c: 2 } });
    expect(before.a.b).toBe(1);
  });
  it("is a no-op when the path is absent", () => {
    expect(removeAt({ a: 1 }, ["nope", "deep"])).toEqual({ a: 1 });
  });
});

describe("normalizeUi", () => {
  const legacyPack = {
    entities: { goal: { identifier: "title" } },
    ui: { goals: { title_field: "title", badges: ["status"], detail_fields: ["notes"] } },
  };

  it("converts the legacy flat map to a sections array", () => {
    const { sections } = normalizeUi(legacyPack);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      kind: "list",
      path: ["goals"],
      entity: "goal",
      title_field: "title",
      badges: ["status"],
      detail_fields: ["notes"],
    });
  });

  it("resolves the entity by its declared list key", () => {
    const pack = {
      entities: { media_item: { list: "items" }, other: { list: "elsewhere" } },
      ui: { items: { title_field: "title" } },
    };
    expect(normalizeUi(pack).sections[0].entity).toBe("media_item");
  });

  it("passes an explicit sections array through untouched", () => {
    const pack = { entities: {}, ui: { sections: [{ kind: "list", path: ["x"], entity: "e" }] } };
    expect(normalizeUi(pack).sections).toEqual([{ kind: "list", path: ["x"], entity: "e" }]);
  });

  it("returns no sections for a pack without a ui block", () => {
    expect(normalizeUi({ entities: {} }).sections).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/renderers/paths.test.js`
Expected: FAIL — `Failed to resolve import "./paths"`.

- [ ] **Step 3: Implement**

Create `frontend/src/renderers/paths.js`. Write `getAt`, `setAt` and `removeAt` as pure recursive functions over an array path. Then `normalizeUi(pack)`:

- If `pack.ui?.sections` is an array, return `{ sections: pack.ui.sections }` unchanged.
- Otherwise treat `pack.ui` as the legacy `{ [listKey]: uiSpec }` map. For each entry emit `{ kind: "list", path: [listKey], entity: <resolved>, ...uiSpec }`.
- Resolve the entity exactly as `GenericSectionEditor.jsx:248-264` does today: prefer the entity whose `list` equals the key; if none matches and the pack has exactly one entity, use it; otherwise leave `entity` undefined and skip the node.
- If `pack.ui` is absent, return `{ sections: [] }`.

Read `GenericSectionEditor.jsx` before writing the resolution so the legacy behaviour is reproduced rather than reinvented.

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run src/renderers/paths.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderers/paths.js frontend/src/renderers/paths.test.js
git commit -m "feat: path helpers and ui normaliser for the renderer kit

Immutable get/set/remove at an array path, plus normalizeUi, which accepts
both the new explicit ui.sections form and the legacy flat map so existing
packs keep working without a manifest change."
```

---

### Task 2: `ScalarField`

One field, one control. Extracted from `GenericSectionEditor`'s `FieldInput` with no behaviour change.

**Files:**
- Create: `frontend/src/renderers/ScalarField.jsx`
- Create: `frontend/src/renderers/ScalarField.test.jsx`

**Interfaces:**
- Produces `ScalarField({ field, value, meta, onChange, customValue, onCustomChange })`.
  - `meta` is `{ valid_values, optional, array_fields, long_text }` — everything the control needs, already resolved by the caller. `ScalarField` never reads a pack or an entity itself.
  - Renders, in priority order: an `EnumControl` when `meta.valid_values?.[field]` exists; an `ArrayInput` when `field` is in `meta.array_fields`; a `Textarea` when `field` is in `meta.long_text`; otherwise an `Input`.
  - When an enum's value is `"other"` and `meta.optional` includes `custom_${field}`, it also renders a text input wired to `customValue`/`onCustomChange`.
- Task 3 depends on this signature.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/renderers/ScalarField.test.jsx` covering: a plain field renders an input carrying its value; a field in `array_fields` renders `ArrayInput` (assert an existing item appears as a badge); a field in `long_text` renders a textarea; a field with `valid_values` renders an enum control (four or fewer options render segmented buttons with `aria-pressed`, more than four render a combobox — see `SEGMENTED_MAX` in `frontend/src/components/controls.jsx`); and the `custom_*` input appears only when the value is `"other"` **and** `custom_<field>` is in `meta.optional`.

Write real assertions with real values — do not assert on `container.firstChild`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/renderers/ScalarField.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/renderers/ScalarField.jsx` by lifting the `FieldInput` function from `frontend/src/components/GenericSectionEditor.jsx:16-43`, changing only how it obtains its metadata: today it reads `entity.valid_values`, `entity.optional` and a module-level `LONG_TEXT_FIELDS`; now all three arrive via `meta`. Keep `LONG_TEXT_FIELDS` as the default `long_text` set, exported so Task 3 can pass it.

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run src/renderers/ScalarField.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderers/ScalarField.jsx frontend/src/renderers/ScalarField.test.jsx
git commit -m "feat: ScalarField picks a control for one field

Lifted from GenericSectionEditor's FieldInput. Takes resolved metadata
rather than reaching into a pack, so it has no opinion about where
valid_values came from -- which is what lets later waves feed it inline
enums for sections whose manifest names are not their storage keys."
```

---

### Task 3: `ListRenderer`

**Files:**
- Create: `frontend/src/renderers/ListRenderer.jsx`
- Create: `frontend/src/renderers/ListRenderer.test.jsx`

**Interfaces:**
- Produces `ListRenderer({ node, entity, items, onItems, onShowConfirmation })`.
  - `node` is a normalised `kind: "list"` node. `entity` is the resolved entity spec object, or `undefined`.
  - `items` is the array at the node's path; `onItems(nextArray)` reports a whole replacement array.
  - Renders the entry count, the Add dialog, suggestion chips, and the collapsible rows with badges and a delete button — all as `GenericSectionEditor`'s `PackList` does today.
  - `onShowConfirmation(title, body, onConfirm)` is called before removal when provided.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/renderers/ListRenderer.test.jsx` covering, with real assertions:

- rows render their title, and badges render for fields listed in `node.badges`
- clicking a row expands it and reveals its detail fields
- **removal goes through `onShowConfirmation` when supplied** — assert the callback fires and that `onItems` is NOT called until the confirm callback is invoked. This is the branch production always takes and which wave 1's harness never exercised.
- adding via the dialog merges `entity.field_defaults` into the new item
- adding an item whose title duplicates an existing one (case-insensitively) is a no-op
- a suggestion chip adds an item, and chips for already-present titles are not offered

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/renderers/ListRenderer.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/renderers/ListRenderer.jsx` from `GenericSectionEditor.jsx:45-244` (`PackList`), with these changes and no others:

- take `node` instead of `uiSpec` + `listKey`, and `entity` as a resolved object
- delegate every field control to `ScalarField`, passing `meta` built from `node` and `entity`: `{ valid_values: node.enum ?? entity?.valid_values, optional: entity?.optional ?? [], array_fields: node.array_fields ?? [], long_text: LONG_TEXT_FIELDS }`
- take `field_defaults` from `node.field_defaults ?? entity?.field_defaults ?? {}`

The `node.enum` and `node.field_defaults` precedence is what waves 3-6 will use for sections whose manifest field names are not their storage keys. It is unused by all three packs today; implement it anyway, because retrofitting precedence later means re-testing every migrated section.

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run src/renderers/ListRenderer.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderers/ListRenderer.jsx frontend/src/renderers/ListRenderer.test.jsx
git commit -m "feat: ListRenderer renders a list of objects

Lifted from GenericSectionEditor's PackList, with node-level enum and
field_defaults taking precedence over the entity's. Adds the deletion
confirmation test wave 1's harness could not reach."
```

---

### Task 4: `SectionRenderer`, and retire `GenericSectionEditor`

The parity gate. The wave 1 guards must pass against the new renderer with their assertions unchanged.

**Files:**
- Create: `frontend/src/renderers/SectionRenderer.jsx`
- Modify: `frontend/src/test/harness.jsx` (render `SectionRenderer`; pass `onShowConfirmation`)
- Move: `frontend/src/components/GenericSectionEditor.test.jsx` → `frontend/src/renderers/SectionRenderer.test.jsx`
- Move: `frontend/src/components/GenericSectionEditor.stories.jsx` → `frontend/src/renderers/SectionRenderer.stories.jsx`
- Modify: `frontend/src/App.jsx:55` and `:683-688`
- Delete: `frontend/src/components/GenericSectionEditor.jsx`

**Interfaces:**
- Produces `SectionRenderer({ pack, data, onChange, onShowConfirmation })` — same prop contract `App.jsx` passes `GenericSectionEditor` today, so the call site changes only in name.
- Internally: `normalizeUi(pack)`, then for each node dispatch on `kind`. `"list"` renders `ListRenderer` over `getAt(data, node.path)`, reporting back through `setAt`. Any other `kind` must `console.error` naming the kind and the pack key, and render nothing for that node — a silent skip is how a migrated section loses a whole list without anyone noticing.

- [ ] **Step 1: Update the harness and move the tests**

In `frontend/src/test/harness.jsx`, import `SectionRenderer` instead of `GenericSectionEditor`, and pass `onShowConfirmation` through so tests can exercise the branch production uses:

```jsx
export function renderSection({ pack, initial, onShowConfirmation }) {
  const start = deepFreeze(structuredClone(initial));
  let seen = start;
  function Harness() {
    const [data, setData] = useState(start);
    return (
      <SectionRenderer
        pack={pack}
        data={data}
        onChange={(next) => { seen = next; setData(next); }}
        onShowConfirmation={onShowConfirmation}
      />
    );
  }
  const result = render(<Harness />);
  return { ...result, user: userEvent.setup(), latest: () => seen, initial: structuredClone(initial) };
}
```

`git mv` the test and story files into `frontend/src/renderers/` and update their imports.

**One change to the moved test file is required, and only one.** Its `describeGuards` helper currently derives the covered field list by indexing `pack.ui[listKey]`. Task 5 migrates the three manifests to the explicit `ui.sections` form, at which point that index returns `undefined` and every coverage assertion would silently loop zero fields — passing while testing nothing. Change it to resolve the node through `normalizeUi`, which handles both forms:

```js
import { normalizeUi } from "@/renderers/paths";

const node = normalizeUi(pack).sections.find((s) => s.path[0] === listKey);
const covered = [...new Set([...(node.badges || []), ...(node.detail_fields || [])])];
```

**Every assertion stays exactly as it is.** Only the derivation of `covered` changes. If you find yourself editing an `expect(...)`, stop — the renderer is not at parity and the renderer is what needs fixing.

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npm test`
Expected: FAIL — `SectionRenderer` does not exist yet.

- [ ] **Step 3: Implement**

Create `frontend/src/renderers/SectionRenderer.jsx`. Keep the `Card` / `CardHeader` / `CardTitle` / `CardDescription` wrapper exactly as `GenericSectionEditor.jsx:252-258` renders it, so the visual output is unchanged.

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npm test`
Expected: PASS — 9 tests, assertions unchanged. **This is the parity proof.** If a guard fails, the renderer is not at parity: fix the renderer, never the assertion.

- [ ] **Step 5: Swap the call site and delete the old component**

Update `frontend/src/App.jsx:55` to import `SectionRenderer` from `@/renderers/SectionRenderer`, and `:683-688` to render it. Then delete `frontend/src/components/GenericSectionEditor.jsx` and confirm nothing references it:

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
grep -rn "GenericSectionEditor" frontend/src || echo "no references remain"
cd frontend && npm test && npm run build
```

Expected: no references; 9 tests pass; the build succeeds with one JS and one CSS asset.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src
git commit -m "feat: SectionRenderer replaces GenericSectionEditor

Dispatches ui.sections nodes by kind; only 'list' is implemented in this
wave, and an unknown kind logs loudly rather than silently rendering
nothing. The wave 1 coverage and round-trip guards pass against it with
their assertions unchanged, which is the parity proof.

The harness now passes onShowConfirmation, so tests reach the deletion
branch App.jsx actually uses."
```

---

### Task 5: Explicit `ui.sections` manifests and a schema with teeth

**Files:**
- Modify: `backend/section_packs/goals/manifest.json`, `media/manifest.json`, `aesthetics/manifest.json`
- Modify: `backend/section_packs/meta_schema.json`
- Create: `backend/tests/test_ui_schema.py`
- Regenerate: `frontend/src/__fixtures__/packs.json`

**Interfaces:**
- Consumes `normalizeUi` from Task 1 — the migrated manifests exercise its passthrough branch, and the meta_schema keeps accepting the legacy form so third-party packs still load.

- [ ] **Step 1: Write the failing backend tests**

Create `backend/tests/test_ui_schema.py`. It must assert:

- every in-repo pack manifest validates against `meta_schema.json`
- a `ui` with an unknown `kind` is **rejected**
- a `kind: "list"` node missing `path` is **rejected**
- a legacy flat `ui` map is still **accepted** (third-party packs must not break)
- every field named in a pack's `ui` nodes (`title_field`, `badges`, `detail_fields`, `array_fields`) appears in that entity's `required + optional` — the narrow completeness check the spec scopes to the generic packs only

Note: `goals` declares `custom_type` in `optional` with no `ui` reference. That is the documented `custom_*` overflow mechanism, not an omission — the completeness check runs `ui` → `entity`, not the reverse, so it does not fire. Do not add a reverse check; the spec records why in "Known gaps in the wave 1 harness".

Run: `cd backend && python -m pytest tests/test_ui_schema.py -v`
Expected: FAIL — the schema has no `ui` definition, so the invalid cases are accepted.

- [ ] **Step 2: Give `meta_schema.json` a real `ui` definition**

Replace `"ui": {"type": "object"}` with a schema accepting either form:

- an object with a `sections` array, each item requiring `kind` and `path`, with `kind` an enum of `["list", "fields", "strings"]`, `path` an array of strings, and optional `entity`, `title`, `title_field`, `badges`, `detail_fields`, `array_fields`, `long_text`, `suggestions`, `enum`, `field_defaults`, `children`
- or the legacy free-form object map

Declare `"list"`, `"fields"` and `"strings"` now even though only `"list"` renders in this wave — the schema describes the vocabulary, and waves 4-5 add the renderers. Set `additionalProperties: false` on a section node so a typo is rejected rather than silently ignored; that is the entire point of this task.

- [ ] **Step 3: Migrate the three manifests**

Convert each pack's `ui` to the explicit form, preserving every existing key. For example, `goals`:

```json
"ui": {
  "sections": [
    {
      "kind": "list",
      "path": ["goals"],
      "entity": "goal",
      "title_field": "title",
      "badges": ["type", "status"],
      "detail_fields": ["target_date", "why", "notes"]
    }
  ]
}
```

`media` uses `path: ["items"]`, `entity: "media_item"`, and keeps `array_fields: ["tags"]`. `aesthetics` uses `path: ["styles"]`, `entity: "aesthetic"`, and keeps both `array_fields: ["references"]` and its full `suggestions` block. Copy the existing values exactly — do not retype them from memory.

- [ ] **Step 4: Run the backend tests**

Run: `cd backend && python -m pytest tests/test_ui_schema.py -v && python -m pytest -q`
Expected: the new tests pass and the full suite stays green.

- [ ] **Step 5: Regenerate the fixture and re-run the frontend suite**

```bash
cd frontend && npm run fixtures && npm test
```

Expected: `packs.json` picks up the new `ui` shape, and **all 9 frontend tests still pass with their assertions unchanged** — this proves the explicit form renders identically to the legacy form.

Before trusting that green, confirm the coverage guard is still looking at something. Task 4 rewired it through `normalizeUi`; if that resolution returns `undefined` for a migrated pack, `covered` becomes an empty list and the guard passes vacuously. Check it directly:

```bash
cd frontend && node -e "
const packs = require('./src/__fixtures__/packs.json');
for (const key of ['goals','media','aesthetics']) {
  const p = packs.find(x => x.key === key);
  const s = (p.ui.sections || [])[0] || {};
  console.log(key, '-> path', JSON.stringify(s.path), 'covered',
    [...new Set([...(s.badges||[]), ...(s.detail_fields||[])])]);
}"
```

Expected: each pack prints a non-empty covered list — `goals` four fields, `media` six, `aesthetics` four. An empty list here means the guards are testing nothing regardless of what the suite reports.

- [ ] **Step 6: Commit**

```bash
git add backend/section_packs backend/tests/test_ui_schema.py frontend/src/__fixtures__/packs.json
git commit -m "feat: validate ui blocks and migrate the generic packs

meta_schema.json validated nothing inside ui, which was tolerable while ui
drove three optional packs and becomes silent data loss once it drives the
whole editing surface. Section nodes now reject unknown kinds and unknown
keys, and the three generic packs use the explicit form. The legacy flat
map still validates, so third-party packs keep loading."
```

---

### Task 6: Ship

- [ ] **Step 1: Verify the container**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
docker build -t mygist:wave2 .
docker run --rm --entrypoint sh mygist:wave2 -c 'ls /app/static/assets | wc -l'
```

Expected: build succeeds, two assets.

- [ ] **Step 2: Review the three sections in Storybook**

Convergence means appearance can shift. Start Storybook, open `Sections/SectionRenderer`, and confirm the Populated and Empty stories render as before — rows, badges, expansion, suggestion chips on `aesthetics`.

```bash
cd frontend && npm run storybook -- --no-open --ci &
SB_PID=$!
sleep 40
curl -s -o /dev/null -w 'storybook:%{http_code}\n' http://localhost:6006/
```

Kill by PID when done. Report what you saw.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feature/wave-2-renderer-kit
gh pr create --title "feat: replace GenericSectionEditor with the renderer kit (wave 2)" --body "..."
```

Write the body yourself from what actually happened: what the kit is, that parity is proven by the wave 1 guards passing unchanged, that the legacy `ui` form still validates, and anything that surprised you.

- [ ] **Step 4: Wait for CI, then hand over for merge**

```bash
gh pr checks --watch
```

Merging is the human's call.

---

## What this wave does not do

- Implement `kind: "fields"`, `kind: "strings"`, or nested `children` — waves 4-5.
- Touch any of the seven bespoke editors, or `App.jsx` beyond the one import and one call site.
- Change any stored JSON.
- Reconcile `entities` with storage keys — the deferred backend project.

## Rollback

Reverting the merge restores `GenericSectionEditor` and the legacy `ui` blocks together. No data migration is involved, so a revert is clean.
