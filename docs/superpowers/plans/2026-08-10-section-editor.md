# Section Editor Implementation Plan — migration slice 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the section editor's single card-with-nested-headings layout with the prototype's structure — a page title block, eyebrow bands over one card per subsection, capped at two visual tiers — and replace the per-flush "Saved" toast with a per-card save tick.

**Architecture:** `SectionRenderer` stops rendering an outer `Card`. It emits a title block, then partitions the section's top-level children into *runs* (each group is a run; each consecutive stretch of leaves is a run), 32px apart. A group's run is an `EyebrowBand` over its children; every leaf — grouped or not — becomes a `SubsectionCard`. The `data-band` anchor contract slice 1 landed is untouched: it stays on the depth-0 wrapper, which is now the run wrapper for a group and the card wrapper for a leaf.

**Tech Stack:** React 18, Tailwind 3, shadcn/Radix, Vitest + Testing Library.

**Parent spec:** `docs/superpowers/specs/2026-08-10-app-migration-umbrella-design.md` (slice 2 of 5). Design source: `docs/superpowers/specs/2026-08-04-mygist-app-reshaped-design.md` § "Section editor".

**Branch:** continues on `design/app-migration-umbrella`. Slice 1 is not yet merged to `main`, so a separate slice-2 branch would stack on unmerged work for no benefit; the landing strategy's "own short-lived branch" is satisfied by merging slice 1 and slice 2 in order from this branch.

## Global Constraints

- Geometry, measured from Figma file `Ti7FlZLYOvX3goyvfypJBk`, page `04 Section editor` (`1:5`): card radius **12**, padding **16**, header→content gap **12**, 1px border, no shadow at rest. Gap **16** inside a run, **32** between runs. Title block gap **4**.
- Type: page title `featured-3` = 20/600; card title `headline-2` = 16/600; in-card group label `headline-3` = 14/600; eyebrow label `caption-2` = 13 Geist **Mono**, +0.06em, uppercase, muted; page description and counts `caption-1`/13 Geist **Regular** — a count is never mono.
- **Exactly two visual tiers.** Band, then card. A third manifest level renders as a `headline-3` label inside its parent's card, never a third tier.
- Card header right slot is decided by the denominator, not by judgement: `fields` → `x of y` (or `Nothing yet` at zero); `list`/`strings` → `+ Add`; `scalar` → nothing.
- Heading levels follow the tree, not the tier: page title `h2`, depth-0 node and eyebrow label `h3`, depth-1 node `h4`. This is the existing depth rule, so today's level assertions keep passing.
- `data-band` and `scroll-mt-[60px]` stay on the depth-0 wrapper and stay derived from `outline(pack)` — the ids the editor stamps must remain exactly the ids the rail lists.
- Motion tokens only (`duration-fast|medium|slow`, `ease-*`). Under `prefers-reduced-motion` the CSS block collapses `animation-duration` to 1ms, so **no timed sequence may be driven by a CSS animation** — JS timers own any hold.
- Test command: `npm test -- --project unit` from `frontend/`. Every task ends green.
- No new dependency.

---

## File Structure

| File | Responsibility |
|---|---|
| Create `frontend/src/renderers/fillSummary.js` | Pure `fillSummary(node, value)` → `{ filled, total }` for a `fields` node |
| Create `frontend/src/renderers/EyebrowBand.jsx` | The mono uppercase label plus its hairline rule |
| Create `frontend/src/renderers/SubsectionCard.jsx` | The card shell: header (title, right slot, save tick) and content. Holds the local `SaveTick`. |
| Modify `frontend/src/renderers/SectionRenderer.jsx` | Title block, run partitioning, band/card dispatch, two-tier cap, tick bookkeeping |
| Modify `frontend/src/renderers/FieldsRenderer.jsx` | Nothing in this slice (see Out of scope) |
| Modify `frontend/src/App.jsx` | Drop the per-flush success toast; pass `savedAt`; track dirty so the header chip stops lying |
| Modify `frontend/src/globals.css` | `save-tick-in` keyframe |
| Modify `frontend/src/tailwind.config.js` | `borderRadius.xl` so 12px is derived from `--radius`, not a coincidence |
| Modify `frontend/src/renderers/SectionRenderer.test.jsx` | Delete the separator suite; add band/card/run/tier/count/tick suites |

---

## What the prototype actually says (read from the file, not inferred)

Resolved node IDs, for the checklist and for anyone re-checking a value:

| Thing | Node |
|---|---|
| Page | `04 Section editor` `1:5` |
| `Desktop — Profile` / its content column | `114:110` / `114:149` (VERTICAL, gap 32) |
| `Desktop — Preferences` / content | `109:2` / `109:41` |
| `Desktop — Goals` / content | `114:495` / `114:534` |
| Title block, title text, description text | `114:354`, `114:355` (20 Geist SemiBold), `114:356` (13 Geist Regular) |
| Run frames ("Group N"), gap 16 | `287:620`, `287:621` (Profile); `287:617`–`287:619` (Preferences); `287:622` (Goals) |
| `EyebrowBand` instance / main / label / rule | `109:98` / `61:22` / `I109:98;61:23` (13 Geist Mono, +6%, UPPER) / `I109:98;61:24` (1px) |
| `SubsectionCard — Personal Information` (radius 12, pad 16, gap 12, 1px) | `114:363`; header `114:364`; title `114:365`; `FillSummary` `114:366` = `6 of 7` |
| `SubsectionCard — Education` (header 36 tall, holds `Add`) | `114:413`; header `114:414`; `Add` `315:765` |
| Two-across rows | Profile `114:442` (Emails `114:449`, Links `114:465`); Preferences `109:101` → `109:102`, `109:137`; `110:278` |
| Full-width run containing a `fields` node | `287:618` (Communication: `110:84`, `110:114`, `110:134`) |
| Untitled node's card — title repeats the pack title | `114:602`, header `114:603`, title `114:604` = "Goals" |
| `Mobile — Preferences` (single column, cards 358) | `116:390`, content `116:405` |
| Save tick | `08 Motion` `1:9` |

Three rules the design spec states loosely and this plan fixes:

**1. An eyebrow band is a `group` node, and only a `group`.** Contract 2 of the umbrella spec says a top-level `list`/`strings`/`fields` "renders as its own band", which reads as an eyebrow label. The file says otherwise: Profile's Personal Information, Education, Work Experience and Languages are bare cards with no eyebrow, and Preferences' Likes & Dislikes likewise. The word *band* is overloaded — an anchor/rail destination versus a visual eyebrow. Both hold: a top-level leaf **is** a rail destination and carries `data-band` on its card; it just has no eyebrow label. The anchor contract is unchanged.

**2. Runs, and one deliberate divergence.** Figma groups the content column into frames of gap 16, separated by 32. Two of those frames trail a leaf card under the previous group's eyebrow (Languages under `CONTACT & LINKS`, Likes & Dislikes under `LEARNING STYLE`). That reads as membership the manifest does not have, and it contradicts the rail, which lists those two as siblings of the group above. **A leaf that follows a group starts its own run**, so the eyebrow's scope visibly ends where the group ends. Divergence from the file: 16px → 32px in two places.

**3. When cards go two-across.** Nothing in the spec says. Derived from all four groups in the file: `CODE STYLE` (3 × `strings`) wraps 2+1, `CONTACT & LINKS` (2 × `list`) and `LEARNING STYLE` (2 × `strings`) pair, and `COMMUNICATION` — the only group holding a `fields` node — is full width throughout. So: **a group's cards go two-across, unless the group holds a `fields` child, in which case the whole group is single column.** A `fields` card carries its own two-column field grid and would collapse to one column in half a row. Rejected alternative: "grid always, `fields` spans the row" — it reproduces Communication's `fields` card but then pairs `When I'm feeling...` with `Response format`, which the file stacks. Ungrouped leaves are always full width. Breakpoint `lg` (1024px), not `md`: at 768px the content column is ~480px and two cards would be 230px each.

---

### Task 1: `fillSummary` — the `fields` denominator

**Files:**
- Create: `frontend/src/renderers/fillSummary.js`
- Test: `frontend/src/renderers/fillSummary.test.js`

**Interfaces:**
- Produces: `fillSummary(node, value) → { filled: number, total: number }`

Pure, and in its own file rather than inside `SubsectionCard`, because "what counts as filled" is the kind of rule that gets re-answered differently in a second place. `// @vitest-environment node` — it imports nothing.

- [ ] **Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fillSummary } from "./fillSummary";

const node = { kind: "fields", fields: ["tone", "detail_level", "locale"] };

describe("fillSummary", () => {
  it("counts the declared keys that hold a value", () => {
    expect(fillSummary(node, { tone: "direct", locale: "en-GB" })).toEqual({ filled: 2, total: 3 });
  });

  it("counts nothing for a value that is not an object", () => {
    // An MCP client can leave any shape behind; FieldsRenderer already renders
    // empty controls for one rather than throwing.
    expect(fillSummary(node, "direct")).toEqual({ filled: 0, total: 3 });
    expect(fillSummary(node, undefined)).toEqual({ filled: 0, total: 3 });
  });

  it("does not count blank, whitespace, empty-array or null values as filled", () => {
    expect(fillSummary(node, { tone: "", detail_level: "   ", locale: null })).toEqual({
      filled: 0,
      total: 3,
    });
    expect(fillSummary({ kind: "fields", fields: ["a"] }, { a: [] })).toEqual({ filled: 0, total: 1 });
  });

  it("counts false and 0 as filled, because a switch that is off is answered", () => {
    expect(fillSummary({ kind: "fields", fields: ["a", "b"] }, { a: false, b: 0 })).toEqual({
      filled: 2,
      total: 2,
    });
  });

  it("ignores stored keys the node does not declare", () => {
    // `communication.default` is seeded with keys that predate the node.
    expect(fillSummary(node, { tone: "direct", surprise: "x" })).toEqual({ filled: 1, total: 3 });
  });

  it("reports a total of 0 for a node declaring no fields", () => {
    expect(fillSummary({ kind: "fields" }, {})).toEqual({ filled: 0, total: 0 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

`npm test -- --project unit src/renderers/fillSummary.test.js` → FAIL, no such module.

- [ ] **Step 3: Implement**

```js
// How full a `fields` node is, for the count in its card header ("6 of 7").
//
// `false` and `0` count as filled: a switch that is off and a number that is
// zero are both answers. Only absence counts as unfilled -- undefined, null,
// an empty or whitespace-only string, an empty array.
export function fillSummary(node, value) {
  const fields = node?.fields ?? [];
  const stored = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const filled = fields.filter((f) => isFilled(stored[f])).length;
  return { filled, total: fields.length };
}

function isFilled(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
```

- [ ] **Step 4: Green, then commit**

```bash
git add frontend/src/renderers/fillSummary.js frontend/src/renderers/fillSummary.test.js
git commit -m "feat(editor): fillSummary, the denominator a fields card header reports"
```

---

### Task 2: `EyebrowBand`

**Files:**
- Create: `frontend/src/renderers/EyebrowBand.jsx`, `frontend/src/renderers/EyebrowBand.test.jsx`

**Interfaces:**
- Produces: `<EyebrowBand title info depth />` — an `h3` label plus a rule that fills the remaining width.

The rule is `aria-hidden` decoration (`role="separator"` would put it in the a11y tree as a divider between things it is actually labelling). The label keeps its `InfoButton` if the group declares `info`, so no group loses its explainer in the restructure.

- [ ] **Step 1: Write the failing test** — asserts: renders the title as a level-3 heading; the label is `font-mono`, `uppercase`, `tracking-[0.06em]`, `text-[13px]`, muted; a rule element exists and is `aria-hidden`; an `info` prop renders the `About <title>` button in the same row; no `info` renders no button.

- [ ] **Step 2: Run it, watch it fail.**

- [ ] **Step 3: Implement**

```jsx
export function EyebrowBand({ title, info }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className="shrink-0 font-mono text-[13px] uppercase tracking-[0.06em] text-muted-foreground">
        {title}
      </h3>
      <InfoButton info={info} title={title} />
      <span aria-hidden="true" data-eyebrow-rule className="h-px flex-1 bg-border" />
    </div>
  );
}
```

- [ ] **Step 4: Green, then commit.**

---

### Task 3: `SubsectionCard`, and the radius it needs

**Files:**
- Create: `frontend/src/renderers/SubsectionCard.jsx`, `frontend/src/renderers/SubsectionCard.test.jsx`
- Modify: `frontend/tailwind.config.js`

**Interfaces:**
- Produces: `<SubsectionCard title info depth action count tick children />`
  - `depth` picks `h3` (0) or `h4` (1+) — the existing rule, so level assertions survive.
  - `action` is the portal slot element (a list node's `+ Add` lands in it), rendered right-aligned.
  - `count` is a rendered node or null (the `fields` summary).
  - `tick` is `null | "in" | "out"`.

`rounded-xl` is 12px in Tailwind's defaults, but only by coincidence here — the config overrides `lg`/`md`/`sm` off `--radius` and leaves `xl` alone. Add it so the concentric scale is derived:

```js
borderRadius: {
  lg: "var(--radius)",
  md: "calc(var(--radius) - 2px)",
  sm: "calc(var(--radius) - 4px)",
  // radius-xl. The card is the outermost of the concentric three (12 holds 8
  // holds 6), so it derives from --radius like the others rather than relying
  // on Tailwind's default 0.75rem happening to equal 12px.
  xl: "calc(var(--radius) + 4px)",
},
```

- [ ] **Step 1: Write the failing test** — asserts: the title renders at `h3` for depth 0 and `h4` for depth 1; geometry classes `rounded-xl border p-4` and a 12px header/content gap; `action` renders inside the header row, not the content; `count` likewise; children render in the content region; no `action`/`count` renders no empty right slot; `tick: "in"` renders `[data-save-tick]` and `tick: null` does not; the tick is `aria-hidden`; `tick: "out"` carries `opacity-0` and `data-motion="fade"`.

- [ ] **Step 2: Run it, watch it fail.**

- [ ] **Step 3: Implement** — one file, with a local `SaveTick`:

```jsx
// The tick is decoration: the header's save chip is the role="status" that
// announces, and a second announcement per card would be noise. data-motion
// ="fade" keeps a 100ms fade under prefers-reduced-motion, where every other
// duration collapses; the 1.2s hold is a JS timer in SectionRenderer, because
// the reduced-motion block forces animation-duration to 1ms and would
// otherwise erase the hold entirely.
function SaveTick({ phase }) {
  return (
    <span
      data-save-tick
      data-motion="fade"
      aria-hidden="true"
      className={`ml-1 inline-flex text-primary transition-opacity duration-medium ${
        phase === "out" ? "opacity-0" : "animate-save-tick-in opacity-100"
      }`}
    >
      <Check className="h-4 w-4" />
    </span>
  );
}
```

Card shell: `<Card className="rounded-xl p-4 shadow-none">` containing a header row (`flex items-start justify-between gap-2 min-h-9`) and `<div className="mt-3">{children}</div>`. `min-h-9` (36px) is the header height the `+ Add` button sets in the file (`114:414`); a card without a button keeps the same header height so cards side by side align their content.

- [ ] **Step 4: Add the keyframe to `globals.css`**

```css
/* Save tick, per card: scales 0.8 to 1 with a fade. The design spec's 160ms is
   off-scale and an entrance, so the snap rule takes the longer token (200ms).
   Entrance only -- the hold and the exit are owned by JS and a transition, so
   the reduced-motion block's animation-duration: 1ms cannot swallow them. */
@keyframes save-tick-in {
  from { opacity: 0; transform: scale(0.8); }
  to   { opacity: 1; transform: scale(1); }
}
.animate-save-tick-in {
  animation: save-tick-in var(--duration-medium) var(--ease-decelerate);
}
```

- [ ] **Step 5: Green, then commit.**

---

### Task 4: the restructure — title block, runs, bands, cards

**Files:**
- Modify: `frontend/src/renderers/SectionRenderer.jsx`
- Modify: `frontend/src/renderers/SectionRenderer.test.jsx`

The load-bearing task. Delete the outer `Card`/`CardHeader`/`CardContent` and `withSeparators` entirely; every `<hr>` goes with them (the eyebrow's own rule replaces them, and a 32px gap does the rest).

**Interfaces:**
- Consumes: `outline(pack)` (unchanged), `EyebrowBand`, `SubsectionCard`, `HeaderActionSlotContext` (unchanged — the portal seam stays exactly as `headerActionSlot.jsx` argues, only the slot's DOM position moves from `NodeHeading` to the card header).
- Produces: unchanged props; `data-band` / `scroll-mt-[60px]` on depth-0 wrappers; `data-ui-node` on every node wrapper.

Run partitioning, the one piece of real logic:

```js
// Each group is its own run; each consecutive stretch of leaves is its own run.
// 32px between runs, 16px inside one. A leaf that FOLLOWS a group starts a new
// run rather than joining it -- see the plan's divergence note: the file trails
// two such cards under the previous eyebrow, which reads as membership the
// manifest does not have and the rail does not show.
function toRuns(nodes) {
  const runs = [];
  nodes.forEach((node, index) => {
    const last = runs[runs.length - 1];
    if (node.kind === "group" || !last || last.kind === "group") {
      runs.push({ kind: node.kind === "group" ? "group" : "leaves", items: [{ node, index }] });
    } else {
      last.items.push({ node, index });
    }
  });
  return runs;
}
```

- [ ] **Step 1: Write the failing tests** in a new `describe("the section's structure")`:
  - the pack title renders as an `h2` above everything, with the description beneath it, and **not** inside any card;
  - each titled top-level node gets its own card — `preferences` yields five card elements, one per top-level child plus one per grouped child, and no card contains another;
  - a group renders an eyebrow band whose label is its title, and its children as cards after it;
  - an ungrouped leaf renders no eyebrow (`preferences`' Likes & Dislikes has a card and no `[data-eyebrow-rule]` of its own);
  - `screen.queryAllByRole("separator")` is empty for `preferences` — the rules are gone;
  - an untitled node's card is titled with the **pack** title (`goals`), and both headings are present (h2 page title + h3 card title): the duplication is the design's, `114:604`;
  - runs: the wrapper of a leaf run and of a group run are siblings separated by the 32px class, and cards inside a run by 16px;
  - a list node's `+ Add` lands in its own card header — for an untitled node, in that card's header, no longer in a page-level row;
  - the untitled node's `InfoButton` moves with it into the card header.

- [ ] **Step 2: Run them, watch them fail.** Also run the whole file and record which existing tests break — expect the separator suite (delete it), the "only one heading" case in `describe("node.title")` (now two: page title plus the untitled node's card title), and any test reaching for the pack title's row.

- [ ] **Step 3: Implement** the new render: title block (`space-y-1` : `h2` `text-xl font-semibold` + `p` `text-[13px] text-muted-foreground`), then `space-y-8` over runs, each run `space-y-4`, a group run rendering `<EyebrowBand>` then its children in `grid gap-4` (`lg:grid-cols-2` unless the group holds a `fields` child — Task 5), each leaf a `SubsectionCard`.

- [ ] **Step 4: Delete the separator suite and fix the fallout**, one edit per broken test, each with a comment naming why the expectation moved.

- [ ] **Step 5: Full suite green, then commit.**

---

### Task 5: two-across inside a group

**Files:** Modify `SectionRenderer.jsx`, `SectionRenderer.test.jsx`

- [ ] **Step 1: Write the failing test** — `preferences`' `Code Style` (3 × `strings`) and `profile`'s `Contact & Links` (2 × `list`) carry `lg:grid-cols-2`; `preferences`' `Communication` (holds a `fields` node) does not; a run of ungrouped leaves never does.
- [ ] **Step 2: Run it, watch it fail** (Task 4 ships single column).
- [ ] **Step 3: Implement** — `const twoUp = run.items.every(({ node }) => node.kind !== "fields")` on group runs only, with the derivation and the rejected alternative in a comment.
- [ ] **Step 4: Green, commit.**

---

### Task 6: the two-tier cap

**Files:** Modify `SectionRenderer.jsx`, `SectionRenderer.test.jsx`

No shipping manifest nests a group inside a group, so this is the defensive path that stops a future manifest inventing a third tier. A group at depth ≥ 1 renders as **one** card titled with the group's title, its children stacked inside under `headline-3` labels — never a second eyebrow, never a card inside a card.

- [ ] **Step 1: Write the failing test** with a synthetic pack (group → group → two `strings` nodes): the inner group's title renders as a `headline-3`-styled label *inside* the outer card; exactly one card exists for that branch; no second `[data-eyebrow-rule]`; the nested nodes' values still bind against the section root; a fourth level flattens into the same card rather than nesting further.
- [ ] **Step 2: Run it, watch it fail** — today's recursion would emit a nested block, and after Task 4 it would emit a card inside a card.
- [ ] **Step 3: Implement** — in `renderSectionNode`, a `group` at `depth >= 1` returns a labelled `<div>` (`h4`/`h5` by depth, `text-sm font-semibold`) plus its children rendered at `depth + 1` with `inCard` true, so leaves render bare rather than as cards.
- [ ] **Step 4: Green, commit.**

---

### Task 7: the `fields` count in the card header

**Files:** Modify `SectionRenderer.jsx`, `SectionRenderer.test.jsx`

- [ ] **Step 1: Write the failing test** — `preferences`' `Default Communication Style` with all three keys set shows `3 of 3` in its card header; with one set, `1 of 3`; with none, `Nothing yet`; the count is **not** `font-mono`; a `list` node's header shows `+ Add` and no count; `profile`'s Personal Information reports against its declared key set. Assert position: the count is inside the card's header element, opposite the title.
- [ ] **Step 2: Run it, watch it fail.**
- [ ] **Step 3: Implement** — `fields` nodes only: `const { filled, total } = fillSummary(node, value)`, rendering `total === 0 ? null : filled === 0 ? "Nothing yet" : `${filled} of ${total}`` in `text-[13px] text-muted-foreground tabular-nums`. `tabular-nums` and not mono: the design spec is explicit that a count is a sentence fragment, and mono is what made the old onboarding summaries read as debug output.
- [ ] **Step 4: Green, commit.**

---

### Task 8: save feedback — the tick replaces the toast

**Files:** Modify `frontend/src/App.jsx`, `SectionRenderer.jsx`, `App.test.jsx`, `SectionRenderer.test.jsx`

Three changes, one behaviour:

1. `saveFile` stops toasting on success. The failure toast stays — a failure genuinely needs interrupting.
2. `SectionRenderer` takes `savedAt` and shows the tick on the card whose node last changed.
3. The header chip stops lying. `saveState` is currently `isSaving ? "saving" : isAutosaveEnabled ? "saved" : "unsaved"`, so with autosave off the chip reads "Unsaved" forever — including immediately after a successful `Save now`. Track a dirty flag instead: set on a change while autosave is off, cleared on a successful save.

- [ ] **Step 1: Write the failing tests**
  - `SectionRenderer`: editing a field then bumping `savedAt` renders `[data-save-tick]` inside **that** node's card and no other; the tick is gone after the hold (fake timers, 1600ms); a `savedAt` change with no preceding edit renders no tick (the remount-after-a-previous-save case); a second edit elsewhere then another `savedAt` moves the tick rather than showing two.
  - `App`: an autosave flush produces no "Saved" toast; a failed flush still produces a destructive one; with autosave off, a change makes the chip read "Unsaved" and a successful `Save now` makes it read "Saved".
- [ ] **Step 2: Run them, watch them fail.**
- [ ] **Step 3: Implement.** In `SectionRenderer`, a `lastEditedRef` written by the per-node `onValue` wrapper, and an effect keyed on `savedAt`:

```js
// 200ms in, 1.2s hold, 200ms out -- the spec's "plays once". The timers live
// here rather than in the card so the tick can move between cards without one
// card's unmount cancelling another's.
useEffect(() => {
  if (!savedAt || !lastEditedRef.current) return;
  const key = lastEditedRef.current;
  setTick({ key, phase: "in" });
  const out = setTimeout(() => setTick({ key, phase: "out" }), 1400);
  const done = setTimeout(() => setTick(null), 1600);
  return () => { clearTimeout(out); clearTimeout(done); };
}, [savedAt]);
```

`savedAt` is App's existing `lastSaved`, which already updates on every successful `saveFile` **and** `saveAll` — so `Save now` ticks the card you were editing, which is correct.

- [ ] **Step 4: Green, commit.**

---

### Task 9: the anchor contract, re-proved end to end

**Files:** Modify `SectionRenderer.test.jsx`; add one case to `frontend/src/App.test.jsx`

The restructure moved every wrapper `data-band` sits on. The existing `describe("scroll-spy anchors")` covers the old shape; this proves the new one, and proves it against the rail rather than against itself.

- [ ] **Step 1: Write the failing tests**
  - for each of `profile`, `preferences`, `lifestyle`, `knowledge`: the set of `[data-band]` values rendered equals `outline(pack).map(b => b.id)`, in order;
  - a group's `data-band` is on the wrapper that holds the eyebrow **and** its cards, so scrolling to it lands on the label;
  - a top-level leaf's `data-band` is on its card wrapper;
  - no `[data-band]` inside a card (a grouped child is not a rail destination);
  - every anchor still carries `scroll-mt-[60px]`;
  - in `App.test.jsx`: clicking the rail's Contact & Links scrolls to the element the band names, through the real editor (the existing scroll tests use `education`, a leaf — this covers the group wrapper).
- [ ] **Step 2: Run, watch fail where they should** (some will already pass — mark those as guards in a comment rather than claiming them).
- [ ] **Step 3: Fix whatever they catch.**
- [ ] **Step 4: Green, commit.**

---

### Task 10: fidelity checklist and the preview

**Files:** Modify this plan (fill the checklist), `docs/superpowers/specs/2026-08-04-mygist-app-reshaped-design.md` (record the run divergence under "Prototype divergences")

- [ ] **Step 1:** `npm test -- --project unit` green; `node design/app-contrast.mjs` exits 0 (from the repo root).
- [ ] **Step 2:** Rebuild the Docker preview at the slice head and confirm in the served bundle what unit tests cannot prove: the `save-tick-in` keyframe, `rounded-xl` resolving to `calc(var(--radius) + 4px)`, `lg:grid-cols-2`, `tracking-[0.06em]`, and the absence of the deleted `<hr>` rules.
- [ ] **Step 3:** Walk the checklist below at `http://127.0.0.1:8100` against the Figma frames, then hand it to the owner.

| Property | Value | Figma node | ✓ |
|---|---|---|---|
| Page title | 20/600 Geist, above the first card, not in it | `114:355` | |
| Page description | 13/400, muted | `114:356` | |
| Title block → first run | 32px | `114:149` | |
| Between runs | 32px | `114:149` | |
| Inside a run | 16px | `287:620` | |
| Eyebrow label | 13 Geist Mono, +0.06em, uppercase, muted | `I109:98;61:23` | |
| Eyebrow rule | 1px, border colour, fills the row | `I109:98;61:24` | |
| Card | radius 12, 1px border, no shadow, padding 16 | `114:363` | |
| Card header → content | 12px | `114:363` | |
| Card title | 16/600 Geist | `114:365` | |
| Header right — `fields` | `6 of 7`, 13/400 Geist Regular, **not** mono | `114:366` | |
| Header right — `list`/`strings` | ghost `+ Add`, 36 tall | `315:765` | |
| Two-across group | `CODE STYLE`, `CONTACT & LINKS`, `LEARNING STYLE` | `109:101`, `114:442`, `110:278` | |
| Single-column group (holds `fields`) | `COMMUNICATION` | `287:618` | |
| Mobile 390 | one column, cards 358, same 16/32 rhythm | `116:405` | |
| Save tick | check, scale 0.8→1 + fade 200ms, holds 1.2s, fades 200ms, once | `1:9` | |
| Reduced motion | tick still appears and holds; no scale; 100ms fade | — | |

---

## Out of scope, and why

**Field patterns** — the design spec's "Field patterns" subsection (chip paste splitting on comma/newline, list rows expanding inline to edit, search appearing past six items, remove behind an overflow menu, `fields` labels at `headline-3`). The umbrella spec's decomposition assigns slice 2 four things — eyebrow bands, one card per subsection, the two-tier cap, save feedback — and field patterns are none of them. They change editing behaviour rather than page structure, and they land in `ListRenderer.jsx` (36KB, 83KB of tests) and `StringsRenderer.jsx`. Folding them in would roughly triple this slice and delay a shippable merge. **They are not dropped:** they become slice 2b, to be specced after this merges. Recorded here because the umbrella spec's table is the only other place they could have gone, and it does not mention them.

Also out: the `Add` icon-colour rule and 44px touch-target caveat (Figma-only concerns), `FillSummary`'s mono treatment in the prototype (superseded here — the code renders the count in Geist Regular per the spec's own rule), and anything in slices 3–5.

## Self-review

- **Spec coverage.** Eyebrow bands → Tasks 2, 4. One card per subsection → Tasks 3, 4. Two-tier cap → Task 6. Save feedback → Tasks 3, 8. Header right slot table → Task 7 (`fields`), existing portal (`list`/`strings`), nothing for `scalar`. Empty states per card → already shipped (the six-point checklist round); untouched here. Field patterns → deferred above, explicitly.
- **Placeholders.** None: every value is a measured Figma number with a node ID, and every test lists its assertions.
- **Type consistency.** `fillSummary(node, value) → {filled,total}` is consumed only in Task 7 with those names. `SubsectionCard`'s `tick` is `null | "in" | "out"` in Tasks 3 and 8. `savedAt` is App's `lastSaved` in Task 8, nowhere else. `toRuns` returns `{kind: "group"|"leaves", items:[{node,index}]}`, consumed in Tasks 4 and 5 — `index` is the unfiltered position, which is what `outline()` keys `data-band` by and what the React key derives from.
- **Risk.** The one real hazard is the 124-test `SectionRenderer.test.jsx`: 48 references to `hr` mean the separator suite must be deleted rather than adjusted, and deleting tests is how coverage silently goes missing. Task 4 Step 4 requires a comment on every moved expectation, and Task 9 re-proves the anchor contract from `outline()` rather than trusting the old assertions.
