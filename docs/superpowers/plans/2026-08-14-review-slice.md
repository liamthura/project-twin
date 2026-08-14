# Review Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the review queue by how much thought each item needs — inbox items become one dense line with expand-in-place, observations keep their card — behind `Tabs` that carry live counts.

**Architecture:** `ProposalsPanel.jsx` (404 lines) splits into five files. A pure `proposalSummary.js` decides what one row's single line says. `InboxRow.jsx`, `ObservationCard.jsx` and `PromoteDialog.jsx` each own one surface. The panel keeps fetching, polling and `act()`.

**Tech Stack:** React 18, Vite, Vitest + Testing Library, Tailwind 3, shadcn/ui over Radix.

Spec: `docs/superpowers/specs/2026-08-14-review-slice-design.md`

## Global Constraints

- **Test baseline before Task 1: `869 tests / 45 files`** on `npx vitest run --project unit`, run from `frontend/`. Bare `npm test` adds the Storybook browser project and reports `871 / 46`. Use the unit number unless a step says otherwise.
- Backend baseline: `1001 passed, 1 skipped` from `backend/` via `pytest`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Work on a branch off `main`. Do not push.
- Do not change `frontend/package.json`. Every component this plan needs already exists.
- Entity names and field keys are snake_case in the schema and are rendered as words. Reuse `humanise`, never re-implement it.
- **If a step's stated expectation does not match what you observe, stop and report it. Do not work around it.** The brief may be wrong; that is worth more than a workaround.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/components/proposalSummary.js` | new — pure: what one inbox row's line says |
| `src/components/proposalSummary.test.js` | new — table test over the real fixture |
| `src/components/InboxRow.jsx` | new — one dense row, its expanded detail |
| `src/components/ObservationCard.jsx` | new — the observation card |
| `src/components/PromoteDialog.jsx` | new — dialog, selects, `promotionTargets` |
| `src/components/PromoteDialog.test.jsx` | new — includes the Select-in-Dialog test |
| `src/components/ProposalsPanel.jsx` | shrinks — fetch, poll, `act()`, tabs, empty states |
| `src/components/ProposalsPanel.test.jsx` | updated alongside |
| `src/lib/api.js` | `proposalCount()` returns the whole breakdown |
| `src/App.jsx` | `onCounts` replaces `onResolved` |
| `backend/server.py` | `propose_update` docstring only |

---

### Task 1: `proposalSummary` — what a row's one line says

A proposal stores only new values, never old ones, so the arrow in `tone → direct` is the identifier and the one other field that carries a value — not a before and after.

**Files:**
- Create: `frontend/src/components/proposalSummary.js`
- Create: `frontend/src/components/proposalSummary.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `humanise(key: string) => string`
  - `renderValue(value: any) => string`
  - `findEntitySpec(entity: string, packs: array) => object | null`
  - `proposalSummary(row: object, packs: array) => { lead: string, trail: string, extra: number }`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/proposalSummary.test.js`:

```js
import { describe, it, expect } from "vitest";
import { proposalSummary } from "./proposalSummary";

const PACKS = [
  {
    key: "lifestyle",
    entities: {
      hobby: { actions: ["add"], required: ["name"], optional: ["notes"], identifier: "name" },
      hobby_specific: {
        actions: ["add"], required: ["hobby_name", "specific"],
        identifier: "specific", parent: "hobby_name",
      },
    },
  },
  {
    key: "profile",
    entities: {
      preference: { actions: ["add", "update"], required: ["key"], optional: ["category", "value"], identifier: "key" },
      work_experience: {
        actions: ["add", "update"], identifier: "company",
        required: ["company", "role", "type", "period"], optional: ["location"],
      },
    },
  },
];

const row = (entity, data) => ({ id: "x", kind: "entity", action: "add", entity, data });

describe("proposalSummary", () => {
  it("shows just the identifier when nothing else carries a value", () => {
    expect(proposalSummary(row("hobby", { name: "bouldering" }), PACKS))
      .toEqual({ lead: "bouldering", trail: "", extra: 0 });
  });

  it("arrows the identifier to the one other field that has a value", () => {
    expect(proposalSummary(row("preference", { key: "tone", value: "direct" }), PACKS))
      .toEqual({ lead: "tone", trail: "direct", extra: 0 });
  });

  it("puts the parent first, because the parent is the context", () => {
    // Checked before the single-other-field rule on purpose. That rule alone
    // would render `bouldering -> climbing`, backwards.
    expect(proposalSummary(
      row("hobby_specific", { hobby_name: "climbing", specific: "bouldering" }), PACKS))
      .toEqual({ lead: "climbing", trail: "bouldering", extra: 0 });
  });

  it("counts what it cannot show when several fields carry values", () => {
    expect(proposalSummary(row("work_experience", {
      company: "Acme", role: "lead", type: "full-time", period: "2021-2024",
    }), PACKS)).toEqual({ lead: "Acme", trail: "", extra: 3 });
  });

  it("ignores fields that are present but empty", () => {
    expect(proposalSummary(row("preference", { key: "tone", value: "", category: null }), PACKS))
      .toEqual({ lead: "tone", trail: "", extra: 0 });
  });

  it("falls back to the first value when the entity resolves to no pack", () => {
    // A disabled pack, a renamed entity, a proposal left over from an older
    // schema. A blank row would look broken, and it is still approvable.
    expect(proposalSummary(row("domain", { name: "Datadog", level: "advanced" }), PACKS))
      .toEqual({ lead: "Datadog", trail: "", extra: 1 });
  });

  it("reads snake_case values as words", () => {
    expect(proposalSummary(row("preference", { key: "detail_level", value: "high" }), PACKS))
      .toEqual({ lead: "detail level", trail: "high", extra: 0 });
  });

  it("survives a row with no data at all", () => {
    expect(proposalSummary({ entity: "hobby", data: {} }, PACKS))
      .toEqual({ lead: "", trail: "", extra: 0 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend && npx vitest run --project unit src/components/proposalSummary.test.js
```

Expected: fails to resolve `./proposalSummary`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/proposalSummary.js`:

```js
/**
 * What one inbox row says on its single line.
 *
 * A proposal stores only the values being proposed, never the ones on record,
 * so the arrow in `tone -> direct` is not a before and after. It is the
 * identifier and the one other field that carries a value. Entities that
 * declare a parent read the other way round -- `climbing -> bouldering` --
 * because there the parent is the context and the identifier is the thing
 * being proposed.
 */

// Entity names and field keys are snake_case in the schema. A person reads this
// surface, so they get read as words.
export function humanise(key) {
  return String(key ?? "").replace(/_/g, " ");
}

export function renderValue(value) {
  if (Array.isArray(value)) return value.map(humanise).join(", ");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([k, v]) => `${humanise(k)}: ${v}`)
      .join(" · ");
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  return humanise(value);
}

// Present means "worth showing": an empty string, an empty array and a null are
// all fields the agent left alone, and counting them would put `+2 more` on a
// row that is hiding nothing.
function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value === null || value === undefined) return false;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return String(value).trim() !== "";
}

export function findEntitySpec(entity, packs) {
  for (const pack of packs || []) {
    const spec = pack?.entities?.[entity];
    if (spec) return spec;
  }
  return null;
}

export function proposalSummary(row, packs) {
  const data = row?.data || {};
  const entries = Object.entries(data).filter(([, v]) => present(v));
  const spec = findEntitySpec(row?.entity, packs);

  if (!spec?.identifier) {
    const [first, ...rest] = entries;
    return { lead: first ? renderValue(first[1]) : "", trail: "", extra: rest.length };
  }

  const { identifier, parent } = spec;
  const lead = present(data[identifier]) ? renderValue(data[identifier]) : "";
  const others = entries.filter(([k]) => k !== identifier && k !== parent);

  if (parent && present(data[parent])) {
    return { lead: renderValue(data[parent]), trail: lead, extra: others.length };
  }
  if (others.length === 1) {
    return { lead, trail: renderValue(others[0][1]), extra: 0 };
  }
  return { lead, trail: "", extra: others.length };
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd frontend && npx vitest run --project unit src/components/proposalSummary.test.js
```

Expected: 8 passed.

- [ ] **Step 5: Add the fixture table test**

Append to `proposalSummary.test.js`:

```js
import packs from "@/__fixtures__/packs.json";

describe("proposalSummary against every shipped entity", () => {
  const specs = packs.flatMap((p) =>
    Object.entries(p.entities || {}).map(([name, spec]) => [name, spec]),
  );

  it("has entities to check", () => {
    expect(specs.length).toBeGreaterThan(30);
  });

  it.each(specs)("summarises %s without throwing", (name, spec) => {
    if (!spec.identifier) return;
    const data = {};
    for (const f of spec.required || []) data[f] = `${f}-value`;
    const out = proposalSummary({ entity: name, data }, packs);
    expect(typeof out.lead).toBe("string");
    expect(out.lead).not.toBe("");
    expect(out.extra).toBeGreaterThanOrEqual(0);
  });

  it("reaches all three branches with real entities", () => {
    const reached = new Set();
    for (const [name, spec] of specs) {
      if (!spec.identifier) continue;
      const data = {};
      for (const f of spec.required || []) data[f] = `${f}-value`;
      const { trail, extra } = proposalSummary({ entity: name, data }, packs);
      if (spec.parent) reached.add("parent");
      else if (trail) reached.add("single-other");
      else if (extra > 0) reached.add("counted");
      else reached.add("identifier-only");
    }
    expect(reached).toContain("parent");
    expect(reached).toContain("single-other");
    expect(reached).toContain("counted");
    expect(reached).toContain("identifier-only");
  });
});
```

- [ ] **Step 6: Run the file, then the whole suite**

```bash
cd frontend && npx vitest run --project unit src/components/proposalSummary.test.js
cd frontend && npx vitest run --project unit
```

Expected: the file passes. Whole suite: **880 tests / 46 files** (869 + 11 new).

If the "reaches all three branches" test fails, **stop and report which branch is unreached** — it means the rule does not fit the shipped manifests and the spec needs revisiting, not the test loosening.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/proposalSummary.js frontend/src/components/proposalSummary.test.js
git commit -m "feat(review): a pure rule for what one inbox row says

$(printf '%s' 'A proposal stores only what is being proposed, never what is on
record, so `tone -> direct` is the identifier and the one other field
carrying a value. Entities declaring a parent read the other way round,
and that case is checked first: the single-other-field rule alone would
render `bouldering -> climbing`, backwards.

Pure, so it is tested against every entity in the shipped fixture rather
than through a rendered row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 2: Extract `ObservationCard`

A pure move. No behaviour changes, and `ProposalsPanel.test.jsx` must pass untouched.

**Files:**
- Create: `frontend/src/components/ObservationCard.jsx`
- Modify: `frontend/src/components/ProposalsPanel.jsx`

**Interfaces:**
- Consumes: `humanise`, `renderValue` from Task 1.
- Produces: default export `ObservationCard({ row, busy, canPromote, onPromote, onDelete })`.

- [ ] **Step 1: Create the component**

```jsx
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { humanise } from "./proposalSummary";

/**
 * An observation keeps its card.
 *
 * Promoting one is a real decision about where something belongs, so it gets
 * the surface that supports a decision: who proposed it, how many tools
 * noticed, the agent's reasoning and the user's own words. The inbox row
 * next door is a two-second approve, and it is dense for the same reason.
 */
export default function ObservationCard({ row, busy, canPromote, onPromote, onDelete }) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{row.proposed_by}</Badge>
        {row.seen_count > 1 && (
          <span className="text-xs text-muted-foreground">seen {row.seen_count}×</span>
        )}
        {row.section_hint && (
          // "suggested", not an arrow: this is where the agent thinks it
          // belongs, and you choose the real destination on promote. An arrow
          // read as a promise the promote dialog then broke.
          <span className="text-xs text-muted-foreground">
            suggested: {humanise(row.section_hint)}
          </span>
        )}
      </div>

      <p className="text-sm font-medium">{row.note}</p>
      <p className="text-sm text-muted-foreground">{row.rationale}</p>
      {row.evidence && (
        <blockquote className="border-l-2 pl-3 text-sm italic text-muted-foreground">
          “{row.evidence}”
        </blockquote>
      )}

      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !canPromote} onClick={onPromote}>
          Promote
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onDelete}>
          Delete
        </Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Use it from the panel**

In `ProposalsPanel.jsx`, import it, and replace the `row.kind === "entity" ? ... : ...` note branch so observations render `<ObservationCard>`. Keep the entity branch exactly as it is for now — Task 5 replaces it.

The panel passes:

```jsx
<ObservationCard
  key={row.id}
  row={row}
  busy={busy === row.id}
  canPromote={promotable.length > 0}
  onPromote={() => openPromote(row)}
  onDelete={() =>
    act(row.id, "Deleted — it will not be proposed again", () => rejectProposal(row.id))}
/>
```

Delete the now-unused note branches from the panel's card body.

- [ ] **Step 3: Run the suite**

```bash
cd frontend && npx vitest run --project unit
```

Expected: **880 / 46**, unchanged from Task 1. `ProposalsPanel.test.jsx` is not edited in this task. If any of its tests fail, the extraction changed behaviour — fix the component, not the test.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ObservationCard.jsx frontend/src/components/ProposalsPanel.jsx
git commit -m "refactor(review): observations move to their own card component

$(printf '%s' 'A pure move ahead of the inbox row becoming something else
entirely. ProposalsPanel.test.jsx is untouched and still passes, which
is the point of doing this as its own commit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 3: Extract `PromoteDialog`, selects unchanged

Still a pure move. The raw `<select>` elements come across as they are so this commit changes structure only — Task 4 changes behaviour.

**Files:**
- Create: `frontend/src/components/PromoteDialog.jsx`
- Modify: `frontend/src/components/ProposalsPanel.jsx`
- Modify: `frontend/src/components/ProposalsPanel.test.jsx:4` (import path only)

**Interfaces:**
- Produces:
  - `promotionTargets(pack) => [{ entity, field }]` (named export, moved verbatim)
  - default export `PromoteDialog({ promoting, promotable, onChange, onCancel, onConfirm })` where `promoting` is `{ row, section, entity, text } | null`.

- [ ] **Step 1: Move `promotionTargets` and the dialog**

Move `promotionTargets` verbatim, its docstring included. Move the `<Dialog>` block from `ProposalsPanel.jsx:206-284` verbatim, including `selectClass`, swapping the inline `setPromoting` calls for `onChange`:

```jsx
export default function PromoteDialog({ promoting, promotable, onChange, onCancel, onConfirm }) {
  const section = promotable.find((s) => s.key === promoting?.section);
  const field = section?.targets.find((t) => t.entity === promoting?.entity)?.field;

  return (
    <Dialog open={Boolean(promoting)} onOpenChange={(o) => !o && onCancel()}>
      {/* ...the existing content, with onChange((p) => ({ ...p, ... })) ... */}
    </Dialog>
  );
}
```

The panel keeps `promoting` state and `confirmPromote`, and renders:

```jsx
<PromoteDialog
  promoting={promoting}
  promotable={promotable}
  onChange={setPromoting}
  onCancel={() => setPromoting(null)}
  onConfirm={confirmPromote}
/>
```

`confirmPromote` stays in the panel because it calls `act`.

- [ ] **Step 2: Update the test's import**

`ProposalsPanel.test.jsx:4` becomes two lines:

```js
import ProposalsPanel from "./ProposalsPanel";
import { promotionTargets } from "./PromoteDialog";
```

- [ ] **Step 3: Run the suite**

```bash
cd frontend && npx vitest run --project unit
```

Expected: **880 / 46**. Every promote test still passes — they drive raw `<select>` elements, which have not changed yet.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/PromoteDialog.jsx frontend/src/components/ProposalsPanel.jsx frontend/src/components/ProposalsPanel.test.jsx
git commit -m "refactor(review): the promote dialog moves out, selects intact

$(printf '%s' 'Structure only. The raw selects come across unchanged so this commit
is provably behaviour-free, and the next one can be read as nothing but
the control swap.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 4: shadcn `Select`, and a test that renders it inside the real Dialog

This deletes the last two raw `<select>` elements in the app.

`SelectControl` from `components/controls.jsx` is deliberately **not** reused: it takes a flat array of strings, renders enum icons, and appends a "Clear" item. Sections need `value=key, label=title` pairs and the field is required.

**Files:**
- Modify: `frontend/src/components/PromoteDialog.jsx`
- Create: `frontend/src/components/PromoteDialog.test.jsx`
- Modify: `frontend/src/components/ProposalsPanel.test.jsx:179-203` (the two `selectOptions` tests)

**Interfaces:** unchanged from Task 3.

- [ ] **Step 1: Swap the controls**

Replace both `<select>` blocks and delete `selectClass`. The accessible-name pattern is `Label htmlFor` + `SelectTrigger id`, copied from the sort control at `renderers/ListRenderer.jsx:431-434`, which is what keeps `getByLabelText(/section/i)` working:

```jsx
<div className="space-y-1.5">
  <Label htmlFor="promote-section">Section</Label>
  <Select
    value={promoting?.section || ""}
    onValueChange={(value) => {
      const next = promotable.find((s) => s.key === value);
      onChange((p) => ({ ...p, section: value, entity: next?.targets[0]?.entity ?? "" }));
    }}
  >
    <SelectTrigger id="promote-section">
      <SelectValue placeholder="Choose a section" />
    </SelectTrigger>
    <SelectContent>
      {promotable.map((s) => (
        <SelectItem key={s.key} value={s.key}>{s.title}</SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>

<div className="space-y-1.5">
  <Label htmlFor="promote-entity">Type</Label>
  <Select
    value={promoting?.entity || ""}
    onValueChange={(value) => onChange((p) => ({ ...p, entity: value }))}
  >
    <SelectTrigger id="promote-entity">
      <SelectValue placeholder="Choose a type" />
    </SelectTrigger>
    <SelectContent>
      {(section?.targets || []).map((t) => (
        <SelectItem key={t.entity} value={t.entity} className="capitalize">
          {humanise(t.entity)}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

Import from `@/components/ui/select`: `Select, SelectContent, SelectItem, SelectTrigger, SelectValue`.

- [ ] **Step 2: Rewrite the two tests that drive the old selects**

In `ProposalsPanel.test.jsx`, `user.selectOptions(el, value)` no longer works — a Radix Select is a button, not a `<select>`. Replace with click-then-pick. The jsdom polyfills these need are already in `src/test/setup.js:85-95`.

```jsx
async function pick(user, dialog, labelText, optionName) {
  await user.click(within(dialog).getByLabelText(labelText));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

it("promotes into the entity you picked, under its own field", async () => {
  const user = userEvent.setup();
  const dialog = await openPromoteDialog(user);
  await pick(user, dialog, /section/i, "Lifestyle");
  await pick(user, dialog, /^type$/i, "value");
  await user.click(within(dialog).getByRole("button", { name: /^promote$/i }));
  await waitFor(() =>
    expect(api.promoteProposal).toHaveBeenCalledWith(
      "p2", "value", { value: "Wants the recommendation first." }),
  );
});

it("lets you edit the wording before it becomes real data", async () => {
  const user = userEvent.setup();
  const dialog = await openPromoteDialog(user);
  await pick(user, dialog, /section/i, "Knowledge");
  const field = within(dialog).getByLabelText(/^title$/i);
  await user.clear(field);
  await user.type(field, "Recommendation first");
  await user.click(within(dialog).getByRole("button", { name: /^promote$/i }));
  await waitFor(() =>
    expect(api.promoteProposal).toHaveBeenCalledWith(
      "p2", "mental_tab", { title: "Recommendation first" }),
  );
});
```

The option list is portalled outside the dialog, so options are found with `screen`, not `within(dialog)`.

- [ ] **Step 3: Write the Select-inside-Dialog test**

Create `frontend/src/components/PromoteDialog.test.jsx`. This exists because in slice 2b, five clean task reviews shipped an overflow menu that could not open a dialog — no test in the repo rendered two Radix layer components together.

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PromoteDialog, { promotionTargets } from "./PromoteDialog";

const PROMOTABLE = [
  { key: "lifestyle", title: "Lifestyle", targets: [{ entity: "hobby", field: "name" }, { entity: "value", field: "value" }] },
  { key: "knowledge", title: "Knowledge", targets: [{ entity: "mental_tab", field: "title" }] },
];

function Harness({ onConfirm = vi.fn(), onCancel = vi.fn() }) {
  const [promoting, setPromoting] = useState({
    row: { id: "p2", note: "Wants the recommendation first." },
    section: "lifestyle", entity: "hobby", text: "Wants the recommendation first.",
  });
  return (
    <PromoteDialog
      promoting={promoting} promotable={PROMOTABLE}
      onChange={setPromoting} onCancel={onCancel}
      onConfirm={() => onConfirm(promoting)}
    />
  );
}

describe("a Select inside the real Dialog", () => {
  // Radix keeps module-scope state in react-focus-scope and
  // react-dismissable-layer. When a Dialog and a layer component inside it
  // resolve to different copies, the inner one's teardown restores
  // `pointer-events: none` on the body and the dialog goes dead. npm ls says
  // react-select dedupes against react-dialog today; this is what keeps that
  // true when a dependency moves.
  it("picks an option and leaves the dialog usable", { timeout: 15000 }, async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByLabelText(/^type$/i));
    await user.click(await screen.findByRole("option", { name: "value" }));

    expect(within(dialog).getByLabelText(/^type$/i)).toHaveTextContent("value");
    expect(dialog.contains(document.activeElement)).toBe(true);
    // The dialog's own backdrop sets this. A second, unpaired copy of
    // dismissable-layer restores it to "none" instead of "".
    expect(document.body.style.pointerEvents).toBe("");

    await user.click(within(dialog).getByRole("button", { name: /^promote$/i }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ entity: "value" }));
  });
});
```

Add `import { useState } from "react";` at the top.

**The explicit `timeout` is required.** This class of failure hangs rather than going red, so without it a regression reports as silence.

- [ ] **Step 4: Run both files, then the suite**

```bash
cd frontend && npx vitest run --project unit src/components/PromoteDialog.test.jsx src/components/ProposalsPanel.test.jsx
cd frontend && npx vitest run --project unit
```

Expected: **881 / 47** (880 + 1 new test in 1 new file).

- [ ] **Step 5: Verify no raw selects remain**

```bash
cd frontend/src && grep -rn "<select" . | grep -v "\.test\."
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PromoteDialog.jsx frontend/src/components/PromoteDialog.test.jsx frontend/src/components/ProposalsPanel.test.jsx
git commit -m "feat(review): the promote dialog gets real selects

$(printf '%s' 'Two raw <select> elements sharing a hand-rolled class string become
shadcn Select. These were the last raw selects in the app.

Comes with a test that renders the Select inside the real Dialog. In
slice 2b an overflow menu that could not open a dialog passed five task
reviews, because nothing in the repo rendered two Radix layer components
together. That failure hangs rather than going red, so the test carries
an explicit timeout.

SelectControl was not reused: it takes flat strings and appends a Clear
item, and these are required key/title pairs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 5: The dense inbox row

**Files:**
- Create: `frontend/src/components/InboxRow.jsx`
- Modify: `frontend/src/components/ProposalsPanel.jsx`
- Modify: `frontend/src/components/ProposalsPanel.test.jsx`

**Interfaces:**
- Consumes: `proposalSummary`, `humanise`, `renderValue` from Task 1.
- Produces: default export `InboxRow({ row, packs, busy, onApprove, onReject })`.

- [ ] **Step 1: Write the component**

```jsx
import { useState, Fragment } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { proposalSummary, humanise, renderValue } from "./proposalSummary";

const ACTION_VERB = { add: "Add", update: "Update", remove: "Remove" };

/**
 * One inbox item, one line.
 *
 * Approving does not require expanding. The split from observations is by how
 * much thought an item needs, and a queue that makes a two-second decision
 * look like a considered one gets abandoned at the considered ones.
 *
 * `proposed_by` and `seen N×` live in the expanded detail because the line has
 * no room for them. On an observation they stay on the card face, where they
 * inform a decision the reader is about to make.
 */
export default function InboxRow({ row, packs, busy, onApprove, onReject }) {
  const [open, setOpen] = useState(false);
  const { lead, trail, extra } = proposalSummary(row, packs);

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-3 px-3 py-2 text-sm">
        <span className="w-16 shrink-0 font-medium">
          {ACTION_VERB[row.action] || row.action}
        </span>
        <span className="w-32 shrink-0 truncate text-muted-foreground">
          {humanise(row.entity)}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {lead}
          {trail && <span className="text-muted-foreground"> → </span>}
          {trail}
          {extra > 0 && (
            <span className="ml-2 text-xs text-muted-foreground">+{extra} more</span>
          )}
        </span>

        <Button size="sm" variant="ghost" disabled={busy} onClick={onApprove}
                aria-label={`Approve ${lead}`}>
          <Check className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onReject}
                aria-label={`Reject ${lead}`}>
          <X className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}
                aria-expanded={open} aria-label={`Details for ${lead}`}>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>
      </div>

      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{row.proposed_by}</Badge>
            {row.seen_count > 1 && (
              <span className="text-xs text-muted-foreground">seen {row.seen_count}×</span>
            )}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
            {Object.entries(row.data || {}).map(([field, value]) => (
              <Fragment key={field}>
                <dt className="text-muted-foreground">{humanise(field)}</dt>
                <dd className="min-w-0 break-words">{renderValue(value)}</dd>
              </Fragment>
            ))}
          </dl>
          <p className="text-sm text-muted-foreground">{row.rationale}</p>
          {row.evidence && (
            <blockquote className="border-l-2 pl-3 text-sm italic text-muted-foreground">
              “{row.evidence}”
            </blockquote>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Use it from the panel**

Replace the entity branch with `<InboxRow>`, passing `packs`. Delete the panel's now-unused `ACTION_VERB`, `renderValue`, `Fragment` import, and its `humanise` if nothing else in the file uses it.

- [ ] **Step 3: Update the panel's tests**

The approve and reject buttons are now icons with `aria-label`. `ENTITY` resolves to no pack when `packs` is not passed, so it summarises as `Datadog +1 more`.

Change these tests:

```jsx
// was: getByRole("button", { name: /^approve$/i })
await user.click(await screen.findByRole("button", { name: /^approve /i }));
// was: getByRole("button", { name: /^reject$/i })
await user.click(await screen.findByRole("button", { name: /^reject /i }));
```

`"shows the rationale and the evidence"`, `"renders the change as fields"`, `"reads snake_case keys as words"`, `"names the tool that proposed it"` and `"shows how many tools raised the same thing"` all now need the row expanded first. Add before their assertions:

```jsx
await user.click(await screen.findByRole("button", { name: /^details for /i }));
```

Add one new test for the collapsed line:

```jsx
it("says what the change is without being expanded", async () => {
  render(<ProposalsPanel packs={PACKS} />);
  // hobby's identifier is `name`, and `notes` is the one other field with a
  // value, so the line reads the identifier then what it becomes.
  api.listProposals.mockImplementation((kind) =>
    Promise.resolve(kind === "entity"
      ? [{ ...ENTITY, entity: "hobby", data: { name: "bouldering", notes: "twice a week" } }]
      : []),
  );
  expect(await screen.findByText(/bouldering/)).toBeInTheDocument();
  expect(screen.getByText(/twice a week/)).toBeInTheDocument();
  // The rationale is behind the chevron.
  expect(screen.queryByText(/Runs the on-call dashboards/)).not.toBeInTheDocument();
});
```

- [ ] **Step 4: Run the suite**

```bash
cd frontend && npx vitest run --project unit
```

Expected: **882 / 47**. If more than the listed tests fail, **stop and report** — the list is the plan's claim about what this change touches, and a longer list means the claim is wrong.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/InboxRow.jsx frontend/src/components/ProposalsPanel.jsx frontend/src/components/ProposalsPanel.test.jsx
git commit -m "feat(review): inbox items collapse to one line

$(printf '%s' 'Verb, entity, what the change is, approve, reject, expand. The chevron
opens the full field list, the rationale and the evidence in place, and
approving never requires opening it.

proposed_by and seen N× move into the expanded detail -- the line has no
room. Observations keep them on the card face, where they inform a
decision the reader is about to make.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 6: Tabs carrying counts

**Files:**
- Modify: `frontend/src/lib/api.js:463-468`
- Modify: `frontend/src/components/ProposalsPanel.jsx`
- Modify: `frontend/src/components/ProposalsPanel.test.jsx`

**Interfaces:**
- Produces: `proposalCount() => Promise<{ entity: number, note: number, total: number }>`; panel prop `onCounts(total: number)`.

- [ ] **Step 1: Widen `proposalCount`**

```js
// How many proposals are waiting, per queue. Unlike listProposals this does not
// mark rows seen, which is what makes it safe for a badge: a row marked seen
// loses its eviction protection, and a count that stripped that off an
// observation nobody had looked at would be a silent data loss.
async function proposalCount() {
  const data = await api("/proposals/count");
  return { entity: data?.entity ?? 0, note: data?.note ?? 0, total: data?.total ?? 0 };
}
```

It has no callers today, so widening it breaks nothing.

- [ ] **Step 2: Tabs in the panel**

```jsx
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { proposalCount } from "@/lib/api";

const [counts, setCounts] = useState({ entity: 0, note: 0, total: 0 });

const refreshCounts = useCallback(async () => {
  try {
    const next = await proposalCount();
    setCounts(next);
    onCounts?.(next.total);
  } catch {
    // A stale badge beats a broken panel.
  }
}, [onCounts]);
```

Call `refreshCounts()` beside `refresh(kind)` in both effects, and at the end of a successful `act()` in place of `onResolved?.()`.

```jsx
<Tabs value={kind} onValueChange={setKind}>
  <TabsList>
    {KINDS.map((k) => (
      <TabsTrigger key={k.key} value={k.key}>
        {k.label}
        {counts[k.key] > 0 && (
          <span className="ml-1.5 text-xs text-muted-foreground">{counts[k.key]}</span>
        )}
      </TabsTrigger>
    ))}
  </TabsList>
</Tabs>
```

`KINDS` keys are already `entity` and `note`, matching the endpoint.

- [ ] **Step 3: Update the tests**

Add `proposalCount: vi.fn(() => Promise.resolve({ entity: 1, note: 1, total: 2 }))` to the `@/lib/api` mock. Without it the panel throws on `api.proposalCount is not a function`.

Tab triggers are `role="tab"`, not `role="button"`:

```jsx
// was: getByRole("button", { name: /observations/i })
await user.click(screen.getByRole("tab", { name: /observations/i }));
```

Add:

```jsx
it("says how much is waiting in the queue you are not looking at", async () => {
  api.proposalCount.mockResolvedValue({ entity: 3, note: 2, total: 5 });
  render(<ProposalsPanel />);
  expect(await screen.findByRole("tab", { name: /inbox 3/i })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /observations 2/i })).toBeInTheDocument();
});

it("tells the app the new total, so the sidebar dot does not need its own fetch", async () => {
  const user = userEvent.setup();
  const onCounts = vi.fn();
  render(<ProposalsPanel onCounts={onCounts} />);
  await waitFor(() => expect(onCounts).toHaveBeenCalledWith(2));
  api.proposalCount.mockResolvedValue({ entity: 0, note: 1, total: 1 });
  await user.click(await screen.findByRole("button", { name: /^approve /i }));
  await waitFor(() => expect(onCounts).toHaveBeenCalledWith(1));
});
```

- [ ] **Step 4: Run the suite**

```bash
cd frontend && npx vitest run --project unit
```

Expected: **884 / 47**.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.js frontend/src/components/ProposalsPanel.jsx frontend/src/components/ProposalsPanel.test.jsx
git commit -m "feat(review): the tabs say how much is waiting

$(printf '%s' 'Two plain buttons become Tabs carrying counts, which gives
components/ui/tabs.jsx its first importer -- it has been in the repo
unused and was on the list to delete.

The counts come from /proposals/count, which already returned the
breakdown and already declines to mark rows seen. proposalCount() in
api.js had no callers and threw everything but `total` away; it now
returns the whole object.

onCounts replaces onResolved. Resolving used to make App fetch a number
the panel was about to fetch anyway.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 7: The empty state says why nothing is waiting

**Files:**
- Modify: `frontend/src/components/ProposalsPanel.jsx`
- Modify: `frontend/src/components/ProposalsPanel.test.jsx`

**Interfaces:**
- Consumes: `listConnectedApps()` from `lib/api.js`, returning `[{ id, clientId, clientName, scopes, createdAt }]`.
- Produces: panel prop `onOpenSettings()`.

- [ ] **Step 1: Fetch grants, but only when the queue is empty**

```jsx
// Must match auth/src/oauth.js and ConnectedApps.jsx exactly -- this is the
// wire value, not a label.
const PROPOSE = "persona:propose";

const [grants, setGrants] = useState(null);

// Only when there is nothing to review: a reader with proposals waiting never
// needs this line, and this is the one surface that already polls.
useEffect(() => {
  if (rows.length > 0 || grants !== null) return;
  let cancelled = false;
  listConnectedApps()
    .then((list) => { if (!cancelled) setGrants(list); })
    .catch(() => { if (!cancelled) setGrants([]); });
  return () => { cancelled = true; };
}, [rows.length, grants]);
```

Treating a failure as `[]` renders no extra line, which is what happens today.

- [ ] **Step 2: Render the two cases**

```jsx
{rows.length === 0 && (
  <EmptyState className="space-y-2">
    <p>Nothing waiting. Agents propose changes here as they notice them.</p>
    {grants?.length === 0 && (
      <p>
        Nothing is connected yet.{" "}
        <Button variant="link" className="h-auto p-0" onClick={onOpenSettings}>
          Connect an app
        </Button>
      </p>
    )}
    {grants?.length > 0 && !grants.some((g) => (g.scopes || []).includes(PROPOSE)) && (
      <p>
        {grants.length === 1
          ? `${grants[0].clientName} can read your persona but not suggest changes to it.`
          : "None of your connected apps can suggest changes to your persona."}{" "}
        <Button variant="link" className="h-auto p-0" onClick={onOpenSettings}>
          Review access
        </Button>
      </p>
    )}
  </EmptyState>
)}
```

- [ ] **Step 3: Wire `onOpenSettings` in `App.jsx`**

`App.jsx` already has `setShowConnectionSettings`. Pass `onOpenSettings={() => setShowConnectionSettings(true)}` to `<ProposalsPanel>`.

- [ ] **Step 4: Tests**

Add `listConnectedApps: vi.fn(() => Promise.resolve([]))` to the mock.

```jsx
describe("the empty state says why it is empty", () => {
  beforeEach(() => { api.listProposals.mockResolvedValue([]); });

  it("points at the connect flow when nothing is connected", async () => {
    api.listConnectedApps.mockResolvedValue([]);
    render(<ProposalsPanel />);
    expect(await screen.findByText(/nothing is connected yet/i)).toBeInTheDocument();
  });

  it("names the app that can read but not propose", async () => {
    api.listConnectedApps.mockResolvedValue([
      { id: "g1", clientId: "c1", clientName: "Claude Desktop", scopes: ["persona:read"] },
    ]);
    render(<ProposalsPanel />);
    expect(await screen.findByText(/Claude Desktop can read your persona but not suggest/i))
      .toBeInTheDocument();
  });

  it("says nothing extra when something can propose", async () => {
    api.listConnectedApps.mockResolvedValue([
      { id: "g1", clientId: "c1", clientName: "Cursor", scopes: ["persona:read", "persona:propose"] },
    ]);
    render(<ProposalsPanel />);
    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
    expect(screen.queryByText(/not suggest changes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing is connected/i)).not.toBeInTheDocument();
  });

  it("does not ask about connections while there is something to review", async () => {
    api.listProposals.mockImplementation((kind) =>
      Promise.resolve(kind === "entity" ? [ENTITY] : []));
    render(<ProposalsPanel />);
    await screen.findByRole("button", { name: /^approve /i });
    expect(api.listConnectedApps).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run the suite**

```bash
cd frontend && npx vitest run --project unit
```

Expected: **888 / 47**.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ProposalsPanel.jsx frontend/src/components/ProposalsPanel.test.jsx frontend/src/App.jsx
git commit -m "feat(review): an empty queue says which fix applies

$(printf '%s' 'Nothing connected and connected-but-read-only are different problems
with different fixes, so one line for both would misdirect half the
readers.

Grants live in the auth service behind a session cookie, and consent
rows carry no display name -- listConnectedApps() already resolves both.
It is called once, and only when the queue is empty, so it never runs
for a reader who has proposals waiting. A failure renders no extra line,
which is what happens today.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 8: App drops `onResolved`

**Files:**
- Modify: `frontend/src/App.jsx:375-400`, `:733-740`
- Modify: `frontend/src/App.test.jsx` if it asserts on the panel's props

**Interfaces:** consumes `onCounts` from Task 6.

- [ ] **Step 1: Swap the prop**

```jsx
<ProposalsPanel
  onViewSection={(section) => navigate(section, null)}
  onSectionChanged={refreshSection}
  onCounts={setPendingCount}
  onOpenSettings={() => setShowConnectionSettings(true)}
  sectionTitles={sectionTitles}
  packs={packs}
/>
```

- [ ] **Step 2: Leave the polling exception alone**

`App.jsx:390`'s `activeSection !== "review"` **stays**. It is what stops App polling the count while the panel is already polling it; removing it would mean two pollers, not one. `refreshPendingCount` also stays — it still runs for every other section.

- [ ] **Step 3: Run the suite**

```bash
cd frontend && npx vitest run --project unit
```

Expected: **888 / 47**.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "refactor(review): the panel reports the count it already has

$(printf '%s' 'onResolved made App fetch a number the panel was fetching anyway.
App keeps its own poller and its activeSection exception, which is what
stops the two of them polling at once.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 9: `propose_update` states the compact shape

A dense row only works if proposals arrive compact. Server-side narrowing is deferred to its own plan; this is the docstring half.

**Files:**
- Modify: `backend/server.py:3518-3562`

- [ ] **Step 1: Rewrite the KINDS and REQUIRED sections**

Keep everything else. `_example_data` at `server.py:2694` already documents this shape for `persona_modify`, so this aligns the two rather than inventing a rule.

```
    KINDS:
        entity -- typed and schema-valid; you know where it belongs.
            {kind: "entity", action: "add"|"update"|"remove", entity: "domain",
             data: {...}, rationale: "...", evidence: "...", confidence: 0.7}
            Call get_schema if unsure of the entity vocabulary.

    HOW MUCH TO SEND IN `data`:
        add    -- every required field, plus any optional field you actually
                  know. Do not invent values to fill the shape.
        update -- the identifier (and the parent, where the entity has one) to
                  locate the row, plus ONLY the fields that change. Resending
                  fields whose values you are not changing is the most common
                  mistake here, and the user sees the result: their review
                  queue shows a row full of values that are already on record.
        remove -- the identifier and parent only. Nothing else is read.

    REQUIRED ON EVERY PROPOSAL:
        rationale -- why this is durable, in your words. ONE SENTENCE. The user
            reads this while deciding, next to a dozen others, so it must be
            the reason and not a restatement of the change or a summary of the
            conversation.
        evidence -- the user's own words that prompted it. Quote them, briefly.
            If you cannot quote them, you have inferred too far and should not
            propose.
```

- [ ] **Step 2: Run the backend suite**

```bash
cd backend && pytest -q
```

Expected: **1001 passed, 1 skipped**, unchanged. Nothing asserts on this docstring's wording; if something does, **stop and report it**.

- [ ] **Step 3: Commit**

```bash
git add backend/server.py
git commit -m "docs(mcp): propose_update says how much to send

$(printf '%s' 'The tool never said how much data a proposal should carry, though
_example_data has documented exactly that for persona_modify all along:
update locates by identifier and sends only what changes.

This matters now that an inbox item is one line. An agent that resends
all eight fields of a work_experience to change one turns every row into
`+7 more`. rationale gets a length too -- one sentence -- because the
user reads it next to a dozen others.

Prose only works on models that follow it. Making the server narrow an
update against the stored record is deferred to its own plan; see the
spec for why it is a sub-slice rather than a bolt-on.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 10: Whole-slice verification

- [ ] **Step 1: Both suites, both projects**

```bash
cd frontend && npm test 2>&1 | tail -5
cd backend && pytest -q 2>&1 | tail -5
```

Expected: frontend **890 / 48** (888 unit + 2 Storybook, 47 + 1). Backend **1001 passed, 1 skipped**.

- [ ] **Step 2: Build**

```bash
cd frontend && npm run build
```

Expected: no errors.

- [ ] **Step 3: Confirm the dead files are alive**

```bash
cd frontend/src && grep -rn "ui/tabs" --include=*.jsx . | grep -v "ui/tabs.jsx"
cd frontend/src && grep -rn "proposalCount" . | grep -v "lib/api.js"
```

Expected: at least one hit each. Both were unused before this slice.

- [ ] **Step 4: Line count check**

```bash
wc -l frontend/src/components/ProposalsPanel.jsx frontend/src/components/InboxRow.jsx frontend/src/components/ObservationCard.jsx frontend/src/components/PromoteDialog.jsx frontend/src/components/proposalSummary.js
```

`ProposalsPanel.jsx` should be near 200, down from 404. If it is over 300, report it — the split did not land where the plan said.

---

## Self-Review

**Spec coverage.** Decomposition → Tasks 1-5. Tabs and counts → 6. Inbox row and the summary rule → 1, 5. Observations → 2. Promote dialog → 3, 4. Empty states → 7. `onCounts` → 6, 8. Docstring → 9. Select-in-Dialog test → 4. Fixture table test → 1. Narrowing → deferred in the spec, no task, deliberately.

**Placeholders.** None. Every code step carries its code.

**Type consistency.** `proposalSummary` returns `{lead, trail, extra}` in Tasks 1 and 5. `promotionTargets(pack) => [{entity, field}]` in Tasks 3 and 4, and `promotable` entries are `{key, title, targets}` in 3, 4 and 7. `proposalCount()` returns `{entity, note, total}` in 6 and is consumed as `counts[k.key]` where `KINDS` keys are `entity`/`note`. `onCounts(total)` in 6 and 8.

**Test arithmetic.** 869 → +11 (T1) → 880 → +1 (T4) → 881 → +1 (T5) → 882 → +2 (T6) → 884 → +4 (T7) → 888. Files 45 → 46 (T1) → 47 (T4). Both projects add 2 tests and 1 file: 890 / 48.
