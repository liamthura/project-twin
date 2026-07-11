# Ledger UI Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the MyGist frontend to the approved "Ledger" design (light-first professional, cobalt accent, Geist type), add the header save-state cluster and account chip, and introduce build-time versioning — matching the Figma wireframes.

**Architecture:** The app is shadcn-token based, so most of the reskin is a token swap in `globals.css` + `tailwind.config.js` + two ui-component class fixes (`tabs.jsx` kills the lime pill and mono nav; `card.jsx` drops the shadow). On top of that: a header/shell rework in `App.jsx`, a mechanical class sweep flattening tinted sub-cards into hairline panels, sticky panel headers, a segmented control in `ConnectionSettings.jsx`, and Vite-injected version/commit shown in the sidebar.

**Tech Stack:** React + Tailwind (HSL shadcn tokens), Vite `define` for versioning, Playwright for visual verification.

**Spec:** `docs/superpowers/specs/2026-07-11-ledger-ui-rebrand-design.md`
**Figma reference:** file `G7jFu9BaQ1EOeyka9clX9I`, page "Ledger Rebrand".

## Global Constraints

- Exact token values from the spec (HSL conversions below are authoritative for this plan). One accent (cobalt); NO lime anywhere after this lands.
- Fonts: Geist (sans) + Geist Mono (mono; ids/timestamps/version ONLY). Sora and Space Mono are removed.
- Light is default; dark applies via `prefers-color-scheme` (hardcoded `class="dark"` on `<html>` is removed). Both themes must work.
- One radius system: keep `--radius: 0.5rem`; badges/chips/toggles stay full-pill.
- No IA, copy, routing, or data-flow changes. `debouncedSave`, `saveAll`, section registry, tests — untouched.
- Version source of truth: `frontend/package.json` `"version": "2.0.0"`; commit from `git rev-parse --short HEAD` at build, fallback `"dev"`. Display format: `v2.0.0 (abc1234)`.
- All line numbers reference commit 61bce41 — locate anchors by content.

---

### Task 1: Tokens, fonts, theme switch, versioning plumbing

**Files:**
- Modify: `frontend/src/globals.css` (replace both variable blocks)
- Modify: `frontend/tailwind.config.js` (fontFamily)
- Modify: `frontend/index.html` (font link, dark-mode script)
- Modify: `frontend/package.json` (version)
- Modify: `frontend/vite.config.js` (define block)
- Modify: `frontend/src/components/ui/card.jsx`, `frontend/src/components/ui/tabs.jsx`, `frontend/src/components/ui/badge.jsx`

**Interfaces:**
- Produces: globals `__APP_VERSION__` and `__APP_COMMIT__` (strings) available in all frontend source (Task 2 renders them); new token values under the SAME shadcn variable names (no consumer changes needed).

- [ ] **Step 1: Replace the variable blocks in `globals.css`**

Replace the entire `:root { ... }` and `.dark { ... }` blocks with:

```css
  :root {
    --background: 60 9% 98%;
    --foreground: 24 10% 10%;
    --card: 0 0% 100%;
    --card-foreground: 24 10% 10%;
    --popover: 0 0% 100%;
    --popover-foreground: 24 10% 10%;
    --primary: 228 69% 55%;
    --primary-foreground: 0 0% 100%;
    --secondary: 60 5% 96%;
    --secondary-foreground: 24 10% 10%;
    --muted: 60 5% 96%;
    --muted-foreground: 25 5% 45%;
    --accent: 223 100% 96%;
    --accent-foreground: 228 69% 55%;
    --destructive: 0 65% 48%;
    --destructive-foreground: 0 0% 98%;
    --border: 20 6% 90%;
    --input: 20 6% 90%;
    --ring: 228 69% 55%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 60 3% 7%;
    --foreground: 60 5% 96%;
    --card: 60 2% 10%;
    --card-foreground: 60 5% 96%;
    --popover: 60 2% 10%;
    --popover-foreground: 60 5% 96%;
    --primary: 228 94% 67%;
    --primary-foreground: 0 0% 100%;
    --secondary: 60 1% 14%;
    --secondary-foreground: 60 5% 96%;
    --muted: 60 1% 14%;
    --muted-foreground: 24 5% 64%;
    --accent: 227 22% 20%;
    --accent-foreground: 228 94% 67%;
    --destructive: 0 74% 54%;
    --destructive-foreground: 0 0% 98%;
    --border: 60 2% 16%;
    --input: 60 2% 16%;
    --ring: 228 94% 67%;
  }
```

(Mapping: `--accent` = Ledger accent-tint, `--accent-foreground` = cobalt, so `bg-accent text-accent-foreground` renders active-nav styling for free. `--primary` = cobalt.)

Also add after the `@layer base` block (spec: lucide at 1.75 stroke, one global rule instead of per-icon props):

```css
svg.lucide {
  stroke-width: 1.75;
}
```

- [ ] **Step 2: Fonts**

`frontend/tailwind.config.js` fontFamily:

```js
      fontFamily: {
        sans: ["Geist", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "monospace"],
      },
```

`frontend/index.html`: replace the Google Fonts stylesheet href with:

```html
      href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400&display=swap"
```

- [ ] **Step 3: Theme switch**

In `frontend/index.html`, change `<html lang="en" class="dark">` to `<html lang="en">` and add inside `<head>` (before the stylesheet links):

```html
    <script>
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        document.documentElement.classList.add("dark");
      }
    </script>
```

- [ ] **Step 4: Versioning plumbing**

`frontend/package.json`: `"version": "2.0.0"`.

`frontend/vite.config.js` — add at top:

```js
import { execSync } from "node:child_process";
import pkg from "./package.json";

let commit = "dev";
try {
  commit = execSync("git rev-parse --short HEAD").toString().trim();
} catch {}
```

and inside `defineConfig({ ... })`:

```js
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
  },
```

- [ ] **Step 5: ui component fixes**

`ui/card.jsx` line 8: `shadow-sm` → `shadow-none`.

`ui/tabs.jsx` line 11 (TabsList): replace class string with:

```
"inline-flex h-auto items-center justify-start rounded-lg bg-transparent p-0 text-muted-foreground gap-1 flex-wrap"
```

`ui/tabs.jsx` line 23 (TabsTrigger): in the class string, replace `data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm font-mono` with `data-[state=active]:bg-accent data-[state=active]:text-accent-foreground` (removes the lime pill, the shadow, and the mono nav labels). Also change `rounded-md` to `rounded-lg`.

`ui/badge.jsx` line 6: `font-semibold` → `font-medium`.

- [ ] **Step 7: Verify and commit**

Run: `cd frontend && npm run build` — must succeed.
Then start the dev flow only if needed; visual check happens in Task 5.

```bash
git add frontend/src/globals.css frontend/tailwind.config.js frontend/index.html frontend/package.json frontend/vite.config.js frontend/src/components/ui/card.jsx frontend/src/components/ui/tabs.jsx frontend/src/components/ui/badge.jsx
git commit -m "feat: Ledger design tokens, Geist type, system theme, build versioning"
```

---

### Task 2: App shell rework (header, sidebar, mobile strip, version label)

**Files:**
- Modify: `frontend/src/App.jsx` (header block ~line 5930-5962, TabsList ~5969-6006, floating save bar ~6100-6135, Sections TabsContent)

**Interfaces:**
- Consumes: `__APP_VERSION__`, `__APP_COMMIT__` (Task 1); existing state: `isSaving`, `lastSaved`, `isAutosaveEnabled`, `setIsAutosaveEnabled`, `saveAll`, `profile`, `setShowConnectionSettings`; `ConnectionStatus` import may be dropped if unused after this.
- Produces: header save cluster + account chip; sidebar version label; mobile pill strip. No state-shape changes.

All anchors by content; the header is the block containing the wordmark and the `ConnectionStatus`/connection badge; the floating save bar is the card with "Save All", "Reload", and the auto-save checkbox.

- [ ] **Step 1: Header**

Rework the header JSX to (keep the existing outer `<header>` wrapper/width classes; make it sticky):

```jsx
        <header className="sticky top-0 z-20 border-b bg-card">
          <div className="mx-auto flex h-[60px] max-w-[1400px] items-center justify-between px-8">
            <h1 className="text-lg font-semibold">MyGist</h1>
            <div className="flex items-center gap-4">
              {/* Auto-save toggle */}
              <button
                type="button"
                role="switch"
                aria-checked={isAutosaveEnabled}
                onClick={() => setIsAutosaveEnabled(!isAutosaveEnabled)}
                className="flex items-center gap-2"
              >
                <span
                  className={`relative h-[18px] w-8 rounded-full transition-colors ${
                    isAutosaveEnabled ? "bg-primary" : "border bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-transform ${
                      isAutosaveEnabled ? "translate-x-[16px]" : "translate-x-[2px]"
                    }`}
                  />
                </span>
                <span className="text-xs font-medium text-muted-foreground">
                  Auto-save
                </span>
              </button>
              {/* Save status */}
              <span className="text-xs text-muted-foreground">
                {isSaving
                  ? "Saving..."
                  : isAutosaveEnabled
                    ? lastSaved
                      ? "Saved just now"
                      : "Saved"
                    : "Unsaved changes"}
              </span>
              {!isAutosaveEnabled && (
                <Button size="sm" onClick={saveAll} disabled={isSaving}>
                  Save changes
                </Button>
              )}
              {/* Account chip */}
              <button
                type="button"
                onClick={() => setShowConnectionSettings(true)}
                className="flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-[13px] font-medium hover:bg-muted/50"
              >
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                {profile?.preferred_name || profile?.name || "Account"}
              </button>
            </div>
          </div>
        </header>
```

Preserve whatever the existing header renders for the DISCONNECTED state (badge or error affordance) by keeping its conditional next to the account chip. If `ConnectionStatus` becomes unused, remove it from the import.

- [ ] **Step 2: Delete the floating save bar**

Remove the entire floating "Save All / Reload / Auto-save" card block (the one with the `Save All` button, `Reload` button, and auto-save checkbox). `saveAll` stays (used by the header button); if `loadAllData`'s Reload affordance only lived there, drop it (header/status now covers state; reload still happens on reconnect).

- [ ] **Step 3: Sidebar version label + mobile pills**

Wrap the existing `<TabsList ...>` in the sidebar column so the version can sit under it on desktop; directly after `</TabsList>` add:

```jsx
            <p className="mt-4 hidden px-3 font-mono text-[11px] text-muted-foreground md:block">
              {`v${__APP_VERSION__} (${__APP_COMMIT__})`}
            </p>
```

(If the TabsList is not already inside a dedicated sidebar wrapper element, add a `<div className="md:sticky md:top-8 md:w-48 md:self-start">` around list + version and remove the equivalent classes from TabsList.)

Mobile pills: on the shared `TabsTrigger` className in App.jsx (each trigger currently has `"gap-2 md:w-full md:justify-start"`), extend to:

```
"gap-2 rounded-full border md:w-full md:justify-start md:rounded-lg md:border-0 data-[state=active]:border-transparent"
```

and change the TabsList wrapper classes so that on mobile it scrolls horizontally instead of wrapping: on the `<TabsList>` element in App.jsx add `flex-nowrap overflow-x-auto md:flex-wrap md:overflow-visible`.

Icons already render in each trigger; on mobile the label spans are `hidden md:inline` today — change each trigger's label span to always show (`<span>` without hidden classes) EXCEPT keep icons; active pill then shows icon + label, matching the wireframe closely enough (icons on all pills is acceptable; the wireframe minimum is icon on the active pill).

- [ ] **Step 4: Version on mobile Sections page**

At the bottom of the Sections `TabsContent` (after the Manage Sections card) add:

```jsx
            <p className="mt-4 px-1 font-mono text-[11px] text-muted-foreground md:hidden">
              {`v${__APP_VERSION__} (${__APP_COMMIT__})`}
            </p>
```

- [ ] **Step 5: Verify and commit**

`cd frontend && npm run build` — must succeed.

```bash
git add frontend/src/App.jsx
git commit -m "feat: Ledger app shell - header save cluster, account chip, version label, mobile pills"
```

---

### Task 3: Editor pattern sweep (flatten cards, sticky headers, header add buttons)

**Files:**
- Modify: `frontend/src/App.jsx` (mechanical class transforms + 3 header-button placements + CardHeader stickiness)

**Interfaces:**
- Consumes: Task 1 tokens (all colors via shadcn utilities). No logic changes: every `onClick`/`onChange` stays byte-identical.

- [ ] **Step 1: Flatten collapse-item shells into divider rows**

Every collapsible item shell currently uses this exact class string (work experience, education, learning log, projects, connections, and similar):

```
rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors overflow-hidden
```

Replace ALL occurrences (grep to enumerate: `grep -n 'bg-muted/30 hover:bg-muted/50' frontend/src/App.jsx`) with:

```
border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors
```

- [ ] **Step 2: De-tint nested sub-cards**

Replace all occurrences of the tinted sub-card classes (enumerate with `grep -n 'bg-muted/20' frontend/src/App.jsx`):
- `rounded border border-muted bg-muted/20` → `rounded-lg border`
- `rounded-lg border border-muted bg-muted/10` → `rounded-lg border`

(Keep every other class on those elements — only the tint and `border-muted` change.)

- [ ] **Step 3: Sticky panel headers**

Every section `<CardHeader>` that heads a scrolling list (ProfileEditor cards, KnowledgeEditor, ProjectsEditor, LifestyleEditor, CircleEditor, PreferencesEditor, LearningLogEditor) gets stickiness. CardHeaders in this file render a clickable row div inside; add to each `<CardHeader>` element (grep `<CardHeader` in App.jsx; skip dialogs):

```
className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card"
```

merged with any existing CardHeader className. The `top-[60px]` matches the sticky app header height from Task 2. (CSS-only approximation of the Figma stuck state: constant hairline instead of scroll-conditional shadow — accepted deviation per spec's "implementation shape".)

- [ ] **Step 4: Header add buttons**

1. **Learning Log**: in `LearningLogEditor`'s CardHeader, make the title row horizontal with the existing add action on the right: add a `<Button size="sm" onClick={addEntry}>Add entry</Button>` right-aligned inside the CardHeader (wrap title + button in `flex items-center justify-between`). KEEP the existing bottom "Add Entry" button (long list).
2. **Work experience** (ProfileEditor): add `<Button variant="outline" size="sm">` with the existing add-experience `onClick` (move it from the bottom button) into the section header row, right-aligned; REMOVE the bottom "Add Experience" button.
3. **Education** (ProfileEditor): same as work experience with `addEducation`; REMOVE the bottom "Add Education" button. (Goals keep their bottom add.)

- [ ] **Step 5: Mono for ids and timestamps**

In `LearningLogEditor`, the read-only id/timestamp footer line and the date shown in collapsed entry headers get `font-mono` added to their className (spec: Geist Mono for ids/timestamps only). Grep `entry.timestamp` in App.jsx to find both.

- [ ] **Step 6: Sections toggles accent check**

In the Manage Sections panel, ensure the toggle/switch on-state uses `bg-primary` (cobalt via tokens) and off-state `bg-muted border` — adjust classes if they reference removed styles.

- [ ] **Step 7: Verify and commit**

`cd frontend && npm run build` — must succeed. Also `grep -c 'bg-muted/30 hover:bg-muted/50' frontend/src/App.jsx` must return 0.

```bash
git add frontend/src/App.jsx
git commit -m "feat: Ledger editor patterns - flat divider rows, sticky section headers, header add buttons"
```

---

### Task 4: Connection dialog segmented control

**Files:**
- Modify: `frontend/src/components/ConnectionSettings.jsx` (Connection Type buttons block)

**Interfaces:**
- Consumes: existing `connectionType`, `selectCloud`, `selectSelfHosted`, `Globe`, `Server` imports. No behavior changes.

- [ ] **Step 1: Replace the two variant-buttons with a segmented control**

The current block renders two `<Button variant={connectionType === ... ? "default" : "outline"}>`. Replace with:

```jsx
          <div className="flex rounded-lg bg-muted p-0.5">
            <button
              type="button"
              onClick={selectCloud}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                connectionType === "cloud"
                  ? "border bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Globe className="h-4 w-4" />
              Cloud
            </button>
            <button
              type="button"
              onClick={selectSelfHosted}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                connectionType === "self-hosted"
                  ? "border bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Server className="h-4 w-4" />
              Self-hosted
            </button>
          </div>
```

- [ ] **Step 2: Verify and commit**

`cd frontend && npm run build`.

```bash
git add frontend/src/components/ConnectionSettings.jsx
git commit -m "feat: segmented Cloud/Self-hosted control in connection dialog"
```

---

### Task 5: Visual verification (Playwright, both themes, desktop + mobile)

**Files:**
- Create: `<scratchpad>/verify_ledger.py` (throwaway)
- Fix-and-recommit only if real defects found.

**Interfaces:**
- Consumes: Tasks 1-4 committed; docker test-db running; backend venv; seed/bootstrap flow identical to previous verifications (register user, seed profile + learning entries, inject localStorage token, vite on :3000).

- [ ] **Step 1: Start servers, seed, run checks**

Same bootstrap as prior verification tasks. Playwright checks (viewport 1440x900, `color_scheme="light"`):
1. Profile screen: header shows Auto-save toggle + "Saved"/"Saved just now" + account chip with the user's preferred name; NO floating save bar; sidebar shows version label matching `v2.0.0 (<7-hex>)`; active nav item is tinted (not lime); fonts render Geist (assert `getComputedStyle(document.body).fontFamily` contains "Geist").
2. Toggle Auto-save off → "Unsaved changes" + "Save changes" button appears; click it → saving works (toast or status change).
3. Work experience/education headers contain the add buttons; bottom adds removed there; Learning Log has header add AND bottom add.
4. Scroll the profile page → a CardHeader is sticky below the app header (assert boundingBox top stays ~60px after scrolling 600px).
5. Connection dialog: segmented control renders; switching to Self-hosted reveals the URL input (existing behavior intact).
6. Mobile (390x844): pill strip scrolls horizontally, active pill tinted with icon+label, Sections page shows the version line.
7. Dark (`color_scheme="dark"`): reload Profile; page background is near-black `hsl(60 3% 7%)`, primary button cobalt-light, no lime anywhere.

Screenshot each state to the scratchpad; compare against the Figma frames.

- [ ] **Step 2: Clean up and report**

Kill only the PIDs you started; leave docker running. Report pass/fail per check with screenshot paths. Fix real defects with `fix:` commits and re-run the failed check.
