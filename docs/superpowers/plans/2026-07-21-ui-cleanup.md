# UI Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Spec: `docs/superpowers/specs/2026-07-21-ui-cleanup-design.md`.
> Design-skill note: when executing editor-normalization tasks load the `normalize` skill, for the mobile-shell task load `adapt`, and finish with `polish` — the user asked for taste-design skills to guide implementation.

**Goal:** Normalize the seven MyGist section editors against one set of UI standards, split the 6,800-line App.jsx into per-editor files, and make the shell comfortable on a ~375px phone.

**Architecture:** Foundation-first: fix/extend the shadcn-style primitives so improvements propagate everywhere, then a mechanical file split, then per-editor normalization against the standards below, then the mobile shell. No behavior, data-shape, or visual-language changes.

**Tech Stack:** React 18 + Vite 5, Tailwind 3.4, Radix primitives, lucide-react. `@` aliases `frontend/src`. No test framework exists in the frontend — each task verifies with `npm run build` (run from `frontend/`) plus a visual check; a final Playwright pass (webapp-testing skill) closes the plan.

## Global Constraints

- No new dependencies. No backend/API changes. No color/typography redesign.
- All work happens under `frontend/` on branch `feature/remote-access`.
- Line numbers cited for `App.jsx` refer to the pre-split file and shift after Task 5; from Task 6 on, locate patterns by the quoted code, not line numbers.
- Button/label copy uses sentence case: "Add reference", "Add education", "Add entry".
- Empty-state copy template: `No {things} yet. Add one to get started.`
- Verify command for every task: `cd frontend && npm run build` → expected `✓ built in …` with no errors.

## The Standards (referenced by every normalization task)

- **STD-DELETE** (any delete/remove icon button, primary or nested):
  ```jsx
  <Button variant="ghost" size="icon" className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive" onClick={...}>
    <Trash2 className="h-4 w-4" />
  </Button>
  ```
  Always `Trash2`, never `X` (except ArrayInput chips, which keep their inline `X`).
- **STD-INFO** (info icon buttons):
  ```jsx
  <Button variant="ghost" size="icon" className="tap-target h-7 w-7 text-muted-foreground hover:text-foreground" onClick={...}>
    <Info className="h-4 w-4" />
  </Button>
  ```
- **STD-ADD-HEADER** (add button in a card header): `<Button size="sm" onClick={...}><Plus className="h-4 w-4 mr-2" />Add {thing}</Button>` — default variant, sentence case.
- **STD-ADD-NESTED** (add button inside an expanded entry): `<Button type="button" variant="outline" size="sm" className="h-8 w-full border-dashed" onClick={...}><Plus className="h-3.5 w-3.5 mr-1.5" />Add {thing}</Button>`.
- **STD-INPUT**: dialogs/top-level forms keep default `h-10`; search/filter rows and all fields inside expanded entries use `h-9`. No `h-7`/`h-8` inputs anywhere.
- **STD-EXPANDED** (expanded-entry form container): `className="border-t bg-background/50 p-4 space-y-4"`; field-pair grids inside use `grid gap-4 sm:grid-cols-2` (or `sm:grid-cols-3` where already 3-up).
- **STD-COLLAPSE-HEADER** (collapsible card header — NOT sticky):
  ```jsx
  <CardHeader className="border-b">
    <div
      className="-m-6 flex cursor-pointer items-center justify-between rounded-t-lg p-6 transition-colors hover:bg-muted/50"
      onClick={() => setCollapsed(!collapsed)}
    >
      <div className="space-y-1.5">
        <CardTitle>…</CardTitle>
        <CardDescription>…</CardDescription>
      </div>
      <div className="flex items-center gap-2">
        {/* count badge / add button / chevron */}
      </div>
    </div>
  </CardHeader>
  ```
  Every `sticky top-[60px] z-10 … bg-card` on a CardHeader is removed (headers stop being sticky app-wide).
- **STD-BADGE-COUNT**: `Badge variant="secondary" className="h-5 text-xs"` — no `text-[11px]`.
- **STD-EMPTY**: use the `EmptyState` component (Task 4) with template copy.

---

### Task 1: Dialog and Card primitive fixes + `tap-target` utility

**Files:**
- Modify: `frontend/src/components/ui/dialog.jsx:34`
- Modify: `frontend/src/components/ui/card.jsx:29`
- Modify: `frontend/src/globals.css`

**Interfaces:**
- Produces: all DialogContent instances become viewport-safe; `CardTitle` renders `text-lg`; a global `.tap-target` class that expands any button's hit area to ≥44px without changing layout.

- [ ] **Step 1: Make DialogContent viewport-safe**

In `dialog.jsx` line 34, inside the `cn(...)` string, change
`"fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 …matches… sm:rounded-lg"`
so that:
- `w-full` → `w-[calc(100%-2rem)] sm:w-full`
- `sm:rounded-lg` → `rounded-lg`
- append `max-h-[90dvh] overflow-y-auto`

- [ ] **Step 2: Fix CardTitle size**

In `card.jsx` line 29: `"text-2xl font-semibold leading-none tracking-tight"` → `"text-lg font-semibold leading-none tracking-tight"`.

- [ ] **Step 3: Add the tap-target utility to `globals.css`**

```css
/* Expand small icon buttons to a >=44px hit area without changing layout */
.tap-target {
  position: relative;
}
.tap-target::after {
  content: "";
  position: absolute;
  inset: -6px;
}
```

- [ ] **Step 4: Build and visual-check**

Run: `cd frontend && npm run build` → expect `✓ built`. Then in the dev server, open an Add modal at 375×812: it must fit and scroll internally.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/dialog.jsx frontend/src/components/ui/card.jsx frontend/src/globals.css
git commit -m "fix: viewport-safe dialogs, right-sized card titles, tap-target utility"
```

---

### Task 2: Switch component, replace both hand-rolled toggles

**Files:**
- Create: `frontend/src/components/ui/switch.jsx`
- Modify: `frontend/src/App.jsx:6539-6564` (auto-save toggle), `frontend/src/App.jsx:6760-6775` (sections toggle)

**Interfaces:**
- Produces: `Switch({ checked, onCheckedChange, className, ...props })` — `role="switch"`, controlled, spreads extra props (e.g. `aria-label`) onto the button.

- [ ] **Step 1: Create `switch.jsx`**

```jsx
import { cn } from "@/lib/utils";

export function Switch({ checked, onCheckedChange, className, ...props }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "tap-target relative h-5 w-9 shrink-0 rounded-full transition-colors",
        checked ? "bg-primary" : "border bg-muted",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "absolute left-0 top-[2px] h-4 w-4 rounded-full border bg-card transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[2px]"
        )}
      />
    </button>
  );
}
```

- [ ] **Step 2: Replace the auto-save toggle (App.jsx:6539)**

The outer `<button role="switch" …>` wrapping track+knob+label becomes:

```jsx
<label className="flex cursor-pointer items-center gap-2">
  <Switch
    checked={isAutosaveEnabled}
    onCheckedChange={(next) => {
      setIsAutosaveEnabled(next);
      if (next) saveAll();
    }}
    aria-label="Auto-save"
  />
  <span className="text-xs font-medium text-muted-foreground">Auto-save</span>
</label>
```

(The `hidden sm:inline` treatment of the label comes later in Task 11.) Import `Switch` in App.jsx.

- [ ] **Step 3: Replace the sections toggle (App.jsx:6760)**

The hand-rolled `<button role="switch" …>` in the Sections tab becomes:

```jsx
<Switch
  checked={enabled}
  onCheckedChange={() => toggleSection(key)}
  aria-label={`Toggle ${SECTION_LABELS[key] || key}`}
/>
```

- [ ] **Step 4: Build and visual-check both toggles still work, then commit**

```bash
cd frontend && npm run build
git add frontend/src/components/ui/switch.jsx frontend/src/App.jsx
git commit -m "refactor: shared Switch component replaces hand-rolled toggles"
```

---

### Task 3: SegmentedControl extraction + status-dot tokens

**Files:**
- Create: `frontend/src/components/ui/segmented-control.jsx`
- Modify: `frontend/src/components/ConnectionSettings.jsx:54-65` (delete local `segmentClass`), `:876-878` (status dots)
- Modify: `frontend/src/App.jsx:6100-6130` (WelcomeAuth's hand-copied segment classes)
- Modify: `frontend/src/globals.css`, `frontend/tailwind.config.js` (success/warning tokens)

**Interfaces:**
- Produces: `segmentClass(active, disabled)` exported from `segmented-control.jsx`; Tailwind `success` and `warning` color utilities.

- [ ] **Step 1: Create `segmented-control.jsx`** — move `segmentClass` verbatim from ConnectionSettings.jsx:56-65 and export it:

```jsx
// Segmented-control button classes, shared by ConnectionSettings (tab row,
// connection-type toggle, import-mode toggle) and WelcomeAuth.
export function segmentClass(active, disabled) {
  if (disabled) {
    return "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground/50 cursor-not-allowed";
  }
  return `flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "border bg-card text-foreground"
      : "text-muted-foreground hover:text-foreground"
  }`;
}
```

- [ ] **Step 2: Update consumers** — in ConnectionSettings delete the local copy and `import { segmentClass } from "@/components/ui/segmented-control"`. In WelcomeAuth (App.jsx:6110-6126) replace both inline class strings with `segmentClass(mode === "signin")` / `segmentClass(mode === "register")` (match the actual state variable used there).

- [ ] **Step 3: Add success/warning tokens.** In `globals.css` `:root` add `--success: 142 71% 35%; --warning: 43 96% 40%;` and in `.dark` add `--success: 142 60% 50%; --warning: 43 90% 55%;`. In `tailwind.config.js` `theme.extend.colors` add:

```js
success: "hsl(var(--success))",
warning: "hsl(var(--warning))",
```

Then in ConnectionSettings:876-878 replace `text-green-500` → `text-success`, `text-red-500` → `text-destructive`, `text-yellow-500` → `text-warning`.

- [ ] **Step 4: Build, visual-check the welcome page pills and connection status dots, commit**

```bash
cd frontend && npm run build
git add -A frontend/src frontend/tailwind.config.js
git commit -m "refactor: shared segmentClass, theme tokens for status colors"
```

---

### Task 4: EmptyState + InfoDialog components, applied app-wide

**Files:**
- Create: `frontend/src/components/ui/empty-state.jsx`, `frontend/src/components/ui/info-dialog.jsx`
- Modify: `frontend/src/App.jsx` — 9 empty-state sites (lines ~1045, 2254, 2666, 3087, 3452, 4043, 4806, 5597, 5804) and 6 Info-modal sites (~1624, 2724, 4109, 5661 + the other two found by `grep -n "max-h-\[60vh\]" App.jsx`)

**Interfaces:**
- Produces: `EmptyState({ children, className })`; `InfoDialog({ open, onOpenChange, title, description, children })`.

- [ ] **Step 1: Create `empty-state.jsx`**

```jsx
import { cn } from "@/lib/utils";

export function EmptyState({ children, className }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Create `info-dialog.jsx`**

```jsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function InfoDialog({ open, onOpenChange, title, description, children }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-4 text-sm">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Replace all 9 empty states** with `<EmptyState>No {things} yet. Add one to get started.</EmptyState>` (things = education entries / skills / mental tabs / mood overrides / ideas / projects / hobbies / connections / entries). Delete the old bordered-div and plain-`<p>` variants including their `&quot;Click …&quot;` copy.

- [ ] **Step 4: Replace the 6 Info modals** with `<InfoDialog open={…} onOpenChange={…} title="…" description="…">{existing body content}</InfoDialog>`, dropping each site's inner `max-h-[60vh] overflow-y-auto` wrapper (DialogContent now scrolls itself). Keep each site's existing state variable and body JSX unchanged.

- [ ] **Step 5: Build, spot-check one empty state and one info modal, commit**

```bash
cd frontend && npm run build
git add frontend/src
git commit -m "refactor: shared EmptyState and InfoDialog components"
```

---

### Task 5: Mechanical file split of App.jsx

**Files:**
- Create: `frontend/src/editors/ProfileEditor.jsx` (from App.jsx:136), `KnowledgeEditor.jsx` (1667), `PreferencesEditor.jsx` (2767), `ProjectsEditor.jsx` (3142), `LifestyleEditor.jsx` (4152), `CircleEditor.jsx` (5271), `LearningLogEditor.jsx` (5704)
- Create: `frontend/src/components/WelcomeAuth.jsx` (from 6000), `frontend/src/components/ArrayInput.jsx` (from 86)
- Create: `frontend/src/lib/sections.js` (SECTION_LABELS + SECTION_DESCRIPTIONS from 5982)
- Modify: `frontend/src/App.jsx` → shell only

**Interfaces:**
- Produces: each editor file default-exports its component with the unchanged signature `({ data, onChange, onShowConfirmation })` (PreferencesEditor: `({ data, onChange })`). `ArrayInput` and `WelcomeAuth` are named exports matching current usage. `lib/sections.js` exports `SECTION_LABELS`, `SECTION_DESCRIPTIONS`.

- [ ] **Step 1: Move code, don't edit it.** Cut each component into its file verbatim. Per file, add only: the subset of existing App.jsx imports it needs (`useState`/`useEffect`, ui components, lucide icons, `ArrayInput`, `InfoDialog`, `EmptyState`, `useDebounce` if used) and the `export default`. No className or logic changes in this task.

- [ ] **Step 2: Remove dead code.** ProfileEditor's unused local confirm-dialog state (`confirmDialog`, `showConfirmation`, `handleConfirm`, `handleCancel` at App.jsx:504-529) is deleted, not moved — it delegates to the `onShowConfirmation` prop.

- [ ] **Step 3: Slim App.jsx** to the shell (header, Tabs, Sections tab, confirmation dialog, ConnectionSettings, Toaster, data/save state) importing the new modules. Remove now-unused imports (verify with the build).

- [ ] **Step 4: Build must pass with zero behavior change; then commit**

```bash
cd frontend && npm run build
git add frontend/src
git commit -m "refactor: split App.jsx into per-editor files (no behavior change)"
```

- [ ] **Step 5: Smoke-test in dev server** — every tab renders, an edit autosaves, collapse/expand works, welcome page renders when signed out (open a private window).

---

### Task 6: Normalize ProfileEditor

**Files:**
- Modify: `frontend/src/editors/ProfileEditor.jsx`

Apply the Standards. Locate by quoted pattern (line refs are pre-split App.jsx, for orientation only):

- [ ] Expanded containers → STD-EXPANDED: Work Experience `"space-y-3 p-3 pt-0"` (was 1226) and Education `"p-4 pt-1 space-y-4"` (was 742); field grids `gap-3 sm:grid-cols-2` → `gap-4 sm:grid-cols-2`; CardContent list spacing unified to `space-y-4` (Education/Contact currently `space-y-6`).
- [ ] Deletes → STD-DELETE: coursework `X` (was 868) and goals `X` (was 1069) become `Trash2`; all `h-7 w-7` deletes become `h-8 w-8 tap-target`; highlight deletes (was 1014, 1307) lose always-red `text-destructive h-10 w-10` for the standard muted→destructive hover.
- [ ] Info buttons → STD-INFO (was `h-6 w-6`, e.g. 548, 645, 1132).
- [ ] Collapsible headers → STD-COLLAPSE-HEADER; drop every `sticky top-[60px] z-10` from CardHeaders.
- [ ] Add buttons → STD-ADD-HEADER with sentence case ("Add education", "Add experience"…); nested adds → STD-ADD-NESTED.
- [ ] Inputs inside expanded entries → `h-9` (STD-INPUT).
- [ ] Build, visual-check the Profile tab desktop + 375px, commit: `git commit -m "polish: normalize ProfileEditor to shared UI standards"`.

---

### Task 7: Normalize KnowledgeEditor

**Files:**
- Modify: `frontend/src/editors/KnowledgeEditor.jsx`

- [ ] Reference name/URL grids `grid grid-cols-2 gap-2` (was 2151, 2565) → `grid grid-cols-1 gap-2 sm:grid-cols-2`.
- [ ] Reference inputs `h-7` (was 2169, 2189) → `h-9`; search inputs stay `h-9`; expanded-entry inputs `h-8` (was 2055, 2067) → `h-9`.
- [ ] Reference add buttons `border-dashed text-xs h-7` "Add Reference" (was 2238) → STD-ADD-NESTED "Add reference".
- [ ] Reference delete/chevron `h-6 w-6` (was 2144, 2558) → STD-DELETE / `tap-target h-7 w-7` for chevrons.
- [ ] Headers → STD-COLLAPSE-HEADER (drop sticky); header adds → STD-ADD-HEADER sentence case ("Add skill", "Add tab").
- [ ] Build, visual-check, commit: `git commit -m "polish: normalize KnowledgeEditor to shared UI standards"`.

---

### Task 8: Normalize PreferencesEditor + ProjectsEditor

**Files:**
- Modify: `frontend/src/editors/PreferencesEditor.jsx`, `frontend/src/editors/ProjectsEditor.jsx`

- [ ] Preferences: "Add Mood" `variant="outline"` (was 2965) → STD-ADD-HEADER ("Add mood"); mood empty state uses EmptyState (`py-8` default); sub-heading `Label` → `<p className="text-sm font-medium">` where not tied to a form control (was 2908).
- [ ] Projects: reference-count badges `text-[11px]` (was 3813, 3821) → STD-BADGE-COUNT; reference deletes (was 3842) → STD-DELETE; search/filter `h-8` (was 3579) → `h-9`; nested add (was 3940) already `h-8 border-dashed` — align icon/label to STD-ADD-NESTED; expanded container already STD-EXPANDED — keep; headers drop sticky; header add sentence case ("Add project", "Add idea"); highlight delete (was 4010) → STD-DELETE.
- [ ] Build, visual-check both tabs, commit: `git commit -m "polish: normalize Preferences and Projects editors"`.

---

### Task 9: Normalize LifestyleEditor

**Files:**
- Modify: `frontend/src/editors/LifestyleEditor.jsx`

- [ ] Passions/Curiosities/Traits/Values/Wellness on-CardHeader click handlers (was 4869, 4913, 4957, 5000, 5042) → STD-COLLAPSE-HEADER (inner `-m-6 p-6` div), matching the Hobbies card; drop all sticky classes.
- [ ] Wellness sleep grids `grid grid-cols-2 gap-3` (was 5081, 5134) → `grid grid-cols-1 gap-3 sm:grid-cols-2`; sub-headings unify on `<p className="text-sm font-medium">` (was mixed `Label`/`p` at 5077-5133).
- [ ] Reference-count badges `text-[11px]` (was 4643, 4651) → STD-BADGE-COUNT; reference add (was 4774) → STD-ADD-NESTED; reference delete (was 4672) → STD-DELETE; search `h-8` (was 4405) → `h-9`; expanded inputs `h-8` (was 4536) → `h-9`; header add "Add hobby".
- [ ] Build, visual-check, commit: `git commit -m "polish: normalize LifestyleEditor"`.

---

### Task 10: Normalize CircleEditor + LearningLogEditor

**Files:**
- Modify: `frontend/src/editors/CircleEditor.jsx`, `frontend/src/editors/LearningLogEditor.jsx`

- [ ] Give both editors the same card-header structure as siblings: CardHeader with title/description left, count badge + STD-ADD-HEADER right, using STD-COLLAPSE-HEADER (collapsible, chevron) for consistency with the other five editors; drop sticky classes.
- [ ] Circle: search `h-8` (was 5433) → `h-9`; expanded inputs (was 5536) → `h-9`; deletes (was 5512) → STD-DELETE; header add "Add connection".
- [ ] Learning Log: expanded container `space-y-3 p-3 pt-0` (was 5878) → STD-EXPANDED; search input gets a `<Label>Search</Label>` like every other editor (was 5798); remove the bottom duplicate add button (was 5968) and keep the single header add "Add entry" (STD-ADD-HEADER); deletes (was 5870) → STD-DELETE.
- [ ] Build, visual-check, commit: `git commit -m "polish: normalize Circle and LearningLog editors"`.

---

### Task 11: Mobile shell — header + tab strip

**Files:**
- Modify: `frontend/src/App.jsx` (header ~6510, TabsList ~6622 pre-split numbering), `frontend/src/globals.css`

- [ ] **Step 1: De-crowd the header.** Container gap `gap-4` → `gap-2 sm:gap-4`. Auto-save label span gains `hidden sm:inline` (Switch keeps `aria-label="Auto-save"`). Account chip name wraps in `<span className="max-w-[128px] truncate">…</span>`.

- [ ] **Step 2: DRY the tab triggers.** In App.jsx define once:

```jsx
const TAB_TRIGGER_CLASS =
  "h-11 shrink-0 snap-start gap-2 rounded-full border md:h-9 md:w-full md:justify-start md:rounded-lg md:border-0 data-[state=active]:border-transparent";
```

and use it for all 8 TabsTriggers (replacing the copy-pasted string).

- [ ] **Step 3: Sticky strip with fade + snap.** The TabsList wrapper div (`md:sticky md:top-[84px] md:w-48 md:self-start`) gains mobile stickiness: `sticky top-[60px] z-10 -mx-4 bg-background px-4 pb-2 md:static md:mx-0 md:px-0 md:pb-0 md:sticky md:top-[84px] md:w-48 md:self-start` (mobile sticky under the 60px header; desktop behavior unchanged). TabsList itself adds `snap-x snap-proximity tab-strip-fade`. In `globals.css`:

```css
/* Edge fade hinting at more tabs off-screen (mobile strip only) */
@media (max-width: 767px) {
  .tab-strip-fade {
    mask-image: linear-gradient(
      to right,
      transparent,
      black 16px,
      black calc(100% - 24px),
      transparent
    );
    -webkit-mask-image: linear-gradient(
      to right,
      transparent,
      black 16px,
      black calc(100% - 24px),
      transparent
    );
  }
}
```

- [ ] **Step 4: Confirmation verb.** In the confirmation dialog (App.jsx ~6800) replace the hardcoded `Delete` label:

```jsx
<Button variant="destructive" onClick={handleConfirm}>
  {confirmDialog.title?.startsWith("Remove") ? "Remove" : "Delete"}
</Button>
```

- [ ] **Step 5: Build, check at 375px** (header fits, strip scrolls with fade, snap works, sidebar unchanged at ≥768px), commit: `git commit -m "feat: mobile-friendly header and tab strip"`.

---

### Task 12: App-like polish

**Files:**
- Modify: `frontend/index.html`, `frontend/src/globals.css`, `frontend/src/components/ui/input.jsx`, `textarea.jsx`, `select.jsx`, `frontend/src/App.jsx` (full-height states, welcome logo)

- [ ] **Step 1: Viewport + safe areas.** `index.html` viewport meta → `content="width=device-width, initial-scale=1.0, viewport-fit=cover"`. In `globals.css` `body` layer add:

```css
body {
  @apply bg-background text-foreground;
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
```

and on the App header element add `pt-[env(safe-area-inset-top)]`.

- [ ] **Step 2: Stop iOS zoom-on-focus.** In `input.jsx`, `textarea.jsx`, and `select.jsx` (SelectTrigger) change `text-sm` in the base class to `text-base sm:text-sm` (16px below `sm`).

- [ ] **Step 3: dvh.** Replace `min-h-screen` with `min-h-dvh` in App.jsx's loading, welcome, error, and root shell divs (grep `min-h-screen`).

- [ ] **Step 4: Welcome logo token.** In WelcomeAuth's parent welcome screen SVG (was App.jsx:6436, 6442) `stroke="#FFFFFF"` → `stroke="hsl(var(--primary-foreground))"`.

- [ ] **Step 5: Build, commit**: `git commit -m "feat: app-like mobile polish (safe areas, no zoom-on-focus, dvh)"`.

---

### Task 13: Verification pass

**Files:** none (verification only; fix regressions found).

- [ ] **Step 1:** `cd frontend && npm run build` — clean.
- [ ] **Step 2:** Load the `webapp-testing` skill. Start the dev server, and for each of the 8 tabs screenshot at 375×812 and 1280×800, in light and dark. Check: no horizontal overflow; dialogs fit and scroll; tab strip fade/snap; consistent delete/add/empty-state rendering across editors; toggles work.
- [ ] **Step 3:** Manual smoke: edit a field → autosave toast; toggle a section off/on; collapse/expand in every editor; sign-out welcome page renders.
- [ ] **Step 4:** Load the `polish` skill and sweep the screenshots for remaining alignment/spacing misses; fix and commit any as `polish: …`.
- [ ] **Step 5:** Final commit if fixes were made; report results with the screenshots.
