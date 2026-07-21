# UI Cleanup: Consistency, Streamlining, and Mobile-Friendliness

**Date:** 2026-07-21
**Status:** Approved
**Scope:** Frontend only (`frontend/src`). No backend changes, no new features, no visual redesign (colors/typography stay).

## Goal

The seven section editors in `App.jsx` (6,800 lines) have drifted: the same UI
concepts (delete buttons, add buttons, empty states, expanded-entry forms,
collapsible headers, toggle switches) are implemented multiple different ways.
On mobile, dialogs overflow the viewport, some grids never collapse, touch
targets go as low as 24px, and the header row crowds at 375px.

This work extracts shared primitives, splits the monolith into per-editor
files, normalizes every editor against a single set of standards, and makes the
shell comfortable to use on a phone.

An audit with file:line references for every issue below was performed on
2026-07-21; key line references are cited inline (they refer to pre-split
`App.jsx` and will shift after the restructure).

## Decisions made with the user

- **Scope:** visual cleanup + code restructure (component extraction and file
  split). Not a visual redesign.
- **Mobile goals:** comfortable editing at ~375px, better section navigation,
  app-like feel (safe areas, no zoom-on-focus).
- **Mobile navigation:** improved sticky top tab strip (edge-fade scroll
  hints, scroll-snap, 44px targets). Bottom nav was rejected because it stacks
  with Safari iOS's bottom URL bar in in-browser use.

## 1. Shared primitives (new files in `components/ui/`)

| File | Contents |
|---|---|
| `switch.jsx` | Single Switch component: 20px-high track, knob, `role="switch"`, ≥40px touch area via padding. Replaces the two hand-rolled toggles (auto-save at App.jsx:6550, sections at App.jsx:6766, which currently differ in size). |
| `empty-state.jsx` | Single EmptyState: dashed-border rounded box, centered `text-sm text-muted-foreground`, `py-8`. Copy template: "No {things} yet. Add one to get started." Replaces 9 divergent variants. |
| `info-dialog.jsx` | InfoDialog component (`max-w-lg` DialogContent, scrollable body) extracted from the Info modal copy-pasted 6× (App.jsx:1624, 2724, 4109, 5661, …). |
| `segmented-control.jsx` | SegmentedControl extracted from ConnectionSettings' `segmentClass()` (ConnectionSettings.jsx:56–65); WelcomeAuth's hand-copied duplicate (App.jsx:6110–6126) switches to it. |

Primitive fixes (existing files):

- `dialog.jsx` — `DialogContent` gains `max-h-[90dvh] overflow-y-auto` and
  mobile edge insets so tall dialogs (ConnectionSettings, Add modals with the
  keyboard up, confirmation dialog) never run off-screen. Inner
  `max-h-[60vh]` workarounds in Info modals become unnecessary.
- `card.jsx` — `CardTitle` default drops `text-2xl` → `text-lg` so section
  titles no longer render larger than the app title and dialog titles.

## 2. File restructure

Mechanical split of `App.jsx`, no behavior change, done as its own commit so
the later normalization diffs are reviewable:

```
frontend/src/
  editors/
    ProfileEditor.jsx      (was App.jsx:136)
    KnowledgeEditor.jsx    (was 1667)
    PreferencesEditor.jsx  (was 2767)
    ProjectsEditor.jsx     (was 3142)
    LifestyleEditor.jsx    (was 4152)
    CircleEditor.jsx       (was 5271)
    LearningLogEditor.jsx  (was 5704)
  components/
    WelcomeAuth.jsx        (was 6000)
    ArrayInput.jsx         (was 86)
    ConnectionSettings.jsx (existing)
  lib/
    sections.js            (SECTION_LABELS / SECTION_DESCRIPTIONS, was 5982)
  App.jsx                  (shell only: header, tabs, dialogs, data state)
```

Dead code removed during the split: ProfileEditor's unused local
`confirmDialog` state (App.jsx:504–529 — it delegates to the
`onShowConfirmation` prop).

## 3. Normalization standards

Applied uniformly to all seven editors:

- **Delete affordance:** always `Trash2` icon, `variant="ghost"
  size="icon"`, `h-8 w-8`, `text-muted-foreground hover:text-destructive`.
  Fixes: X-vs-Trash2 mixes (App.jsx:868 vs 935), h-6/h-7/h-10 size drift, and
  the always-red no-hover highlight deletes (App.jsx:1014, 1307, 4010).
- **Add buttons:** header-level adds are default variant `size="sm"`
  (fixes Preferences "Add Mood" outline at App.jsx:2965); nested adds are
  dashed outline `h-8 w-full`. Labels use sentence case everywhere
  ("Add reference"). Learning Log keeps one add pattern top and bottom with
  matching casing (App.jsx:5792 vs 5968).
- **Input heights:** `h-10` (default) in dialogs and top-level forms;
  `h-9` for search/filter rows and expanded-entry fields. `h-7`/`h-8`
  overrides removed.
- **Expanded-entry container:** one spec — `border-t bg-background/50 p-4
  space-y-4` (already used by Knowledge/Projects/Lifestyle) — applied to Work
  Experience (App.jsx:1226), Education (742), and Learning Log (5878). Field
  pair grids standardize on `gap-4`.
- **Collapsible headers:** one pattern — clickable inner div with the
  `-m-6 p-6` expanded hit area (not the on-CardHeader handler used by
  Lifestyle's Passions/Curiosities/Traits/Values/Wellness cards at
  App.jsx:4869+). Circle and Learning Log get the same header structure as
  sibling editors. Card headers are **no longer sticky** — multiple headers
  currently pin to the same `top-[60px]` line and overlap while scrolling;
  only the app header (and mobile tab strip) stay sticky.
- **Empty states:** all use the new EmptyState component and copy template.
- **Responsive/mobile fixes in editors:**
  - `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`: Knowledge references
    (App.jsx:2151, 2565) and Wellness sleep times (5081, 5134).
  - All icon-button touch targets ≥40px (info buttons currently `h-6 w-6`,
    reference chevrons/deletes `h-6`/`h-7`).
  - Learning Log search input gets a `<Label>` like every other search field
    (App.jsx:5798).
- **Copy/semantics:** confirmation dialog's confirm button verb matches the
  action ("Remove" when the title says Remove, "Delete" otherwise);
  ConnectionSettings status dots use theme tokens instead of
  `text-green-500`/`red-500`/`yellow-500` (ConnectionSettings.jsx:876);
  Welcome logo SVG uses `currentColor`/token instead of hardcoded `#FFFFFF`
  (App.jsx:6436); badge text sizes standardize on `text-xs`; sub-headings
  inside cards standardize on one element (`p` with `text-sm font-medium` —
  `Label` reserved for form fields).

## 4. Mobile shell

- **Header (App.jsx:6510):** below `sm`, hide the "Auto-save" text label
  (switch remains with `aria-label`) and the save-status text (already
  hidden); account chip truncates long names with `truncate max-w-[128px]`.
  All header controls keep ≥40px hit areas.
- **Tab strip:** on mobile, sticky directly under the header; edge-fade
  gradient indicating more tabs off-screen; `scroll-snap`; pill height 44px.
  Desktop keeps the current left sidebar unchanged.
- **App-like polish:**
  - `viewport-fit=cover` on the viewport meta + `env(safe-area-inset-*)`
    padding on the header/shell.
  - Inputs/selects/textareas render ≥16px font below `sm` so iOS Safari
    stops zooming on focus.
  - Full-height states (loading, welcome) use `dvh` instead of `vh`.

## Non-goals

- No changes to colors, fonts, or the overall visual language.
- No backend or API changes.
- No new features; no changes to data shapes or save behavior.
- No bottom navigation (rejected — Safari iOS URL-bar stacking).

## Implementation order

1. Shared primitives + `dialog.jsx`/`card.jsx` fixes (foundation).
2. Mechanical file split (own commit, no behavior change).
3. Per-editor normalization (one commit per editor or per standard).
4. Mobile shell (header, tab strip, app-like polish).
5. Verification pass.

## Verification

- `npm run build` passes after each phase.
- Playwright pass (webapp-testing) screenshotting every section at 375px and
  1280px, light and dark themes: no horizontal overflow, dialogs scroll within
  viewport, tab strip fade/snap works, touch targets visually ≥40px.
- Manual smoke: autosave still fires on edit, section toggle still works,
  collapse/expand still works in all editors.
