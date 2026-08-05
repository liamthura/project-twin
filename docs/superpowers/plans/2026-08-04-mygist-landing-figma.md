# MyGist Landing Page — Figma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MyGist design system and landing page prototype in Figma, from the approved spec at `docs/superpowers/specs/2026-08-04-mygist-landing-design.md`.

**Architecture:** One Figma design file with three pages — Foundations (variables and specimens), Components (the library), and Landing (page assembly at two breakpoints). Variables are the single source of truth and are named so they could be exported as CSS custom properties without renaming. Gradient artwork is generated outside Figma from a local copy of GRADIENTOOL, following the owner's reference ramp, and imported as stills. Every product object is populated with one demo persona, built from screenshots of the running application rather than from imagination.

**Tech Stack:** Figma (via `use_figma` MCP), GRADIENTOOL (local HTML, canvas 2D), Magic UI registry (`bento-grid`, `safari`, `blur-fade`, `noise-texture`) as design reference, the running MyGist app (Docker) as the source for mockup content.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec.

**Verify with a separate read, and use a read that tells the truth.** Every task that writes to Figma confirms the result with a separate read call rather than by inspecting what its own write returned.

**`get_metadata` with no `nodeId` is not a usable verification tool.** Its "list top-level pages" path returned only `01 Foundations` for the whole of Task 1, persistently, while `02 Components` and `03 Landing` demonstrably existed — confirmed by `get_metadata` with explicit node IDs `1:2` and `1:3`, and by a `use_figma` read of `figma.root.children`. Two separate reviewers reached the wrong conclusion from it and a false Critical finding went into a fix round.

Verify page structure with `use_figma` reading `figma.root.children`, or with `get_metadata` against an explicit `nodeId`. Verify appearance with `get_screenshot`.

**Verify variables with the Plugin API, not `get_variable_defs`.** That tool resolves variables for a *selection*, so on a page with no layers it fails with "nothing selected" — which is every page at the point Tasks 2 and 3 run. Read them directly instead:

```js
const cols = await figma.variables.getLocalVariableCollectionsAsync()
const vars = await figma.variables.getLocalVariablesAsync()
return vars.map(v => ({ name: v.name, type: v.resolvedType, values: v.valuesByMode }))
```

`get_variable_defs` becomes useful only once components exist and can be selected, which is Task 7 onwards.

If a read disagrees with a write, get a third read by a different method before concluding anything.

**Mandatory skill loading.** Before *every* `use_figma` call, invoke the `figma:figma-use` skill. Before `create_new_file`, invoke `figma:figma-create-new-file`. When building variables or components, load `figma:figma-generate-library` alongside `figma-use`. When assembling the page, load `figma:figma-generate-design`. Skipping these causes hard-to-debug failures.

**HSL is authoritative; every hex in this plan is derived from it.** The HSL values below come from the app's real tokens and the approved palette artifact. Hex values appear only as conveniences for tools that demand them, and three of the five in Task 5's first draft were wrong — they were typed rather than computed, which would have produced off-brand gradient art that Task 5's own palette check could not have caught, because it compared against the same wrong list. If a hex and an HSL value ever disagree, the HSL wins. Compute, do not transcribe:

```js
const hsl = (h, s, l) => { s/=100; l/=100
  const k = n => (n + h/30) % 12, a = s * Math.min(l, 1-l)
  const f = n => l - a * Math.max(-1, Math.min(k(n)-3, Math.min(9-k(n), 1)))
  return "#" + [f(0),f(8),f(4)].map(v=>Math.round(v*255).toString(16).padStart(2,"0")).join("").toUpperCase() }
```

**Colour — light mode.**
```
paper           60 9% 98%      ink             24 10% 10%
card             0 0% 100%     muted           60 5% 96%
muted-fg        25 5% 45%      border          20 6% 90%
indigo         228 69% 55%     indigo-tint    223 100% 96%
on-primary       0 0% 100%     (white in BOTH modes)
clay            18 74% 60%     clay-tint       18 74% 94%
verdigris      188 38% 36%     verdigris-tint 188 26% 93%
success        142 71% 35%     warning         43 96% 40%
destructive      0 65% 48%
```

**Colour — dark mode.**
```
paper           60 3% 7%       ink             60 5% 96%
card            60 2% 10%      muted           60 1% 14%
muted-fg        24 5% 64%      border          60 2% 16%
indigo         228 94% 67%     indigo-tint    227 22% 20%
on-primary       0 0% 100%     (white in BOTH modes)
clay            18 66% 62%     clay-tint       18 30% 18%
verdigris      188 40% 50%     verdigris-tint 188 26% 15%
success        142 60% 50%     warning         43 90% 55%
destructive      0 74% 54%
```

**Type.** Stack Sans Notch (display, 40px and above only, weights 500–600), Geist (UI and body), Geist Mono (eyebrows, labels, code). Ramp: `13 · 14 · 16 · 18 · 20 · 28 · 40 · 56 · 72`.

The 40px floor is a **role boundary, not a legibility limit**. Task 4's specimen showed the notches still reading fine at 28px, so do not justify the floor by claiming the character disappears — it does not. The floor exists so display and body stay visibly separate roles and the display face stays an event rather than a default. Enforce it regardless.

**Hero headline is decided: "Explain yourself once."** Chosen from the specimen. Do not re-open it, and do not set the other candidate anywhere.

**Radius.** `4 · 6 · 8 · 12 · 16 · 24 · 32 · 9999`.

**Cards use `radius/12`, and their inner rows `radius/8`.** Not 24/16. Set by the owner against the running app, whose own radius is 8px — a 24px marketing card read as a different product. This overrides the Playful Editorial note's 16px floor; the owner made the call with both surfaces on screen. The 32px page frame and 9999px pills are unaffected.

**Space.** `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 80 · 120 · 160`.

**Elevation.** All shadows tinted with ink, never black. `sm` = `0 1px 2px ink/6%`, `lift` = `0 8px 24px ink/10%`, `pop` = `0 12px 32px ink/14%`.

**Motion.** Press 120–180ms. State change 180–260ms. Entrance 240ms ease-out. Exit 180ms ease-in. Nothing over 300ms.

**Motion that is forbidden.** Nothing loops, drifts, pulses, shimmers or travels. Specifically banned: travelling beams along a path, aurora or gradient-shifting text, shimmer sweeps, meteors, particle fields, perpetual ambient background motion. Every animation is triggered by arrival or input, plays once, and stops.

**Colour usage rule.** Clay and Verdigris are never used for body text. They appear as flat section tints and illustration fills only. Clay takes the larger share of tinted ground, because Verdigris and Indigo are both cool.

**Gradient rule.** Gradient artwork follows the owner's reference ramp, not the brand palette. It never sits under text — type over gradient sits on a solid or scrimmed surface.

```
REFERENCE RAMP (authoritative)
0.00  #1C1917   ink        (reference says #000000; substituted so the page has one black, and a warm one)
0.44  #2345E0   blue       (deeper and more saturated than brand indigo #3D5DDB — deliberate)
0.72  #FF9DC5   pink       (new to the system)
1.00  #FBF0EE   cream      (new to the system)

STRUCTURE          shape one peak · peakPos 0.5 · direction up · gradMap bar
                   count 9 · depth 0.45 · curveExp 1 · widthExp 0 · mirror false
                   gap 0 · jitter 0 · steps 0 · layout linear · margin 0
RELIEF & GRAIN     shadow 1 · depth3d 0.55 · seam 0.05 · grainIntensity 0.52
```

An earlier draft locked gradient artwork to the five brand colours and produced mud, because clay and verdigris are near-complementary and interpolating between them passes through grey-brown. The reference works because lightness rises monotonically and every hue step is adjacent. Do not "correct" it back toward the brand palette — that is the thing that failed.

**Copy rule.** British English. No em dashes in page copy. No "delve", "leverage", "seamless", "unlock", "empower". Copy is fixed in the spec's copy deck and is transcribed exactly, not improvised.

**Client names.** Claude, Codex, Raycast, Notion AI, Hermes, plus "anything with MCP connectors". ChatGPT is deliberately absent — it has no MCP connectors by default. Do not add clients not on this list.

**Demo persona.** Maya Ellis, 23, Manchester. Marketing assistant, six months out of an English and Media degree. Writes British English, no exclamation marks, never "delve". Uses three assistants a day for drafts, research and meeting notes. Goal: move into brand strategy within two years. Learns examples first, theory later. Review queue holds one item: *"Maya now owns the monthly newsletter"*. She appears in every product object, consistently. No placeholder or lorem text anywhere.

---

## File Structure

| Figma page | Responsibility |
|---|---|
| `01 Foundations` | Variable collections, type specimen, gradient asset sheet, contrast audit table |
| `02 Components` | The component library — shell, actions, content, product objects |
| `03 Landing` | Page assembly at 1440 and 390, plus prototype wiring |

| Repo path | Responsibility |
|---|---|
| `docs/superpowers/specs/2026-08-04-mygist-landing-design.md` | The approved spec. Read-only reference. |
| `design/gradients/` | Generated gradient stills, committed as PNGs |
| `design/gradients/README.md` | The exact GRADIENTOOL parameters used, so output is reproducible |
| `design/screens/` | Screenshots of the running app, used as mockup source |

---

## Task 1: Preflight and file creation

**Files:**
- Create: Figma design file `MyGist — Design System & Landing`
- Create: `design/gradients/README.md`
- Create: `design/screens/.gitkeep`

**Interfaces:**
- Consumes: nothing
- Produces: `FILE_KEY` — the Figma file key, referenced by every later task. Three named pages: `01 Foundations`, `02 Components`, `03 Landing`.

- [ ] **Step 1: Confirm Figma access**

Run the `whoami` Figma MCP tool. Expected: a handle and at least one plan with a `Full` seat. If the seat is `Viewer` or the call errors, stop and report — nothing else in this plan can proceed.

- [ ] **Step 2: Create the file**

`use_figma` requires an existing `fileKey` to execute against, so the file must exist before the font check can run. Invoke `figma:figma-create-new-file`, then create a `design` editor-type file named `MyGist — Design System & Landing`.

Pass the name as a literal `&`. HTML-escaping it to `&amp;` produces a file with a mangled name, and this toolset has no rename or delete tool, so the mistake is only fixable by hand in the Figma UI.

Report the returned file key as `FILE_KEY` — every later task needs it.

- [ ] **Step 3: Confirm Stack Sans Notch is available to Figma**

Stack Sans Notch is on Google Fonts, which Figma serves natively. Invoke `figma:figma-use`, then run a `use_figma` call against `FILE_KEY` listing available fonts and filtering for it:

```js
const fonts = await figma.listAvailableFontsAsync()
const hits = fonts.filter(f => f.fontName.family.toLowerCase().includes('stack sans'))
return hits.map(f => `${f.fontName.family} ${f.fontName.style}`)
```

Expected: entries including `Stack Sans Notch Medium` and `Stack Sans Notch SemiBold`. Report the exact family and style strings returned — later tasks need them verbatim, and a near-miss silently falls back to a default sans without erroring. If the family is absent, stop and report; Task 4 depends on it and there is no substitute that preserves the design intent.

- [ ] **Step 4: Create the three pages**

Invoke `figma:figma-use`, then:

```js
const names = ['01 Foundations', '02 Components', '03 Landing']
const existing = figma.root.children
names.forEach((n, i) => {
  if (existing[i]) { existing[i].name = n }
  else { const p = figma.createPage(); p.name = n }
})
return figma.root.children.map(p => p.name)
```

Expected return: `["01 Foundations", "02 Components", "03 Landing"]`.

Verify with a separate read, using either of these — **not** `get_metadata` without a `nodeId`, which reports only `01 Foundations` for this file no matter what actually exists:

```js
// Authoritative page list.
return figma.root.children.map(p => ({ id: p.id, name: p.name }))
```

Or `get_metadata` against each page's explicit node ID. In the first execution the pages landed at `0:1`, `1:2` and `1:3`.

- [ ] **Step 5: Create the repo scaffolding**

```bash
mkdir -p design/gradients design/screens
touch design/screens/.gitkeep
```

Write `design/gradients/README.md` with this content:

```markdown
# Gradient assets

Generated from GRADIENTOOL (gradientool.com), a canvas 2D generator using
layered linear and radial gradients with grain.

Every asset here follows the owner's reference ramp (ink -> blue -> pink ->
cream), not the brand palette. Brand-locking the artwork was tried first and
produced mud. See the spec at
docs/superpowers/specs/2026-08-04-mygist-landing-design.md.

Regenerating: open the tool, set the parameters recorded beside each asset
below, export at 2x, and replace the file in place. Keep the parameter block
up to date or the next person cannot reproduce it.

## Assets

(populated by Task 5)
```

- [ ] **Step 6: Commit**

```bash
git add design/
git commit -m "chore: scaffolding for generated design assets

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Colour variables

**Files:**
- Modify: Figma file `FILE_KEY`, page `01 Foundations`

**Interfaces:**
- Consumes: `FILE_KEY` from Task 1
- Produces: a variable collection named `color` with two modes, `Light` and `Dark`. Variable names, referenced by every later task: `color/paper`, `color/ink`, `color/card`, `color/muted`, `color/muted-fg`, `color/border`, `color/indigo`, `color/indigo-tint`, `color/clay`, `color/clay-tint`, `color/verdigris`, `color/verdigris-tint`, `color/success`, `color/warning`, `color/destructive`.

- [ ] **Step 1: Create the collection and both modes**

Invoke `figma:figma-use` and `figma:figma-generate-library`, then:

```js
const c = figma.variables.createVariableCollection('color')
c.renameMode(c.modes[0].modeId, 'Light')
const darkId = c.addMode('Dark')
return { id: c.id, light: c.modes[0].modeId, dark: darkId }
```

- [ ] **Step 2: Define the colours and write them in**

HSL values are given in the Global Constraints. Figma takes RGB 0–1, so convert. Use this exact helper so light and dark agree:

```js
function hsl(h, s, l) {
  s /= 100; l /= 100
  const k = n => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return { r: f(0), g: f(8), b: f(4) }
}

const TOKENS = {
  'paper':          [[60,9,98],    [60,3,7]],
  'ink':            [[24,10,10],   [60,5,96]],
  'card':           [[0,0,100],    [60,2,10]],
  'muted':          [[60,5,96],    [60,1,14]],
  'muted-fg':       [[25,5,45],    [24,5,64]],
  'border':         [[20,6,90],    [60,2,16]],
  'indigo':         [[228,69,55],  [228,94,67]],
  'on-primary':     [[0,0,100],    [0,0,100]],   // white in BOTH modes
  'indigo-tint':    [[223,100,96], [227,22,20]],
  'clay':           [[18,74,60],   [18,66,62]],
  'clay-tint':      [[18,74,94],   [18,30,18]],
  'verdigris':      [[188,38,36],  [188,40,50]],
  'verdigris-tint': [[188,26,93],  [188,26,15]],
  'success':        [[142,71,35],  [142,60,50]],
  'warning':        [[43,96,40],   [43,90,55]],
  'destructive':    [[0,65,48],    [0,74,54]],
}

// COLLECTION_ID is the `id` returned by Step 1.
const col = figma.variables.getVariableCollectionById(COLLECTION_ID)
const [lightId, darkId] = [col.modes[0].modeId, col.modes[1].modeId]
const made = []
for (const [name, [lt, dk]] of Object.entries(TOKENS)) {
  const v = figma.variables.createVariable(`color/${name}`, col, 'COLOR')
  v.setValueForMode(lightId, hsl(...lt))
  v.setValueForMode(darkId,  hsl(...dk))
  made.push(v.name)
}
return made
```

- [ ] **Step 3: Verify by reading back, not by trusting the write**

Read the variables back with the Plugin API snippet in Global Constraints — not `get_variable_defs`, which needs a selection and will fail on this empty page. Expected: 16 variables under the `color/` prefix, each resolving to a different value in Light and Dark. Spot-check three by hand:

- `color/paper` Light must be `#FAFAF9` (±1 per channel from rounding)
- `color/verdigris` Light must be `#39757F` (±1)
- `color/clay-tint` Dark must be `#3C2820` (±1)

If any of the three is wrong, the `hsl` helper was altered — restore it verbatim and re-run Step 2.

- [ ] **Step 4: Commit the checkpoint**

Figma state is not in git, so record progress in the plan file itself:

```bash
git commit --allow-empty -m "design: colour variables, light and dark, verified by read-back

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Scale variables

**Files:**
- Modify: Figma file `FILE_KEY`, page `01 Foundations`

**Interfaces:**
- Consumes: `FILE_KEY`
- Produces: three collections. `radius` with `radius/4`, `radius/6`, `radius/8`, `radius/12`, `radius/16`, `radius/24`, `radius/32`, `radius/pill`. `space` with `space/4` through `space/160`. `type` with `type/13` through `type/72`. All FLOAT, single mode.

- [ ] **Step 1: Create all three collections**

Invoke `figma:figma-use`, then:

```js
function scale(collectionName, values, prefix) {
  const c = figma.variables.createVariableCollection(collectionName)
  const mode = c.modes[0].modeId
  return values.map(v => {
    const name = (v === 9999) ? `${prefix}/pill` : `${prefix}/${v}`
    const variable = figma.variables.createVariable(name, c, 'FLOAT')
    variable.setValueForMode(mode, v)
    return variable.name
  })
}

return [
  scale('radius', [4, 6, 8, 12, 16, 24, 32, 9999], 'radius'),
  scale('space',  [4, 8, 12, 16, 24, 32, 48, 64, 80, 120, 160], 'space'),
  scale('type',   [13, 14, 16, 18, 20, 28, 40, 56, 72], 'type'),
].flat()
```

- [ ] **Step 2: Verify**

Read the variables back with the Plugin API snippet in Global Constraints. Expected: 8 radius, 11 space, 9 type = 28 new variables, on top of the 16 colours from Task 2.

If the count is short, a value collided with an existing name — list the collection contents and reconcile before continuing.

- [ ] **Step 3: Record elevation and motion as a documentation frame, not variables**

Figma cannot bind shadow or duration to variables in a way that survives export, so these live as a written reference on `01 Foundations`. Create a text frame titled `Elevation & motion` containing exactly:

```
ELEVATION — all shadows tinted with ink, never black
none    (flat tiles on tinted grounds)
sm      0 1px 2px ink/6%     resting cards
lift    0 8px 24px ink/10%   card hover, persona card
pop     0 12px 32px ink/14%  floating nav pill

MOTION
press          120-180ms
state change   180-260ms
entrance       240ms ease-out
exit           180ms ease-in
ceiling        300ms, nothing above it

FORBIDDEN
No loops, drifts, pulses, shimmers or travel. No beams along a path,
no aurora or gradient-shifting text, no shimmer sweeps, no meteors,
no particle fields, no ambient background motion. Everything is
triggered by arrival or input, plays once, and stops.
```

- [ ] **Step 4: Commit the checkpoint**

```bash
git commit --allow-empty -m "design: radius, space and type scales plus the motion reference

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Type specimen — DECISION GATE

**Files:**
- Modify: Figma file `FILE_KEY`, page `01 Foundations`

**Interfaces:**
- Consumes: `color` and `type` variables from Tasks 2–3
- Produces: a decision on the hero headline, recorded in the spec. No component depends on this task's output except the hero in Task 10.

This task ends by stopping and asking the user. Do not proceed past it unattended.

- [ ] **Step 1: Build the specimen frame**

Invoke `figma:figma-use`. Create a frame on `01 Foundations` named `Type specimen`, 1440 wide, background bound to `color/paper`. Inside, set the full ramp in the correct family per the size floor:

| Size | Family | Weight | Sample string |
|---|---|---|---|
| 72 | Stack Sans Notch | SemiBold | `Write yourself down once.` |
| 72 | Stack Sans Notch | SemiBold | `Explain yourself once.` |
| 56 | Stack Sans Notch | SemiBold | `Everything your assistants can ask for.` |
| 40 | Stack Sans Notch | Medium | `Three steps.` |
| 28 | Geist | SemiBold | `Nothing lands until you say so.` |
| 20 | Geist | Medium | `Every client sees only the slice you allow.` |
| 18 | Geist | Regular | `Every new AI conversation starts from nothing.` |
| 16 | Geist | Regular | `Your role, your stack, how you like answers written.` |
| 14 | Geist | Regular | `Invite-only while it's small.` |
| 13 | Geist Mono | Medium | `PORTABLE CONTEXT FOR AI` (uppercase, 0.12em tracking) |

- [ ] **Step 2: Prove the 40px floor is a real rule, not an assertion**

Directly beneath, add a comparison row: the string `Three steps.` set at 28px in Stack Sans Notch beside the same string at 28px in Geist. Label it `Below the floor — the notches stop reading and it collapses into Geist`.

This exists so the reviewer can see why the rule is there rather than take it on trust.

- [ ] **Step 3: Screenshot and check the render**

Run `get_screenshot` on the `Type specimen` frame. Inspect the image: every row must render in its intended family. If any row has silently fallen back to a default sans, the font name string is wrong — correct it against the exact family and style names returned in Task 1 Step 2 and re-run.

- [ ] **Step 4: STOP and ask the user**

Present the screenshot and ask exactly this:

> Two hero headlines at 72px. "Write yourself down once." or "Explain yourself once."? The second hits the repetition pain harder but can read as being told off.

Wait for the answer. Then record it in the spec:

```bash
# Replace the Open questions bullet for the hero headline with the decision,
# stating which was chosen and, in one clause, why.
git add docs/superpowers/specs/2026-08-04-mygist-landing-design.md
git commit -m "docs: hero headline chosen from the Figma specimen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Gradient assets — DECISION GATE

**Files:**
- Create: `design/gradients/edge-strip-{light,dark}.png`
- Create: `design/gradients/hero-field-{light,dark}.png`
- Create: `design/gradients/tile-cap-{indigo,clay,verdigris}-{light,dark}.png`
- Modify: `design/gradients/README.md`
- Modify: Figma file `FILE_KEY`, page `01 Foundations`

**Interfaces:**
- Consumes: the brand colours from Task 2
- Produces: ten PNGs, imported into Figma as fills available to Tasks 8–11.

- [ ] **Step 1: Open the local tool**

```bash
open "$HOME/Downloads/gradientool-206c8092.html"
```

It is a saved single-file copy of gradientool.com — canvas 2D, no network needed. If the file is missing, fetch a fresh copy from https://www.gradientool.com/ before continuing.

- [ ] **Step 2: Lock the palette**

Set the state to the reference ramp given in Global Constraints. Do not substitute brand colours — the brand-locked version was tried and produced mud.

```
0.00  #1C1917      0.44  #2345E0      0.72  #FF9DC5      1.00  #FBF0EE
grain 0.52 · seam 0.05 · depth3d 0.55 · shadow 1
one peak · peakPos 0.5 · direction up · gradMap bar · count 9 · depth 0.45
```

`window.GR_DEBUG.state` is the tool's own exposed state object; set the stops there and call `GR_DEBUG.render()` rather than driving sliders. Read the state back afterwards to confirm it held.

- [ ] **Step 3a: Generate two assets and stop for judgement**

Produce `edge-strip-light` and `hero-field-light` only, to the specifications in the table below, then stop and present them. These two carry the look: the edge strip is the signature element repeated on every section, and the hero field is the largest area of gradient on the page. If the direction is wrong, it is wrong for all ten, and eight more files is wasted work.

The tool is a GUI. Drive it with Playwright (see the `webapp-testing` skill) rather than by hand: its sliders carry stable ids such as `i-grainIntensity`, `i-seam` and `i-depth3d`, so parameters can be set programmatically and recorded exactly. Read the result straight off the `<canvas>` with `toDataURL` rather than using the export button — fewer moving parts, and it gives the exact pixels the canvas holds.

**If the colour stops cannot be set programmatically, stop and report.** Do not generate assets in the tool's default palette and plan to recolour later. A stray non-brand hue is the single most likely failure in this task, and it stays invisible until the asset is sitting next to the real palette.

- [ ] **Step 3b: Generate the remaining eight**

Only after the direction is approved.

| Asset | Size | Colours | Notes |
|---|---|---|---|
| `edge-strip-light` | 2880×24 | indigo → clay → verdigris | The signature. Reads at 12px tall on the page, so generate at 2x and keep the band structure coarse — fine detail vanishes. |
| `edge-strip-dark` | 2880×24 | same, dark values | |
| `hero-field-light` | 2880×1600 | indigo dominant, paper falloff | Soft, low contrast. It sits behind the mockup and must not compete with it. |
| `hero-field-dark` | 2880×1600 | same, dark values | |
| `tile-cap-indigo-light` | 1200×16 | indigo | |
| `tile-cap-clay-light` | 1200×16 | clay | |
| `tile-cap-verdigris-light` | 1200×16 | verdigris | |
| `tile-cap-{indigo,clay,verdigris}-dark` | 1200×16 | dark values | Three files |

Export each at 2x into `design/gradients/`.

- [ ] **Step 4: Record the parameters so this is reproducible**

For each asset, append a block to `design/gradients/README.md` under `## Assets`:

```markdown
### edge-strip-light.png
2880x24 @2x · stops: indigo #3D5DDB, clay #E47B4E, verdigris #39757F
grain 0.52 · seam 0.05 · depth3d 0.55 · treatment: contour / filled bands
frequency <value> · weight <value> · angle <value> · layers <value>
```

Fill in the real values used. A block with placeholders is a task failure — the whole point is that the next person can regenerate the asset.

- [ ] **Step 5: Import into Figma**

Invoke `figma:figma-use`. Use `upload_assets` to bring the ten PNGs into `FILE_KEY`, then lay them out on `01 Foundations` in a frame named `Gradient assets`, each labelled with its filename, light and dark side by side.

- [ ] **Step 6: Check the palette lock held**

Run `get_screenshot` on the `Gradient assets` frame. Inspect every asset. If any shows a hue that is not indigo, clay, verdigris or the neutrals — a stray green, purple or yellow from a leftover default stop — regenerate that asset. This is the single most likely failure in the task, because the tool ships with its own palette and a missed stop is invisible until it is on the page.

- [ ] **Step 7: STOP and ask the user**

Present the screenshot and ask:

> Ten gradient assets on the reference ramp. The edge strip is the signature element and appears on every section, so it matters most. Too loud, too quiet, or right?

Wait for the answer and regenerate if asked.

- [ ] **Step 8: Commit**

```bash
git add design/gradients/
git commit -m "design: gradient assets on the reference ramp, with their generation parameters

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Capture the running application

**Files:**
- Create: `design/screens/editor-persona.png`
- Create: `design/screens/editor-proposals.png`
- Create: `design/screens/editor-scope.png`
- Create: `design/screens/editor-export.png`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: reference screenshots. Task 9 builds every product object from these and from nothing else.

This task exists because the spec forbids showing UI that does not exist. Build the mockups from what is on screen, not from memory of what the app probably looks like.

- [ ] **Step 1: Run the app**

```bash
docker build -t mygist .
docker run -p 1120:1120 -e DATABASE_URL="postgresql://…" mygist
```

Substitute a real `DATABASE_URL`. If no local Postgres is available, ask the user for one rather than guessing — a failed connection produces an empty editor, which is useless as mockup source.

- [ ] **Step 2: Seed Maya**

Create an account and populate the persona with Maya Ellis's details exactly as given in the Global Constraints. Enter them through the web UI so the data lands in the shape the app expects.

- [ ] **Step 3: Capture four screens**

Use the `webapp-testing` skill (Playwright) at 1440×900, or capture manually:

| File | Screen |
|---|---|
| `editor-persona.png` | The editor with Maya's profile section open |
| `editor-proposals.png` | The Review tab with the newsletter proposal pending |
| `editor-scope.png` | Whatever surface exposes scopes — the consent screen if the editor has no scope picker |
| `editor-export.png` | Account → Data → Export |

- [ ] **Step 4: Reconcile the spec against reality**

Compare each screenshot to the spec's product-object list. If the app has no scope selector UI at all, the spec's component 13 describes something that does not exist. Report the mismatch to the user and ask whether to cut the component or design it as a proposal. Do not quietly invent it.

- [ ] **Step 5: Commit**

```bash
git add design/screens/
git commit -m "design: reference captures of the running editor with the demo persona

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Shell, action and content components

**Files:**
- Modify: Figma file `FILE_KEY`, page `02 Components`

**Interfaces:**
- Consumes: all variables from Tasks 2–3, gradient assets from Task 5
- Produces: components `Page frame`, `Nav pill`, `Footer`, `Button`, `Waitlist field`, `Section header`, `Step card`, `Pull-quote`. Button variant properties: `variant` = `primary | secondary | ghost`, `size` = `sm | md | lg`. Waitlist field variant property: `state` = `idle | focus | submitting | success | error`.

- [ ] **Step 1: Build Button**

Invoke `figma:figma-use` and `figma:figma-generate-library`. Create a component set named `Button` with 9 variants (3 variants × 3 sizes).

Heights: `sm` 36, `md` 44, `lg` 56. Radius bound to `radius/pill` on all. Horizontal padding: `sm` `space/16`, `md` `space/24`, `lg` `space/32`. Label in Geist Medium at `type/14` (sm) or `type/16` (md, lg).

Fills: `primary` = `color/indigo` with white label. `secondary` = `color/card` with `color/ink` label and a 1px `color/border` stroke. `ghost` = transparent with `color/ink` label, no stroke.

- [ ] **Step 2: Build Waitlist field**

Component set named `Waitlist field`, 5 variants on the `state` property. Container 56 tall, radius `radius/pill`, fill `color/card`, 1px `color/border` stroke, holding an email input and an `lg` primary Button labelled `Join the waitlist`.

| State | Treatment |
|---|---|
| `idle` | Placeholder `you@email.com` in `color/muted-fg` |
| `focus` | 2px `color/indigo` stroke, caret visible |
| `submitting` | Button label reads `Joining…`, button at 60% opacity |
| `success` | Whole field replaced by `color/indigo-tint` fill, a check mark, and `You're on the list. Watch for an invite.` |
| `error` | 2px `color/destructive` stroke, message beneath: `That doesn't look like an email address.` |

The success state is the last thing a converted visitor sees, so it gets the same care as `idle`, not less.

- [ ] **Step 3: Build the shell components**

`Page frame` — a 32px-radius container the whole page sits inside. **It does not contain the edge strip.**

`Edge strip` — its own component, 12px tall, full viewport width, **square corners**, with a `theme` property (`light`/`dark`) carrying `edge-strip-light.png` and `edge-strip-dark.png`. It sits at the very top of the page, above everything including the nav pill, and bleeds to both viewport edges.

The strip cannot live inside `Page frame`: a 32px-radius container would clip it away from the viewport edge, and full-bleed is the point.

`Nav pill` — floating, detached 16px from the top, radius `radius/pill`, fill `color/card` at 80% opacity with a background blur (frosted glass, permitted here and nowhere else), shadow `pop`. Contents: the MyGist mark at left, and `Sign in` at right.

`Footer` — fill `color/ink`, text `color/paper`, links to Docs, GitHub and Self-host.

- [ ] **Step 4: Build the content components**

`Section header` — vertical stack: eyebrow (Geist Mono, `type/13`, uppercase, 0.12em tracking, `color/muted-fg`), display (Stack Sans Notch SemiBold, `type/56`), sub (Geist, `type/18`, `color/muted-fg`). Gap `space/12`.

`Step card` — numbered, radius `radius/24`, fill `color/card`, shadow `sm`.

`Pull-quote` — Geist Medium `type/28`, no quotation marks drawn, a 3px `color/clay` rule at the left.

- [ ] **Step 5: Verify every component binds variables rather than hardcoding**

Run `get_variable_defs` scoped to `02 Components`. Every fill, radius and font size on every component must resolve to a variable. A raw hex or a literal `24` in a component is a task failure: the point of the system is that changing `color/clay` once changes the page.

Fix any unbound property before committing.

- [ ] **Step 6: Commit the checkpoint**

```bash
git commit --allow-empty -m "design: shell, action and content components, all variable-bound

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Bento tile component

**Files:**
- Modify: Figma file `FILE_KEY`, page `02 Components`

**Interfaces:**
- Consumes: variables from Tasks 2–3, tile-cap gradients from Task 5
- Produces: component set `Bento tile` with variant properties `width` = `1col | 2col` and `media` = `none | ui`.

Adapted from Magic UI's `bento-grid`. That component ships `rounded-xl` (12px), hardcoded `neutral-*` text colours, its own box-shadows, and Radix icons. All four are replaced.

- [ ] **Step 1: Build the tile**

Radius `radius/24` — not the registry's 12px. Fill `color/card`, 1px `color/border` stroke. Shadow `sm` at rest. **Title in Geist SemiBold `type/20` bound to `color/indigo`** — not ink. Body in Geist `type/16` bound to `color/muted-fg`.

**No icon and no tile cap.** Both were built and then cut once the visual direction was set from reference images: the tiles are plain cards whose colour arrives from the Indigo title and the product UI, and an 8px gradient band fought that. The gradient signature lives on the page frame's edge strip instead.

Widths: `1col` = 400, `2col` = 824. Row height 352 (the registry's `22rem`). Gap between tiles `space/16`.

- [ ] **Step 2: Build the `media = ui` variant — the media bleeds**

This is the point of the whole component, so get it right. The product UI is **larger than the tile and clipped by it**, running off the bottom and right edges rather than sitting in a bounded box. A contained thumbnail is the look the reference deliberately moves away from.

Set `clipsContent = true` on the tile. Inside, a frame named exactly `media slot`, positioned to overflow:

| Variant | Tile | `media slot` | Position |
|---|---|---|---|
| `1col` | 400×352 | 520×280 | x `space/32`, top at y 168 — overflows ~152px right, ~96px bottom |
| `2col` | 824×352 | 1000×300 | x `space/48`, top at y 152 — overflows ~224px right, ~100px bottom |

Give the slot a soft fade where it leaves the tile: a gradient mask from opaque at the top-left to transparent toward the bottom-right edge, so the UI dissolves rather than being guillotined.

The slot is **not** empty, and cannot be: a Figma fade needs a mask, and a mask is a child node. It holds two children:

- `fade mask` — `isMask = true`, the gradient that dissolves the bleed. **Structural. Task 9 must not delete or reorder it.** Note `isMask` masks *later* siblings, so it comes first.
- `media placeholder (demo only)` — a flat `color/muted` rectangle so the component reads before real content exists. **This is what Task 9 replaces.**

An earlier draft of this step asked for a fade and an empty slot in the same breath, which is not possible.

- [ ] **Step 3: Record the hover spec, do not wire it**

Hover is wired in Task 13, which owns every interaction. Do not wire it here, and do not add a hover variant axis.

The reason is a constraint worth knowing: Figma's `CHANGE_TO` reaction only resolves to sibling variants inside the same set, so a variant-driven hover needs its own property axis — which would contradict this task's four-variant contract. An earlier draft of this plan asked for both and could not have had them.

Record the intended behaviour in the component's description instead, for Task 13 to implement: shadow `sm` → `lift` over 240ms ease-out, icon scales to 0.9, title lifts 3px. The registry's 300ms is the ceiling and is not exceeded.

No CTA link is built. The registry's `href` and `cta` props go unused — a page with one action does not offer seven competing ones.

- [ ] **Step 4: Verify**

Run `get_screenshot` on the component set. Expected: four variants at `radius/12`, no tile cap, no icon, an Indigo title, and on the `media = ui` variants the media visibly running off the bottom and right edges rather than sitting in a box.

- [ ] **Step 5: Commit the checkpoint**

```bash
git commit --allow-empty -m "design: bento tile adapted from the Magic UI registry to MyGist tokens

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Product objects

**Files:**
- Modify: Figma file `FILE_KEY`, page `02 Components`

**Interfaces:**
- Consumes: Task 6 screenshots, Task 7 and 8 components
- Produces: components `Product mockup`, `Persona card`, `Client chip`, `Scope selector`, `Proposal card`, `Export view`. Every one populated with Maya.

Build each from `design/screens/`. If a screenshot does not show a thing, the thing does not go in the mockup.

- [ ] **Step 1: Build Product mockup**

A browser frame based on Magic UI's `safari`, with its macOS grey chrome recoloured to `color/muted` and its stroke to `color/border`, so it does not fight the warm 24–32px containers around it. URL bar reads `mygist.thuradev.qzz.io`. Inside sits `editor-persona.png` rebuilt as vector, not placed as a bitmap — a placed screenshot cannot be recoloured for dark mode.

- [ ] **Step 2: Build Persona card**

The editor's **Profile** section, transcribed from `design/screens/editor-persona.png`. Radius `radius/12` outer, `radius/8` inner rows — concentric, one step down from the original 24/16.

Labelled fields with their captured values:

```
Name             Maya Ellis
Preferred name   Maya
Current role     Marketing Assistant
Organisation     Northgate Studio
Location         Manchester, UK
Nationality      British
Bio              Marketing assistant, six months out of an English and Media
                 degree. I write most of the words that go out: newsletter,
                 socials, the odd case study. I run three assistants a day and
                 got tired of explaining my tone rules to each one.
```

**Do not build a `WRITES / USES / GOAL / LEARNS` summary.** An earlier draft of this plan specified one and no such view exists; the Profile section is a form. Maya's tone rules and goals are real, but they live in the Preferences and Goals sections.

- [ ] **Step 3: Build Client chip**

Radius `radius/pill`, fill `color/card`, 1px `color/border`, logo plus name. Six instances: `Claude`, `Codex`, `Raycast`, `Notion AI`, `Hermes`, and a text-only `anything with MCP connectors`. Do not add clients beyond this list.

- [ ] **Step 4: Build Scope payload**

**Not a selector.** Task 6 established that no scope-selector UI exists — read scopes are `get_context` parameters in `backend/pack_loader.py`, and the app's "scopes" are OAuth permissions. Do not draw a segmented control.

Build from `design/screens/editor-preferences.png`: the Preferences section showing Maya's tone rules and dislikes, with a Geist Mono label above it reading `SCOPE: professional`. This shows what a scope returns rather than a control that does not exist.

- [ ] **Step 5: Build Proposal card**

Radius `radius/16`, fill `color/card`, shadow `sm`. Content, verbatim:

```
PROPOSED BY AN ASSISTANT
Maya now owns the monthly newsletter

Reasoning   You mentioned taking over the newsletter from Priya this month.
Evidence    "I've got the newsletter now, so that's on me from June."

[ Approve ]  [ Edit ]  [ Reject ]
```

- [ ] **Step 6: Build Export view**

The **Account & Connection** dialog on its **Data** tab, transcribed from `design/screens/editor-export.png`. Radius `radius/12`, fill `color/card`, shadow `lift` (it is a modal).

```
Account & Connection
Manage your connection, tokens, and data.
[ Connection ]  [ API tokens ]  [ Data ]        <- Data selected

Export backup                                   [ Export ]
Download everything as a zip.

Import backup                                   [ Choose file ]
Restore from a backup zip. A safety backup is made first.

Import mode
[ Replace ]  [ Merge ]
Replace overwrites your existing data with the backup's contents.
```

**Not a JSON viewer.** An earlier draft specified "readable JSON in Geist Mono with a Download button". The real export is a **zip**, from a settings dialog. The first capture of this screen caught the Connection tab by mistake; the Data tab is the right one.

- [ ] **Step 7: Verify against reality, not against this plan**

Put each component beside its source screenshot from `design/screens/` and compare. Any control, label or field present in the component but absent from the screenshot is invented and must come out.

- [ ] **Step 8: Commit the checkpoint**

```bash
git commit --allow-empty -m "design: product objects, built from captures of the running app

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Page assembly at 1440

**Files:**
- Modify: Figma file `FILE_KEY`, page `03 Landing`

**Interfaces:**
- Consumes: every component from Tasks 7–9, gradients from Task 5
- Produces: frame `Landing — 1440`, six sections in order.

Copy is transcribed exactly from the spec's copy deck at `docs/superpowers/specs/2026-08-04-mygist-landing-design.md`. Do not improvise, tighten or "improve" it — it has already been through an editing pass.

- [ ] **Step 1: Build the frame and section grounds**

Invoke `figma:figma-use` and `figma:figma-generate-design`. Frame `Landing — 1440`, 1440 wide, inside a `Page frame`. Section grounds in order:

| # | Section | Ground |
|---|---|---|
| 1 | Hero | `color/paper` + `hero-field` gradient |
| 2 | Works with | `color/paper` |
| 3 | How it works | `color/clay-tint` |
| 4 | What it does | `color/paper` |
| 5 | Closing CTA | `color/ink` + indigo gradient |
| 6 | Footer | `color/ink` |

Section padding `space/120` top and bottom, `space/80` horizontal.

- [ ] **Step 2: Assemble the hero**

Eyebrow `PORTABLE CONTEXT FOR AI`. Headline at `type/72` in Stack Sans Notch, reading exactly `Explain yourself once.` Sub at `type/18`. Then the `Waitlist field` in `idle`, then the small link `Already have a code? Sign in.` in `type/14`.

`Product mockup` sits below, centred on the hero gradient field. `Client chip` row beneath it, with no line drawn between them.

- [ ] **Step 3: Assemble sections 2 and 3**

Section 2: the six client chips in a row, with the line `One URL. Any client that speaks MCP picks it up.`

Section 3: `Section header` with eyebrow `HOW IT WORKS`, display `Three steps.`, sub `After that, every chat starts with you already in it.` Then three `Step card`s carrying the spec's step copy verbatim.

- [ ] **Step 4: Assemble the bento**

`Section header` with eyebrow `WHAT IT DOES` and display `Everything your assistants can ask for.` Then a 3-column grid, `space/16` gap, row height 352:

```
row 1   [ Scoped reads      2col, media=ui ] [ Search        1col ]
row 2   [ Your sections 1col ] [ Proposals  2col, media=ui ]
row 3   [ Consent 1col ] [ Skills 1col ] [ Run it yourself 1col ]
```

`Scope payload` drops into the Scoped reads media slot; `Proposal card` into the Proposals media slot.

In both cases, **replace the `media placeholder (demo only)` node and leave `fade mask` alone** — it is what makes the bleed dissolve, `isMask` masks later siblings so it must stay first, and deleting it leaves the media guillotined at the tile edge.

**There are no tile caps.** An earlier draft assigned a gradient cap colour per tile; caps were cut when the bento's direction was set from reference. Do not add them back, and do not colour the tiles individually — every tile is `color/card` with a `color/border` hairline, and the differentiation comes from the Indigo title and the bleeding product UI.

Tile copy is transcribed from the spec's seven tile blocks, verbatim.

- [ ] **Step 5: Assemble the closing and footer**

Closing on `color/ink`: display `Stop starting from nothing.` at `type/56`, sub `Leave your email and we'll send an invite when a slot opens.`, then a `Waitlist field`. The indigo gradient sits over the ink ground.

Footer: `Footer` component.

- [ ] **Step 6: Verify the whole page in both modes**

Run `get_screenshot` on `Landing — 1440` in Light, then switch the file's colour mode to Dark and screenshot again. Check:

- No lorem, no `[placeholder]`, no unstyled default text anywhere
- Every heading at 40px and above is Stack Sans Notch; nothing below 40px is
- Section grounds alternate as the table above specifies
- The page resolves into dark at the closing CTA

- [ ] **Step 7: Commit the checkpoint**

```bash
git commit --allow-empty -m "design: landing page assembled at 1440, both colour modes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Mobile at 390

**Files:**
- Modify: Figma file `FILE_KEY`, page `03 Landing`

**Interfaces:**
- Consumes: `Landing — 1440` from Task 10
- Produces: frame `Landing — 390`

- [ ] **Step 1: Build the frame**

Frame `Landing — 390`, 390 wide. Section padding drops from `space/120` to `space/64` vertical and `space/24` horizontal.

- [ ] **Step 2: Collapse the type ramp**

Hero headline drops from `type/72` to `type/40` — still at the Stack Sans Notch floor, so the notches still read. Section displays drop from `type/56` to `type/40`. Nothing goes below 40px in the display face; if a heading will not fit at 40, the copy is too long and gets cut rather than the type shrinking below the floor.

- [ ] **Step 3: Collapse the bento to one column**

All seven tiles become full width, stacked, in the reading order given in Task 10 Step 4. The `2col` tiles keep their media slots, scaled to fit.

- [ ] **Step 4: Reflow the hero and clients**

`Product mockup` scales to 342 wide. Client chips wrap to three rows of two. `Waitlist field` stacks the input above the button rather than sitting inline — at 390 an inline button leaves the input too narrow to read an email address in.

- [ ] **Step 5: Verify**

Run `get_screenshot` on `Landing — 390`. Check that no text is clipped, no element overflows the frame horizontally, and every tap target is at least 44px.

- [ ] **Step 6: Commit the checkpoint**

```bash
git commit --allow-empty -m "design: mobile at 390, bento collapsed to one column

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 12: Contrast audit

**Files:**
- Modify: Figma file `FILE_KEY`, page `01 Foundations`
- Create: `design/contrast-audit.md`

**Interfaces:**
- Consumes: the finished pages from Tasks 10–11
- Produces: a measured pass/fail table. The spec requires every pair measured, not eyeballed.

- [ ] **Step 1: Enumerate every foreground/background pair in use**

Walk `Landing — 1440` and list each text-on-ground combination. At minimum:

```
ink on paper          ink on clay-tint       ink on verdigris-tint
ink on card           muted-fg on paper      muted-fg on card
muted-fg on clay-tint indigo on paper        indigo on clay-tint
paper on ink          paper on indigo        white on indigo
```

- [ ] **Step 2: Measure each pair in both modes**

```bash
cat > /tmp/contrast.mjs <<'EOF'
function hslToRgb(h, s, l) {
  s /= 100; l /= 100
  const k = n => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}
const lum = ([r, g, b]) => {
  const f = c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
export const ratio = (a, b) => {
  const [l1, l2] = [lum(hslToRgb(...a)), lum(hslToRgb(...b))]
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return ((hi + 0.05) / (lo + 0.05)).toFixed(2)
}
EOF
```

Import it and print every pair. Body text needs 4.5, large text and UI boundaries need 3.0.

- [ ] **Step 3: Write the audit**

Create `design/contrast-audit.md` with a table: foreground, ground, mode, ratio, body pass/fail, large pass/fail.

- [ ] **Step 4: Fix every failure**

For any pair below its threshold, adjust the *foreground* lightness, never the tint — the tints were chosen by eye and approved, and changing them invalidates that decision. Re-measure after each fix.

If a pair cannot pass without visibly changing the design, stop and report it to the user with the numbers rather than shipping a failing pair or quietly redesigning around it.

- [ ] **Step 5: Commit**

```bash
git add design/contrast-audit.md
git commit -m "design: measured contrast audit across both colour modes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 13: Prototype

**Files:**
- Modify: Figma file `FILE_KEY`, page `03 Landing`

**Interfaces:**
- Consumes: everything
- Produces: a clickable prototype. Last, because it is the most expensive thing to build well and depends on every other decision landing first.

- [ ] **Step 1: Wire the waitlist field**

Load `figma:figma-use-motion` alongside `figma:figma-use`. Connect the five `Waitlist field` states: `idle` → `focus` on click (180ms), `focus` → `submitting` on submit (180ms), `submitting` → `success` after 800ms (240ms ease-out). Wire `error` from `submitting` as an alternate branch.

- [ ] **Step 2: Build the hero arrival sequence**

Three ghosted chat bubbles, each opening with the same self-introduction, stack up and collapse into the `Product mockup`. Then the six client chips fade up in sequence, 60ms apart.

Timings: each bubble enters at 240ms ease-out, 80ms apart. The collapse runs 240ms. Chips begin after the collapse completes. Total elapsed under 600ms, no single step over 240ms.

It plays once on arrival and never again. Nothing is drawn between the mockup and the chips — an earlier draft ran lines outward, which reads as the beam effect the spec bans even when it plays once.

- [ ] **Step 3: Wire the section entrances**

Each of sections 2 to 6 enters on scroll with the `blur-fade` treatment from the Magic UI registry: opacity 0 → 1 with a 4px blur resolving to 0, over 240ms ease-out, triggered once when the section first reaches the viewport.

Sections do not re-animate on scroll back up. A section that fades in every time it is scrolled past is ambient motion by another name, and the ban list applies.

- [ ] **Step 4: Wire hover states**

Bento tiles lift `sm` → `lift` over 240ms. Buttons press over 140ms. Nothing else moves.

- [ ] **Step 5: Verify against the motion rules**

Play the prototype through. Check:

- Nothing loops, drifts, pulses or shimmers
- No single transition exceeds 300ms
- The hero sequence resolves and stops
- A reduced-motion variant exists in which the hero sequence is replaced by its end state, shown immediately

Any animation still running five seconds after arrival is a failure — find it and remove it.

- [ ] **Step 6: Final read-through against the spec**

Open the spec's Success criteria and confirm each line. Report any that cannot be ticked, with the reason, rather than ticking it optimistically.

- [ ] **Step 7: Commit**

```bash
git commit --allow-empty -m "design: prototype wired, motion verified against the ban list

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Notes for the implementer

**This plan builds a Figma file, not code.** There is no test suite. Verification is done by reading state back out of Figma — the Plugin API for variables, `get_metadata` with an explicit nodeId, `get_screenshot` for appearance — rather than by trusting that a write succeeded. Read the Global Constraints note on which read tools actually work before choosing one; two of the obvious choices do not. Several tasks fail silently if you skip the read-back: fonts fall back without erroring, and a gradient with a stray colour looks fine until it is next to the brand palette.

**Three tasks stop and ask.** Tasks 4 and 5 are decision gates on things only a person can judge by eye. Task 6 Step 4 stops if the app turns out not to have a UI the spec assumed. Do not guess past any of them.

**The empty commits are deliberate.** Figma state does not live in git, so checkpoint commits record which tasks completed. Tasks that produce real files commit those files normally.
