# App Foundations Reconciliation & Add-Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the app redesign prototype's colour foundations into agreement with the token layer `main` shipped, replace the badge tint pattern that fails WCAG AA on four of six tones, and then land the four code defects the design round surfaced.

**Architecture:** Two phases with a hard boundary. Phase 0 changes the Figma file `Ti7FlZLYOvX3goyvfypJBk` plus documentation, and is verified by read-back and by a committed contrast script — no app code moves. Phase 1 changes `frontend/` and is verified by vitest. The two phases live on different branches because they have different bases (see **Branch strategy**).

**Tech Stack:** Figma Plugin API via `use_figma`; React 18, Tailwind 3, shadcn/ui, Radix Dialog; vitest + @testing-library/react; Node 20 for the contrast script.

## Global Constraints

- **Code is the authority for token values, not the prototype.** Every colour in Phase 0 is derived from `frontend/src/globals.css` on `main`, or from the Tailwind palette the app already uses in `frontend/src/components/controls.jsx`. Where they disagree, the prototype is wrong.
- **WCAG 2.1 AA thresholds:** `4.5` for normal text, `3.0` for large text (≥18.66px bold or ≥24px regular) and for UI component boundaries. Ratios are computed, never eyeballed.
- **`use_figma` rules that this file has already been bitten by** — all four are load-bearing:
  - Always load the `figma:figma-use` skill before calling `use_figma`, and pass `skillNames: "figma-use"`.
  - Call `setCurrentPageAsync` **at most once per invocation**; fan multi-page work out as parallel calls in one message.
  - Never use `figma.notify()`, `loadAllPagesAsync`, `setPluginData`, or `createImageAsync`. Colours are 0–1. `return` is the only output channel and must include every created/mutated node ID.
  - **`setBoundVariableForPaint` returns a NEW paint and silently discards a fractional `opacity` set on the source object.** Opacity must be applied as a *second* write. This cost two rounds of rework.
  - **A property-hidden or visibility-overridden instance sub-layer is unreachable** via `children`, `findAll`, and `getNodeByIdAsync`. Only `instance.overrides` reveals it.
  - After `setProperties`, **re-find child handles** — the pre-swap handle is invalid.
- **Figma file:** `Ti7FlZLYOvX3goyvfypJBk`. Colour collection `VariableCollectionId:4:2`, modes Light `4:0` / Dark `4:1`. Pages: `0:1` 00 Cover, `1:2` 01 Foundations, `1:3` 02 Components, `1:4` 03 Shell & Navigation, `1:5` 04 Section editor, `1:6` 05 Review, `1:7` 06 Onboarding, `1:8` 07 Auth & Settings, `1:9` 08 Motion.
- **Every page must be left in Light mode (`4:0`)** — this is how every prior round ended and how screenshots stay comparable.
- **Test command is `npm test -- --project unit`.** Unqualified `npm test` also runs the `storybook` project, which needs a Playwright browser that is not available in this environment. Baseline on `main`: **28 files, 627 tests, all passing.**
- **Commit trailer:** every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Branch strategy

The current branch `worktree-design+app-reshaped-redesign` is **docs-only** (two new files) and is being kept as-is by the owner's decision.

- **Phase 0 commits to the current branch**, in the worktree at `/Users/khantthura/Documents/ProjectL/project-twin/.claude/worktrees/design+app-reshaped-redesign`. It touches Figma, this plan, the spec, and one new file under `design/`.
- **Phase 1 needs a branch off `main`**, because `main` is 60+ commits ahead and already contains the `--link` token, the landing page, and the `ListRenderer.jsx` line that Phase 1 edits around. Create it from the main worktree:

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git checkout main && git pull
git checkout -b feat/add-dialog-and-header-action
```

Cherry-pick the Phase 0 commit that adds this plan file so the plan travels with the work.

---

## What changed under this prototype, and why Phase 0 exists

`main` merged `design/landing-page` as `97572d4`. That branch ran a contrast audit (`design/contrast-audit.md`) which found `--primary` doing two jobs with opposite requirements: a colour used as a **fill** wants to be darker so its label passes, while the same colour used as **text** wants to be lighter so it passes on the page. Dark `--primary` had been tuned for the text case, leaving white labels on every primary button at **3.69** — a real AA failure in the shipping app. The fix split the roles into `--primary` (fills) and `--link` (interactive text).

Three of those changes landed in code and none reached this prototype. Each was confirmed by converting the code's HSL back to RGB and matching it against the prototype's stored value:

| Token | Prototype holds | Code holds | Why it matters |
|---|---|---|---|
| `muted-fg` Light | `rgb(120,114,109)` = `25 5% 45%` | `25 5% 42%` = `rgb(113,106,102)` | the exact pre-audit value that failed at **4.10** on clay-tint and **4.36** on muted |
| `indigo` Dark | `rgb(92,123,250)` = `228 94% 67%` | fills `228 94% 62%` = `rgb(67,103,249)` | the value that put white button labels at **3.69** |
| `link` | **absent** | `--link`, exposed in `tailwind.config.js` | interactive text has no correct binding target |

Two further defects belong to the prototype alone:

- **Primary button labels bind to `card`** — white in Light, `rgb(26,26,25)` in Dark, i.e. near-black labels on indigo. Measured **3.77** in Dark. Latent only because every page is left in Light. The code is correct (`--primary-foreground` is always white); the landing file gained an `on-primary` token for exactly this and the app file never did.
- **The badge tint pattern is structurally unsound.** Each tone grounds itself in a 12% wash of its own label colour, which produces a very light ground while the label stays as light as the token is. Measured, four of six tones fail:

| Badge tone | Light | Dark |
|---|---|---|
| Neutral (`ink` on `muted`) | 16.03 | 14.24 |
| Primary (`indigo` on 12% `indigo`) | 4.71 | **4.06 FAIL** |
| Positive (`success` on 12% `success`) | **3.21 FAIL** | 6.74 |
| Critical (`destructive` on 12% `destructive`) | **4.49 FAIL** | **3.56 FAIL** |
| Warning (`warning` on 12% `warning`) | **2.52 FAIL** | 7.69 |
| Live (`verdigris` on `verdigris-tint`) | 4.55 | 4.95 |

The Warning tone at **2.52** is the worst pair in the file, and it was added in the previous round. Note which tone passes and why: **Live is the only one that uses a designed tint token rather than a wash of itself.** That is the fix, and the app code already does it — `VALUE_META` in `controls.jsx` uses three-part pairs like `border-amber-300 bg-amber-50 text-amber-800`, which measure 6.84 (amber), 5.21 (emerald) and 5.72 (rose). Phase 0 adopts that structure.

A useful side effect: moving every badge ground to a designed tint at **opacity 1** removes the fractional-opacity paint entirely, which retires the recurring drift bug where `clone()` and `setProperties` silently reset `0.12` → `1`.

### One boundary question, not a defect

`clay`, `verdigris` and both tints match code to the byte — no drift. But `main` comments them "Brand layer, marketing page only; the app reads the semantic names," while this redesign uses `clay` for the delegate offer and `verdigris` for Live badges. Task 4 records the conflict and proposes promoting both to app-sanctioned use; it does not change code. **This is the one item in the plan that needs an owner's ruling rather than an implementation.**

---

## File Structure

**Phase 0**

- Modify: Figma `Ti7FlZLYOvX3goyvfypJBk` — Colour collection (Task 1, 2), `Badge` set `58:23` (Task 2), `Button`/`Link`/`RailItem`/`RailSubItem`/`Tabs` sets and all nine pages (Task 3), `01 Foundations` specimen page (Task 4)
- Create: `design/app-contrast.mjs` — rerunnable ratio calculator for app pairs, mirroring the precedent of the committed `design/gradients/generate.py`
- Create: `design/app-contrast-audit.md` — the measured table, in the shape of `design/contrast-audit.md`
- Modify: `docs/superpowers/specs/2026-08-04-mygist-app-reshaped-design.md` — token table, badge treatment, the clay/verdigris boundary question
- Modify: `docs/superpowers/plans/2026-08-04-mygist-app-reshaped-figma.md` — recorded values and new node IDs

**Phase 1**

- Create: `frontend/src/renderers/AddEntryDialog.jsx` — the Add dialog, extracted from `ListRenderer` so one component owns the title copy, the description, the footer and the draft lifecycle. Three of the four code defects live here once it exists.
- Create: `frontend/src/renderers/AddEntryDialog.test.jsx`
- Modify: `frontend/src/renderers/ListRenderer.jsx` — consumes `AddEntryDialog`; count moves beside the facet bar
- Modify: `frontend/src/renderers/SectionRenderer.jsx` — `heading()` becomes a component with a right-hand action slot; the Card header gains the same slot for untitled nodes
- Modify: `frontend/src/renderers/renderNode.jsx` — threads `depth` and the header-action slot
- Modify: `frontend/src/renderers/ListRenderer.test.jsx`, `frontend/src/renderers/SectionRenderer.test.jsx`

---

# Phase 0 — Foundations reconciliation

## Task 1: Add `link` and `on-primary`; correct `muted-fg`, `indigo` and `indigo-tint`

**Files:**
- Modify: Figma `Ti7FlZLYOvX3goyvfypJBk`, Colour collection `VariableCollectionId:4:2`

**Interfaces:**
- Produces: two new variable IDs, returned as `{ linkId, onPrimaryId }`. Tasks 2 and 3 bind to them by ID, so those IDs must be recorded in the task's return value and copied into the plan's recorded-values list.

- [ ] **Step 1: Read the five target values back first, so the change is provable**

Load the `figma:figma-use` skill, then run:

```js
const ids = ['VariableID:4:7', 'VariableID:4:9', 'VariableID:4:10'];
const out = [];
for (const id of ids) {
  const v = await figma.variables.getVariableByIdAsync(id);
  const to255 = (c) => `rgb(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)})`;
  out.push({ id, name: v.name, Light: to255(v.valuesByMode['4:0']), Dark: to255(v.valuesByMode['4:1']) });
}
const cols = await figma.variables.getLocalVariableCollectionsAsync();
const names = cols.find(c => c.id === 'VariableCollectionId:4:2').variableIds;
const existing = [];
for (const id of names) { const v = await figma.variables.getVariableByIdAsync(id); existing.push(v.name); }
return { before: out, hasLink: existing.includes('link'), hasOnPrimary: existing.includes('on-primary'), existing };
```

Expected: `muted-fg` Light `rgb(120,114,109)`, `indigo` Dark `rgb(92,123,250)`, `indigo-tint` Dark `rgb(40,45,62)`, `hasLink: false`, `hasOnPrimary: false`. **If any value already differs, stop and re-derive — someone else has touched the file.**

- [ ] **Step 2: Apply the two corrections and the tint darkening**

```js
const c = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 });
const LIGHT = '4:0', DARK = '4:1';

const mutedFg = await figma.variables.getVariableByIdAsync('VariableID:4:7');
mutedFg.setValueForMode(LIGHT, c(113, 106, 102));   // 25 5% 42%, main's post-audit value

const indigo = await figma.variables.getVariableByIdAsync('VariableID:4:9');
indigo.setValueForMode(DARK, c(67, 103, 249));      // 228 94% 62%, fills only

// Darkened so the rail's active row and the Primary badge both clear AA in Dark.
// indigo-950 at 40% over card, which is the composite the app's chip classes produce.
const indigoTint = await figma.variables.getVariableByIdAsync('VariableID:4:10');
indigoTint.setValueForMode(DARK, c(28, 26, 45));

return { mutatedNodeIds: ['VariableID:4:7', 'VariableID:4:9', 'VariableID:4:10'] };
```

- [ ] **Step 3: Create `link` and `on-primary`**

`scopes` is set explicitly on both — the `ALL_SCOPES` default pollutes every property picker.

```js
const c = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 });
const LIGHT = '4:0', DARK = '4:1';
const col = await figma.variables.getVariableCollectionByIdAsync('VariableCollectionId:4:2');

const link = figma.variables.createVariable('link', col, 'COLOR');
link.setValueForMode(LIGHT, c(61, 93, 219));    // 228 69% 55% -- light needs no split
link.setValueForMode(DARK, c(97, 127, 250));    // 228 94% 68%
link.scopes = ['TEXT_FILL', 'STROKE_COLOR'];
link.description = 'Interactive text and the icons beside it. Never a fill -- that is indigo. Split from indigo because a colour used as a fill wants to be darker so its label passes, while the same colour as text wants to be lighter so it passes on the page.';

const onPrimary = figma.variables.createVariable('on-primary', col, 'COLOR');
onPrimary.setValueForMode(LIGHT, c(255, 255, 255));
onPrimary.setValueForMode(DARK, c(255, 255, 255));   // deliberately does NOT invert
onPrimary.scopes = ['TEXT_FILL', 'STROKE_COLOR'];
onPrimary.description = 'Labels and icons sitting on an indigo fill. Does not invert between modes: a Primary button is indigo in both, so its label is white in both. Binding these to `card` produced near-black labels on indigo in Dark, measured 3.77.';

return { createdNodeIds: [link.id, onPrimary.id], linkId: link.id, onPrimaryId: onPrimary.id };
```

- [ ] **Step 4: Verify by read-back**

Re-run Step 1's script. Expected: `muted-fg` Light `rgb(113,106,102)`, `indigo` Dark `rgb(67,103,249)`, `indigo-tint` Dark `rgb(28,26,45)`, `hasLink: true`, `hasOnPrimary: true`. Also confirm `link` Dark reads `rgb(97,127,250)` and `on-primary` reads `rgb(255,255,255)` in **both** modes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "design: split link from indigo, add on-primary, correct two stale token values

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Replace the badge 12% wash with designed tint/ink pairs

**Files:**
- Modify: Figma Colour collection `VariableCollectionId:4:2` (7 new variables)
- Modify: Figma `Badge` component set `58:23`, variants `58:12` Neutral, `58:14` Primary, `58:16` Positive, `58:18` Critical, `58:20` Live, `328:63` Warning
- Modify: every `Badge` instance across all nine pages that carries a `0.12` opacity override

**Interfaces:**
- Consumes: nothing from Task 1 (independent), but must run **after** Task 1 so `indigo-tint` Dark is already darkened — the Primary tone's Dark ratio depends on it.
- Produces: `{ tintIds: {success, warning, destructive}, inkIds: {indigo, success, warning, destructive} }`

**The target values.** Light values are the Tailwind shades the app's own `VALUE_META` chips already use; Dark values are `<hue>-950` at 40% over `card`, which is what the app's `dark:bg-<hue>-950/40` classes composite to, paired with `<hue>-300` text. All eight pairs were verified before this plan was written:

| Tone | Ink Light | Tint Light | Ink Dark | Tint Dark | Light | Dark |
|---|---|---|---|---|---|---|
| Primary | `rgb(61,93,219)` | `rgb(235,240,255)` | `rgb(165,180,252)` | `rgb(28,26,45)` | 4.87 | 8.53 |
| Positive | `rgb(4,120,87)` | `rgb(236,253,245)` | `rgb(110,231,183)` | `rgb(16,33,29)` | 5.21 | 10.96 |
| Critical | `rgb(185,28,28)` | `rgb(254,242,242)` | `rgb(252,165,165)` | `rgb(43,20,19)` | 5.91 | 9.13 |
| Warning | `rgb(146,64,14)` | `rgb(255,251,235)` | `rgb(252,211,77)` | `rgb(43,26,16)` | 6.84 | 11.58 |

Primary reuses the existing `indigo-tint` as its ground, so only three new tint variables are needed. Neutral and Live are already passing and are **not touched**.

- [ ] **Step 1: Create the three tint and four ink variables**

```js
const c = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 });
const LIGHT = '4:0', DARK = '4:1';
const col = await figma.variables.getVariableCollectionByIdAsync('VariableCollectionId:4:2');
const made = {};

const mk = (name, light, dark, scopes, description) => {
  const v = figma.variables.createVariable(name, col, 'COLOR');
  v.setValueForMode(LIGHT, light);
  v.setValueForMode(DARK, dark);
  v.scopes = scopes;
  v.description = description;
  made[name] = v.id;
  return v;
};

const GROUND = ['FRAME_FILL', 'SHAPE_FILL'];
const TEXT = ['TEXT_FILL', 'STROKE_COLOR'];
const why = 'Badge grounds are designed tints, not a 12% wash of the label colour. The wash failed AA on four of six tones (Warning measured 2.52). Opacity stays 1, which also retires the drift bug where clone() and setProperties reset a fractional opacity to 1.';

mk('success-tint',     c(236, 253, 245), c(16, 33, 29), GROUND, why);
mk('warning-tint',     c(255, 251, 235), c(43, 26, 16), GROUND, why);
mk('destructive-tint', c(254, 242, 242), c(43, 20, 19), GROUND, why);

const inkWhy = 'Badge label colour. Darker than the base token in Light and lighter in Dark, which is what lets a tinted pill clear 4.5 in both modes.';
mk('indigo-ink',      c(61, 93, 219),  c(165, 180, 252), TEXT, inkWhy);
mk('success-ink',     c(4, 120, 87),   c(110, 231, 183), TEXT, inkWhy);
mk('destructive-ink', c(185, 28, 28),  c(252, 165, 165), TEXT, inkWhy);
mk('warning-ink',     c(146, 64, 14),  c(252, 211, 77),  TEXT, inkWhy);

return { createdNodeIds: Object.values(made), made };
```

- [ ] **Step 2: Rebind the four failing Badge variants**

Note the two hazards in play: `setBoundVariableForPaint` returns a **new** paint that must be captured and reassigned, and the label handle must be re-found rather than reused. Opacity is written to `1` explicitly rather than left alone, because the existing paints carry `0.12`.

```js
const page = await figma.getNodeByIdAsync('1:3');
await figma.setCurrentPageAsync(page);

const byName = {};
const col = await figma.variables.getVariableCollectionByIdAsync('VariableCollectionId:4:2');
for (const id of col.variableIds) {
  const v = await figma.variables.getVariableByIdAsync(id);
  byName[v.name] = v;
}

// variant id -> [ground variable name, label variable name]
const MAP = {
  '58:14': ['indigo-tint', 'indigo-ink'],       // Tone=Primary
  '58:16': ['success-tint', 'success-ink'],     // Tone=Positive
  '58:18': ['destructive-tint', 'destructive-ink'], // Tone=Critical
  '328:63': ['warning-tint', 'warning-ink'],    // Tone=Warning
};

const mutated = [];
for (const [vid, [groundName, inkName]] of Object.entries(MAP)) {
  const variant = await figma.getNodeByIdAsync(vid);

  const g = variant.fills.map((p) => JSON.parse(JSON.stringify(p)));
  g[0] = figma.variables.setBoundVariableForPaint(g[0], 'color', byName[groundName]);
  g[0].opacity = 1;                        // second write -- the bind discards it
  variant.fills = g;

  const label = variant.findOne((n) => n.type === 'TEXT');   // re-found, not reused
  await figma.loadFontAsync(label.fontName);
  const l = label.fills.map((p) => JSON.parse(JSON.stringify(p)));
  l[0] = figma.variables.setBoundVariableForPaint(l[0], 'color', byName[inkName]);
  l[0].opacity = 1;
  label.fills = l;

  mutated.push(variant.id, label.id);
}
return { mutatedNodeIds: mutated };
```

- [ ] **Step 3: Verify the variants read back with opacity 1**

```js
const page = await figma.getNodeByIdAsync('1:3');
await figma.setCurrentPageAsync(page);
const set = await figma.getNodeByIdAsync('58:23');
const nameOf = async (id) => { const v = await figma.variables.getVariableByIdAsync(id); return v && v.name; };
const rows = [];
for (const v of set.children) {
  const lbl = v.findOne((n) => n.type === 'TEXT');
  const gp = v.fills[0], lp = lbl.fills[0];
  rows.push({
    variant: v.name,
    ground: await nameOf(gp.boundVariables?.color?.id), groundOpacity: gp.opacity ?? 1,
    ink: await nameOf(lp.boundVariables?.color?.id), inkOpacity: lp.opacity ?? 1,
  });
}
return rows;
```

Expected: the four rebound tones show the new variable names with `groundOpacity: 1` and `inkOpacity: 1`. Neutral still reads `muted`/`ink`; Live still reads `verdigris-tint`/`verdigris`. **Any `0.12` remaining is a failure.**

- [ ] **Step 4: Sweep instance-level opacity overrides across all nine pages**

Emit **nine parallel `use_figma` calls in a single message**, one per page ID (`0:1`, `1:2`, `1:3`, `1:4`, `1:5`, `1:6`, `1:7`, `1:8`, `1:9`), each with `PAGE` substituted.

**The predicate is scoped to Badge instances on purpose.** A blanket "normalise every fractional opacity" sweep would strip the deliberate 50% paint opacity off `Switch Off Disabled` and off the Button disabled variants — a regression, not a repair. Only instances of the `Badge` set `58:23` are touched, and only their ground and label paints.

```js
const page = await figma.getNodeByIdAsync('PAGE');
await figma.setCurrentPageAsync(page);

const BADGE_SET = '58:23';
const normalise = (node) => {
  if (!Array.isArray(node.fills) || !node.fills.length) return false;
  const needs = node.fills.some((p) => p.opacity !== undefined && p.opacity > 0 && p.opacity < 1);
  if (!needs) return false;
  const f = node.fills.map((p) => JSON.parse(JSON.stringify(p)));
  f.forEach((p) => { if (p.opacity > 0 && p.opacity < 1) p.opacity = 1; });
  node.fills = f;
  return true;
};

const fixed = [];
for (const inst of page.findAll((n) => n.type === 'INSTANCE')) {
  const main = await inst.getMainComponentAsync();
  // A variant's parent is its COMPONENT_SET; that is what identifies a Badge.
  if (!main || !main.parent || main.parent.id !== BADGE_SET) continue;
  if (normalise(inst)) fixed.push({ id: inst.id, part: 'ground', variant: main.name });
  const label = inst.findOne((n) => n.type === 'TEXT');
  if (label && normalise(label)) fixed.push({ id: label.id, part: 'label', variant: main.name });
}
figma.currentPage.setExplicitVariableModeForCollection('VariableCollectionId:4:2', '4:0');
return { page: page.name, fixed, count: fixed.length };
```

**Then confirm the sweep did not reach beyond badges.** Run one read-only check on page `1:3` verifying that `Switch Off Disabled` and every `State=Disabled` Button variant still carry a paint opacity of `0.5`. If any reads `1`, that is collateral damage — restore it before continuing.

- [ ] **Step 5: Screenshot every badge tone to confirm the pills read as pills**

Use `get_screenshot` on `58:23`. Expected: six pills, each with a pale ground and a legible darker label. A solid saturated pill with invisible text means an opacity write was lost.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "design: badge tones get designed tints instead of a 12% wash of themselves

Four of six tones failed AA -- Warning at 2.52. Grounds are now the same
tint/ink pairs the app's own chip classes use, at opacity 1, which also
retires the fractional-opacity drift bug.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Rebind interactive text to `link` and Primary labels to `on-primary`

**Files:**
- Modify: Figma `Button` set `56:40` (Ghost labels `56:31`, `56:33`, `56:35`, `56:37`; Primary labels in `55:2`, `56:2`, `56:4`, `56:6`)
- Modify: `Link` set `294:*` (labels `294:46`, `294:50`, `294:58`, `294:62`)
- Modify: `RailItem` set `75:55` (labels `75:30`, `75:34`, `75:40`, `75:44`), `RailSubItem` set `75:78` (label `75:73`), `Tabs` set `78:43` (labels `78:18`, `78:37`)
- Modify: local settings-tab text on `02 Components` — `173:30`, `173:47`, `173:64`, `194:30`, `194:51`, `194:72`, `194:93`
- Modify: any remaining `indigo`-bound TEXT across the other eight pages

**Interfaces:**
- Consumes: `linkId` and `onPrimaryId` from Task 1.
- Produces: a per-page census `{ page, rebound: [...], remainingIndigoText: [...] }` for Task 4's audit document.

**Scope, measured before this plan was written.** The `02 Components` page alone holds **29** `indigo`-bound TEXT nodes. Most are component-level, so instances follow automatically. Two exclusions matter:

- `58:15` (Badge `Tone=Primary` label) is **already handled by Task 2** — it becomes `indigo-ink`, not `link`. Do not touch it here.
- The 46 non-text `indigo` bindings are fills and strokes — focus rings, switch tracks, checkbox grounds, Primary button grounds, spinner strokes. **These stay `indigo`.** `indigo` is fills only, which is the whole point of the split.

Rebinding to `link` is not always sufficient. Measured, before and after:

| Pair | as `indigo` | as `link` |
|---|---|---|
| Ghost button on `paper` | 5.31 / 5.06 | 5.31 / **5.29** |
| Tabs + RailSubItem on `card` | 5.55 / 4.70 | 5.55 / **4.91** |
| RailItem Active on `indigo-tint` | 4.87 / **3.69 FAIL** | 4.87 / **3.86 FAIL** |

The rail's active row is fixed by Task 1's `indigo-tint` darkening, not by this task — `rgb(28,26,45)` lifts it to **4.80**. Verify that specific pair in Step 5 rather than assuming the rebind covered it.

- [ ] **Step 1: Rebind the component sets**

```js
const page = await figma.getNodeByIdAsync('1:3');
await figma.setCurrentPageAsync(page);
const col = await figma.variables.getVariableCollectionByIdAsync('VariableCollectionId:4:2');
const byName = {};
for (const id of col.variableIds) { const v = await figma.variables.getVariableByIdAsync(id); byName[v.name] = v; }

const TO_LINK = ['56:31','56:33','56:35','56:37',   // Button Ghost labels
                 '294:46','294:50','294:58','294:62', // Link set
                 '75:30','75:34','75:40','75:44',   // RailItem Active + Active Expanded
                 '75:73',                            // RailSubItem Current
                 '78:18','78:37',                    // Tabs active
                 '173:30','173:47','173:64',         // Settings tabs, 3-tab demo
                 '194:30','194:51','194:72','194:93']; // Settings tabs, 4-tab demo

const rebind = async (nodeId, variable) => {
  const n = await figma.getNodeByIdAsync(nodeId);
  if (!n) return { nodeId, missing: true };
  await figma.loadFontAsync(n.fontName);
  const f = n.fills.map((p) => JSON.parse(JSON.stringify(p)));
  const prevOpacity = f[0].opacity ?? 1;
  f[0] = figma.variables.setBoundVariableForPaint(f[0], 'color', variable);
  f[0].opacity = prevOpacity;      // preserves the disabled state's 0.5
  n.fills = f;
  return { nodeId, name: n.name, chars: n.characters.slice(0, 24), opacity: prevOpacity };
};

const done = [];
for (const id of TO_LINK) done.push(await rebind(id, byName['link']));

// Primary button labels were bound to `card`, which is near-black in Dark.
const primaryLabels = [];
const btn = await figma.getNodeByIdAsync('56:40');
for (const v of btn.children) {
  if (!/Variant=Primary/.test(v.name)) continue;
  const lbl = v.findOne((n) => n.type === 'TEXT');
  if (!lbl) continue;                                  // the Loading variant has none
  primaryLabels.push(await rebind(lbl.id, byName['on-primary']));
}
return { mutatedNodeIds: [...done, ...primaryLabels].filter(r => !r.missing).map(r => r.nodeId), done, primaryLabels };
```

**A `missing: true` entry means the node is property-hidden or visibility-overridden and is unreachable via `getNodeByIdAsync`.** Recover it through the owning instance's `overrides` array — do not skip it.

- [ ] **Step 2: Census the other eight pages for stragglers**

Emit **eight parallel calls in one message** for `0:1`, `1:2`, `1:4`, `1:5`, `1:6`, `1:7`, `1:8`, `1:9`:

```js
const page = await figma.getNodeByIdAsync('PAGE');
await figma.setCurrentPageAsync(page);
const INDIGO = 'VariableID:4:9';
const hits = [];
for (const n of page.findAll((n) => n.type === 'TEXT')) {
  if (!Array.isArray(n.fills)) continue;
  for (const p of n.fills) {
    if (p.boundVariables?.color?.id === INDIGO) {
      hits.push({ id: n.id, name: n.name, chars: n.characters.slice(0, 40), parent: n.parent?.name });
    }
  }
}
return { page: page.name, count: hits.length, hits };
```

- [ ] **Step 3: Rebind the stragglers**

For each page that returned a non-empty `hits`, run Step 1's `rebind` helper against those IDs with `byName['link']`, **one call per page**. Before rebinding, judge each hit: a heading or body word that merely happens to be indigo is not interactive text, and belongs to `ink` or stays as-is. Record any judgement calls in the return value so Task 4 can report them.

- [ ] **Step 4: Confirm no interactive text is left on `indigo`**

Re-run Step 2 across all nine pages in parallel. Expected: every page returns `count: 0`, except any node deliberately left as `indigo` in Step 3 and named in that step's return value.

- [ ] **Step 5: Screenshot the three pairs the numbers say were marginal**

Use `get_screenshot` on `75:55` (RailItem, active row on the darkened tint), `56:40` (Button, Primary label now white and Ghost label now `link`), and `294:*` (Link set). Then set the Colour collection's mode to Dark on a scratch frame, screenshot the rail and a Primary button, and **confirm the Primary label is white rather than near-black**. Return the collection to Light `4:0` before finishing.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "design: interactive text binds to link, Primary labels to on-primary

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Commit the contrast calculator, the app audit, and the doc corrections

**Files:**
- Create: `design/app-contrast.mjs`
- Create: `design/app-contrast-audit.md`
- Modify: `docs/superpowers/specs/2026-08-04-mygist-app-reshaped-design.md`
- Modify: `docs/superpowers/plans/2026-08-04-mygist-app-reshaped-figma.md`
- Modify: Figma `01 Foundations` page `1:2` — add `link`, `on-primary` and the seven new tone variables to the colour specimen

**Interfaces:**
- Consumes: Task 1's `linkId`/`onPrimaryId`, Task 2's `made` map, Task 3's census output.

- [ ] **Step 1: Write the calculator**

The landing audit was hand-written prose with no rerunnable artifact, which is why its numbers could not be checked against the app file. This one ships a script, following the precedent of the committed `design/gradients/generate.py`.

Create `design/app-contrast.mjs`:

```js
// Contrast ratios for every foreground/ground pair the APP uses, in both modes.
// The landing page has its own table in design/contrast-audit.md; this file
// covers the pairs that one never measured -- badge tones, the rail's active
// row, and the tinted pills.
//
// Run: node design/app-contrast.mjs
// Exits non-zero if any pair falls below its threshold, so it can gate CI.
const T = {
  Light: {
    paper: [250,250,249], card: [255,255,255], muted: [245,245,244], ink: [28,25,23],
    'muted-fg': [113,106,102], border: [231,229,228],
    indigo: [61,93,219], 'indigo-tint': [235,240,255], link: [61,93,219], 'on-primary': [255,255,255],
    clay: [228,123,78], 'clay-tint': [251,235,228],
    verdigris: [57,117,127], 'verdigris-tint': [233,241,242],
    success: [26,153,72], warning: [200,144,4], destructive: [202,43,43],
    'indigo-ink': [61,93,219], 'success-ink': [4,120,87],
    'destructive-ink': [185,28,28], 'warning-ink': [146,64,14],
    'success-tint': [236,253,245], 'destructive-tint': [254,242,242], 'warning-tint': [255,251,235],
  },
  Dark: {
    paper: [18,18,17], card: [26,26,25], muted: [36,36,35], ink: [245,245,244],
    'muted-fg': [168,162,159], border: [42,42,40],
    indigo: [67,103,249], 'indigo-tint': [28,26,45], link: [97,127,250], 'on-primary': [255,255,255],
    clay: [222,133,94], 'clay-tint': [60,40,32],
    verdigris: [77,165,178], 'verdigris-tint': [28,46,48],
    success: [51,204,107], warning: [244,185,37], destructive: [225,51,51],
    'indigo-ink': [165,180,252], 'success-ink': [110,231,183],
    'destructive-ink': [252,165,165], 'warning-ink': [252,211,77],
    'success-tint': [16,33,29], 'destructive-tint': [43,20,19], 'warning-tint': [43,26,16],
  },
};

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// [label, foreground token, ground token, threshold, context]
const PAIRS = [
  ['ink / paper',            'ink', 'paper', 4.5, 'body and headings'],
  ['ink / card',             'ink', 'card', 4.5, 'text in cards'],
  ['muted-fg / paper',       'muted-fg', 'paper', 4.5, 'sub copy'],
  ['muted-fg / card',        'muted-fg', 'card', 4.5, 'helper text, counts'],
  ['muted-fg / muted',       'muted-fg', 'muted', 4.5, 'segmented control, inactive'],
  ['link / paper',           'link', 'paper', 4.5, 'Ghost buttons, text links'],
  ['link / card',            'link', 'card', 4.5, 'Tabs active, RailSubItem current'],
  ['link / indigo-tint',     'link', 'indigo-tint', 4.5, 'RailItem active row'],
  ['on-primary / indigo',    'on-primary', 'indigo', 4.5, 'Primary button label'],
  ['ink / muted',            'ink', 'muted', 4.5, 'Badge Neutral'],
  ['indigo-ink / indigo-tint','indigo-ink', 'indigo-tint', 4.5, 'Badge Primary'],
  ['success-ink / success-tint','success-ink','success-tint', 4.5, 'Badge Positive'],
  ['destructive-ink / destructive-tint','destructive-ink','destructive-tint', 4.5, 'Badge Critical'],
  ['warning-ink / warning-tint','warning-ink','warning-tint', 4.5, 'Badge Warning'],
  ['verdigris / verdigris-tint','verdigris','verdigris-tint', 4.5, 'Badge Live'],
  ['muted-fg / clay-tint',   'muted-fg', 'clay-tint', 4.5, 'delegate offer sub copy'],
  ['ink / clay-tint',        'ink', 'clay-tint', 4.5, 'delegate offer heading'],
  ['border / card',          'border', 'card', 3.0, 'hairline dividers'],
];

let failed = 0;
const rows = PAIRS.map(([name, fg, bg, need, ctx]) => {
  const l = ratio(T.Light[fg], T.Light[bg]);
  const d = ratio(T.Dark[fg], T.Dark[bg]);
  if (l < need || d < need) failed++;
  const f = (v) => `${v.toFixed(2)}${v < need ? ' FAIL' : ''}`;
  return `| ${name} | ${ctx} | ${need} | ${f(l)} | ${f(d)} |`;
});
console.log('| Pair | Context | Need | Light | Dark |');
console.log('|---|---|---|---|---|');
console.log(rows.join('\n'));
if (failed) { console.error(`\n${failed} pair(s) below threshold.`); process.exit(1); }
console.log('\nAll pairs pass.');
```

- [ ] **Step 2: Run it and confirm a clean exit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin/.claude/worktrees/design+app-reshaped-redesign
node design/app-contrast.mjs
```

Expected: the table prints and the last line is `All pairs pass.`, exit code 0. **If any pair fails, do not soften the threshold** — go back and change the token, which is the whole method the landing audit established.

- [ ] **Step 3: Write `design/app-contrast-audit.md`**

Mirror the structure of `design/contrast-audit.md`: a **Result** table (paste the script's output), a **What was wrong, and why** section, and a **Not measured** section. The prose must state, in this order:

1. `muted-fg` and dark `indigo` were stale copies of the pre-audit landing values; the app prototype never received the split.
2. Primary button labels were bound to `card`, measuring **3.77** in Dark, and `on-primary` exists because a Primary button is indigo in both modes so its label is white in both.
3. The badge wash failed four of six tones, worst at **2.52**, and the fix adopts the tint/ink structure the app's own `VALUE_META` chips already use — cite 6.84 / 5.21 / 5.72 for amber, emerald and rose.
4. `indigo-tint` was darkened in Dark for the rail's active row, and note explicitly that **rebinding to `link` alone did not fix it** (3.69 → 3.86, still failing) — the ground had to move.
5. Under **Not measured:** disabled states, which carry a 50% paint opacity and are exempt; and gradient artwork, which the app does not use.

- [ ] **Step 4: Record the clay/verdigris boundary question**

Append to the spec, under a new `### Open question: clay and verdigris in the app, 2026-08-10` heading:

> `main`'s `globals.css` and `tailwind.config.js` both comment the `clay` and `verdigris` tokens "Brand layer, marketing page only; the app reads the semantic names." This redesign uses `clay` for the delegate-to-client offer and `verdigris` for the Live badge, both in-app. The values themselves agree exactly between code and prototype, so nothing is broken today — but the declared boundary and the design disagree, and one of them should move. The proposal is to promote both to app-sanctioned use with their sanctioned meanings named (`clay` = the delegate offer only; `verdigris` = live/streaming state only), because the alternative is inventing two more semantic tokens for one usage each. **This needs the owner's ruling and is not implemented by this plan.**

- [ ] **Step 5: Correct the spec's token table and badge treatment**

In `docs/superpowers/specs/2026-08-04-mygist-app-reshaped-design.md`: update the colour table with `link`, `on-primary`, the three new tints and four new inks; change `muted-fg` and dark `indigo`; and rewrite the badge description so it no longer says a tone grounds itself at 12%. Add one sentence naming why: the wash failed AA on four tones.

- [ ] **Step 6: Update the Figma plan's recorded values**

In `docs/superpowers/plans/2026-08-04-mygist-app-reshaped-figma.md`, add an "Iteration round 5 additions" bullet carrying every new variable ID from Tasks 1 and 2, and record the two hazards this round confirmed: that a disabled variant's 50% opacity must be preserved by an opacity-normalising sweep, and that moving badge grounds to opacity 1 retires the fractional-opacity drift bug for good.

- [ ] **Step 7: Add the new variables to the Foundations specimen**

On page `1:2`, extend the colour specimen with swatches for `link`, `on-primary`, `success-tint`, `warning-tint`, `destructive-tint`, `indigo-ink`, `success-ink`, `destructive-ink`, `warning-ink`. Each swatch's label text binds to `ink`, and each ground binds to its own variable — the same pattern the existing swatches use. Leave the page in Light `4:0`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs: app contrast audit, with a rerunnable calculator

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 1 — The code defects the design round surfaced

Create the branch off `main` first, per **Branch strategy** above.

## Task 5: Extract `AddEntryDialog` from `ListRenderer`

**Files:**
- Create: `frontend/src/renderers/AddEntryDialog.jsx`
- Modify: `frontend/src/renderers/ListRenderer.jsx:206-281` (the `<Dialog>` block) and its `addOpen`/`draft`/`openAdd` state
- Test: `frontend/src/renderers/AddEntryDialog.test.jsx`

**Interfaces:**
- Produces:
  ```js
  // AddEntryDialog.jsx
  export function AddEntryDialog({
    node,          // the ui.section node
    entity,        // entities[node.entity], may be undefined
    items,         // current rows, for the duplicate-title check
    onAdd,         // (draft) => void -- ListRenderer's addItem
    open,          // boolean
    onOpenChange,  // (boolean) => void
    trigger,       // optional ReactNode wrapped in DialogTrigger; omit for controlled-only use
  })
  ```
  Tasks 6, 7, 8 and 9 all modify or mount this component. Its prop names are fixed here.

**Why this comes first:** three of the four remaining defects (missing description, wrong title copy, absent Cancel) are all inside this one block, and Task 9 needs to mount the same dialog from a second place — the section card header. Extracting once beats editing the same JSX four times inside a 600-line file.

This is a **pure refactor**: no behaviour changes, so the existing suite is the test.

- [ ] **Step 1: Run the baseline and record the number**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin/frontend
npm test -- --project unit
```

Expected: `28 files, 627 tests` passing. Note the two `ListRenderer.test.jsx` cases that already cover both open paths — `offers an Add action inside the empty panel, naming what it adds` and `seeds field_defaults identically whether opened from the panel or the header`. **These two are the refactor's safety net; if either breaks, the extraction changed behaviour.**

Also note the warning the run prints, which Task 6 removes:
`Warning: Missing 'Description' or 'aria-describedby={undefined}' for {DialogContent}.`

- [ ] **Step 2: Create `AddEntryDialog.jsx`**

Move the JSX verbatim, with `draft` state and the derived values it needs. The `titleCollides` comparison, the suggestion filter, and the `Enter`-to-submit handler all move unchanged.

```jsx
// The Add dialog, lifted out of ListRenderer so that one component owns the
// draft lifecycle, the copy, and the footer -- and so the section card header
// can mount the same dialog the empty-state panel mounts. Both entry points
// must seed `field_defaults` identically or a manifest default would apply
// invisibly on one route and visibly on the other.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { FOCUS_RING } from "@/components/controls";
import { buildFieldMeta } from "./fieldMeta";
import ScalarField from "./ScalarField";

export function AddEntryDialog({ node, entity, items, onAdd, open, onOpenChange, trigger }) {
  const titleField = node.title_field;
  const badges = node.badges ?? [];
  const detailFields = node.detail_fields ?? [];
  const pinnedField = node.pinned?.field;
  const fieldDefaults = node.field_defaults ?? entity?.field_defaults ?? {};
  const suggestions = node.suggestions?.[titleField] || [];
  const meta = buildFieldMeta(node, entity);

  const [draft, setDraft] = useState({ ...fieldDefaults });

  const existingTitles = new Set(items.map((i) => (i[titleField] || "").toLowerCase()));
  // Same case-insensitive comparison addItem uses to reject a collision --
  // computed here so the dialog can surface it instead of letting addItem
  // silently no-op and close on a title the user already has.
  const titleCollides =
    !!draft[titleField] && existingTitles.has(draft[titleField].toLowerCase());

  // `pinned.field` never renders as an editable control, per meta_schema.json.
  const editFields = [...new Set([...badges, ...detailFields])].filter((f) => f !== pinnedField);

  const submit = () => { onAdd(draft); onOpenChange(false); setDraft({}); };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        // Preselect manifest defaults (e.g. stance: like) so the controls show
        // the real initial state instead of applying it invisibly.
        setDraft(o ? { ...fieldDefaults } : {});
      }}
    >
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Add {(node.title ?? node.entity ?? "item").replace(/_/g, " ")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs capitalize">{titleField}</Label>
            <Input
              value={draft[titleField] || ""}
              onChange={(e) => setDraft({ ...draft, [titleField]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft[titleField] && !titleCollides) submit();
              }}
              autoFocus
            />
            {titleCollides && (
              <p className="text-xs text-destructive">
                "{draft[titleField]}" already exists.
              </p>
            )}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {suggestions
                  .filter((s) => !existingTitles.has(s.toLowerCase()))
                  .slice(0, 8)
                  .map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setDraft({ ...draft, [titleField]: s })}
                      className={`rounded-full border border-input bg-background px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted/50 ${FOCUS_RING}`}
                    >
                      {s}
                    </button>
                  ))}
              </div>
            )}
          </div>
          {editFields.filter((f) => f !== titleField).map((f) => (
            <div key={f} className="space-y-1.5">
              <Label className="text-xs capitalize">{f.replace(/_/g, " ")}</Label>
              <ScalarField
                field={f}
                value={draft[f]}
                meta={meta}
                customValue={draft[`custom_${f}`]}
                onChange={(v) => {
                  const next = { ...draft, [f]: v };
                  if (v !== "other") delete next[`custom_${f}`];
                  setDraft(next);
                }}
                onCustomChange={(v) => setDraft({ ...draft, [`custom_${f}`]: v })}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!draft[titleField] || titleCollides}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Check the import paths for `buildFieldMeta` and `ScalarField` against the real files before running** — `ListRenderer.jsx` imports both, so copy its import lines rather than trusting the ones above.

- [ ] **Step 3: Replace the block in `ListRenderer.jsx`**

Delete the `<Dialog>…</Dialog>` block and the now-unused `draft`/`setDraft` state, and mount:

```jsx
<AddEntryDialog
  node={node}
  entity={entity}
  items={items}
  onAdd={addItem}
  open={addOpen}
  onOpenChange={setAddOpen}
  trigger={
    <Button size="sm" variant="outline">
      <Plus className="mr-1 h-4 w-4" />Add
    </Button>
  }
/>
```

Keep `openAdd` — the empty-state panel calls it, and it now only needs `setAddOpen(true)` because the dialog seeds its own draft on open.

- [ ] **Step 4: Run the suite; expect no change**

```bash
npm test -- --project unit
```

Expected: still `627 passed`. A failure in the two named cases means the extraction changed behaviour — fix the component, not the test.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderers/AddEntryDialog.jsx frontend/src/renderers/ListRenderer.jsx
git commit -m "refactor: the Add dialog becomes its own component

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Give the dialog an accessible description

**Files:**
- Modify: `frontend/src/renderers/AddEntryDialog.jsx`
- Test: `frontend/src/renderers/AddEntryDialog.test.jsx`

**Interfaces:**
- Consumes: `AddEntryDialog` from Task 5.

This is not a cosmetic fix. Radix warns on every render today, meaning the dialog ships to screen readers with no description. `DialogDescription` is **already exported** from `frontend/src/components/ui/dialog.jsx:84` and simply was never imported.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AddEntryDialog } from "./AddEntryDialog";

const node = {
  kind: "list", path: ["likes_dislikes"], title: "Likes & Dislikes",
  entity: "like", title_field: "item", badges: ["stance"],
  enum: { stance: ["like", "dislike"] }, field_defaults: { stance: "like" },
};

describe("AddEntryDialog accessibility", () => {
  it("gives the dialog a description, so Radix has something to point aria-describedby at", () => {
    render(
      <AddEntryDialog node={node} entity={undefined} items={[]}
        onAdd={vi.fn()} open onOpenChange={vi.fn()} />
    );
    const dialog = screen.getByRole("dialog");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- --project unit AddEntryDialog
```

Expected: FAIL — `aria-describedby` is `null`, so `expect(describedBy).toBeTruthy()` fails.

- [ ] **Step 3: Add the description**

Add `DialogDescription` to the import from `@/components/ui/dialog`, then inside `DialogHeader`, after `DialogTitle`:

```jsx
<DialogDescription>
  {node.description ?? `Add one entry to ${node.title ?? "this list"}.`}
</DialogDescription>
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npm test -- --project unit
```

Expected: the new test passes, `627 + 1` total, **and the `Missing 'Description'` warning no longer appears in the output.** Grep the output to confirm: `npm test -- --project unit 2>&1 | grep -c "aria-describedby"` should print `0`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderers/AddEntryDialog.jsx frontend/src/renderers/AddEntryDialog.test.jsx
git commit -m "fix(a11y): the Add dialog describes itself

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Fix the dialog's title copy

**Files:**
- Modify: `frontend/src/renderers/AddEntryDialog.jsx`
- Test: `frontend/src/renderers/AddEntryDialog.test.jsx`

**Interfaces:**
- Consumes: `AddEntryDialog` from Task 5.

The current expression is `Add {node.title ?? node.entity ?? "item"}`, which on the likes/dislikes node prints **"Add Likes & Dislikes"** — as though the list itself were the thing being added. The prototype says **"Add to Likes & Dislikes"**.

The fix is conditional, not a blanket string swap: `node.title` is a container name and takes "Add to", while `node.entity` is a singular noun (`like`, `aesthetic`) and takes a bare "Add". An existing test — `ListRenderer.test.jsx:212`, "uses node.title, when present, for the Add dialog heading in preference to node.entity" — pins the precedence and must keep passing.

- [ ] **Step 1: Write the failing tests**

```jsx
it("says 'Add to <list>' when the node names its container, not 'Add <list>'", () => {
  render(
    <AddEntryDialog node={node} entity={undefined} items={[]}
      onAdd={vi.fn()} open onOpenChange={vi.fn()} />
  );
  expect(screen.getByRole("heading", { name: "Add to Likes & Dislikes" })).toBeInTheDocument();
});

it("says a bare 'Add <entity>' when there is no container title to add to", () => {
  const untitled = { ...node, title: undefined, entity: "mental_tab" };
  render(
    <AddEntryDialog node={untitled} entity={undefined} items={[]}
      onAdd={vi.fn()} open onOpenChange={vi.fn()} />
  );
  expect(screen.getByRole("heading", { name: "Add mental tab" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test -- --project unit AddEntryDialog
```

Expected: the first fails — the heading reads `Add Likes & Dislikes`. The second passes already; it is there to stop the fix regressing the fallback.

- [ ] **Step 3: Make the title conditional**

```jsx
<DialogTitle>
  {/* A container name takes "Add to" -- the list is the destination, not the
      thing being added. An entity name is already the singular noun, so it
      takes a bare "Add". `Add Likes & Dislikes` was the old string. */}
  {node.title
    ? `Add to ${node.title}`
    : `Add ${(node.entity ?? "item").replace(/_/g, " ")}`}
</DialogTitle>
```

- [ ] **Step 4: Run the full suite**

```bash
npm test -- --project unit
```

Expected: all pass, including `ListRenderer.test.jsx:212`. **If that test asserts the exact string `Add Likes & Dislikes`, update it to `Add to Likes & Dislikes`** — the precedence it guards is unchanged, only the copy.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderers/AddEntryDialog.jsx frontend/src/renderers/AddEntryDialog.test.jsx frontend/src/renderers/ListRenderer.test.jsx
git commit -m "fix: the list is what you add to, not what you add

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Give the dialog a Cancel button

**Files:**
- Modify: `frontend/src/renderers/AddEntryDialog.jsx`
- Test: `frontend/src/renderers/AddEntryDialog.test.jsx`

**Interfaces:**
- Consumes: `AddEntryDialog` from Task 5.

`DialogFooter` currently holds only `Add`. Dismissal relies on Esc, an overlay click, or Radix's corner close control — none of which is a labelled affordance. The owner's standing preference is that buttons carry a descriptive label; a dialog whose only exit is an unlabelled glyph is the same defect one level up.

- [ ] **Step 1: Write the failing test**

```jsx
it("offers a labelled way out, and closes without adding anything", async () => {
  const onAdd = vi.fn();
  const onOpenChange = vi.fn();
  const user = userEvent.setup();
  render(
    <AddEntryDialog node={node} entity={undefined} items={[]}
      onAdd={onAdd} open onOpenChange={onOpenChange} />
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(onAdd).not.toHaveBeenCalled();
});
```

Add `import userEvent from "@testing-library/user-event";` at the top of the test file if it is not already there.

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- --project unit AddEntryDialog
```

Expected: FAIL — `Unable to find an accessible element with the role "button" and name "Cancel"`.

- [ ] **Step 3: Add Cancel, ordered before Add**

```jsx
<DialogFooter>
  <Button variant="ghost" onClick={() => onOpenChange(false)}>
    Cancel
  </Button>
  <Button onClick={submit} disabled={!draft[titleField] || titleCollides}>
    Add
  </Button>
</DialogFooter>
```

`DialogFooter` already lays its children out with the primary action last, matching the prototype's right-aligned footer.

- [ ] **Step 4: Run the full suite**

```bash
npm test -- --project unit
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderers/AddEntryDialog.jsx frontend/src/renderers/AddEntryDialog.test.jsx
git commit -m "fix: the Add dialog has a labelled way out

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: `+ Add` moves into the card header; the count moves beside the filter

**Files:**
- Modify: `frontend/src/renderers/SectionRenderer.jsx:104-124` (`heading`) and `:126-143` (`CardHeader`)
- Modify: `frontend/src/renderers/renderNode.jsx` — signature gains `headerAction`
- Modify: `frontend/src/renderers/ListRenderer.jsx` — toolbar loses `+ Add`, count moves
- Test: `frontend/src/renderers/SectionRenderer.test.jsx`, `frontend/src/renderers/ListRenderer.test.jsx`

**Interfaces:**
- Consumes: `AddEntryDialog` from Task 5.
- Produces:
  ```jsx
  // SectionRenderer.jsx -- extracted from the local `heading` closure
  export function NodeHeading({ node, depth, action })
  ```

**The constraint that shapes this task.** `SectionRenderer` renders a node's heading only when `node.title` is truthy (`:73`), and a comment at `:131` explains why: *"A node with no title of its own is the section's main list, so the heading that describes it is the Card's."* So there are **two** header rows that can hold the action, and both need it:

- a **titled** node → the action goes in that node's own heading row
- an **untitled** node → the action goes in the `CardHeader`'s `CardTitle` row

Getting the action from `ListRenderer` up to either row means it cannot be created inside `ListRenderer`. Instead `SectionRenderer` — which already holds each node's `value` and `onValue` — mounts `AddEntryDialog` itself and passes the trigger down as the header action. This is why Task 5 came first.

- [ ] **Step 1: Write the failing tests**

```jsx
it("puts the Add trigger in a titled list node's own header row, not in the list body", async () => {
  renderSection("preferences");                  // use this file's existing helper
  const nodeEl = uiNode("Likes & Dislikes");     // ditto -- scopes by data-ui-node
  const heading = nodeEl.querySelector("h3, h4");
  const headerRow = heading.closest("div").parentElement;
  expect(within(headerRow).getByRole("button", { name: /add/i })).toBeInTheDocument();
});

it("shows the entry count beside the filter row rather than above it", async () => {
  renderSection("preferences");
  const nodeEl = uiNode("Likes & Dislikes");
  expect(within(nodeEl).getByText(/\d+ entr(y|ies)/)).toBeInTheDocument();
});
```

**Read `SectionRenderer.test.jsx` first and reuse its existing `renderSection`/`uiNode` helpers rather than inventing new ones** — the file already has a helper that throws `no ui node titled "<title>" is rendered`, and the `data-ui-node` attribute exists specifically so tests scope this way.

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test -- --project unit SectionRenderer
```

Expected: the first fails — the Add button is inside the list body, not the heading row.

- [ ] **Step 3: Extract `NodeHeading` with an action slot**

Replace the local `heading` closure in `SectionRenderer.jsx` with a module-level export, and give it a right-hand slot:

```jsx
// A node's own heading row: its title, the "i" that explains it, the optional
// action on the right, and the one muted line under all three. Shared by
// groups and titled nodes so a description renders for every kind.
export function NodeHeading({ node, depth, action }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {depth === 0 ? (
            <h3 className="text-sm font-semibold text-foreground">{node.title}</h3>
          ) : (
            <h4 className="text-sm font-medium text-foreground">{node.title}</h4>
          )}
          <InfoButton info={node.info} title={node.title} />
        </div>
        {action}
      </div>
      {node.description && (
        <p className="text-xs text-muted-foreground">{node.description}</p>
      )}
    </div>
  );
}
```

Update the call site at `:73` to `{node.title && <NodeHeading node={node} depth={depth} action={headerAction} />}`.

- [ ] **Step 4: Build the action in `SectionRenderer` and route it to the right row**

In `renderSectionNode`, for a `list` node, mount the dialog and hold its open state. Because a section can hold several list nodes, the open state must be keyed per node — a single boolean would open every dialog at once:

```jsx
const [addOpenFor, setAddOpenFor] = useState(null);   // node key, or null
```

Then, for a `list` node:

```jsx
const isList = node.kind === "list";
const headerAction = isList ? (
  <AddEntryDialog
    node={node}
    entity={entities?.[node.entity]}
    items={Array.isArray(value) ? value : []}
    onAdd={(draft) => addTo(node, draft)}
    open={addOpenFor === key}
    onOpenChange={(o) => setAddOpenFor(o ? key : null)}
    trigger={
      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs">
        <Plus className="h-3.5 w-3.5" />Add
      </Button>
    }
  />
) : null;
```

`addTo(node, draft)` must reuse the same append-and-write path `ListRenderer.addItem` uses, so the two entry points cannot diverge. **Read `ListRenderer`'s `addItem` and `useListItems.js` and either import that helper or lift it — do not reimplement the append.** If lifting proves invasive, the acceptable fallback is to keep `addItem` in `ListRenderer` and pass a callback ref upward; record which you chose in the commit message.

For an **untitled** node, pass the same `headerAction` into the `CardTitle` row instead, beside the existing `InfoButton` map at `:131-140`.

- [ ] **Step 5: Move the count in `ListRenderer`**

Remove the `+ Add` trigger and the count from the top toolbar. Render the count immediately beside the facet control (`:312` onward) so filter feedback sits next to the filter:

```jsx
<div className="flex items-center gap-2 text-sm text-muted-foreground">
  {q || facetsActive ? `${visible.length} of ${items.length}` : items.length}{" "}
  {items.length === 1 ? "entry" : "entries"}
</div>
```

When a node has neither facets nor search, this row is the count alone — keep it rendered, because the count is the only thing that tells the reader how long the list is.

- [ ] **Step 6: Run the full suite**

```bash
npm test -- --project unit
```

Expected: all pass. The two Task-5 safety-net cases are the ones to watch — `seeds field_defaults identically whether opened from the panel or the header` now spans two components, which is exactly the divergence it exists to catch. **If it fails, the two entry points have drifted; fix the code.**

- [ ] **Step 7: Commit**

```bash
git add frontend/src/renderers/
git commit -m "feat: + Add sits in the section header, the count sits with the filter

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10 (optional): a user-facing sort control

**Files:**
- Modify: `frontend/src/renderers/ListRenderer.jsx`, `frontend/src/renderers/listPipeline.js`
- Test: `frontend/src/renderers/listPipeline.test.js`, `frontend/src/renderers/ListRenderer.test.jsx`

**Interfaces:**
- Consumes: `buildOrder(items, sort)` from `listPipeline.js`, unchanged in signature.

**Marked optional because it is new capability, not a defect.** Include it only on the owner's say-so. It is cheap and carries no write risk: `meta_schema.json` is explicit that `sort` is *"Display order only. Rows are sorted by this storage key; the stored array is never reordered,"* and the entity `actions` enum is exactly `add | update | remove`. So a sort control changes what the reader sees and never what is stored. **Hand reordering remains unrepresentable and must not be offered.**

- [ ] **Step 1: Write the failing test**

```js
it("sorts by a chosen key without touching the stored array", () => {
  const items = [{ topic: "b", timestamp: "2026-01-02" }, { topic: "a", timestamp: "2026-01-01" }];
  const frozen = JSON.parse(JSON.stringify(items));
  const order = buildOrder(items, { field: "topic", dir: "asc" });
  expect(order.map((i) => items[i].topic)).toEqual(["a", "b"]);
  expect(items).toEqual(frozen);
});

it("sorts rows with a missing or empty key last, whichever direction is chosen", () => {
  const items = [{ topic: "a" }, {}, { topic: "" }, { topic: "b" }];
  for (const dir of ["asc", "desc"]) {
    const order = buildOrder(items, { field: "topic", dir });
    const lastTwo = order.slice(-2).map((i) => items[i].topic);
    expect(lastTwo.every((v) => !v)).toBe(true);
  }
});
```

- [ ] **Step 2: Run and confirm which assertions already hold**

```bash
npm test -- --project unit listPipeline
```

`buildOrder` already implements the missing-key rule, so the second test should pass unchanged. **If it does not, that is a pre-existing bug against `meta_schema.json` and takes priority over this task.**

- [ ] **Step 3: Add the control**

Hold the user's choice in state, defaulting to the manifest's declaration so nothing changes until the reader acts:

```jsx
const [sort, setSort] = useState(node.sort ?? null);
const order = buildOrder(items, sort);
```

Render a `Select` beside the count with one option per sortable key — the union of `node.display_fields`, `node.badges` and `node.title_field` — plus a direction toggle. Offer it only when there are at least two sortable keys **and** at least two rows; below that it is a control with nothing to do.

- [ ] **Step 4: Run the full suite**

```bash
npm test -- --project unit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderers/
git commit -m "feat: readers can choose the list's display order

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes

**Spec coverage.** Every item the owner selected is covered: `link` and `on-primary` (Task 1), `muted-fg` 45→42% and dark `indigo` 67→62% (Task 1), the ~29-node interactive-text rebind (Task 3), the unaudited app pairs (Task 4), `DialogDescription` (Task 6), the `Add Likes & Dislikes` title (Task 7), `Cancel` (Task 8), `+ Add` in the section card header (Task 9), and the optional sort control (Task 10).

**Two things this plan adds beyond the selected scope, and why.** The badge tint replacement (Task 2) was not in the list because nobody had measured those pairs — four of six fail, worst at 2.52, and one of them shipped last round. The `indigo-tint` Dark darkening was likewise unforeseen: it is the only thing that fixes the rail's active row, since rebinding to `link` leaves it at 3.86. Both are defects in what already exists rather than new features.

**One item deliberately left unimplemented.** The clay/verdigris boundary (Task 4, Step 4) is recorded as an open question because it needs a ruling, not a fix — the values agree, only the declared scope disagrees.

**Known ordering dependencies.** Task 2 must follow Task 1 (Primary's Dark ratio depends on the darkened `indigo-tint`). Task 3 must follow Task 1 (needs `link` and `on-primary` to exist). Tasks 6–9 must all follow Task 5. Task 9 is the largest and should be reviewed on its own.
