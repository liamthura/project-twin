# MyGist App Redesign — Figma Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MyGist app redesign as a Figma prototype — a MyGist-themed Reshaped foundation, a component library, and every redesigned surface at 1440 and 390 — from the approved spec at `docs/superpowers/specs/2026-08-04-mygist-app-reshaped-design.md`.

**Architecture:** One Figma design file, nine pages. Variables are the single source of truth and are named so they could be exported as CSS custom properties, or fed to Reshaped's `ThemeDefinition`, without renaming. Components are built once on the Components page with full variant sets and variable bindings, then instanced everywhere else — no screen contains a locally-styled rectangle standing in for a component. Screens are assembled section by section, validated by screenshot after each, never in one large script.

**Tech Stack:** Figma design file via the `use_figma` MCP tool (Plugin API), the duplicated Reshaped v3.9 Figma community library as geometry reference, `search_design_system` for component discovery, the MyGist app source (`frontend/src`) as the source of truth for what each surface actually contains.

## Global Constraints

Every task's requirements implicitly include this section.

### Mandatory skill loading

- Before **every** `use_figma` call: invoke `figma:figma-use`. Pass `skillNames: "figma-use"` on the call.
- Before `create_new_file`: invoke `figma:figma-create-new-file`.
- When creating variables or components (Tasks 2–7): load `figma:figma-generate-library` alongside `figma-use`.
- When assembling screens (Tasks 8–13): load `figma:figma-generate-design` alongside `figma-use`.
- When adding motion (Task 14): load `figma:figma-use-motion` alongside `figma-use`.

Skipping these causes hard-to-debug failures. This is not optional.

### Plugin API rules that bite

- **Max 10 logical operations per `use_figma` call.** Split anything larger.
- Colours are **0–1 range**, never 0–255. Paint `color` takes `{r,g,b}` only — opacity goes at paint level.
- Fills/strokes are read-only arrays: clone, modify, reassign.
- **Every text mutation:** `loadFontAsync` → `await` → mutate → return affected node IDs.
- Wrapping text needs `textAutoResize = 'HEIGHT'` **and** an explicit width via `'FIXED'` + `resize()`. `FILL` alone collapses the node.
- `resize()` **before** setting sizing modes. `layoutSizing* = 'FILL'` only **after** `appendChild`.
- `await figma.setCurrentPageAsync(page)` — the sync setter throws. **At most one page switch per call**; fan multi-page work out as parallel calls in a single message.
- Always set `variable.scopes` explicitly. `ALL_SCOPES` pollutes every picker.
- `setBoundVariableForPaint` returns a **new** paint — capture and reassign.
- **Return every created and mutated node ID** from every script.
- On error: **stop**, read it, fix, then retry. Failed scripts are atomic — nothing was written.

### The standard script preamble

Several scripts below are partial and refer to `byName`, `scaleByName`, `FONT_SANS`,
`FONT_MONO`, `REGULAR_STYLE` and `SEMIBOLD_STYLE` without redefining them. Those
names come from this preamble. **Put it at the top of every `use_figma` call that
touches colour, scale or text**, substituting the page name and the values
recorded in Task 1:

```js
const page = figma.root.children.find(p => p.name === 'PAGE_NAME');
await figma.setCurrentPageAsync(page);          // once per call, never in a loop

const FONT_SANS = 'FONT_DECISION.sans';         // from Task 1 Step 5
const FONT_MONO = 'FONT_DECISION.mono';
const REGULAR_STYLE = 'REGULAR_STYLE_STRING';   // verbatim from Task 1 Step 4
const SEMIBOLD_STYLE = 'SEMIBOLD_STYLE_STRING'; // "SemiBold" vs "Semi Bold" matters
await figma.loadFontAsync({ family: FONT_SANS, style: REGULAR_STYLE });
await figma.loadFontAsync({ family: FONT_SANS, style: SEMIBOLD_STYLE });
await figma.loadFontAsync({ family: FONT_MONO, style: REGULAR_STYLE });

const byName = Object.fromEntries(
  (await figma.variables.getLocalVariablesAsync('COLOR')).map(v => [v.name, v]));
const scaleByName = Object.fromEntries(
  (await figma.variables.getLocalVariablesAsync('FLOAT')).map(v => [v.name, v]));
```

Loading a font you do not end up using is free. Failing to load one you do use
throws `Cannot write to node with unloaded font`, which is the single most common
way these scripts fail.

### Colour tokens

Light and dark values for one variable collection with two modes. Hex is for human checking; the `{r,g,b}` object is what goes in the script.

| Token | Light hex | Light rgb | Dark hex | Dark rgb |
|---|---|---|---|---|
| `paper` | #FAFAF9 | `{r:0.9818, g:0.9818, b:0.9782}` | #121211 | `{r:0.0721, g:0.0721, b:0.0679}` |
| `card` | #FFFFFF | `{r:1.0000, g:1.0000, b:1.0000}` | #1A1A19 | `{r:0.1020, g:0.1020, b:0.0980}` |
| `muted` | #F5F5F4 | `{r:0.9620, g:0.9620, b:0.9580}` | #242423 | `{r:0.1414, g:0.1414, b:0.1386}` |
| `ink` | #1C1917 | `{r:0.1100, g:0.0980, b:0.0900}` | #F5F5F4 | `{r:0.9620, g:0.9620, b:0.9580}` |
| `muted-fg` | #78726D | `{r:0.4725, g:0.4463, b:0.4275}` | #A8A29F | `{r:0.6580, g:0.6364, b:0.6220}` |
| `border` | #E7E5E4 | `{r:0.9060, g:0.8980, b:0.8940}` | #2A2A28 | `{r:0.1632, g:0.1632, b:0.1568}` |
| `indigo` | #3D5DDB | `{r:0.2395, g:0.3637, b:0.8605}` | #5C7BFA | `{r:0.3598, g:0.4839, b:0.9802}` |
| `indigo-tint` | #EBF0FF | `{r:0.9200, g:0.9427, b:1.0000}` | #282D3E | `{r:0.1560, g:0.1751, b:0.2440}` |
| `clay` | #E47B4E | `{r:0.8960, g:0.4816, b:0.3040}` | #DE855E | `{r:0.8708, g:0.5197, b:0.3692}` |
| `clay-tint` | #FBEBE4 | `{r:0.9844, g:0.9222, b:0.8956}` | #3C2820 | `{r:0.2340, g:0.1584, b:0.1260}` |
| `verdigris` | #39757F | `{r:0.2232, g:0.4603, b:0.4968}` | #4DA5B2 | `{r:0.3000, g:0.6467, b:0.7000}` |
| `verdigris-tint` | #E9F1F2 | `{r:0.9118, g:0.9433, b:0.9482}` | #1C2E30 | `{r:0.1110, g:0.1786, b:0.1890}` |
| `success` | #1A9948 | `{r:0.1015, g:0.5985, b:0.2837}` | #33CC6B | `{r:0.2000, g:0.8000, b:0.4200}` |
| `warning` | #C89004 | `{r:0.7840, g:0.5664, b:0.0160}` | #F4B925 | `{r:0.9550, g:0.7255, b:0.1450}` |
| `destructive` | #CA2B2B | `{r:0.7920, g:0.1680, b:0.1680}` | #E13333 | `{r:0.8804, g:0.1996, b:0.1996}` |

**Colour usage rules.** `clay`/`clay-tint` appear **only** on the onboarding spine, the delegate-to-client offer, and empty-state surfaces. `verdigris`/`verdigris-tint` mean **one** thing: a live client connection. Neither ever lands on a button, a label, or body text. Cards use `border` at rest; shadow is only for things that float.

### Type ramp

Token names are Reshaped v4's; values are MyGist overrides.

| Token | Size / line height | Face, weight | Used for |
|---|---|---|---|
| `featured-2` | 28 / 1.2 | Geist 600 | full-page empty state headline |
| `featured-3` | 20 / 1.3 | Geist 600 | section page title |
| `headline-1` | 18 / 1.4 | Geist 600 | modal title |
| `headline-2` | 16 / 1.4 | Geist 600 | subsection card title |
| `headline-3` | 14 / 1.4 | Geist 600 | in-card field group label |
| `body-1` | 16 / 1.6 | Geist 400 | long-form body, consent copy |
| `body-2` | 14 / 1.55 | Geist 400 | default UI text, all inputs |
| `caption-1` | 13 / 1.45 | Geist 400 | helper text, descriptions |
| `caption-2` | 13 / 1.4 | Geist Mono 400, +0.06em, uppercase | group eyebrows, version, keys |

**The app loads no display face.** Stack Sans Notch is landing-only; nothing in the app reaches 40px. Do not create a `featured-1` text style.

### Radius, space, elevation, motion

- `radius` s/m/l/xl = **4 / 6 / 8 / 12**. Concentric: a 12 card holds 8 rows holds 6 inputs. Never use 16/24/32 — those are landing values.
- Space: **4 · 8 · 12 · 16 · 24 · 32** only. Nothing above 32.
- `shadow-raised` = `0 1px 2px ink/6%`; `shadow-overlay` = `0 12px 32px ink/14%`. Tinted with ink, **never black**.
- Motion: `fast` 120ms, `medium` 200ms, `slow` 280ms, scroll ≤400ms. Easings `decelerate` `cubic-bezier(0,0,.2,1)`, `accelerate` `cubic-bezier(.4,0,1,1)`, `standard` `cubic-bezier(.4,0,.2,1)`, `emphasized` `cubic-bezier(.2,0,0,1)`.
- Nothing animates while idle. Nothing exceeds 400ms. Stagger caps at 5 items × 30ms.

### Copy rules

British English. **No em dashes in UI copy.** Banned words: "delve", "leverage", "seamless", "unlock", "empower". Empty states name what would live there and what puts it there — never "No data found", never apologetic.

### Content: the demo persona

Every populated surface shows **Maya Ellis** — 23, Manchester. Marketing assistant, six months out of an English and Media degree. British English, no exclamation marks, never the word "delve". Uses three assistants a day for drafts, research and meeting notes. Goal: move into brand strategy within two years. Learns examples first, theory later. In the review queue: *"Maya now owns the monthly newsletter"*, proposed by an assistant with a quote from her, awaiting approval.

She is deliberately not a developer, so **Preferences' Code Style group is genuinely empty for her** — that is the intended demonstration of the `empty` fill summary and the teaching empty state, not an oversight to fill in.

### Fill summary rule

| Node kind | Renders as |
|---|---|
| `fields` (fixed key set) | `2 of 5`, `3 of 3` |
| `list`, `strings` (unbounded) | `3 set`, `12 set` |
| `scalar` | nothing |
| any, when zero | `empty` |

### Page names

Exactly these, in this order: `00 Cover`, `01 Foundations`, `02 Components`, `03 Shell & Navigation`, `04 Section editor`, `05 Review`, `06 Onboarding`, `07 Auth & Settings`, `08 Motion`.

### Verification standard

Figma work has no unit tests. The analogue, and it is mandatory for every task:

1. State the expected structure **before** building (counts, names, hierarchy).
2. Build.
3. `get_metadata` to confirm structure matches.
4. `await node.screenshot()` to confirm it looks right. **Look specifically for clipped text, overlapping nodes, and collapsed zero-width text nodes** — the three most common and easiest to miss.
5. Fix before moving on. Never build on a broken foundation.

---

## Recorded values

Produced by Task 1. `FILE_KEY` is already resolved inline everywhere it appears in this document — no manual substitution remains for it. The placeholders that remain unresolved (`COLLECTION_ID`, `PAGE_ID`, `ROOT_ID`, `VARIANT_ID_*`, `FONT_DECISION.sans`/`.mono`, `REGULAR_STYLE_STRING`, `SEMIBOLD_STYLE_STRING`, etc.) are filled in by later tasks at their own runtime, once each value is known.

- **`FILE_KEY`**: `Ti7FlZLYOvX3goyvfypJBk`
- **`FONT_DECISION`**: `{ sans: 'Geist', mono: 'Geist Mono', regularStyle: 'Regular', semiboldStyle: 'SemiBold' }` — both `Geist` and `Geist Mono` are available (`listAvailableFontsAsync` rule 1 applied), so no Inter/Roboto Mono substitution is needed. Style strings are verbatim from `listAvailableFontsAsync()`: Geist and Geist Mono both expose `Black, Bold, ExtraBold, ExtraLight, Light, Medium, Regular, SemiBold, Thin` — note **no space** in `SemiBold`/`ExtraBold` (unlike Inter, which uses `Semi Bold`/`Extra Bold` with a space).
- **`RESHAPED_LIB_KEY`**: `null` — the duplicated Reshaped v3.9 library did not appear in `libraries_available_to_add` for this file's team (`Khant Thura's team`; `libraries_available_to_add_next_offset` was `null`, so pagination is exhausted). This is now the correct, final value, not a failure — see `RESHAPED_REF_FILE_KEY` below for how later tasks get geometry reference instead.
- **`RESHAPED_REF_FILE_KEY`**: `oR8g1o9qiluZAqHzMfieg0` — URL: `https://www.figma.com/design/oR8g1o9qiluZAqHzMfieg0/Reshaped-Design-System-v3.9--Community-`. The user provided this Reshaped v3.9 reference file directly. It is read as a **geometry reference only**, via `get_metadata` and `get_screenshot` — it is deliberately **not** a subscribed library, so nothing is ever instanced or imported from it. Tasks 5–7 copy proportions (heights, padding, focus-ring treatment, etc.) from it by eye/measurement and build every component locally in the app file.
- **`COLOUR_COLLECTION_ID`**: `VariableCollectionId:4:2` — Produced by Task 2. This is the `Colour` variable collection's ID; later tasks resolve `COLLECTION_ID` from this value when binding colour variables.
- **`LIGHT_MODE_ID`**: `4:0` — Produced by Task 2. The `Light` mode of the `Colour` collection.
- **`DARK_MODE_ID`**: `4:1` — Produced by Task 2. The `Dark` mode of the `Colour` collection.
- **Task 2 `variableIds`** (all in collection `VariableCollectionId:4:2`): `paper` = `VariableID:4:3`, `card` = `VariableID:4:4`, `muted` = `VariableID:4:5`, `ink` = `VariableID:4:6`, `muted-fg` = `VariableID:4:7`, `border` = `VariableID:4:8`, `indigo` = `VariableID:4:9`, `indigo-tint` = `VariableID:4:10`, `clay` = `VariableID:4:11`, `clay-tint` = `VariableID:4:12`, `verdigris` = `VariableID:4:13`, `verdigris-tint` = `VariableID:4:14`, `success` = `VariableID:4:15`, `warning` = `VariableID:4:16`, `destructive` = `VariableID:4:17`.
- **`SCALE_COLLECTION_ID`**: `VariableCollectionId:7:2` — Produced by Task 3. Mode `Mode 1` = `7:0`. Task 3 `variableIds`: `radius-s` = `VariableID:7:3`, `radius-m` = `VariableID:7:4`, `radius-l` = `VariableID:7:5`, `radius-xl` = `VariableID:7:6`, `space-4` = `VariableID:7:7`, `space-8` = `VariableID:7:8`, `space-12` = `VariableID:7:9`, `space-16` = `VariableID:7:10`, `space-24` = `VariableID:7:11`, `space-32` = `VariableID:7:12`.
- **`MOTION_COLLECTION_ID`**: `VariableCollectionId:7:13` — Produced by Task 3. Mode `Mode 1` = `7:1`. Task 3 `variableIds`: `duration-fast` = `VariableID:7:14`, `duration-medium` = `VariableID:7:15`, `duration-slow` = `VariableID:7:16`, `duration-scroll` = `VariableID:7:17`, `easing-decelerate` = `VariableID:7:18`, `easing-accelerate` = `VariableID:7:19`, `easing-standard` = `VariableID:7:20`, `easing-emphasized` = `VariableID:7:21`.
- **Task 3 `textStyleIds`**: `featured-2` = `S:8c53a2ec48cec65ae8dd09c82e5d2b1b92790edb,`, `featured-3` = `S:b64dd4d1f10e8f04d2ad75cd3ac3b4917138646f,`, `headline-1` = `S:2f151c5f267a1c937475bb62dca4fe1e782109be,`, `headline-2` = `S:8c19b10f1c13933916a09df777520734da81ebb0,`, `headline-3` = `S:868ef535b81546a8d4a15b32ef35a4bc2834d2ad,`, `body-1` = `S:4c0a7dfefeb26bf04e7d6d0767e14266acee373f,`, `body-2` = `S:7b2a17ce6a4397672b40e1ec6acaa2fc96987584,`, `caption-1` = `S:3fbb4e54fb967eef3923cb14852c06427f3c71e0,`, `caption-2` = `S:67d9c575f4707ce385fa563a0635917dc30f9e2d,`.
- **Task 3 `effectStyleIds`**: `shadow-raised` = `S:a3d8d8cb802153b071804af1f587b398c0f2e244,`, `shadow-overlay` = `S:1c90f6baec2795d0eb0aea3a9cbb3001363b7988,`.
- **Task 5 component sets** (all on page `02 Components`, `Ti7FlZLYOvX3goyvfypJBk`): `TextField` id `28:34` key `03456a0c6313dac68a36242f1b58d1aff3633f76` (6 variants); `Select` id `29:44` key `e0b8d0a3347f781580ec00daa7ef33a1a41e6003` (6 variants); `TextArea` id `30:38` key `68a397cd1d297404282a3860fd1fd15fe2618e66` (6 variants); `Switch` id `32:14` key `7a59f5e2f7fa475c526483a0ef2e9e26e5eba921` (4 variants); `Checkbox` id `37:12` key `3f6dbbcddfde74738d17ad7d7caa5b75ce5bcaca` (4 variants); `PinField` id `38:49` key `4e9b0daad2c4977f04aa1c2d86f8663db7e9d394` (4 variants). Reshaped reference file exposed no usable geometry (Community cover page only) so all proportions come from the brief's explicit values. Tasks 8–13 consume these sets via local `component.createInstance()`, not `importComponentByKeyAsync` — same file, no publish step exists.
- **Task 6 component sets** (all on page `02 Components`, `Ti7FlZLYOvX3goyvfypJBk`): `Button` id `56:40` key `4871a5017692949546fad7ddbdd822529b3ad437` (20 variants); `Chip` id `58:11` key `bdf575f08fa0361dbd1ab864ca4ed5d0454e564d` (3 variants); `Badge` id `58:23` key `30c88a54e2dead82d77d25e75392f06dc9ce44a7` (5 variants); `FillSummary` id `58:30` key `05008ed91e402b98c42e97e7063f02d418391099` (3 variants); `SubsectionCard` id `61:21` key `d9e1ec26b3c7e0e2ed1a519dac16bd7c5bc1e4f2` (3 variants); `EmptyState` id `62:14` key `1f8c3400fb755420009ec2ebd4d1bf64323870df` (2 variants). `EyebrowBand` is a bare `COMPONENT` (not a set, per ruling): id `61:22` key `4fd0ca5a66db03b957b7e00b7c75b9952a8be938`. `SubsectionCard` nests a local `FillSummary` instance in its header via `createInstance()`; `EmptyState` nests local `Button` instances (Ghost/Default for `Card`, Primary/Default for `Page`) the same way. Discovered during this task: `combineAsVariants` resets bound-paint opacity to 1 on its children, the same failure mode as `setExplicitVariableModeForCollection` from Task 5's lessons — any fractional-opacity overlay/tint paint must be (re-)applied only after the last `combineAsVariants` or mode-switch call in the build order.
- **Task 7 component sets** (all on page `02 Components`, `Ti7FlZLYOvX3goyvfypJBk`): `RailItem` id `75:55` key `50521c8912e7194d8defc0409594ecfbddd40830` (8 variants, State×Badge); `RailSubItem` id `75:78` key `2810226dd533949561d23cb3eb10430dd0c8c098` (3 variants); `Tabs` id `78:43` key `c6f5118001be3cd40595df2ae88f77797e336521` (2 variants, `Count=Two` only — Task 12 adds `Count=Three`); `Modal` id `85:24` key `44b231ebe794f45494a078baa17f9f667a62d98a` (2 variants); `Sheet` id `86:31` key `05ff4eb66e0da27e22dc2455fe533a15cdbe10b5` (2 variants); `SaveStateChip` id `79:28` key `e33f111008f80c29d13f08e70740b0eb48e0c9b2` (3 variants); `SectionSelector` id `86:40` key `a51d1763b19f0b57fe17b728cf3ab57557461c88` (2 variants). `RailSubItem` carries `Spy marker` (2×16, bound `indigo`) in all three variants, hidden except in `Current`; `Tabs` carries `Indicator` (2px bound `indigo`) in both variants, its inactive sibling named `Underline` so the per-variant `Indicator` count stays exactly one. RailItem's 36px `RailSubItem` indent and Sheet's handle-to-header gap are both composed from two bound spacing tokens rather than one literal, per the space-token constraint. Three lessons worth carrying forward: (1) `combineAsVariants` freezes the component-set frame's own bounding box from the pre-repositioning layout of its source components — repositioning variants into a grid afterward silently clips anything outside the stale box (`clipsContent` is true by default) unless you explicitly `resize()` the set to the new children's bounding box; this bit both `RailItem` and `SaveStateChip` here. (2) An empty auto-layout HUG container (the `Body`/`Content` slot pattern) does not re-shrink after a child is added then removed within the same or a later script call — it freezes at the child's last size; recovery is an explicit `resize(width, 1)` followed by re-applying `layoutSizingVertical = 'HUG'`, which does correctly re-collapse it. Do this immediately after any add/measure/remove HUG proof, or the proof itself leaves the component broken. (3) `node.query('[name=Some Name]')` silently returns zero matches when the name contains a space (unescaped in the selector), even though the node exists and `findAll(n => n.name === 'Some Name')` finds it correctly — the brief's own Step 6 `Spy marker` check script is affected by this and reports `[0,0,0]`; `findAll` is the reliable check.
- **Task 8 frames** (page `03 Shell & Navigation`, `Ti7FlZLYOvX3goyvfypJBk`): `shellFrameId` (`Desktop 1440 — Shell`) = `91:5`; `mobileShellFrameId` (`Mobile 390 — Shell`) = `94:55`; section-sheet frame (`Mobile 390 — Section sheet`) = `94:92` — **load-bearing for Tasks 9–12, which clone the desktop shell (`91:5`) as their starting point.** Rail (`92:5`) holds 18 rows in order (10 sections, `Preferences`'s four `RailSubItem`s inserted immediately after it via `insertChild`, the divider, `Review` `Badge=Count` set to `3`, `Sections`, the version string); 16 are `INSTANCE`, the two deliberate non-instances are the `Divider` (`FRAME`, containing one `Divider line` rectangle) and the `v2.0.0 (a1b2c3)` version string (`TEXT`, `caption-2`). The mobile Section sheet's `Sheet` instance had to be **detached** (`detachInstance()`) before its `Body` slot would accept new children — the Plugin API refuses `appendChild` into any frame that is itself inside a live `INSTANCE`, which the brief's own `Body`/`Content` slot pattern (Task 7 lesson 2) does not mention; this is the one node in the whole page that is not an `INSTANCE` of `Sheet`, and it is intentional, not a detached-copy defect. Two further lessons: (1) **every purely-structural wrapper frame created via `figma.createAutoLayout()` carries a default opaque unbound white fill** that is invisible in light mode (indistinguishable from `paper`) but breaks dark mode outright — it neither switches nor lets the true background show through. This bit `Body`, `Rail`, `Content`, both `Brand`/`Right cluster` header groups (on all three frames, since the section-sheet clone copied the mobile shell's pre-fix state into new node IDs), and both `Divider` wrappers; every one needed an explicit `fills = []`, found only by diffing dark-mode screenshots against light and reading `fills` back to check for `boundVariables: {}` on an `{r:1,g:1,b:1}` solid. Audit this on every future frame that wraps content in a plain `createAutoLayout()` container without an intentional fill. (2) Ruling (c) held exactly as warned: `setExplicitVariableModeForCollection` reset the scrim's paint opacity from `0.4` back to `1` on **every** mode switch, including the final restore back to Light — the fix (reapply `0.4` as the last write, then re-verify by reading `fills[0].opacity` and by screenshot) had to be repeated three times (into dark, and again on the restore to light) rather than once.
- **Task 9 frames** (page `04 Section editor`, `Ti7FlZLYOvX3goyvfypJBk`): `Desktop — Preferences` = `109:2` (1440×1471); `Desktop — Profile` = `114:110` (1440×1177); `Desktop — Goals` = `114:495` (1440×1024); `Desktop — List expanded` = `115:253` (1440×1024); `Desktop — Chip input` = `115:651` (1440×1024); `Mobile — Preferences` = `116:390` (390×2206). Preferences two-tier check (rewritten per trap 1, `findAll` predicate not `page.query`): `bands: 3`, `cards: 9`, `Likes & Dislikes` confirmed at the same nesting depth as the other ungrouped-band standalone cards. Manifest divergences from the brief, all followed per "manifest is truth": section titles are Title Case (`Preferred Languages`, `Frameworks`, `Tools`, `Preferred Methods`, `Things to Avoid`) not the brief's sentence case; the Communication `fields` node's default locale value is the string `British English`, not `en-GB`; the card title is `Default Communication Style` (the manifest's actual `fields` title) not the brief's `Default style`; and `detail_level` — not `locale` — is the manifest's declared `long_text` field, so it is the one rendered spanning the row as a `TextArea`, with `Tone`/`Locale` as the compact 2-column `Select` pair (a structural correction, not just wording, flagged rather than silently built to the brief's literal pairing). **Detached `SubsectionCard`s, enumerated by frame (27 total, all confirmed `FRAME` type post-detach with nested instances still live):** Desktop — Preferences (9): `109:110` Preferred Languages, `109:127` Frameworks, `109:144` Tools, `110:84` Default Communication Style, `110:114` When I'm feeling..., `110:134` Response format, `110:285` Preferred Methods, `110:301` Things to Avoid, `110:317` Likes & Dislikes. Desktop — Profile (6): `114:363` Personal Information, `114:413` Education, `114:429` Work Experience, `114:449` Emails, `114:465` Links, `114:481` Languages. Desktop — Goals (1): `114:602` Goals. Desktop — List expanded (1): `115:355` Likes & Dislikes (expanded). Desktop — Chip input (1): `115:755` Response format (mid-entry). Mobile — Preferences (9): `116:423` Preferred Languages, `116:439` Frameworks, `116:455` Tools, `116:600` Default Communication Style, `116:629` When I'm feeling..., `116:649` Response format, `117:445` Preferred Methods, `117:461` Things to Avoid, `117:477` Likes & Dislikes. Nothing else was detached; `02 Components` and `03 Shell & Navigation` were not touched. Two new failure modes discovered, both consistent with the Task 5/8 "opacity reset" family: (1) **`Badge.createInstance()` itself resets the main component's fractional fill opacity (`0.12`) to `1`** on creation, even with zero other mutations — confirmed by creating a fresh, untouched instance and reading `fills[0].opacity` back as `1` against the component's own `0.12`; every `Badge` instance needs `instance.fills = JSON.parse(JSON.stringify(instance.mainComponent.fills))` re-applied after creation, verified by measuring, not by re-deriving the expected value. (2) `setExplicitVariableModeForCollection`, used here for the light/dark screenshot check, **reconstructs every paint in the target frame's subtree and re-triggers the same opacity-to-1 reset on every `Badge` inside it** — this corrupted `Badge` opacity on the two frames mode-switched for the dark-mode check (`Desktop — Preferences`, `Desktop — Profile`) and required a second opacity re-fix pass after restoring Light `4:0`, confirmed clean afterward by reading `fills[0].opacity` on all 32 `Badge` instances across all six frames. A pre-existing, out-of-scope finding: `TextField`/`Select`/`TextArea` (Task 5 components) carry an internal `itemSpacing: 6` on their own label/input/helper stack in every instance across all six frames (16 occurrences) — this is baked into the `02 Components` source and off the 4/8/12/16/24/32 token scale, but fixing it would mean editing `02 Components`, which is out of scope for Task 9 and left untouched per the constraint; flagged here for Task 14's audit rather than patched locally.
- **Task 10 frames** (page `05 Review`, `Ti7FlZLYOvX3goyvfypJBk`): `Desktop — Inbox` = `125:2` (1440×1024); `Desktop — Inbox row expanded` = `126:69` (1440×1024); `Desktop — Observations` = `128:134` (1440×1024); `Desktop — Promote dialog` = `129:348` (1440×1024); `Desktop — Empty` = `130:292` (1440×1024); `Desktop — No propose scope` = `130:975` (1440×1024); `Mobile — Inbox` = `133:428` (390×844). `RailItem — Review` swapped to `State=Active, Badge=Count` (label stays `3`) on all six desktop frames; the mobile shell has no rail so `SectionSelector` was left at its shipped default. `ProposalsPanel.jsx`'s eleven fields all placed: `kind` and `action`/`entity`/`data` on the Inbox rows (dense `Value` column) and expanded two-column `dl`; `note` as the `headline-2` lead on Observations cards; `proposed_by`, `seen_count`, `rationale`, `evidence` on the expanded row and both cards; `section_hint` as `suggested: …` on the cards; `id` — the one field with no natural home in the brief's copy — added as a `#short-id` `caption-1` tag beside `proposed_by`/`seen` on the expanded row and both cards (also present on their clones inside the Promote dialog background), since the brief is explicit that a missing field means the design is hiding backend data. **Detached nodes (3 `detachInstance()` calls, all per ruling (a)):** `128:252` (Observations card 1, "Maya now owns the monthly newsletter"), `128:278` (Observations card 2), `129:430` (the `Modal` in Desktop — Promote dialog). `Desktop — Promote dialog` is a `clone()` of the already-built Observations frame, so its background also contains two detached-`SubsectionCard` copies (fresh ids under `129:*`) — these are duplicate copies of an already-detached frame, not additional `detachInstance()` calls, and are noted for completeness rather than counted separately. `Select`/`TextField`/`Button`/`Badge`/`Tabs`/`EmptyState`/`RailItem` stayed live instances everywhere, including both `Select`s and the `TextField` in the promote dialog body. Two defects caught by verification, both fixed and re-measured: (1) the scope-notice's `warning`@12% fill read back as opacity `1` when the bound-paint object was built and given its opacity in a single unbroken expression before ever being committed to `node.fills` — the Task 8/9 "reconstructs the paint" family evidently also covers a paint that has never yet been assigned; the fix (assign the bound paint plain first, read `node.fills[0]` back, then spread `opacity` onto *that* committed object and reassign) is what actually stuck, confirmed by a fresh `getNodeByIdAsync` read at `0.11999999731779099`. (2) A genuine cross-theme defect, left in place and flagged rather than silently patched: the Promote dialog's scrim is bound to `ink` per the brief's literal "40% ink scrim" instruction, but `ink` is a semantic text token that inverts between modes (near-black in Light, near-white in Dark) — in Dark mode this renders as a **light** wash over the dark canvas instead of dimming it, the opposite of a scrim's purpose. Confirmed by screenshot (Dark: background outside the modal reads lighter than the modal itself). Kept as literally specified since no ruling authorized substituting a mode-invariant colour; needs a decision (e.g. bind to a fixed dark value instead of `ink`) before this frame is called done. `TextField`/`Select` still carry the same pre-existing internal `itemSpacing: 6` documented in Task 9 (not touched, out of scope); a **new**, in-scope instance of the same off-token spacing was introduced by this task's own `Mobile — Inbox` row containers (`itemSpacing: 6` between the stacked verb/value/actions lines) and was fixed to `8` (space-8) after the page-wide audit caught it, confirmed by re-reading all three row ids.
- **Task 10 follow-up (coordinator rulings on concerns 1 and 2):** `scrim` variable added to `VariableCollectionId:4:2` (Colour): id `VariableID:140:2`, key `93bb5f52ae2ad5c9936d61dda83cec01e41e6446`, value `#0C0A09` (`r:0.0470588, g:0.0392157, b:0.0352941`) in **both** `4:0` (Light) and `4:1` (Dark), scopes `['FRAME_FILL','SHAPE_FILL','TEXT_FILL','STROKE_COLOR']` — confirmed mode-invariant by reading `valuesByMode` back after a full Dark round-trip. Both scrims rebound to it at 40% opacity, applied last and re-measured fresh each time: Task 10's promote-dialog scrim (`129:419`) and **Task 8's** section-sheet scrim (`94:114`, page `03 Shell & Navigation`) — both previously bound to `ink`, which inverts between modes and was brightening instead of dimming in Dark; both now dim correctly in Dark, confirmed by screenshot and restored to Light afterward (opacity `0.4` on both, bound to `VariableID:140:2` on both, read fresh post-restore). Three new icon components on `02 Components`: `IconTick` = `139:22`, `IconCross` = `139:25`, `IconChevron` = `139:28` (each 16×16, stroke bound to `ink`, each carrying a one-line description). `Button` (`56:40`) gained a component property `Icon#139:0` (`INSTANCE_SWAP`, default `139:22`) and a nested `Icon` instance child inserted as the leading child of its **16 label-bearing variants only** (`Default`/`Hover`/`Pressed`/`Disabled` × all four `Variant`s) — the 4 `Loading` variants were left untouched since they carry a spinner, not a label, and "before the label" has no meaning there; every added `Icon` child is `visible: false` by default. Discovered mid-task: **`createInstance()` silently drops any child of the source component that is `visible: false` at the moment of instantiation** — a fresh instance made immediately after adding the hidden `Icon` child came back with only the `Label` child, no `Icon` node at all, confirmed by a controlled A/B test (toggling the source's `Icon.visible` to `true` before calling `createInstance()` reliably includes it, `false` reliably drops it). Existing instances already in the file are unaffected by this — Figma's live structural sync still pushes the new child to every pre-existing instance regardless of visibility — so the workaround for making the row-action buttons is: flip the relevant source variant's `Icon.visible` to `true`, `createInstance()` as many as needed, swap each instance's icon and set its label, then flip the source back to `false` so the design system's shipped default (and any future `createInstance()` call) stays hidden-by-default. The Inbox row actions were rebuilt on `Desktop — Inbox` (`125:2`), `Desktop — Inbox row expanded` (`126:69`), and `Mobile — Inbox` (`133:428`) as three live `Button` instances per row — `Approve` (`Primary`, `IconTick` shown), `Reject` (`Neutral`, `IconCross` shown), `Expand` (`Ghost`, `IconChevron` shown) — replacing the icon-only local frames from the first pass; the old `Actions` frames were `.remove()`d, not left orphaned. Measured, not assumed: the new labelled-actions cluster is `326px` wide on every row across all three frames; the desktop row stays at its brief-specified `44px` (a `36px`-tall `Button` centres inside it with `4px` to spare, no growth needed); the mobile row's available width is `358px` against a `326px` cluster (`32px` to spare, no growth needed either). `Mobile — Inbox`'s `SectionSelector` relabelled from its shipped default to `Review`. Re-running the page `05 Review` audit after this change found nothing new (same two out-of-scope, pre-existing findings as before: `Select`/`TextField`'s internal `itemSpacing:6`, `RailItem`'s internal `cornerRadius:3`/`1` glyphs); a fresh audit of the `Button` component set on `02 Components` came back clean on fills/strokes/text fills/spacing/radius, with seven pre-existing fractional-opacity hover/pressed-state overlay fills (`8%`/`12%` `ink`, Task 6's own interaction-feedback design, untouched by this change) correctly still present and not mistaken for a new defect. Confirmed no regression on `Button` instances predating this change: `Desktop — List expanded` (Task 9, `115:253` — `Save`/`Cancel` buttons unchanged, no icon visible) and the `Mobile 390 — Section sheet` (Task 8, `94:92`) both screenshot-verified identical to their prior rendering.
- **Task 11 frames** (page `06 Onboarding`, `Ti7FlZLYOvX3goyvfypJBk`): `Desktop — Spine` = `149:2` (1440×1024); `Desktop — Basics About you` = `149:42` (1440×1024); `Desktop — Basics scrolled` = `149:82` (1440×1346 after the Task 11 follow-up fix below regrew the content; originally 1440×1203, grown to fit both bands in full rather than a cropped viewport, so no text is ever clipped — the scroll-spy relationship is proven by the rail marker's position, not by hiding content); `Desktop — Delegate offer` = `149:122` (1440×1024); `Desktop — Spine complete` = `149:162` (1440×1024); `Mobile — Spine` = `149:202` (390×844); `Mobile — Basics` = `149:218` (390×1020). Fill-summary ruling (b) applied exactly as directed: `Your name and role` built with all five fields (`Maya`, `Maya Ellis`, `Marketing assistant`, empty `Organisation`, `Manchester`) and `FillSummary` set to `4 of 5`. Colour ruling (a) confirmed clean by a full-page scan of every bound `fills`/`strokes` paint: `clay`/`clay-tint` appear only on the three `Spine card` instances (`150:271`, `153:217`, `161:359`) and the four `Delegate offer` cards (`155:241`, `156:271`, `160:360`, `162:368`); `verdigris`/`verdigris-tint` appear only on the three `Badge` `Tone=Live` instances (`151:277`, `153:229`, `161:371`) and their nested `Dot`/`Label`. Both long strings transcribed character-for-character from the brief, including the literal backticks around `get_schema`/`propose_update` (read back and diffed against the brief in this session). **Detached nodes (8 `detachInstance()` calls, all `SubsectionCard`, per ruling (a)):** `155:1373` Your name and role and `155:1385` In a sentence (Desktop — Basics About you); `157:324` Default style, `157:356` Response format, `157:1490` Preferred methods, `157:1505` Things to avoid (Desktop — Basics scrolled's own new band — the About you cards on this frame are clones of the two above, carried over as duplicate copies, not additional `detachInstance()` calls); `162:1500` Your name and role and `162:1512` In a sentence (Mobile — Basics). Nothing else was detached; `02 Components` and every other page were not touched except for two temporary, fully-reverted probes described below. **Spy marker trap, a second layer beyond Task 7/10's finding:** toggling the shared `RailSubItem` `State=Default` master's `Spy marker` back to hidden **after** instantiating (the literal workaround text in this task's brief, copied from Task 10's `Button`/`Icon` `INSTANCE_SWAP` case) does **not** work for a plain hidden child — proven by an isolated two-call test (instance read back `Spy marker` count `1` immediately, then `0` once the master's visibility was restored to `false`, both within the same script and again from a fresh script). The `INSTANCE_SWAP`-property workaround does not generalise to a raw `visible` toggle on a non-property child: an `INSTANCE_SWAP` override is stored independently per instance, but a plain-node visibility override that comes to match the master's (reverted) value is collapsed away, deleting the node, not just hiding it. `appendChild`ing a fresh replacement node directly into a live `RailSubItem` instance was also tried and confirmed blocked (`"Cannot move node. New parent is an instance or is inside of an instance"`), and `RailSubItem` is not on the ruling's detach-allow-list, so detaching it was not an option either. The fix that actually holds: build every non-current `RailSubItem` from the **`State=Current`** variant instead (whose `Spy marker` is permanently visible in the untouched master, never toggled), then override two things on the instance only — `Label` fill rebound from `indigo` to `ink`, and the marker's own `opacity` set to `0` (kept `visible:true`, a real per-instance divergence from master that survives because master is never changed). Confirmed stable across two subsequent fresh-script reads and after a full Dark round-trip. All 9 previously-broken instances were removed and rebuilt this way; the `02 Components` `RailSubItem` set (`75:78`) itself was never modified, so Tasks 8–10's existing instances elsewhere in the file are unaffected. **Final per-instance `Spy marker` counts, all 12 = `1`:** Desktop — Basics About you (`154:227` About you Current, `165:1521` How you like answers, `165:1525` Working on, `165:1529` Languages); Desktop — Basics scrolled (`165:1533` About you, `156:1450` How you like answers Current, `165:1537` Working on, `165:1541` Languages); Desktop — Delegate offer (`159:346` About you Current, `165:1545` How you like answers, `165:1549` Working on, `165:1553` Languages). Two leftover artefacts from this debugging were found by the post-build page sweep and removed: two `TEST — marker probe` instances parented directly to the page, and one stranded plain `RECTANGLE` named `Spy marker` (`164:401`) left behind by the failed direct-`appendChild` test (the rectangle was created before the blocked reparent call threw, and was never cleaned up by the catch block) — all three confirmed gone by a fresh `getNodeByIdAsync` read returning `undefined`. Page-wide audit came back clean on unbound fills and text fills (`0` each); the only `itemSpacing`/`cornerRadius` findings are the same two pre-existing, out-of-scope defects already logged in Tasks 9/10 (`TextField`/`Select`/`TextArea`'s internal `itemSpacing:6`, and `RailItem`/`RailSubItem`'s internal decorative-glyph/`Spy marker` `cornerRadius:3`/`1`, both baked into `02 Components` and untouched here). Mode-switch discipline: switched all seven frames to Dark (`4:1`), screenshotted two representative frames (confirmed correct dark theming, including `Delegate offer` staying legible and `Badge Live` still reading as `verdigris` and not a scrim-style inversion), then restored all seven to Light (`4:0`) and re-applied + re-measured the `30%` `clay` stroke opacity on all seven cards (`150:271`, `153:217`, `161:359`, `155:241`, `156:271`, `160:360`, `162:368` — every one read back `0.30000001192092896` after restore, bound to `VariableID:4:11`), and separately re-confirmed via fresh read that the `Spy marker` `opacity`/`visible` overrides on the fake-`Default` instances (a node-level property, not a paint) were unaffected by the mode switch. One open concern carried forward rather than silently resolved: the `Default style` card's three `Select`s (`Tone`/`Detail level`/`Locale`) and the `Response format`/`Preferred methods`/`Things to avoid` chip values are original content invented for this task (the brief specifies only the control types and card names, not field values) — chosen to echo the persona spec's own language (`Direct`, `Concise`, `British English`, `Examples first`, `Jargon`) but not cross-checked against Task 9's `Preferences` screen's actual (unread) chip text, so the same underlying preference could in principle read differently on the two screens; flagged for a future consistency pass rather than guessed at further.
- **Task 11 follow-up (coordinator review fixes):** the concern flagged above was confirmed real. Read Task 9's `Desktop — Preferences` (`04 Section editor`, `109:2`) `Default Communication Style`/`Response format`/`Preferred Methods`/`Things to Avoid` cards directly (actual `characters`, not layer names) as the source of truth, then reconciled `Desktop — Basics scrolled`'s `HOW YOU LIKE ANSWERS` band to match exactly: `Detail level` changed from an invented `Select` reading `Concise` to a `TextArea` reading `Concise. Straight to the point.` (Task 9 declares it long-text) — old `Select` `157:338` removed, new `TextArea` `169:395` inserted, `Tone`/`Locale` `Select`s (`157:332`/`157:344`, already `Direct`/`British English` and already matching Task 9 by coincidence) left as a 2-column row per Task 9's layout, `FillSummary` unchanged at `3 of 3`. `Response format` (`157:356`) chips corrected from the invented `Bullet points`/`Short paragraphs` to Task 9's exact three, lowercase: `no exclamation marks` (`157:362`), `bullet points` (`157:365`), `British English` (new chip `169:400`); `FillSummary` updated `2 set` → `3 set`. `Preferred methods` (`157:1490`) chip lowercased `Examples first` → `examples first` (`157:1496`); `FillSummary` unchanged at `1 set`. `Things to avoid` (`157:1505`) chip corrected `Jargon` → `long theory` (`157:1511`); `FillSummary` unchanged at `1 set`. The added chip and taller `TextArea` grew `Basics scrolled`'s content from `1079` to `1222`px; `Body` (`149:100`) and the frame itself were resized again (`1143`→`1286`, `1203`→`1346`) to keep the no-clipping guarantee, screenshot-confirmed. Spine counter case also fixed per ruling: `caption-2`'s uppercase convention is for eyebrows, not this progress counter, so `1 OF 3`/`3 OF 3` (`150:275`, `153:221`, `161:363`) became lowercase `1 of 3`/`3 of 3`, matching the brief and `FillSummary`'s own lowercase `4 of 5`. Detach enumeration completed per the coordinator's note: `156:277` (`SubsectionCard — Your name and role`) and `156:290` (`SubsectionCard — In a sentence`) are clones of the two `Basics About you` detached frames, carried into `Basics scrolled` by the earlier `clone()` of the whole `About you group` — not additional `detachInstance()` calls, but genuine non-`INSTANCE` frames Task 14's audit needs to see; the full non-instance-frame count is therefore 10 (8 detaches + 2 clones), all enumerated. **No variable-mode switch was performed for this fix round** — confirmed by reading `frame.resolvedVariableModes['VariableCollectionId:4:2']` back as `4:0` (Light) with no mutation. Re-ran the full page-wide audit after the edits: `783` nodes, `0` unbound opaque fills, `0` unbound text fills, `21` pre-existing `itemSpacing:6` hits (same family as before, net unchanged since one `Select` was removed and one `TextArea` added, both carrying the same baked-in value) and `75` pre-existing `cornerRadius` hits (one fewer than before, from the removed `Select`'s internal chevron glyph) — no new defect. Re-confirmed, by fresh read after all edits: all 12 `RailSubItem` `Spy marker`s still present (count `1` each) with unchanged `visible`/`opacity` states, and all 7 `clay`-bound stroke opacities still `0.30000001192092896`.
- **Task 12 frames** (page `07 Auth & Settings`, `Ti7FlZLYOvX3goyvfypJBk`): `Auth — Sign in` = `177:2` (1440×1024); `Auth — Sign up` = `178:21` (1440×1024); `Auth — Forgot` = `179:42` (1440×1024); `Auth — Reset` = `181:53` (1440×1024); `Auth — OTP` = `182:68` (1440×1024); `Auth — Invite gate` = `183:84` (1440×1024); `Settings — Account` = `184:95` (1440×1024); `Settings — Server` = `187:115` (1440×1024); `Settings — Token` = `189:134` (1440×1024); `Settings — Connected apps` = `190:155` (1440×1024); `Consent` = `191:175` (1440×1024); `Mobile — Sign in` = `191:1715` (390×844); `Mobile — Settings Account` = `192:201` (390×844). **`Tabs` extended** on `02 Components` (`78:43`): three new `Count=Three` variants appended — `173:1551` (`Active=First`), `173:1552` (`Active=Second`), `173:1553` (`Active=Third`), labelled `Account`/`Server`/`Token` (no badges); `combineAsVariants`/variant-append's known stale-bounding-box quirk hit again exactly as Task 7 warned (`clipsContent:true` on the set at its pre-append `510×32`, silently clipping the new row at `y:72`) — fixed by `resize(606,104)` and confirmed by screenshot; property definitions read back as `Count: [Two, Three]`, `Active: [First, Second, Third]`; Task 10's five `Count=Two` instances (`125:98`, `126:109`, `128:229`, `129:388`, `133:444`) re-verified unchanged (same main component, `210×32`) both immediately after the extension and again after all Task 12 frames were built, plus a `Desktop — Inbox` screenshot showing no visual shift. One new local component: `Logo Mark` = `176:141` (40×40, indigo fill, white "g"-glyph imported from `AuthShell.jsx`'s inline SVG — a fixed brand-mark glyph, deliberately not theme-bound). **Detached nodes (5 `detachInstance()` calls, all `Modal`/`Sheet` per ruling (d)):** `184:111` (Settings — Account), `187:131` (Settings — Server), `189:150` (Settings — Token), `190:171` (Settings — Connected apps) — all ex-`Modal Size=Medium`; `192:208` (Mobile — Settings Account) — ex-`Sheet State=Open`, resized to `390×844` full-height. Nothing else was detached; `TextField`/`Select`/`Button`/`Badge`/`Switch`/`Checkbox`/`PinField`/`Tabs` stayed live instances everywhere. **Divergences from the brief, all resolved by reading the actual code rather than guessing:** (1) Consent's real scopes are `persona:read`/`persona:propose`/`persona:write` (`READ`/`PROPOSE`/`WRITE` in `Consent.jsx`), not the brief's `read`/`search`/`propose` — built as read/propose/write with the exact `label`/`help` strings from `Consent.jsx` (dispatcher-confirmed before starting). (2) `Auth — Sign up`'s real form (`WelcomeAuth.jsx` `mode==="signup"`) has a **Confirm password** field and asks for **Username**, not email — the brief's own table said "no confirm field" and "email"; built to match the real code instead, both fields present. (3) `Auth — Reset`'s real copy comes from a sixth component the brief didn't list, `ResetPassword.jsx` (title `Choose a new password`, description `This link works once. Pick something you have not used here before.`, submit `Set new password`) — read and used as source of truth since it is the actual screen behind that route; the live destructive match-hint (`Passwords do not match.`) was added per the brief's explicit instruction to show the mismatched state, using the `Error` `TextField` variant plus a `destructive` `caption-1` line. (4) `Auth — OTP` has no corresponding real flow anywhere in the five-plus-one components read (the only `PinField`-shaped real usage is `InviteGate.jsx`'s 8-character invite code, which is a different, separate frame here) — built as a plausible generic 6-digit-email-code screen using the `PinField` `Partial` variant as instructed, with invented but on-voice copy; flagged rather than silently presented as sourced. (5) **Settings tab count**: ruling (b) specified extending `Tabs` to `Count: Three`, but Step 3's own table lists **four** tab-like sections (`Account`/`Server`/`Token`/`Connected apps`) and the Interfaces line names four separate settings frames — built the `Tabs` bar with exactly the three ruling (b) named (`Account`/`Server`/`Token`) and treated `Connected apps` as a second content block reached under the `Token` tab (its frame's `Tabs` instance also reads `Active=Third`) rather than a fourth tab, so both the explicit `Count: Three` instruction and the four-frame requirement are satisfied without contradiction; flagged as a judgement call for confirmation rather than asserted as certainly the intended reading. (6) Ruling (c) applied: `Settings — Server`'s success indicator is `Badge` `Positive` reading `connected` (not `Live`); `Settings — Connected apps`'s two rows use `Badge` `Live` (genuine clients, `Claude Desktop` and `Raycast`, invented names); `Settings — Account`'s `verified` badge is `Positive`. Two defects caught by verification, both fixed and re-measured, same "reconstructs the paint" family as Tasks 8–11: (1) the `Scrim` rectangle's paint-level `opacity:0.4` did not stick after `setBoundVariableForPaint` (read back as `1`) on the very first settings frame — fixed by setting **node-level** `opacity = 0.4` instead, confirmed `0.4000000059604645` by fresh read, and applied that way on all four settings frames plus `Mobile — Settings Account` from the start thereafter. (2) `Badge.createInstance()` reset the `Tone=Positive`/`Tone=Live` variants' `12%`-opacity tint background to `1` on creation (same defect Task 9 logged for `Badge`), which made the `Settings — Account` `verified` label unreadable (white-on-solid-green) until caught by screenshot and fixed (`inst.fills = [{...bg, opacity: 0.12}]`, confirmed `0.11999999731779099`); applied pre-emptively (build-then-immediately-reapply) on every subsequent `Badge` instance across `Settings — Server`/`Settings — Connected apps`/`Mobile — Settings Account`. No variable-mode switch was performed anywhere in this task — confirmed by never calling `setExplicitVariableModeForCollection`; all frames were built and verified in Light only, so no re-apply-after-Dark-round-trip was needed. Page-wide audit (13 frames): `0` unbound fills, `0` unbound strokes, `0` unbound text fills. Spacing sweep found `22` initial hits — `14` were the same pre-existing `TextField`-internal `itemSpacing:6` already logged in Tasks 9–11 (out of scope, untouched); `8` were genuinely introduced by this task (`Autosave label`/`Scope text` columns at `itemSpacing:2`) and were fixed to `space-4`, confirmed by re-read; a second pass then caught `2` more introduced hits (`App row` at `itemSpacing:6` on `Settings — Connected apps`) fixed to `space-8`, confirmed by re-read; a final sweep shows only the `14` pre-existing out-of-scope hits remaining. Radius sweep: `0` off-token hits across all new nodes. `clay`/`clay-tint` do not appear anywhere in this task's output, confirmed by the same fills/strokes scan.
- **Task 12 follow-up (coordinator fix: four tabs, not three):** divergence (5) above was wrong — the coordinator confirmed the pre-flight note's `Count: Three` was stale against Step 3's own four-tab table and the Interfaces list's four named settings frames. Added a fourth `Tabs` variant axis value rather than replacing the third: `Tabs` (`78:43`) now has **`Count=Four`** — `194:1799` (`Active=First`), `194:1800` (`Active=Second`), `194:1801` (`Active=Third`), `194:1802` (`Active=Fourth`), labelled `Account`/`Server`/`Token`/`Connected apps`. `Count=Three` (`173:1551`–`173:1553`) was kept in place, unused, per the coordinator's instruction not to churn it. Property definitions now read `Count: [Two, Three, Four]`, `Active: [First, Second, Third, Fourth]`. Per-variant `Indicator` count confirmed `1` on all four new variants (named exactly `Indicator`, its three inactive siblings named `Underline`), satisfying Task 13's by-name animation requirement. The stale-bounding-box quirk hit a third time exactly as expected: the set's `clipsContent:true` bounding box was still `606×104` (the post-Count=Three size) immediately after the `Count=Four` append, silently clipping the new row — fixed by the same `resize()`-to-children's-bounding-box pattern, now `1334×176`, confirmed by screenshot (all 9 variants — 2+3+4 — visible, nothing clipped). Regression re-check on Task 10's five `Count=Two` instances (`125:98`, `126:109`, `128:229`, `129:388`, `133:444`): unchanged, re-verified both by metadata (same `mainComponentName`, `210×32`) and by a fresh `Desktop — Inbox` screenshot, run again after this second append. All four settings frames' `Tabs` instances were swapped from `Count=Three` to `Count=Four` in place (old instance removed, new one inserted at the same child index): `Settings — Account` (`184:95`) → `196:221` `Active=First`; `Settings — Server` (`187:115`) → `196:238` `Active=Second`; `Settings — Token` (`189:134`) → `196:255` `Active=Third`; `Settings — Connected apps` (`190:155`) → `196:272` `Active=Fourth` (now its own tab, not a `Token`-tab sub-block); `Mobile — Settings Account` (`192:201`) → `196:289` `Active=First`. `Settings — Token`'s content is unchanged (existing-token `muted` code row with `Copy`/`Revoke`, `Create token` with the read/propose/write `Checkbox` group) since it never held `Connected apps` content in the first place — only the tab bar and its `Active` value needed correcting. `Settings — Connected apps`'s two rows (`Claude Desktop`, `Raycast` — `Badge` `Live`, `caption-2` scopes, `caption-1` last-used, `Revoke` `Ghost`) are unchanged, now under their own correctly-`Active=Fourth`-highlighted tab. Old `Count=Three` tab instances (`184:117`, `187:137`, `189:156`, `190:177`, `192:213`) confirmed removed by a fresh `getNodeByIdAsync` read (`undefined` for all five). Full page-wide re-audit after the swap: `0` unbound fills, `0` unbound strokes, `0` unbound text fills, `0` off-token radius; spacing sweep dropped from `14` to `12` pre-existing out-of-scope `TextField`-internal `itemSpacing:6` hits (two fewer because the wider `Count=Four` tab bar's own children carry no such property — not a fix, just fewer components in the count) with no new violations. No variable-mode switch was performed during this follow-up either — confirmed by reading `resolvedVariableModes['VariableCollectionId:4:2']` back as `4:0` (Light) on all 13 frames after the fix.

---

## Task 1: Create the file, pages, library subscription, and font gate

**Files:**
- Create: Figma design file `MyGist — App Redesign`
- Modify: this plan document (record `Ti7FlZLYOvX3goyvfypJBk` and `FONT_DECISION`)

**Interfaces:**
- Produces: `Ti7FlZLYOvX3goyvfypJBk` — the file key, consumed by every later task. Nine named pages. `FONT_DECISION` — the exact `{family, style}` pairs every later text operation must use. `RESHAPED_LIB_KEY` — the Reshaped library key, or `null` if unavailable.

- [x] **Step 1: Create the file**

Invoke `figma:figma-create-new-file`. Create a `design` editor-type file named `MyGist — App Redesign`. Record the returned file key as `Ti7FlZLYOvX3goyvfypJBk` in this document, replacing every literal `Ti7FlZLYOvX3goyvfypJBk` below.

- [x] **Step 2: Create the nine pages**

Invoke `figma:figma-use`. One `use_figma` call:

```js
const wanted = ['00 Cover','01 Foundations','02 Components','03 Shell & Navigation',
  '04 Section editor','05 Review','06 Onboarding','07 Auth & Settings','08 Motion'];
const created = [];
// The file starts with one page. Rename it rather than leaving an orphan "Page 1".
figma.root.children[0].name = wanted[0];
for (let i = 1; i < wanted.length; i++) {
  const p = figma.createPage();
  p.name = wanted[i];
  created.push(p.id);
}
return { renamed: figma.root.children[0].id, createdNodeIds: created,
         pages: figma.root.children.map(p => ({ id: p.id, name: p.name })) };
```

- [x] **Step 3: Verify page structure**

Run `get_metadata` on `Ti7FlZLYOvX3goyvfypJBk`. Expected: exactly nine pages, names matching Step 2's list in order, no page named "Page 1".

- [x] **Step 4: Gate the fonts — this blocks every later task**

Invoke `figma:figma-use`. One `use_figma` call:

```js
const fonts = await figma.listAvailableFontsAsync();
const names = fonts.map(f => f.fontName);
const want = ['Geist', 'Geist Mono', 'Inter'];
const found = {};
for (const family of want) {
  const styles = names.filter(n => n.family === family).map(n => n.style);
  if (styles.length) found[family] = styles;
}
return { found, geistPresent: !!found['Geist'], geistMonoPresent: !!found['Geist Mono'] };
```

- [x] **Step 5: Record the font decision**

Apply this rule exactly. Do not improvise a third option.

- **If `Geist` and `Geist Mono` are both present:** `FONT_DECISION` = `{ sans: 'Geist', mono: 'Geist Mono' }`. Use the returned style strings verbatim — check whether 600 is `"SemiBold"` or `"Semi Bold"`, because guessing wrong throws on every text node.
- **If either is missing:** `FONT_DECISION` = `{ sans: 'Inter', mono: 'Roboto Mono' }`, and record in this document: *"Prototype substitutes Inter/Roboto Mono; Geist is the production face and the variables are named for it."* Bind the `font-family` variables to the **Geist** names regardless, so the token layer stays correct and only the rendered specimen differs.

Write `FONT_DECISION` into this document. Every later task reads it from here.

- [x] **Step 6: Subscribe the Reshaped library**

```
get_libraries with fileKey = Ti7FlZLYOvX3goyvfypJBk
```

Find the duplicated Reshaped v3.9 library in `libraries_available_to_add`. Record its key as `RESHAPED_LIB_KEY`. If the list is paginated, follow `libraries_available_to_add_next_offset` until found.

If it is genuinely absent, record `RESHAPED_LIB_KEY = null` and continue — the library is a geometry reference, not a dependency. Every component in Tasks 5–7 is specified completely enough to build without it. **Do not block on this.**

- [x] **Step 7: Commit the recorded values**

```bash
git add docs/superpowers/plans/2026-08-04-mygist-app-reshaped-figma.md
git commit -m "docs: record Figma file key, font decision and library key"
```

---

## Task 2: Colour variables

**Files:**
- Modify: Figma file `Ti7FlZLYOvX3goyvfypJBk`, variable collection `Colour`

**Interfaces:**
- Consumes: `Ti7FlZLYOvX3goyvfypJBk` from Task 1
- Produces: variable collection `Colour` with modes `Light` and `Dark`, and 15 `COLOR` variables named exactly `paper`, `card`, `muted`, `ink`, `muted-fg`, `border`, `indigo`, `indigo-tint`, `clay`, `clay-tint`, `verdigris`, `verdigris-tint`, `success`, `warning`, `destructive`. Returns `{ collectionId, variableIds: {name: id} }` — later tasks bind by name.

- [x] **Step 1: State the expected structure**

One collection named `Colour`, two modes (`Light`, `Dark`), 15 variables, every variable holding a value in both modes. Scopes: `["FRAME_FILL","SHAPE_FILL","STROKE_COLOR","TEXT_FILL"]` for all of them, because a token like `ink` legitimately fills text and a token like `border` legitimately strokes a frame — narrowing per-token here creates pickers that hide the right answer.

- [x] **Step 2: Create the collection and modes**

Invoke `figma:figma-use` and `figma:figma-generate-library`.

```js
const c = figma.variables.createVariableCollection('Colour');
// A new collection has one mode; rename it rather than adding a third.
c.renameMode(c.modes[0].modeId, 'Light');
const darkId = c.addMode('Dark');
return { collectionId: c.id, lightModeId: c.modes[0].modeId, darkModeId: darkId,
         modes: c.modes.map(m => ({ id: m.modeId, name: m.name })) };
```

- [x] **Step 3: Create the first eight variables**

Ten logical operations is the ceiling, so this splits across two steps. Pass the IDs from Step 2 as string literals.

```js
const c = await figma.variables.getVariableCollectionByIdAsync('COLLECTION_ID');
const LIGHT = 'LIGHT_MODE_ID', DARK = 'DARK_MODE_ID';
const SCOPES = ['FRAME_FILL','SHAPE_FILL','STROKE_COLOR','TEXT_FILL'];
const defs = {
  'paper':        [{r:0.9818,g:0.9818,b:0.9782}, {r:0.0721,g:0.0721,b:0.0679}],
  'card':         [{r:1.0000,g:1.0000,b:1.0000}, {r:0.1020,g:0.1020,b:0.0980}],
  'muted':        [{r:0.9620,g:0.9620,b:0.9580}, {r:0.1414,g:0.1414,b:0.1386}],
  'ink':          [{r:0.1100,g:0.0980,b:0.0900}, {r:0.9620,g:0.9620,b:0.9580}],
  'muted-fg':     [{r:0.4725,g:0.4463,b:0.4275}, {r:0.6580,g:0.6364,b:0.6220}],
  'border':       [{r:0.9060,g:0.8980,b:0.8940}, {r:0.1632,g:0.1632,b:0.1568}],
  'indigo':       [{r:0.2395,g:0.3637,b:0.8605}, {r:0.3598,g:0.4839,b:0.9802}],
  'indigo-tint':  [{r:0.9200,g:0.9427,b:1.0000}, {r:0.1560,g:0.1751,b:0.2440}],
};
const ids = {};
for (const [name, [light, dark]] of Object.entries(defs)) {
  const v = figma.variables.createVariable(name, c, 'COLOR');
  v.scopes = SCOPES;
  v.setValueForMode(LIGHT, light);
  v.setValueForMode(DARK, dark);
  ids[name] = v.id;
}
return { variableIds: ids, count: Object.keys(ids).length };
```

- [x] **Step 4: Create the remaining seven variables**

Same script shape, same collection and mode IDs, with this `defs`:

```js
const defs = {
  'clay':            [{r:0.8960,g:0.4816,b:0.3040}, {r:0.8708,g:0.5197,b:0.3692}],
  'clay-tint':       [{r:0.9844,g:0.9222,b:0.8956}, {r:0.2340,g:0.1584,b:0.1260}],
  'verdigris':       [{r:0.2232,g:0.4603,b:0.4968}, {r:0.3000,g:0.6467,b:0.7000}],
  'verdigris-tint':  [{r:0.9118,g:0.9433,b:0.9482}, {r:0.1110,g:0.1786,b:0.1890}],
  'success':         [{r:0.1015,g:0.5985,b:0.2837}, {r:0.2000,g:0.8000,b:0.4200}],
  'warning':         [{r:0.7840,g:0.5664,b:0.0160}, {r:0.9550,g:0.7255,b:0.1450}],
  'destructive':     [{r:0.7920,g:0.1680,b:0.1680}, {r:0.8804,g:0.1996,b:0.1996}],
};
```

- [x] **Step 5: Verify all 15 exist with both modes populated**

```js
const c = await figma.variables.getVariableCollectionByIdAsync('COLLECTION_ID');
const vars = await Promise.all(c.variableIds.map(id => figma.variables.getVariableByIdAsync(id)));
return {
  count: vars.length,
  missingValues: vars.filter(v => Object.keys(v.valuesByMode).length !== 2).map(v => v.name),
  wrongScopes: vars.filter(v => v.scopes.includes('ALL_SCOPES')).map(v => v.name),
  names: vars.map(v => v.name).sort(),
};
```

Expected: `count: 15`, `missingValues: []`, `wrongScopes: []`, names matching the Task 2 interface list.

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-08-04-mygist-app-reshaped-figma.md
git commit -m "docs: record colour variable ids"
```

---

## Task 3: Type, radius, space, shadow and motion variables, plus text styles

**Files:**
- Modify: Figma file `Ti7FlZLYOvX3goyvfypJBk`, collections `Type`, `Scale`, `Motion`; nine local text styles

**Interfaces:**
- Consumes: `Ti7FlZLYOvX3goyvfypJBk`, `FONT_DECISION` from Task 1; `Colour` variable IDs from Task 2
- Produces: collection `Scale` with `radius-s|m|l|xl` and `space-4|8|12|16|24|32` (`FLOAT`); collection `Motion` with `duration-fast|medium|slow|scroll` (`FLOAT`, ms) and `easing-decelerate|accelerate|standard|emphasized` (`STRING`); nine text styles named `featured-2`, `featured-3`, `headline-1`, `headline-2`, `headline-3`, `body-1`, `body-2`, `caption-1`, `caption-2`. Returns `{ scaleCollectionId, motionCollectionId, textStyleIds: {name: id} }`.

- [x] **Step 1: Create the Scale collection**

Invoke `figma:figma-use` and `figma:figma-generate-library`. One mode, since radius and space do not change between light and dark.

```js
const c = figma.variables.createVariableCollection('Scale');
const mode = c.modes[0].modeId;
const defs = [
  ['radius-s', 4, ['CORNER_RADIUS']], ['radius-m', 6, ['CORNER_RADIUS']],
  ['radius-l', 8, ['CORNER_RADIUS']], ['radius-xl', 12, ['CORNER_RADIUS']],
  ['space-4', 4, ['GAP','WIDTH_HEIGHT']],   ['space-8', 8, ['GAP','WIDTH_HEIGHT']],
  ['space-12', 12, ['GAP','WIDTH_HEIGHT']], ['space-16', 16, ['GAP','WIDTH_HEIGHT']],
  ['space-24', 24, ['GAP','WIDTH_HEIGHT']], ['space-32', 32, ['GAP','WIDTH_HEIGHT']],
];
const ids = {};
for (const [name, value, scopes] of defs) {
  const v = figma.variables.createVariable(name, c, 'FLOAT');
  v.scopes = scopes;
  v.setValueForMode(mode, value);
  ids[name] = v.id;
}
return { scaleCollectionId: c.id, modeId: mode, variableIds: ids };
```

- [x] **Step 2: Create the Motion collection**

```js
const c = figma.variables.createVariableCollection('Motion');
const mode = c.modes[0].modeId;
const ids = {};
for (const [name, value] of [['duration-fast',120],['duration-medium',200],
                             ['duration-slow',280],['duration-scroll',400]]) {
  const v = figma.variables.createVariable(name, c, 'FLOAT');
  v.scopes = ['ALL_SCOPES']; // durations have no Figma property to scope to
  v.setValueForMode(mode, value);
  ids[name] = v.id;
}
for (const [name, value] of [['easing-decelerate','cubic-bezier(0,0,.2,1)'],
                             ['easing-accelerate','cubic-bezier(.4,0,1,1)'],
                             ['easing-standard','cubic-bezier(.4,0,.2,1)'],
                             ['easing-emphasized','cubic-bezier(.2,0,0,1)']]) {
  const v = figma.variables.createVariable(name, c, 'STRING');
  v.scopes = ['ALL_SCOPES'];
  v.setValueForMode(mode, value);
  ids[name] = v.id;
}
return { motionCollectionId: c.id, modeId: mode, variableIds: ids };
```

Durations and easings are documentation tokens here — Figma has no animatable property to scope them to. `ALL_SCOPES` is correct for these two groups and only these two.

- [x] **Step 3: Load the fonts before creating any text style**

Read `FONT_DECISION` from Task 1. Load every weight in one call, using the **exact** style strings Task 1 returned:

```js
const SANS = 'FONT_DECISION.sans', MONO = 'FONT_DECISION.mono';
const REG = 'REGULAR_STYLE_STRING', SEMI = 'SEMIBOLD_STYLE_STRING';
await figma.loadFontAsync({ family: SANS, style: REG });
await figma.loadFontAsync({ family: SANS, style: SEMI });
await figma.loadFontAsync({ family: MONO, style: REG });
return { loaded: [SANS + '/' + REG, SANS + '/' + SEMI, MONO + '/' + REG] };
```

- [x] **Step 4: Create the nine text styles**

Same call, after the loads above. Line heights are percentages so they scale with size.

```js
const defs = [
  ['featured-2',  28, 120, SANS, SEMI, 0],
  ['featured-3',  20, 130, SANS, SEMI, 0],
  ['headline-1',  18, 140, SANS, SEMI, 0],
  ['headline-2',  16, 140, SANS, SEMI, 0],
  ['headline-3',  14, 140, SANS, SEMI, 0],
  ['body-1',      16, 160, SANS, REG,  0],
  ['body-2',      14, 155, SANS, REG,  0],
  ['caption-1',   13, 145, SANS, REG,  0],
  ['caption-2',   13, 140, MONO, REG,  6],
];
const ids = {};
for (const [name, size, lh, family, style, tracking] of defs) {
  const s = figma.createTextStyle();
  s.name = name;
  s.fontName = { family, style };
  s.fontSize = size;
  s.lineHeight = { unit: 'PERCENT', value: lh };
  s.letterSpacing = { unit: 'PERCENT', value: tracking };
  ids[name] = s.id;
}
return { textStyleIds: ids, count: Object.keys(ids).length };
```

`caption-2` carries +6% tracking and is **always typed in uppercase at the call site** — Figma text styles cannot force case, so every eyebrow string in Tasks 8–13 is written in capitals in the content itself.

- [x] **Step 5: Create the two effect styles**

Shadows are tinted with `ink`, never black. `ink` light is `{r:0.1100,g:0.0980,b:0.0900}`.

```js
const raised = figma.createEffectStyle();
raised.name = 'shadow-raised';
raised.effects = [{ type: 'DROP_SHADOW', color: {r:0.1100,g:0.0980,b:0.0900,a:0.06},
  offset: {x:0,y:1}, radius: 2, spread: 0, visible: true, blendMode: 'NORMAL' }];
const overlay = figma.createEffectStyle();
overlay.name = 'shadow-overlay';
overlay.effects = [{ type: 'DROP_SHADOW', color: {r:0.1100,g:0.0980,b:0.0900,a:0.14},
  offset: {x:0,y:12}, radius: 32, spread: 0, visible: true, blendMode: 'NORMAL' }];
return { effectStyleIds: { raised: raised.id, overlay: overlay.id } };
```

Effect shadow colours **do** take an `a` channel — that is the one place `{r,g,b,a}` is correct. Paint fills still do not.

- [x] **Step 6: Verify**

```js
const textStyles = await figma.getLocalTextStylesAsync();
const effectStyles = await figma.getLocalEffectStylesAsync();
const collections = await figma.variables.getLocalVariableCollectionsAsync();
return {
  textStyles: textStyles.map(s => ({ name: s.name, size: s.fontSize,
    family: s.fontName.family, style: s.fontName.style })),
  effectStyles: effectStyles.map(s => s.name),
  collections: collections.map(c => ({ name: c.name, vars: c.variableIds.length,
    modes: c.modes.map(m => m.name) })),
};
```

Expected: nine text styles with no `featured-1`; two effect styles; three collections — `Colour` (15 vars, 2 modes), `Scale` (10 vars, 1 mode), `Motion` (8 vars, 1 mode).

- [x] **Step 7: Commit the recorded IDs**

```bash
git add docs/superpowers/plans/2026-08-04-mygist-app-reshaped-figma.md
git commit -m "docs: record scale, motion and text style ids"
```

---

## Task 4: Foundations specimens

**Files:**
- Modify: Figma file `Ti7FlZLYOvX3goyvfypJBk`, page `01 Foundations`

**Interfaces:**
- Consumes: all variable and style IDs from Tasks 2–3
- Produces: page `01 Foundations` holding frames `Colour`, `Type`, `Scale`, `Elevation`, `Motion`. No later task depends on these — they exist so a human can check the token layer at a glance.

- [x] **Step 1: State the expected structure**

Five top-level auto-layout frames on `01 Foundations`, laid out left to right starting at x=0, y=0, each 24px apart. `Colour` holds 15 swatch rows, each a 48×48 chip with the token name in `caption-2` and the hex in `caption-1`. Every chip fill is **bound to its variable**, not a literal — that is the whole point of the page.

- [x] **Step 2: Build the Colour specimen**

Invoke `figma:figma-use`. Switch to the page first — page context resets every call.

```js
const page = figma.root.children.find(p => p.name === '01 Foundations');
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'FONT_SANS', style: 'REGULAR_STYLE' });
await figma.loadFontAsync({ family: 'FONT_MONO', style: 'REGULAR_STYLE' });

const wrap = figma.createAutoLayout('VERTICAL', { name: 'Colour', itemSpacing: 8 });
wrap.paddingLeft = wrap.paddingRight = wrap.paddingTop = wrap.paddingBottom = 24;
wrap.x = 0; wrap.y = 0;
page.appendChild(wrap);

const names = ['paper','card','muted','ink','muted-fg','border','indigo','indigo-tint',
  'clay','clay-tint','verdigris','verdigris-tint','success','warning','destructive'];
const created = [];
for (const name of names) {
  const v = (await figma.variables.getLocalVariablesAsync('COLOR')).find(x => x.name === name);
  const row = figma.createAutoLayout('HORIZONTAL', { name, itemSpacing: 12 });
  row.counterAxisAlignItems = 'CENTER';
  const chip = figma.createRectangle();
  chip.resize(48, 48);
  chip.cornerRadius = 8;
  // setBoundVariableForPaint returns a NEW paint — capture and reassign.
  const bound = figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: {r:0,g:0,b:0} }, 'color', v);
  chip.fills = [bound];
  chip.strokes = [{ type: 'SOLID', color: {r:0.906,g:0.898,b:0.894} }];
  chip.strokeWeight = 1;
  row.appendChild(chip);
  const label = figma.createText();
  label.fontName = { family: 'FONT_MONO', style: 'REGULAR_STYLE' };
  label.characters = name.toUpperCase();
  row.appendChild(label);
  wrap.appendChild(row);
  created.push(row.id, chip.id, label.id);
}
return { createdNodeIds: created, wrapId: wrap.id };
```

Fifteen rows is over the ten-operation guidance. If the call errors or times out, split it into two calls of eight and seven names — the script is idempotent per name only if you delete the partial wrap first, so on retry remove `wrapId` before rerunning.

- [x] **Step 3: Verify the Colour specimen in both modes**

```js
const page = figma.root.children.find(p => p.name === '01 Foundations');
await figma.setCurrentPageAsync(page);
const wrap = page.query('FRAME[name=Colour]').first();
const unbound = wrap.query('RECTANGLE').toArray()
  .filter(r => !r.boundVariables || !r.boundVariables.fills);
await wrap.screenshot();
return { rows: wrap.children.length, unboundChips: unbound.map(r => r.parent.name) };
```

Expected: `rows: 15`, `unboundChips: []`. Then set the page's Colour collection mode to `Dark` and screenshot again — every chip must change and no label may become illegible.

- [x] **Step 4: Build the Type specimen**

One frame, nine rows, each row the style name in `caption-2` above a pangram in that style. Use "Maya writes British English and never says delve" as the specimen string rather than lorem, so the ramp is checked against real copy.

```js
const page = figma.root.children.find(p => p.name === '01 Foundations');
await figma.setCurrentPageAsync(page);
const styles = await figma.getLocalTextStylesAsync();
// Load every font a style references before applying any of them.
for (const s of styles) await figma.loadFontAsync(s.fontName);
await figma.loadFontAsync({ family: 'FONT_MONO', style: 'REGULAR_STYLE' });

const wrap = figma.createAutoLayout('VERTICAL', { name: 'Type', itemSpacing: 24 });
wrap.paddingLeft = wrap.paddingRight = wrap.paddingTop = wrap.paddingBottom = 24;
wrap.x = 400; wrap.y = 0;
page.appendChild(wrap);
const created = [];
for (const s of styles) {
  const t = figma.createText();
  t.fontName = s.fontName;
  t.characters = 'Maya writes British English and never says delve';
  wrap.appendChild(t);
  // Wrapping text needs FIXED width + HEIGHT autoresize, or it collapses.
  t.textAutoResize = 'HEIGHT';
  t.layoutSizingHorizontal = 'FIXED';
  t.resize(560, t.height);
  await t.setTextStyleIdAsync(s.id);
  created.push(t.id);
}
return { createdNodeIds: created, count: created.length };
```

- [x] **Step 5: Build the Scale, Elevation and Motion specimens**

- `Scale` at x=1000: four squares at radius 4/6/8/12 with `caption-2` labels, then six horizontal bars at width 4/8/12/16/24/32.
- `Elevation` at x=1400: two 200×120 cards, one with `shadow-raised`, one with `shadow-overlay`, both `card` fill on `paper` ground.
- `Motion` at x=1700: a text table of the four durations and four easings, values read from the `Motion` collection rather than retyped, so a drift between the collection and the specimen is impossible.

- [x] **Step 6: Verify the whole page**

`get_metadata` on the page. Expected: five top-level frames named `Colour`, `Type`, `Scale`, `Elevation`, `Motion`, none overlapping, none at (0,0) except `Colour`. Screenshot the full page in light and dark. Check for clipped text in the Type specimen — the 28px row is where clipping shows first.

- [x] **Step 7: Commit**

```bash
git commit --allow-empty -m "chore: foundations specimens built in Figma Ti7FlZLYOvX3goyvfypJBk"
```

Figma work lives in Figma, so the commit records progress against the plan rather than files. Tick the checkboxes in this document in the same commit.

---

## Task 5: Form primitive components

**Files:**
- Modify: Figma file `Ti7FlZLYOvX3goyvfypJBk`, page `02 Components`

**Interfaces:**
- Consumes: variables and text styles from Tasks 2–3; `RESHAPED_LIB_KEY` from Task 1
- Produces: component sets `TextField`, `Select`, `Switch`, `Checkbox`, `PinField`, `TextArea`, each published on `02 Components`. Returns `{ componentIds: {name: id}, componentKeys: {name: key} }`. Tasks 8–13 instance these by key.

- [x] **Step 1: Look at what Reshaped already does**

If `RESHAPED_LIB_KEY` is not null:

```
search_design_system with query "text field input" and includeLibraryKeys [RESHAPED_LIB_KEY]
```

Read the geometry — height, padding, border weight, focus treatment — and match it. Reshaped's components are the reference for *proportion*; MyGist's variables are the source for *value*. Where they conflict, MyGist wins.

- [x] **Step 2: State the expected structure for TextField**

A component set named `TextField` with two variant properties:

| Property | Values |
|---|---|
| `State` | `Default`, `Hover`, `Focus`, `Filled`, `Error`, `Disabled` |
| `Size` | `Medium` |

Six variants. Each variant is a vertical auto-layout: label (`headline-3`, `ink`), input box, helper line (`caption-1`, `muted-fg`). Input box: height 36, horizontal padding 12, `radius-m` (6), 1px `border` stroke, `card` fill, value text `body-2`.

State differences, and nothing else varies:

| State | Stroke | Fill | Helper |
|---|---|---|---|
| `Default` | `border` 1px | `card` | `muted-fg` |
| `Hover` | `muted-fg` 1px | `card` | `muted-fg` |
| `Focus` | `indigo` 2px | `card` | `muted-fg` |
| `Filled` | `border` 1px | `card` | `muted-fg` |
| `Error` | `destructive` 1px | `card` | `destructive`, replaces helper text |
| `Disabled` | `border` 1px | `muted` | `muted-fg` at 50% opacity |

`Error` **replaces** the helper rather than adding a line — the spec is explicit that error occupies the helper slot, so a field does not change height when it fails validation.

- [x] **Step 3: Build one variant, verify, then clone**

Build `State=Default` completely first, screenshot it, and only then clone for the other five. Building all six before looking at one is how six wrong things get made instead of one.

```js
const page = figma.root.children.find(p => p.name === '02 Components');
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'FONT_SANS', style: 'REGULAR_STYLE' });
await figma.loadFontAsync({ family: 'FONT_SANS', style: 'SEMIBOLD_STYLE' });
const colour = await figma.variables.getLocalVariablesAsync('COLOR');
const byName = Object.fromEntries(colour.map(v => [v.name, v]));
const scale = await figma.variables.getLocalVariablesAsync('FLOAT');
const scaleByName = Object.fromEntries(scale.map(v => [v.name, v]));

const root = figma.createAutoLayout('VERTICAL', { name: 'State=Default', itemSpacing: 6 });
root.x = 0; root.y = 0;
page.appendChild(root);
root.layoutSizingHorizontal = 'FIXED';
root.resize(280, root.height);

const label = figma.createText();
label.fontName = { family: 'FONT_SANS', style: 'SEMIBOLD_STYLE' };
label.characters = 'Preferred name';
root.appendChild(label);

const box = figma.createAutoLayout('HORIZONTAL', { name: 'Input', itemSpacing: 8 });
box.paddingLeft = box.paddingRight = 12;
box.counterAxisAlignItems = 'CENTER';
root.appendChild(box);
box.layoutSizingHorizontal = 'FILL';   // only valid AFTER appendChild
box.layoutSizingVertical = 'FIXED';
box.resize(box.width, 36);
box.fills = [figma.variables.setBoundVariableForPaint(
  { type: 'SOLID', color: {r:1,g:1,b:1} }, 'color', byName['card'])];
box.strokes = [figma.variables.setBoundVariableForPaint(
  { type: 'SOLID', color: {r:0,g:0,b:0} }, 'color', byName['border'])];
box.strokeWeight = 1;
box.setBoundVariable('topLeftRadius', scaleByName['radius-m']);
box.setBoundVariable('topRightRadius', scaleByName['radius-m']);
box.setBoundVariable('bottomLeftRadius', scaleByName['radius-m']);
box.setBoundVariable('bottomRightRadius', scaleByName['radius-m']);

const value = figma.createText();
value.fontName = { family: 'FONT_SANS', style: 'REGULAR_STYLE' };
value.characters = 'Maya';
box.appendChild(value);

const helper = figma.createText();
helper.fontName = { family: 'FONT_SANS', style: 'REGULAR_STYLE' };
helper.characters = 'What your assistants should call you';
root.appendChild(helper);

return { createdNodeIds: [root.id, label.id, box.id, value.id, helper.id], rootId: root.id };
```

- [x] **Step 4: Apply text styles and verify the one variant**

Apply `headline-3` to `label`, `body-2` to `value`, `caption-1` to `helper` via `setTextStyleIdAsync`. Bind text fills to `ink`, `ink`, `muted-fg`. Then:

```js
const root = await figma.getNodeByIdAsync('ROOT_ID');
await root.screenshot({ scale: 2 });
return { width: root.width, height: root.height,
         children: root.children.map(c => ({ name: c.name, type: c.type, h: c.height })) };
```

Expected: input box height exactly 36, no text node with width 0, nothing clipped. **Fix now if wrong** — five clones of a broken variant is five fixes later.

- [x] **Step 5: Clone into the remaining five variants and combine**

Clone `root` five times, rename each to `State=<name>`, apply the stroke/fill/helper differences from the Step 2 table, then:

```js
const variants = ['VARIANT_ID_1','VARIANT_ID_2','VARIANT_ID_3','VARIANT_ID_4','VARIANT_ID_5','VARIANT_ID_6'];
const nodes = await Promise.all(variants.map(id => figma.getNodeByIdAsync(id)));
const set = figma.combineAsVariants(nodes, figma.currentPage);
set.name = 'TextField';
set.description = 'Single-line text input. Error replaces the helper line so the field '
  + 'does not change height on validation failure. Bound to MyGist colour and scale variables.';
return { componentSetId: set.id, key: set.key,
         variantNames: set.children.map(c => c.name) };
```

- [x] **Step 6: Build Select, TextArea, Switch, Checkbox, PinField**

One `use_figma` call each, same pattern, same six states where they apply. Exact specifications:

| Component | Geometry | States | Notes |
|---|---|---|---|
| `Select` | as `TextField` plus a 16px chevron at the right, 12px from the edge | same six | value text `body-2`; placeholder uses `muted-fg` |
| `TextArea` | width 280, height 80, padding 12, `radius-m` | same six | `textAutoResize` stays `HEIGHT`; never `FILL` alone |
| `Switch` | track 36×20, `radius-xl`; knob 16×16 circle, `card`, `shadow-raised` | `Off`, `On`, `Off Disabled`, `On Disabled` | track `muted` when off, `indigo` when on |
| `Checkbox` | 18×18, `radius-s` (4) | `Unchecked`, `Checked`, `Indeterminate`, `Disabled` | checked fill `indigo`, tick in `card` |
| `PinField` | six 40×48 cells, `radius-m`, gap `space-8` | `Empty`, `Partial`, `Complete`, `Error` | replaces the `input-otp` dependency; `Partial` shows 3 of 6 filled with a `indigo` 2px focus ring on cell 4 |

- [x] **Step 7: Verify the whole page and commit**

```js
const page = figma.root.children.find(p => p.name === '02 Components');
await figma.setCurrentPageAsync(page);
const sets = page.findAllWithCriteria({ types: ['COMPONENT_SET'] });
await page.screenshot();
return sets.map(s => ({ name: s.name, key: s.key, variants: s.children.length,
                        described: !!s.description }));
```

Expected: six sets — `TextField` 6, `Select` 6, `TextArea` 6, `Switch` 4, `Checkbox` 4, `PinField` 4 — each with a non-empty description. Record every `key` in this document; Tasks 8–13 import by key.

```bash
git commit --allow-empty -m "chore: form primitives built in Figma Ti7FlZLYOvX3goyvfypJBk"
```

---

## Task 6: Display and container components

**Files:**
- Modify: Figma file `Ti7FlZLYOvX3goyvfypJBk`, page `02 Components`

**Interfaces:**
- Consumes: variables, text styles, and the Task 5 component keys
- Produces: component sets `Button`, `Chip`, `Badge`, `FillSummary`, `SubsectionCard`, `EyebrowBand`, `EmptyState`. Returns `{ componentKeys: {name: key} }`.

- [x] **Step 1: State the expected structure**

| Component | Variants | Geometry |
|---|---|---|
| `Button` | `Variant` × `State`: (`Primary`, `Neutral`, `Critical`, `Ghost`) × (`Default`, `Hover`, `Pressed`, `Disabled`, `Loading`) = 20 | height 36, padding 16, `radius-m`, `body-2` label |
| `Chip` | `State`: `Default`, `Hover`, `Removing` | height 28, padding 12/8, `radius-xl`, `muted` fill, `body-2`, 12px × icon |
| `Badge` | `Tone`: `Neutral`, `Primary`, `Positive`, `Critical`, `Live` | height 20, padding 8, `radius-xl`, `caption-1`; `Live` is `verdigris-tint` with a 6px `verdigris` dot |
| `FillSummary` | `State`: `Empty`, `Partial`, `Complete` | `caption-2`, `muted-fg`; `Empty` reads `empty`, `Partial` `2 of 5`, `Complete` `3 of 3` |
| `SubsectionCard` | `State`: `Default`, `Empty`, `Saved` | `card` fill, 1px `border`, `radius-xl` (12), padding 16, gap `space-12`; header row = title `headline-2` + `FillSummary` right-aligned; `Saved` shows a `success` tick |
| `EyebrowBand` | none — single component | `caption-2` uppercase `muted-fg` + a 1px `border` rule filling remaining width |
| `EmptyState` | `Context`: `Card`, `Page` | `Card` = one `caption-1` line + one `Ghost` button, `clay-tint` ground; `Page` = `featured-2` headline + `body-1` line + button |

`Button` at 20 variants is the largest set here. Build `Primary/Default` first, verify, then clone — the same discipline as Task 5.

- [x] **Step 2: Build Button, Primary/Default only, and verify**

Full script pattern as Task 5 Step 3, with: fill bound to `indigo`, label `body-2` bound to `card`, height 36, `radius-m`, horizontal padding 16, `counterAxisAlignItems: 'CENTER'`. Screenshot at scale 2 and confirm the label is vertically centred and not clipped — a 36px box with 155% line height on 14px text is 21.7px of text in 36px of box, which is correct but easy to get wrong by 1px.

- [x] **Step 3: Complete the Button set**

Clone to 20 variants. Differences only:

| Variant | Fill | Label | Stroke |
|---|---|---|---|
| `Primary` | `indigo` | `card` | none |
| `Neutral` | `card` | `ink` | `border` 1px |
| `Critical` | `destructive` | `card` | none |
| `Ghost` | none | `indigo` | none |

| State | Applied to every variant |
|---|---|
| `Default` | as above |
| `Hover` | fill darkened by an 8% `ink` overlay; `Ghost` gains `muted` fill |
| `Pressed` | 12% `ink` overlay |
| `Disabled` | 50% opacity, no overlay |
| `Loading` | label replaced by a 16px spinner glyph, same fill |

- [x] **Step 4: Build Chip, Badge, FillSummary**

One call. These are small enough to batch — three components, roughly nine operations.

- [x] **Step 5: Build SubsectionCard and EyebrowBand**

`SubsectionCard` is the most reused component in the file and the one the whole redesign rests on. Build it with a nested instance of `FillSummary` in the header, so a card's count is swappable per instance rather than retyped. Its content area is an empty auto-layout named `Content` with `layoutSizingVertical = 'HUG'`, which every screen fills with instances.

- [x] **Step 6: Build EmptyState**

Copy for the `Card` context is exactly: `Nothing here yet. Add a language, or let a client propose one.` For `Page`: headline `Nothing waiting`, line `Agents propose changes here as they notice them.` British English, no em dashes, not apologetic.

- [x] **Step 7: Verify and commit**

`get_metadata` plus a full-page screenshot in light and dark. Expected seven sets with the variant counts from Step 1, every one described, no unbound literal colour on any of them:

```js
const page = figma.root.children.find(p => p.name === '02 Components');
await figma.setCurrentPageAsync(page);
const sets = page.findAllWithCriteria({ types: ['COMPONENT_SET'] });
const unbound = [];
for (const s of sets) {
  for (const n of s.query('FRAME, RECTANGLE, TEXT').toArray()) {
    const hasFill = Array.isArray(n.fills) && n.fills.length && n.fills[0].type === 'SOLID';
    if (hasFill && !(n.boundVariables && n.boundVariables.fills)) unbound.push(s.name + ' > ' + n.name);
  }
}
return { sets: sets.map(s => ({ name: s.name, variants: s.children.length })), unbound };
```

`unbound` should be empty. Any entry is a hardcoded colour that will not switch to dark mode.

```bash
git commit --allow-empty -m "chore: display and container components built in Figma Ti7FlZLYOvX3goyvfypJBk"
```

---

## Task 7: Navigation components

**Files:**
- Modify: Figma file `Ti7FlZLYOvX3goyvfypJBk`, page `02 Components`

**Interfaces:**
- Consumes: variables, text styles, Task 5–6 keys
- Produces: component sets `RailItem`, `RailSubItem`, `Tabs`, `Modal`, `Sheet`, `SaveStateChip`, `SectionSelector`. Returns `{ componentKeys: {name: key} }`.

- [x] **Step 1: State the expected structure**

| Component | Variants | Geometry |
|---|---|---|
| `RailItem` | `State`: `Default`, `Hover`, `Active`, `Active Expanded`; `Badge`: `None`, `Count` | width 240 minus 0 padding, height 36, padding 12, `radius-m`, 16px icon + `body-2` label + optional `Badge` right-aligned. `Active` = `indigo-tint` fill, `indigo` label |
| `RailSubItem` | `State`: `Default`, `Hover`, `Current` | height 32, left padding 36 (indented under its parent), `caption-1`. `Current` carries a 2px × 16px `indigo` bar at x=24 — **this is the scroll-spy marker** and must be its own named layer `Spy marker`, because Task 14 animates it |
| `Tabs` | `Count`: `Two`; `Active`: `First`, `Second` | horizontal, gap `space-24`, each tab `body-2` + a `Badge` count; 2px `indigo` indicator under the active tab, its own layer named `Indicator` |
| `Modal` | `Size`: `Small` (400), `Medium` (560) | `card` fill, `radius-xl`, padding 24, `shadow-overlay`; header `headline-1`, body slot, footer right-aligned button row |
| `Sheet` | `State`: `Closed`, `Open` | mobile only, width 390, `card` fill, top corners `radius-xl`, `shadow-overlay`, 40×4 `border` grab handle |
| `SaveStateChip` | `State`: `Saved`, `Saving`, `Unsaved` | height 28, `radius-xl`, `caption-1`. `Saved` `muted` + `success` tick; `Saving` `muted` + spinner; `Unsaved` `warning` at 12% + inline `Save now` Ghost button |
| `SectionSelector` | `State`: `Closed`, `Open` | mobile, height 44, full width, `card` fill, 1px bottom `border`, section name `headline-2` + chevron |

- [x] **Step 2: Build RailItem, verify at both 240 width and in dark mode**

The rail is 240px and its items must fill it exactly. After `appendChild` into a 240-wide auto-layout parent, set `layoutSizingHorizontal = 'FILL'`. Screenshot `Active` in both colour modes — `indigo-tint` on `paper` is the pairing most likely to disappear in dark mode, and it is worth catching here rather than on five screens.

- [x] **Step 3: Build RailSubItem with a named Spy marker layer**

```js
// The marker is a separate, named node because Task 14 animates its Y position
// between sub-items. An inline stroke on the parent cannot be animated.
const marker = figma.createRectangle();
marker.name = 'Spy marker';
marker.resize(2, 16);
marker.cornerRadius = 1;
marker.fills = [figma.variables.setBoundVariableForPaint(
  { type: 'SOLID', color: {r:0,g:0,b:0} }, 'color', byName['indigo'])];
```

In `Default` and `Hover` the marker is present but `visible = false`, so all three variants share one structure and the animation has something to interpolate in every state.

- [x] **Step 4: Build Tabs, SaveStateChip**

`Tabs` content for the Review surface: `Inbox` with a `Badge` reading `3`, `Observations` with `2`. The `Indicator` layer is named and separate for the same reason as `Spy marker`.

- [x] **Step 5: Build Modal, Sheet, SectionSelector**

- [x] **Step 6: Verify and commit**

Same verification script as Task 6 Step 7. Expected seven sets. Additionally confirm `RailSubItem` contains a node named exactly `Spy marker` in all three variants, and `Tabs` a node named exactly `Indicator`:

```js
const page = figma.root.children.find(p => p.name === '02 Components');
await figma.setCurrentPageAsync(page);
const sub = page.query('COMPONENT_SET[name=RailSubItem]').first();
const tabs = page.query('COMPONENT_SET[name=Tabs]').first();
return {
  markersPerVariant: sub.children.map(v => v.query('[name=Spy marker]').length),
  indicatorPerVariant: tabs.children.map(v => v.query('[name=Indicator]').length),
};
```

Expected: `markersPerVariant: [1,1,1]`, every `indicatorPerVariant` entry `1`.

```bash
git commit --allow-empty -m "chore: navigation components built in Figma Ti7FlZLYOvX3goyvfypJBk"
```

---

## Task 8: Shell and navigation screens

**Files:**
- Modify: Figma file `Ti7FlZLYOvX3goyvfypJBk`, page `03 Shell & Navigation`
- Read: `frontend/src/App.jsx:589-700` for what the header and rail actually contain today

**Interfaces:**
- Consumes: every component key from Tasks 5–7
- Produces: frames `Desktop 1440 — Shell`, `Mobile 390 — Shell`, `Mobile 390 — Section sheet`. Produces the reusable `AppShell` frame structure that Tasks 9–12 clone as their starting point. Returns `{ shellFrameId, mobileShellFrameId }`.

- [x] **Step 1: Read the current shell before designing its replacement**

Read `frontend/src/App.jsx` lines 589–700. Confirm the header's real contents: logo svg, `MyGist` wordmark, autosave `Switch`, save-status text, disconnected `Badge`, theme cycle button, account chip. The redesign moves the switch out and replaces the status text with `SaveStateChip` — verify that is still what the code does before building against it.

- [x] **Step 2: State the expected structure**

`Desktop 1440 — Shell`: 1440×1024, `paper` fill.
- Header: 1440×60, `card` fill, 1px bottom `border`, contents inset to a 1152 max-width centred column. Left: 22px logo mark + `MyGist` in `headline-2`. Right, in order, gap `space-16`: `SaveStateChip` (`Saved`), theme button 32×32 `radius-m` 1px `border`, account chip reading `Maya`.
- Body: 1152 centred, padding-top 32, two columns gap `space-24`. Rail 240 fixed. Content fills.
- Rail contents, in order: `RailItem` ×  the ten sections (`Profile`, `Preferences`, `Lifestyle`, `Knowledge`, `Projects`, `Goals`, `Circle`, `Media`, `Aesthetics`, `Learning log`), a 1px `border` divider with `space-12` above and below, `RailItem` `Review` with `Badge` `3`, `RailItem` `Sections`, then `v2.0.0 (a1b2c3)` in `caption-2`.
- `Preferences` is `Active Expanded`, followed by four `RailSubItem`s: `Code Style`, `Communication` (`Current`), `Learning Style`, `Likes & Dislikes`.

- [x] **Step 3: Build the header**

Invoke `figma:figma-use` and `figma:figma-generate-design`. Import components by key before instancing:

```js
const page = figma.root.children.find(p => p.name === '03 Shell & Navigation');
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'FONT_SANS', style: 'SEMIBOLD_STYLE' });
await figma.loadFontAsync({ family: 'FONT_SANS', style: 'REGULAR_STYLE' });

const chipSet = await figma.importComponentSetByKeyAsync('SAVESTATECHIP_KEY');
const saved = chipSet.defaultVariant.createInstance();
saved.setProperties({ State: 'Saved' });

const screen = figma.createFrame();
screen.name = 'Desktop 1440 — Shell';
screen.resize(1440, 1024);
screen.x = 0; screen.y = 0;
screen.fills = [figma.variables.setBoundVariableForPaint(
  { type: 'SOLID', color: {r:1,g:1,b:1} }, 'color', byName['paper'])];
page.appendChild(screen);

const header = figma.createAutoLayout('HORIZONTAL', { name: 'Header', itemSpacing: 16 });
header.counterAxisAlignItems = 'CENTER';
header.primaryAxisAlignItems = 'SPACE_BETWEEN';
header.paddingLeft = header.paddingRight = 144; // (1440 - 1152) / 2
screen.appendChild(header);
header.layoutSizingHorizontal = 'FIXED';
header.resize(1440, 60);
// ... logo group, wordmark, right cluster with `saved` ...
return { createdNodeIds: [screen.id, header.id, saved.id], screenId: screen.id };
```

- [x] **Step 4: Verify the header before building the rail**

Screenshot the header alone at scale 2. Check: 60px tall exactly, contents on the 1152 column, nothing clipped, the chip vertically centred. Fix before continuing.

- [x] **Step 5: Build the rail**

Twelve `RailItem` instances plus four `RailSubItem`s plus a divider is sixteen operations. **Split into two calls** — the ten section items first, then Review/Sections/divider/version/sub-items.

- [x] **Step 6: Build the mobile shell**

`Mobile 390 — Shell`: 390×844. Header 390×56 with the logo, `SaveStateChip`, theme and account collapsed into a 32px overflow button. Below it a `SectionSelector` (`Closed`) reading `Preferences`. **No horizontal tab strip** — its absence is the point of the screen.

`Mobile 390 — Section sheet`: the same frame with `Sheet` `Open` over a 40% `ink` scrim, listing all ten sections plus `Review` and `Sections`, with `Preferences` expanded showing its four sub-items. This is the screen that replaces the strip, so it must show that every subsection is reachable in two taps.

- [x] **Step 7: Verify all three frames**

```js
const page = figma.root.children.find(p => p.name === '03 Shell & Navigation');
await figma.setCurrentPageAsync(page);
const frames = page.children.map(f => ({ name: f.name, w: f.width, h: f.height }));
const detached = page.query('FRAME[name*=Rail]').toArray().filter(n => n.type !== 'INSTANCE');
await page.screenshot();
return { frames, suspectDetached: detached.map(n => n.name) };
```

Expected: three frames at 1440×1024, 390×844, 390×844. Screenshot in light and dark. Confirm every rail row is an `INSTANCE`, not a local frame — a detached copy will not update when the component changes.

- [x] **Step 8: Commit**

```bash
git commit --allow-empty -m "chore: shell and navigation screens built in Figma Ti7FlZLYOvX3goyvfypJBk"
```

---

## Task 9: Section editor screens

**Files:**
- Modify: Figma file `Ti7FlZLYOvX3goyvfypJBk`, page `04 Section editor`
- Read: `backend/section_packs/preferences/manifest.json`, `profile/manifest.json`, `goals/manifest.json`

**Interfaces:**
- Consumes: `AppShell` structure from Task 8, all component keys
- Produces: frames `Desktop — Preferences`, `Desktop — Profile`, `Desktop — Goals`, `Mobile — Preferences`, `Desktop — List expanded`, `Desktop — Chip input`. Returns `{ frameIds: {name: id} }`.

- [x] **Step 1: Read the three manifests**

Confirm the exact node structure before building. Preferences: four groups — `Code Style` (3 `strings`), `Communication` (`fields` with tone/locale/detail_level, a `list`, a `strings`), `Learning Style` (2 `strings`) — plus an ungrouped `list` `Likes & Dislikes`. Profile: a 7-field `fields` node, two `list`s, a `Contact & Links` group with two `list`s, one `list`. Goals: a single untitled `list`.

If a manifest has changed since the spec was written, build what the manifest says and note the difference. The manifest is the truth.

- [x] **Step 2: Build Desktop — Preferences**

Clone the Task 8 shell, then fill the content column. Content structure, top to bottom:

1. Page title `Preferences` in `featured-3`, description `How you like AI to work` in `caption-1` `muted-fg`.
2. `EyebrowBand` `CODE STYLE`.
3. Three `SubsectionCard`s in a 2-column grid, gap `space-16`: `Preferred languages`, `Frameworks`, `Tools` — **all three in `Empty` state** with `FillSummary` reading `empty` and the `EmptyState` `Card` copy. Maya is not a developer; this is deliberate.
4. `EyebrowBand` `COMMUNICATION`.
5. `SubsectionCard` `Default style`, `FillSummary` `3 of 3`, containing a 2-column `Select` grid: `Tone` = `direct`, `Detail level` = `concise`, and `Locale` = `en-GB` spanning the row.
6. `SubsectionCard` `When I'm feeling...`, `FillSummary` `2 set`, containing two list rows.
7. `SubsectionCard` `Response format`, `FillSummary` `3 set`, containing three `Chip`s: `no exclamation marks`, `bullet points`, `British English`.
8. `EyebrowBand` `LEARNING STYLE`.
9. Two `SubsectionCard`s: `Preferred methods` `1 set` with a `examples first` chip; `Things to avoid` `1 set` with a `long theory` chip.
10. `SubsectionCard` `Likes & Dislikes`, `FillSummary` `4 set`, four list rows. No `EyebrowBand` above it — it is ungrouped in the manifest, and that difference should be visible.

Build items 1–4 in one call, 5–7 in a second, 8–10 in a third. Screenshot after each.

- [x] **Step 3: Verify Preferences against the two-tier rule**

```js
const page = figma.root.children.find(p => p.name === '04 Section editor');
await figma.setCurrentPageAsync(page);
const screen = page.query('FRAME[name=Desktop — Preferences]').first();
const bands = screen.query('INSTANCE[name*=EyebrowBand]').length;
const cards = screen.query('INSTANCE[name*=SubsectionCard]').length;
await screen.screenshot();
return { bands, cards };
```

Expected: `bands: 3`, `cards: 9`. Then look at the screenshot and confirm by eye: no card sits inside another card, and the `Likes & Dislikes` card is visibly at the same level as the bands' cards rather than nested under one.

- [x] **Step 4: Build Desktop — Profile**

The density case. Same pattern: a `Personal information` card with a 7-field grid (`name` Maya Ellis, `preferred_name` Maya, `current_role` Marketing assistant, `organisation` empty, `location` Manchester, `nationality` British, `bio` spanning the row), `Education` and `Work experience` list cards, a `CONTACT & LINKS` band over `Emails` and `Links`, then `Languages`. `FillSummary` on the fields card reads `6 of 7`.

- [x] **Step 5: Build Desktop — Goals**

The light case: one card, no band, no rail sub-items — because a single untitled `list` node has no subsections to navigate. This screen exists to prove the design degrades correctly for the seven thin sections, and the rail must show `Goals` as `Active` **not** `Active Expanded`.

- [x] **Step 6: Build the two pattern detail frames**

`Desktop — List expanded`: the `Likes & Dislikes` card with one row expanded inline into its edit form, showing the row title holding position and the form below it. Add and overflow-menu affordances visible. **No modal** — the point is that editing happens in place.

`Desktop — Chip input`: the `Response format` card mid-entry, with a typed value in the input and three committed chips, plus a `Removing` chip to show the exit state.

- [x] **Step 7: Build Mobile — Preferences**

390 wide. `SectionSelector` reading `Preferences`, page title, then the same bands and cards in a single column. Cards go full width, the 2-column field grids collapse to one column.

- [x] **Step 8: Verify the page and commit**

Full-page screenshot, light and dark. Confirm: six frames, every card an instance, no clipped text in the 7-field Profile grid, and the empty Code Style cards read as intentional rather than broken.

```bash
git commit --allow-empty -m "chore: section editor screens built in Figma Ti7FlZLYOvX3goyvfypJBk"
```

---

## Task 10: Review screens

**Files:**
- Modify: Figma file `Ti7FlZLYOvX3goyvfypJBk`, page `05 Review`
- Read: `frontend/src/components/ProposalsPanel.jsx` for the real data shape

**Interfaces:**
- Consumes: shell from Task 8, component keys from Tasks 5–7
- Produces: frames `Desktop — Inbox`, `Desktop — Inbox row expanded`, `Desktop — Observations`, `Desktop — Promote dialog`, `Desktop — Empty`, `Desktop — No propose scope`, `Mobile — Inbox`. Returns `{ frameIds: {name: id} }`.

- [x] **Step 1: Read the panel to get the fields right**

Read `frontend/src/components/ProposalsPanel.jsx`. Confirm a row carries: `id`, `kind` (`entity` or `note`), `action` (`add`/`update`/`remove`), `entity`, `data` (field/value map), `note`, `rationale`, `evidence`, `proposed_by`, `seen_count`, `section_hint`. Every one of these must appear somewhere in the screens, or the design is hiding data the backend sends.

- [x] **Step 2: Build Desktop — Inbox**

Content column: `Tabs` with `Inbox` `3` active and `Observations` `2`, then three dense rows in one `SubsectionCard`-less list container:

| Verb | Entity | Value |
|---|---|---|
| Add | hobby | bouldering |
| Add | tool | Vite |
| Update | preference | tone → direct |

Each row: 44px tall, 1px bottom `border` except the last, `body-2` verb in `ink`, entity in `muted-fg`, value in `ink`, then a `Primary` 28px tick, a `Neutral` 28px cross, and a chevron. Right-aligned, gap `space-8`.

- [x] **Step 3: Build Desktop — Inbox row expanded**

The same screen with row 1 expanded, revealing: the full `data` field list as a two-column definition list, `proposed_by` as a `Neutral` `Badge` reading `claude`, `seen 2×` in `caption-1`, the `rationale` in `body-2` `muted-fg`, and the `evidence` as a blockquote with a 2px `border` left rule in italic `muted-fg`.

- [x] **Step 4: Build Desktop — Observations**

`Observations` tab active. Two full cards, the first being Maya's real queue item: note *"Maya now owns the monthly newsletter"* in `headline-2`, `proposed_by` badge, `seen 2×`, rationale, evidence blockquote, `suggested: Projects` in `caption-1`, then `Promote` (`Primary`) and `Delete` (`Neutral`) buttons. The full card, deliberately heavier than an Inbox row.

- [x] **Step 5: Build Desktop — Promote dialog**

`Modal` `Small` over the Observations screen with a 40% `ink` scrim. Title `Promote to your persona` in `headline-1`. Body: `Select` `Section` = `Projects`, `Select` `Type` = `project`, `TextField` `Name` pre-filled `Maya now owns the monthly newsletter`. Footer: `Cancel` (`Neutral`), `Promote` (`Primary`).

This replaces two raw unstyled `<select>` elements. Every control here must be a `Select` or `TextField` instance — a locally drawn dropdown defeats the entire purpose of the frame.

- [x] **Step 6: Build the two edge-case frames**

`Desktop — Empty`: `EmptyState` `Page` — `Nothing waiting` over `Agents propose changes here as they notice them.` Plus a `caption-1` line listing the keyboard shortcuts: `j k` move, `a` approve, `r` reject, `e` expand.

`Desktop — No propose scope`: the empty state plus a `warning`-toned notice reading `Claude is connected for reading only, so it cannot propose anything. Reconnect to allow proposals.` with a `Ghost` `Reconnect` button. **This frame is the whole reason the scope caveat is in the spec** — without it the failure is silent, so the screen must exist.

- [x] **Step 7: Build Mobile — Inbox and verify**

390 wide, rows stack the value under the verb, actions stay on one line. Then verify the page: seven frames, every control an instance, and confirm the Inbox row is visibly lighter than an Observation card — that contrast is the design.

- [x] **Step 8: Commit**

```bash
git commit --allow-empty -m "chore: review screens built in Figma Ti7FlZLYOvX3goyvfypJBk"
```

---

## Task 11: Onboarding screens

**Files:**
- Modify: Figma file `Ti7FlZLYOvX3goyvfypJBk`, page `06 Onboarding`

**Interfaces:**
- Consumes: shell from Task 8, all component keys
- Produces: frames `Desktop — Spine`, `Desktop — Basics About you`, `Desktop — Basics scrolled`, `Desktop — Delegate offer`, `Desktop — Spine complete`, `Mobile — Spine`, `Mobile — Basics`. Returns `{ frameIds: {name: id} }`.

- [x] **Step 1: Build Desktop — Spine**

The routing card, above the section title on the Profile screen. `clay-tint` fill, 1px `clay` at 30% stroke, `radius-xl`, padding 16. Header row: `Getting started` in `headline-2`, `1 of 3` in `caption-2` right-aligned, a dismiss × . Three rows:

| Row | Content |
|---|---|
| 1 | `success` tick, `Connect a client`, then a `Badge` `Live` reading `connected · Claude` |
| 2 | `Fill in the basics`, `Start` as a `Primary` button |
| 3 | `Ask your client to fill in the rest`, `optional` in `caption-1` `muted-fg` |

It routes and does not collect — no input controls on this card at all.

- [x] **Step 2: Build Desktop — Basics About you**

The rail destination. The rail gains a `Getting started` `RailItem` in `Active Expanded` below the divider, with four `RailSubItem`s: `About you` (`Current`), `How you like answers`, `Working on`, `Languages`.

Content: title `Getting started` in `featured-3`, line `Four groups, about five minutes. Skip any of it.` in `caption-1`. Then the **delegate offer above the first band** — a `clay-tint` card reading `Would you rather your client did this?` in `headline-2` over `Paste one prompt and it proposes the lot for you to approve.` in `caption-1`, with a `Copy prompt` `Neutral` button. Then `EyebrowBand` `ABOUT YOU` over two `SubsectionCard`s:

- `Your name and role`, `FillSummary` `2 of 5`: `TextField`s `What we call you` = `Maya`, `Full name` = `Maya Ellis`, `Role` = `Marketing assistant`, `Organisation` = empty, `Location` = `Manchester`.
- `In a sentence`, `FillSummary` `empty`: a `TextArea` with helper `Anything a new assistant should know first`.

The offer sits above the band, not below the cards. Its position is the design decision.

- [x] **Step 3: Build Desktop — Basics scrolled**

The same screen scrolled to `HOW YOU LIKE ANSWERS`, showing that band's cards — `Default style` with the three `Select`s, `Response format` chips, `Preferred methods`, `Things to avoid` — and the `Spy marker` now on `How you like answers` in the rail. This frame proves the scroll-spy relationship, so the marker's position must visibly disagree with the previous frame's.

- [x] **Step 4: Build Desktop — Delegate offer**

The copy-paste prompt expanded. A `muted` code block, `caption-2`, containing exactly:

> Use `get_schema` to learn my MyGist vocabulary, then propose what you know about me with `propose_update`. One call per fact, each with your reasoning and a short quote from me. Never write directly, and skip anything you are guessing at. I will approve or reject each one.

Below it in `caption-1` `muted-fg`: `Paste this into a client that has permission to propose. If it does not know you yet, give it your CV or bio first.`

Transcribe both strings exactly. They are the feature.

- [x] **Step 5: Build Desktop — Spine complete**

`3 of 3`, all three rows ticked, and a `caption-1` line reading `You can find this again from your account menu.` — the frame that proves dismissal is not destructive.

- [x] **Step 6: Build the two mobile frames and verify**

`Mobile — Spine` at 390 with the card full width and rows stacked. `Mobile — Basics` with the `SectionSelector` reading `Getting started`, the delegate offer, and the About you cards in one column.

Verify: seven frames; the delegate offer appears above the first `EyebrowBand` in every basics frame; the `Spy marker` differs between `Basics About you` and `Basics scrolled`.

- [x] **Step 7: Commit**

```bash
git commit --allow-empty -m "chore: onboarding screens built in Figma Ti7FlZLYOvX3goyvfypJBk"
```

---

## Task 12: Auth, settings and consent screens

**Files:**
- Modify: Figma file `Ti7FlZLYOvX3goyvfypJBk`, page `07 Auth & Settings`
- Read: `frontend/src/components/WelcomeAuth.jsx`, `AuthShell.jsx`, `ConnectionSettings.jsx`, `Consent.jsx`, `InviteGate.jsx`

**Interfaces:**
- Consumes: all component keys
- Produces: frames `Auth — Sign in`, `Auth — Sign up`, `Auth — Forgot`, `Auth — Reset`, `Auth — OTP`, `Auth — Invite gate`, `Settings — Account`, `Settings — Server`, `Settings — Token`, `Settings — Connected apps`, `Consent`, `Mobile — Sign in`, `Mobile — Settings Account`. Returns `{ frameIds: {name: id} }`.

- [x] **Step 1: Read the five components first**

Confirm the real field sets and copy before designing. In particular: what `WelcomeAuth` actually offers (sign in, sign up, forgot, plus a "use a token instead" link), and what `Consent` lists as scopes.

- [x] **Step 2: Build the six auth frames**

Each: 1440×1024 `paper` ground, a 400-wide centred `card` `Modal`-styled panel at `radius-xl`, padding 24, `shadow-raised`. Logo mark above a `headline-1` title and a `caption-1` description, then the form, then a full-width `Primary` submit.

| Frame | Fields | Notes |
|---|---|---|
| `Sign in` | email, password | `Forgot?` `Ghost` link right-aligned above password; `Use a token instead` `Ghost` below submit |
| `Sign up` | email, password | password helper states the rule; no confirm field |
| `Forgot` | email | success state text replaces the form after submit |
| `Reset` | new password, confirm | live match hint in `caption-1`, `destructive` when mismatched |
| `OTP` | `PinField` `Partial` | resend `Ghost` link with a countdown in `caption-1` |
| `Invite gate` | invite code | one `caption-1` line explaining why it is needed |

Build two frames per call, screenshot after each pair.

- [x] **Step 3: Build the four settings frames**

`Modal` `Medium` (560) over a dimmed shell, with `Tabs` — but a **three**-tab instance, so extend the `Tabs` component with a `Count: Three` variant first rather than drawing tabs locally.

| Tab | Contents |
|---|---|
| `Account` | email with a `Live`-less `Badge` reading `verified`, `Add email` `Ghost`, `Change password` `Ghost`, **`Auto-save` `Switch` with helper `Save changes as you type`** — this is where the header's switch moved to — and `Sign out` `Critical` |
| `Server` | `TextField` server URL, `Test connection` `Neutral`, and a `Badge` `Live` reading `connected` on success |
| `Token` | existing token as a `muted` code row with `Copy` and `Revoke`, plus `Create token` with a scope `Checkbox` group |
| `Connected apps` | two rows, each: client name, `Badge` `Live`, granted scopes in `caption-2`, `last used 2 hours ago` in `caption-1`, `Revoke` `Ghost` |

The relocated autosave switch is a specific spec requirement. It must be visibly present on the `Account` tab.

- [x] **Step 4: Build Consent**

A 480 centred panel: `Claude wants to connect to your persona` in `headline-1`, the client name, then a `CheckboxGroup` of scopes in plain language — `Read your persona`, `Search your persona`, `Propose changes for your approval`, each with a `caption-1` explanation. Footer: `Deny` as **`Neutral`** and `Allow` as `Primary`. Deny is not destructive.

- [x] **Step 5: Build the two mobile frames**

`Mobile — Sign in` at 390, panel full width minus `space-16` each side. `Mobile — Settings Account` with the modal as a full-height `Sheet` instead, because a 560 modal does not fit 390.

- [x] **Step 6: Verify and commit**

Thirteen frames. Confirm: the autosave `Switch` exists on `Settings — Account`; `Consent`'s Deny is `Neutral` not `Critical`; `Auth — OTP` uses a `PinField` instance rather than six drawn boxes.

```bash
git commit --allow-empty -m "chore: auth, settings and consent screens built in Figma Ti7FlZLYOvX3goyvfypJBk"
```

---

## Task 13: Motion annotations

**Files:**
- Modify: Figma file `Ti7FlZLYOvX3goyvfypJBk`, page `08 Motion`

**Interfaces:**
- Consumes: `Motion` variables from Task 3; the `Spy marker` and `Indicator` layers from Task 7; screens from Tasks 8–12
- Produces: page `08 Motion` with seven annotated motion specs, and real animation on the two that carry the most weight. Returns `{ frameIds: [...], animatedNodeIds: [...] }`.

- [x] **Step 1: Build the specification table**

One frame listing all seven named motions with trigger, property, duration token, easing token. Values read from the `Motion` collection, not retyped:

| # | Motion | Property | Duration | Easing |
|---|---|---|---|---|
| 1 | Scroll-spy marker travel | `y` | `medium` | `standard` |
| 2 | Subsection expand | `height`, `opacity` | `slow` | `decelerate` |
| 3 | Approve/reject exit | `x` ±8, `opacity`, `height` | 240ms | `accelerate` |
| 4 | Inline list edit | `height` | `slow` | `decelerate` |
| 5 | Save tick | `scale` 0.8→1, `opacity` | `fast` in, 1.2s hold, 200ms out | `decelerate` |
| 6 | Sheet / Modal | `y` / `scale` 0.96→1 | `slow` / 240ms | `emphasized` / `decelerate` |
| 7 | Loading shimmer | sweep | 1.4s loop, stops on arrival | linear |

Plus the three standing rules and the reduced-motion rule, verbatim from the spec's Global Constraints.

- [x] **Step 2: Animate the scroll-spy marker**

Invoke `figma:figma-use-motion` alongside `figma-use`. Clone the rail from Task 8 twice — marker on `Code Style`, marker on `Communication` — and animate the `Spy marker` node's Y between them at 200ms with `cubic-bezier(.4, 0, .2, 1)`. This is the highest-value motion in the design, so it is the one that must actually move rather than be described.

- [x] **Step 3: Animate the approve/reject row exit**

Clone the Task 10 Inbox rows. Animate row 1: `x` +8, `opacity` to 0, `height` to 0 over 240ms `accelerate`, with rows below closing the gap on the same curve.

- [x] **Step 4: Annotate the remaining five**

Static before/after frame pairs with the timing written beside each in `caption-2`. Do not animate all seven — two working examples plus five precise specs is more useful than seven half-built ones.

- [x] **Step 5: Verify and commit**

Confirm the two animated nodes carry animation data and that the durations match the `Motion` collection values rather than hardcoded numbers.

```bash
git commit --allow-empty -m "chore: motion annotations built in Figma Ti7FlZLYOvX3goyvfypJBk"
```

**Recorded values:** Page `08 Motion` (`1:9`) holds five top-level frames — spec table `200:2` (7-row table + standing rules + reduced-motion rule + ruling (c)/(d) notes, all durations/easings read live from `Motion` collection `VariableCollectionId:7:13` mode `7:1`), Motion 1 scroll-spy wrapper `201:56` (Before rail `201:57`, Live rail `201:74`, After rail `201:91`), Motion 3 approve/reject wrapper `204:124` (cloned Inbox row list `204:94`), Step 4 static annotations wrapper `205:62` (motions 2/4/5/6/7), and the ruling (f) Tabs test wrapper `206:62`. The two genuinely-animated nodes: Spy marker `201:1866` (`TRANSLATION_Y` 0→36px, 200ms, `cubic-bezier(.4,0,.2,1)`, on the Live rail — detached from its instance first, since the Plugin API rejects keyframes on instance sublayers; its own 32px-tall row frame `201:1863` had to have `clipsContent` set to `false`, since the sliding marker otherwise gets clipped by its own row bounds mid-transit — verified this exact failure mode by exporting before the fix, then confirmed the slide completes and settles beside "Communication" after) and Row — Add hobby `204:95` plus its divider `204:104` (`TRANSLATION_X` 0→8, `OPACITY` 1→0, `HEIGHT` 44→~0, 240ms, `cubic-bezier(.4,0,1,1)`, verified by exported video showing rows 2–3 close the gap via the parent auto-layout's own reflow). Ruling (b) route: built the two rail states fresh, instancing `RailSubItem` `State=Current` (`75:77`) for every row rather than cloning, then overriding label colour (indigo `VariableID:4:9` for current, ink `VariableID:4:6` otherwise) and marker opacity (1 for current, 0 for the other three) on all 12 instances across the Before/Live/After rails — enumerated and re-read after build: `201:58`=1(current), `201:62`=0, `201:66`=0, `201:70`=0 (Before); `201:75`(later detached to `201:1863`, marker `201:1866`)=1(current), `201:79`=0, `201:83`=0, `201:87`=0 (Live); `201:92`=0, `201:96`=1(current), `201:100`=0, `201:104`=0 (After) — all matched intent, no unwanted resets observed. Ruling (f) finding: Task 7's per-tab in-flow `Indicator` **cannot** currently animate between tabs — a `TRANSLATION_X`/`WIDTH` keyframe test on the `Count=Two, Active=First` variant's `Indicator` (test frame `206:62`, indicator node `206:84`) reproduced the exact "renders invisible" failure within ~70ms of the transition starting, because each `Indicator` is clipped by its own parent `Tab` frame (`clipsContent:true`, sized to that tab's own width, e.g. `206:80` at width 68). Setting that one frame's `clipsContent` to `false` made the same keyframes slide and settle correctly under "Observations" — confirming clipping, not the per-tab architecture itself, is the blocker, and that the fix is small and localised (disable `clipsContent` on each `Tab` frame, or move `Indicator` to a non-clipping shared ancestor). This is routed back as a Task 7 component finding, not fixed in place (Task 13 is not tasked with editing the shared `Tabs` component). No `clay`/`verdigris` tokens used anywhere on the page; a full audit of the five frames found zero unbound fills, zero unbound text fills, and zero non-token corner radii among content authored in Task 13 (the only flagged items — icon fills inside cloned `Button` instances, `Vector` icon strokes, `RailSubItem`'s own internal `itemSpacing:0`, and the shared `Spy marker` component's `cornerRadius:1` — are all inherited from pre-existing Task 7/8/10 components, not introduced here).

**Task 13 follow-up (cross-task fix: `Tabs` component repaired after Task 7 sign-off):** the ruling (f) finding above was upgraded from "documented" to "fixed at the source." `clipsContent` was set to `false` on all 29 `Tab` frames inside the shared `Tabs` component set (`78:43`, page `02 Components`) — every `Tab` frame across all 9 variants: `Count=Two` (`78:16`, `78:22`, `78:29`, `78:35`), `Count=Three` (`173:28`, `173:32`, `173:36`, `173:41`, `173:45`, `173:49`, `173:54`, `173:58`, `173:62`), `Count=Four` (`194:28`, `194:32`, `194:36`, `194:40`, `194:45`, `194:49`, `194:53`, `194:57`, `194:62`, `194:66`, `194:70`, `194:74`, `194:79`, `194:83`, `194:87`, `194:91`) — all read back `clipsContent:false` after the edit, and the component set's own bounding box was unchanged (`1334×176`), so the stale-bounding-box quirk did not recur this time (no variant append, only a boolean toggle). The ruling (f) test frame (`206:62`, page `08 Motion`) was rebuilt with a freshly-created instance from the now-fixed `Count=Two, Active=First` component — no local `clipsContent` override applied — and its `Indicator` (`210:84`) was keyframed `TRANSLATION_X` 0→92 / `WIDTH` 68→118 over 200ms `cubic-bezier(.4,0,.2,1)`; `export_video` + frame extraction confirmed the indicator genuinely slides from under the first tab to under the second and settles there, with `clipsContentInherited:false` proving the fix came from the component, not a per-instance patch. The frame's caption was rewritten to record the finding and the fix (no longer claims "unmodified"). Regression-checked against one Task 10 frame (`Desktop — Inbox`, `125:2`) and one Task 12 frame (`Settings — Account`, `184:95`) by screenshot: both render unchanged, tabs and indicators correctly positioned, nothing clipped. Also bound the two previously-hardcoded `32px` gaps (`201:56`, `205:62`) to `space-32` (`VariableID:7:12`), and a page-wide `itemSpacing` sweep found and bound five more author-created gaps that had a legal value but no binding (`201:108`/`201:110`/`201:112` → `space-8`; `204:124` → `space-16`; `206:62` → `space-12`); the remaining 33 unbound hits are all inherited `itemSpacing` from cloned/instanced Task 7/8/10 content (`RailSubItem`'s internal `0`, the cloned Inbox row list's internal `0`/`8`s, and the `Tabs` `Badge` instances' `4`), unchanged from the original audit's inherited-debt list. Variable mode confirmed `4:0` (Light) on all four touched pages (`02 Components`, `05 Review`, `07 Auth & Settings`, `08 Motion`) — no mode switch performed.

---

## Task 14: Cover, final sweep, and handoff

**Files:**
- Modify: Figma file `Ti7FlZLYOvX3goyvfypJBk`, page `00 Cover`
- Modify: `docs/superpowers/specs/2026-08-04-mygist-app-reshaped-design.md` (add the file link)

**Interfaces:**
- Consumes: everything
- Produces: a cover page, a verified file, and a written record of any place the prototype knowingly diverges from the spec

- [x] **Step 1: Build the cover**

`MyGist — App Redesign` in `featured-2`, a `caption-1` line naming the spec path, the date `2026-08-04`, and a `caption-2` line recording `FONT_DECISION` — so anyone opening the file learns immediately whether they are looking at Geist or a substitute.

- [x] **Step 2: Full-file audit for hardcoded colour**

Fan out one `use_figma` call per screen page in a single message (Rule: one page switch per call). Each returns any node with a solid fill that has no bound variable:

```js
const page = await figma.getNodeByIdAsync('PAGE_ID');
await figma.setCurrentPageAsync(page);
const bad = [];
for (const n of page.query('FRAME, RECTANGLE, TEXT, ELLIPSE').toArray()) {
  if (n.type === 'INSTANCE') continue;               // instances inherit bindings
  const f = n.fills;
  if (Array.isArray(f) && f.length && f[0].type === 'SOLID'
      && !(n.boundVariables && n.boundVariables.fills)) {
    bad.push({ id: n.id, name: n.name, page: page.name });
  }
}
return { unboundCount: bad.length, unbound: bad.slice(0, 40) };
```

Every hit is a node that will not switch to dark mode. Fix them all.

**Task 14 ruling (a) applied:** the script above checks `n.boundVariables.fills` and skips `INSTANCE` nodes — both wrong (paint bindings live on each paint's own `boundVariables.color`; instances can carry their own unbound overrides). Audited instead with a per-paint, per-slot (`fills`/`strokes`), all-node-types sweep across all nine pages. Result: clean everywhere except `Logo Mark`'s two glyph vector strokes (literal white, deliberately not theme-bound — a fixed brand mark) and their 14 nested-instance copies across `07 Auth & Settings`; see the spec's Prototype divergences section. A separate `itemSpacing` sweep (not in the brief's Step 2) found the known 18 off-token `6px` gaps baked into `TextField`/`Select`/`TextArea` (`02 Components`, left unfixed — many downstream instances with previously-verified pixel heights) and 15 off-token `2px` gaps on `01 Foundations`'s swatch labels (new, safe, fixed to `space-4`).

- [x] **Step 3: Dark mode sweep**

Set every page's Colour mode to `Dark` and screenshot each. Look for: `indigo-tint` surfaces vanishing into `card`, `clay-tint` losing contrast against `paper`, and any text that drops below readable contrast. Record and fix.

**Task 14 ruling (c) applied:** before any mode switch, inventoried every fractional opacity file-wide, read-only (~57 paint-level + 12 node-level `Spy marker` hits). Switched all nine pages to Dark and screenshotted; confirmed no `indigo-tint`/`clay-tint` contrast failures. As expected, every paint-level fractional opacity reset to `1` on the switch — reapplied and remeasured in Dark, then restored to Light `4:0` on all nine pages and reapplied/remeasured a second time (mode switches reset paint opacity on the way back too). Node-level opacity (`Button` `Disabled` `0.5`, all twelve `Spy marker` `0`) was directly tested and confirmed to survive every switch unchanged, settling the open paint-vs-node question definitively. See the spec's Prototype divergences section for the full inventory and the fragility this implies for future editors.

- [x] **Step 4: Detached instance sweep**

Confirm no screen contains a locally-built copy of something that exists as a component:

```js
const page = await figma.getNodeByIdAsync('PAGE_ID');
await figma.setCurrentPageAsync(page);
const names = ['Button','Chip','Badge','TextField','Select','Switch','RailItem','SubsectionCard'];
const suspects = [];
for (const n of page.query('FRAME').toArray()) {
  if (names.some(k => n.name.includes(k))) suspects.push({ name: n.name, id: n.id });
}
return { suspects };
```

Any `FRAME` (not `INSTANCE`) named after a component is a detached copy. Fix or rename.

**Task 14 ruling (b) applied:** the name-substring script above would flag ~40 authorised detaches (`SubsectionCard`/`Modal`/`Sheet`) as defects, since Figma rejects `appendChild` into a live instance's descendants. Diffed a structural sweep (non-instance rounded `FRAME`s, cross-checked by name) against the plan's enumerated detach lists across all nine pages. Result — three lists: **enumerated-and-found: 38** (1 `Sheet` exception on `03`, 27 `SubsectionCard` on `04`, 5 on `05`, 5 `Modal`/`Sheet` on `07`); **enumerated-but-missing: 10** (all of Task 11's onboarding `SubsectionCard` detaches/clones — obsolete, because `06 Onboarding` was rebuilt in its later redesign and now contains zero `SubsectionCard`-shaped frames); **found-but-unenumerated: 0**. Full detail in the spec's Prototype divergences section.

- [x] **Step 5: Spec coverage check**

Walk the spec section by section and confirm a frame exists for each. Specifically confirm these six, because they are the requirements most likely to be quietly dropped:

- [x] `SaveStateChip` in the header, and **no** autosave switch there — confirmed: header instances are `SaveStateChip`, `RailItem`s, `Icon`s and a `Badge`; no `Switch` present.
- [x] Numeric badge on the Review rail item, not a dot — confirmed: `Review` rail row carries a `Badge` reading `3`.
- [x] **No** horizontal tab strip on any mobile frame — confirmed against the spec text (the removed strip was the old 12-section edge-faded mobile nav, replaced everywhere by `SectionSelector`; zero `Tabs` instances on any mobile *navigation* frame). The `Tabs` instances found on `Mobile — Inbox` and `Mobile — Settings Account` are the spec-required in-content tab bars (Inbox/Observations; Account/Server/Token/Connected apps), not the removed strip.
- [x] The `No propose scope` Review frame exists — confirmed: `130:975`, read-only reconnect banner and empty inbox, matches spec.
- [x] The autosave switch is on `Settings — Account` — confirmed by screenshot: `Auto-save` `Switch` present, on.
- [ ] **FAIL — the delegate offer does not appear before the field groups.** In the current redesigned standalone flow, `Onboarding — Welcome` and `— About you` (step 1 of 4) contain no delegate-offer content at all; the only offer (`"Let a client do this for you"`) sits inside `— How you like answers` (step 2 of 4), positioned **after** that step's own fields. The full pitch survives only in the superseded pre-redesign `Desktop — Delegate offer` frame. Delegation is currently offered after the work, not before — routed to the coordinator rather than fixed here; see the spec's Prototype divergences section.

- [x] **Step 6: Record divergences**

Add a `## Prototype divergences` section to the spec listing anything the Figma file does differently and why — font substitution, any component built without the Reshaped reference, any frame skipped. If there are none, write "None." An empty list stated is worth more than an absent one.

Done — not "None": the spec's `## Prototype divergences` section lists font (none), the Reshaped v3.9 reference (unusable), 38 detached container components and their propagation cost, the onboarding redesign and its leftover pre-redesign frames, the Step 5.6 failure, `RailItem`'s 13 new icons, `Tabs Count=Four`, the `scrim` token, `Button`'s icon slot, the narrowed `RailSubItem State=Current` trap (15 instances, not 12, on two demo pages only), Consent's real scopes, the seven sections with no dedicated screen, the 5-of-7 annotated motions, the paint-vs-node opacity fragility finding, and the residual off-token `TextField`/`Select`/`TextArea` spacing left unfixed.

- [x] **Step 7: Link the file and commit**

```bash
git add docs/superpowers/specs/2026-08-04-mygist-app-reshaped-design.md \
        docs/superpowers/plans/2026-08-04-mygist-app-reshaped-figma.md
git commit -m "docs: link the Figma prototype and record divergences"
```

---

## Plan self-review

**Spec coverage.** Every spec section maps to a task: foundations → 2–4; form patterns → 5–6, 9; navigation → 7–8; Review → 10; onboarding → 11; auth/settings/consent → 12; motion → 3, 13; Figma file structure → 1, 14. The `fields`/`list`/`strings`/`scalar` patterns are all built in Task 9 Steps 2, 4, 6. The fill-summary rule is a component in Task 6 and applied in 9 and 11. The two-tier hierarchy rule is verified by count in Task 9 Step 3.

**Known deliberate omissions**, stated rather than hidden:

- **Seven of the ten sections get no screen of their own.** Lifestyle, Knowledge, Circle, Media, Aesthetics and Learning log are structurally identical to Goals (one or two `list` nodes). Task 9 builds Goals as the representative light section. If any of those seven turns out to have a structure Goals does not cover, it needs a frame.
- **Five of the seven motions are annotated, not animated** (Task 13 Step 4), deliberately.
- **`Tabs` needs a `Count: Three` variant** added in Task 12 Step 3, extending the Task 7 component rather than duplicating it.

**Type consistency.** Component names are identical across tasks: `TextField`, `Select`, `TextArea`, `Switch`, `Checkbox`, `PinField`, `Button`, `Chip`, `Badge`, `FillSummary`, `SubsectionCard`, `EyebrowBand`, `EmptyState`, `RailItem`, `RailSubItem`, `Tabs`, `Modal`, `Sheet`, `SaveStateChip`, `SectionSelector`. Variable names match the spec's token table exactly. The two named animation layers, `Spy marker` and `Indicator`, are created in Task 7 and consumed by name in Task 13.
