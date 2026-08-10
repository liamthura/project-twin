# Slice 1 — Shell & Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vertical `Tabs` shell with the prototype's two-level rail, live scroll-spy and mobile section sheet, on two-segment hash routing — leaving the app shippable at the merge.

**Architecture:** The shared contracts from the umbrella spec become real code here: a pure `outline(pack)` in `paths.js`, a pure `parseRoute()` in `routes.js`, one `IntersectionObserver` in a `useScrollSpy` hook, and four motion durations as CSS custom properties. The shell splits out of `App.jsx` into `src/shell/` rather than growing it.

**Tech Stack:** React 18, Tailwind 3, shadcn/ui, Radix Dialog (for the mobile sheet); vitest + @testing-library/react.

## Global Constraints

- **The umbrella spec governs.** `docs/superpowers/specs/2026-08-10-app-migration-umbrella-design.md`. Do not re-answer its four contracts; cite it.
- **Every commit leaves the app shippable and the suite green.** This slice carries two footholds into files later slices own — the autosave preference and `data-band` — precisely so that holds.
- **Test command:** `npm test -- --project unit` from `frontend/` for the loop; bare `npm test` (661 tests) before the final commit. The old "Playwright unavailable" constraint is retired.
- **Band ids are slugs of titles**, derived only by `outline()`. Nothing else may derive one.
- **Rail clicks `pushState`; scroll-spy `replaceState`; corrections `replaceState`.**
- **A test file that renders anything must not carry `// @vitest-environment node`.**
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Baseline before this slice: **30 files, 659 tests** (unit), 31/661 (bare).

## File Structure

**Create**
- `frontend/src/shell/Rail.jsx` — desktop rail: sections, expanded sub-items, marker, divider, version caption
- `frontend/src/shell/Header.jsx` — 60px header: logo, save-state chip, theme, account chip
- `frontend/src/shell/SectionSheet.jsx` — mobile `Section ▾` trigger plus full-height sheet
- `frontend/src/shell/useScrollSpy.js` — one IntersectionObserver over `[data-band]`
- `frontend/src/shell/Rail.test.jsx`, `Header.test.jsx`, `SectionSheet.test.jsx`, `useScrollSpy.test.jsx`

**Modify**
- `frontend/src/renderers/paths.js` — add `slugify`, `outline`
- `frontend/src/lib/routes.js` — add `parseRoute`
- `frontend/src/globals.css` — motion tokens + reduced-motion collapse
- `frontend/tailwind.config.js` — expose durations/easings
- `frontend/src/renderers/SectionRenderer.jsx` — stamp `data-band` + `scroll-mt` on depth-0 wrappers
- `frontend/src/components/ConnectionSettings.jsx` — autosave preference row in the `connection` panel
- `frontend/src/App.jsx` — consume the shell; delete `useEdgeFade`, `TAB_TRIGGER_CLASS`, the `Tabs` tree
- `frontend/src/test/harness.jsx` — controllable IntersectionObserver + `matchMedia` stub helpers
- `frontend/src/renderers/paths.test.js`, `SectionRenderer.test.jsx`, `App.test.jsx`, `components/ConnectionSettings.test.jsx`

---

## Task 1: `slugify` and `outline` in `paths.js`

**Files:** Modify `frontend/src/renderers/paths.js`; Test `frontend/src/renderers/paths.test.js`

**Interfaces:**
- Produces: `slugify(title, index)` → string; `outline(pack)` → `[{ id, label, kind, index }]`. Tasks 4, 6, 8, 9 all consume `outline`.

- [ ] **Step 1: Write the failing tests** in `paths.test.js` (already `@vitest-environment node` — keep it, this stays pure):

```js
describe("slugify", () => {
  it("lowercases and hyphenates", () => expect(slugify("Code Style", 0)).toBe("code-style"));
  it("drops ampersands rather than transliterating them", () =>
    expect(slugify("Contact & Links", 0)).toBe("contact-links"));
  it("strips apostrophes instead of turning them into separators", () =>
    expect(slugify("When I'm feeling...", 0)).toBe("when-im-feeling"));
  it("collapses an em dash to one hyphen", () =>
    expect(slugify("Sleep — weekdays", 0)).toBe("sleep-weekdays"));
  it("falls back to the index when nothing slug-worthy survives", () =>
    expect(slugify("...", 3)).toBe("band-3"));
});

describe("outline", () => {
  it("returns one entry per titled top-level child, whatever its kind", () => {
    const pack = { ui: { sections: [
      { kind: "group", path: [], title: "Code Style", sections: [{ kind: "strings", path: ["a"] }] },
      { kind: "list", path: ["likes_dislikes"], title: "Likes & Dislikes" },
    ] } };
    expect(outline(pack)).toEqual([
      { id: "code-style", label: "Code Style", kind: "group", index: 0 },
      { id: "likes-dislikes", label: "Likes & Dislikes", kind: "list", index: 1 },
    ]);
  });
  it("omits untitled children, and keeps the unfiltered index on the rest", () => {
    const pack = { ui: { sections: [
      { kind: "list", path: ["entries"] },
      { kind: "list", path: ["other"], title: "Other" },
    ] } };
    expect(outline(pack)).toEqual([{ id: "other", label: "Other", kind: "list", index: 1 }]);
  });
  it("returns nothing for a section whose only child is untitled", () =>
    expect(outline({ ui: { sections: [{ kind: "list", path: ["entries"] }] } })).toEqual([]));
  it("never descends into a group's children", () => {
    const pack = { ui: { sections: [{ kind: "group", path: [], title: "G",
      sections: [{ kind: "list", path: ["x"], title: "Inner" }] }] } };
    expect(outline(pack).map((b) => b.id)).toEqual(["g"]);
  });
  it("suffixes a duplicate title deterministically, by order", () => {
    const pack = { ui: { sections: [
      { kind: "list", path: ["a"], title: "Notes" },
      { kind: "list", path: ["b"], title: "Notes" },
      { kind: "list", path: ["c"], title: "Notes" },
    ] } };
    expect(outline(pack).map((b) => b.id)).toEqual(["notes", "notes-2", "notes-3"]);
  });
  it("returns nothing for a pack with no ui block", () => expect(outline({})).toEqual([]));
});
```

- [ ] **Step 2: Run and watch them fail** — `npm test -- --project unit src/renderers/paths.test.js`. Expect "slugify is not a function".

- [ ] **Step 3: Implement**, appended to `paths.js` (keep the file's stated purity — no React, no DOM):

```js
/**
 * A band id: URL-safe, readable, and derived only here.
 *
 * Apostrophes are removed rather than replaced so "When I'm feeling" gives
 * `when-im-feeling` and not `when-i-m-feeling`. Everything else non-alphanumeric
 * collapses to one hyphen, which is what folds "&", em dashes and runs of
 * punctuation into a single separator.
 *
 * `index` is only the fallback for a title that slugifies to nothing (a heading
 * that is pure punctuation). It is never the identity -- see the umbrella spec.
 */
export function slugify(title, index) {
  const slug = String(title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `band-${index}`;
}

/**
 * The rail's sub-items for one pack: its TOP-LEVEL children, whatever their
 * kind, in manifest order, untitled ones omitted.
 *
 * Not "groups" -- `group` nodes carry `path: []`, and the prototype's rail under
 * Preferences lists three groups plus a top-level `list`. A group renders as an
 * eyebrow band with its cards beneath; a top-level list/strings/fields is its
 * own band. Never descends: a nested title is a heading inside a card, not a
 * rail destination.
 *
 * Pure and manifest-derived on purpose. The rail must render complete on a cold
 * deep link, before any content mounts -- which a contract where bands register
 * themselves cannot do.
 */
export function outline(pack) {
  const { sections } = normalizeUi(pack);
  const seen = new Map();
  const bands = [];
  sections.forEach((node, index) => {
    if (!node?.title) return;
    const base = slugify(node.title, index);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    bands.push({ id: n === 1 ? base : `${base}-${n}`, label: node.title, kind: node.kind, index });
  });
  return bands;
}
```

- [ ] **Step 4: Run** — expect all pass, and the file's `environment` still 0ms.

- [ ] **Step 5: Commit** — `feat(shell): outline() derives the rail's bands from the manifest`

---

## Task 2: `parseRoute` in `routes.js`

**Files:** Modify `frontend/src/lib/routes.js`; Test `frontend/src/lib/routes.test.js` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `parseRoute(raw)` → `{ section, band }`. Task 9 consumes it. `readRoute()` and `goToRoute()` keep their current contracts — `goToRoute` already tolerates a slash, so it needs no change.

- [ ] **Step 1: Write the failing test**, new file `frontend/src/lib/routes.test.js`, with `// @vitest-environment node` — `parseRoute` is pure string work and the file must not import `session.js`:

```js
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseRoute } from "./routes.js";

describe("parseRoute", () => {
  it("reads a bare section", () =>
    expect(parseRoute("preferences")).toEqual({ section: "preferences", band: null }));
  it("reads a section and band", () =>
    expect(parseRoute("preferences/communication")).toEqual({
      section: "preferences", band: "communication" }));
  it("returns an empty section for an empty route", () =>
    expect(parseRoute("")).toEqual({ section: "", band: null }));
  it("ignores a trailing slash rather than reporting an empty band", () =>
    expect(parseRoute("review/")).toEqual({ section: "review", band: null }));
  it("keeps only the first two segments, so a third cannot smuggle in a band", () =>
    expect(parseRoute("a/b/c")).toEqual({ section: "a", band: "b" }));
});
```

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement** in `routes.js`:

```js
/**
 * Split a raw route (what `readRoute()` returns) into its two segments.
 *
 * Pure, so it is testable without a DOM, and separate from `readRoute()` so the
 * auth screens -- which are single-segment and predate this -- keep the exact
 * contract they already read. `goToRoute` needs no change either: it
 * interpolates its argument into `#/${route}`, which already accepts
 * "section/band".
 *
 * A third segment is dropped rather than error: the shell validates `band`
 * against `outline()` anyway, and an unknown one is a replaceState correction.
 */
export function parseRoute(raw) {
  const [section = "", band] = String(raw ?? "").split("/");
  return { section, band: band || null };
}
```

- [ ] **Step 4: Run** — expect 5 pass.
- [ ] **Step 5: Commit** — `feat(shell): parseRoute reads the second hash segment`

---

## Task 3: Motion tokens

**Files:** Modify `frontend/src/globals.css`, `frontend/tailwind.config.js`

**Interfaces:**
- Produces: classes `duration-fast|medium|slow|scroll` and `ease-decelerate|accelerate|standard|emphasized`. Tasks 6 and 8 use them.

- [ ] **Step 1: Add the tokens** to `globals.css`, in the same `:root` block the colour tokens live in:

```css
    /* Motion. Four durations, four easings -- the whole scale, so no component
       invents a fifth value. Off-scale values snap by direction: an exit takes
       the shorter token, an entrance the longer. See the umbrella spec for the
       six named motions this resolves. */
    --duration-fast: 120ms;
    --duration-medium: 200ms;
    --duration-slow: 280ms;
    --duration-scroll: 400ms;
    --ease-decelerate: cubic-bezier(0, 0, 0.2, 1);
    --ease-accelerate: cubic-bezier(0.4, 0, 1, 1);
    --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
    --ease-emphasized: cubic-bezier(0.2, 0, 0, 1);
```

- [ ] **Step 2: Add the reduced-motion collapse**, at the end of `globals.css`:

```css
/* Every duration to zero except opacity, which caps at 100ms; smooth scroll
   becomes a jump. Done once here rather than opted into per component, so a
   component cannot forget. */
@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-fast: 0ms;
    --duration-medium: 0ms;
    --duration-slow: 0ms;
    --duration-scroll: 0ms;
  }
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0ms !important;
  }
  [data-motion="fade"] { transition-duration: 100ms !important; }
  html { scroll-behavior: auto !important; }
}
```

- [ ] **Step 3: Expose them in Tailwind** — in `tailwind.config.js`, inside `theme.extend`:

```js
      transitionDuration: {
        fast: "var(--duration-fast)",
        medium: "var(--duration-medium)",
        slow: "var(--duration-slow)",
        scroll: "var(--duration-scroll)",
      },
      transitionTimingFunction: {
        decelerate: "var(--ease-decelerate)",
        accelerate: "var(--ease-accelerate)",
        standard: "var(--ease-standard)",
        emphasized: "var(--ease-emphasized)",
      },
```

- [ ] **Step 4: Prove the classes emit real CSS** — a unit test asserting a class name would pass with no rule behind it (the lesson from the switch round). Instead build and grep:

```bash
npm run build && grep -c "duration-medium\|ease-standard" dist/assets/*.css
```

Expect a non-zero count once Task 6 uses them. If zero, Tailwind cannot see the class — check the `content` globs cover `src/shell/`.

- [ ] **Step 5: Commit** — `feat(shell): four motion durations and four easings as tokens`

---

## Task 4: `data-band` on depth-0 wrappers

**Files:** Modify `frontend/src/renderers/SectionRenderer.jsx`; Test `frontend/src/renderers/SectionRenderer.test.jsx`

**Interfaces:**
- Consumes: `outline` from Task 1.
- Produces: a `[data-band="<id>"]` element per titled top-level node, carrying `scroll-mt-[60px]`. Tasks 5 and 6 observe it.

This is the foothold: slice 2 restructures what sits under these wrappers, but the anchor contract lands now, so slice 1 merges with a rail that actually scrolls.

- [ ] **Step 1: Write the failing tests**, appended to `SectionRenderer.test.jsx`:

```js
describe("scroll-spy anchors", () => {
  it("stamps every titled top-level node with its outline id", () => {
    render(<SectionRenderer pack={preferencesPack} data={preferencesData} onChange={vi.fn()} />);
    const ids = [...document.querySelectorAll("[data-band]")].map((el) => el.dataset.band);
    expect(ids).toEqual(outline(preferencesPack).map((b) => b.id));
  });

  it("clears the sticky header, so a click does not hide the heading under it", () => {
    render(<SectionRenderer pack={preferencesPack} data={preferencesData} onChange={vi.fn()} />);
    expect(document.querySelector("[data-band]").className).toContain("scroll-mt-[60px]");
  });

  it("stamps nothing on a section whose only node is untitled", () => {
    render(<SectionRenderer pack={learningLogPack} data={learningLogData} onChange={vi.fn()} />);
    expect(document.querySelectorAll("[data-band]")).toHaveLength(0);
  });

  it("does not stamp a nested title -- a card heading is not a rail destination", () => {
    render(<SectionRenderer pack={preferencesPack} data={preferencesData} onChange={vi.fn()} />);
    const ids = [...document.querySelectorAll("[data-band]")].map((el) => el.dataset.band);
    expect(ids).not.toContain("response-format"); // nested inside Communication
  });
});
```

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement.** In `SectionRenderer`, before `renderSectionNode`, build a lookup from the outline keyed by the node's index among `sections`:

```js
  // The rail's bands, by their index among the section's top-level children.
  // Derived from outline() rather than recomputed here, because a second
  // derivation is a second thing to drift -- see the umbrella spec's anchor
  // contract. Keyed by index because that is what renderSectionNode knows.
  const bandById = new Map(outline(pack).map((b) => [b.index, b.id]));
```

Then in `renderSectionNode`, add a `bandId` for depth 0 only and spread it onto both wrapper `div`s (the group branch and the node branch):

```js
    // Only depth 0: a nested title renders as a heading inside a card, never as
    // a rail destination. `scroll-mt` clears the 60px sticky header.
    const band = depth === 0 ? bandById.get(Number(key)) : undefined;
    const bandProps = band ? { "data-band": band, className: "scroll-mt-[60px]" } : {};
```

Merge `bandProps.className` with each wrapper's existing `className` rather than replacing it — the group branch is `space-y-4`, the node branch `space-y-3`.

- [ ] **Step 4: Run the full unit suite** — the 180 existing SectionRenderer tests must stay green; a wrapper gaining an attribute must not move any of them.
- [ ] **Step 5: Commit** — `feat(shell): section nodes carry their band id, so the rail can scroll to them`

---

## Task 5: Controllable observer stub, and `useScrollSpy`

**Files:** Modify `frontend/src/test/harness.jsx`; Create `frontend/src/shell/useScrollSpy.js`, `frontend/src/shell/useScrollSpy.test.jsx`

**Interfaces:**
- Produces: `useScrollSpy(ids, { rootMargin })` → `currentId | null`; and from the harness, `mockIntersectionObserver()` → `{ intersect(id), restore() }`. Task 6 consumes the hook.

The global stub in `test/setup.js` fires `isIntersecting: true` for every target. Correct for the landing page's blur-fade, and useless here — every band would intersect at once. **Do not change the global stub**; six landing test files depend on it. Install a controllable one per test file and restore it.

- [ ] **Step 1: Add the helper** to `test/harness.jsx`:

```js
/**
 * A controllable IntersectionObserver, for tests that care WHICH element is on
 * screen. The global stub in test/setup.js answers "everything, immediately" --
 * right for the landing page's scroll entrances, and meaningless for scroll-spy,
 * where a test that cannot say "only this band is visible" proves nothing.
 *
 * Call in beforeEach and restore in afterEach; the global stub must survive for
 * the six landing files that rely on it.
 */
export function mockIntersectionObserver() {
  const previous = globalThis.IntersectionObserver;
  const observers = [];
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      observers.push(this);
    }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
    takeRecords() { return []; }
  };
  return {
    /** Report exactly these bands as intersecting, topmost first. */
    intersect(...ids) {
      for (const o of observers) {
        const entries = [...o.targets].map((target) => ({
          target,
          isIntersecting: ids.includes(target.dataset.band),
          // Rank by the order the caller listed them: jsdom does no layout, so
          // boundingClientRect.top is 0 for everything and the hook's
          // topmost-wins rule needs a real signal here.
          boundingClientRect: { top: ids.indexOf(target.dataset.band) },
        }));
        o.callback(entries, o);
      }
    },
    restore() { globalThis.IntersectionObserver = previous; },
  };
}
```

- [ ] **Step 2: Write the failing tests** in `useScrollSpy.test.jsx`: renders a probe component with three `[data-band]` divs, then asserts —
  - nothing is current before any intersection
  - the only intersecting band becomes current
  - with two intersecting, the one with the smaller `top` wins
  - a band leaving does not clear a still-intersecting one
  - the observer is constructed with the passed `rootMargin`
  - `disconnect` is called on unmount

- [ ] **Step 3: Implement** `useScrollSpy.js`:

```js
import { useEffect, useState } from "react";

/**
 * Which band the reader is currently looking at.
 *
 * One observer for the whole page, not one per band: a band is added and
 * removed as sections switch, and N observers would be N things to unwind.
 *
 * `rootMargin` defaults to clearing the 60px sticky header at the top and
 * ignoring the bottom 60% of the viewport, so "current" means "near the top of
 * what you can read", not "anywhere on screen". Tuned in the preview -- the
 * value is recorded in this slice's fidelity checklist.
 */
export function useScrollSpy(ids, { rootMargin = "-60px 0px -60% 0px" } = {}) {
  const [current, setCurrent] = useState(null);
  const key = ids.join(",");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || !key) return undefined;
    const visible = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.dataset.band;
          if (entry.isIntersecting) visible.set(id, entry.boundingClientRect.top);
          else visible.delete(id);
        }
        // Topmost wins. An empty map leaves the previous answer standing rather
        // than blanking the marker mid-scroll between two bands.
        if (visible.size === 0) return;
        const [topId] = [...visible.entries()].sort((a, b) => a[1] - b[1])[0];
        setCurrent(topId);
      },
      { rootMargin }
    );
    for (const id of key.split(",")) {
      const el = document.querySelector(`[data-band="${id}"]`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [key, rootMargin]);

  return current;
}
```

- [ ] **Step 4: Run.** - [ ] **Step 5: Commit** — `feat(shell): useScrollSpy tracks the topmost visible band`

---

## Task 6: The desktop rail

**Files:** Create `frontend/src/shell/Rail.jsx`, `frontend/src/shell/Rail.test.jsx`

**Interfaces:**
- Consumes: `outline` (Task 1), `useScrollSpy` (Task 5), motion tokens (Task 3).
- Produces: `<Rail sections activeSection activeBand pendingCount version onNavigate />`, where `onNavigate(section, band)` is the click contract Task 9 wires to `pushState`.

Per the prototype: 240px, sticky under the header, `ScrollArea`. Only the active section expands. A divider above Review and Sections — load-bearing, because they are not persona sections. Review carries a numeric badge, not a dot. Version caption last.

- [ ] **Step 1: Write the failing tests** — one section item per enabled pack plus Review and Sections; sub-items only under the active section; the marker on the active band; a numeric badge when `pendingCount > 0` and none at 0; `onNavigate` called with `(section, null)` for a section and `(section, bandId)` for a sub-item; a section with no titled children renders no sub-items; the divider sits between the last pack and Review.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.** Marker: a 2px `bg-primary` bar, `transition-all duration-medium ease-standard`. Width `w-60`, `sticky top-[60px]`.
- [ ] **Step 4: Run.** - [ ] **Step 5: Commit** — `feat(shell): the two-level desktop rail`

---

## Task 7: The header

**Files:** Create `frontend/src/shell/Header.jsx`, `frontend/src/shell/Header.test.jsx`

**Interfaces:**
- Produces: `<Header saveState isConnected theme onCycleTheme accountName onOpenSettings onSaveNow />` where `saveState` is `"saved" | "saving" | "unsaved"`.

Three changes from today, all specified: the autosave switch leaves (Task 10 gives it a home), the three-state prose becomes one chip, and the Review dot becomes the rail's number (Task 6).

- [ ] **Step 1: Write the failing tests** — the chip reads `Saved` / `Saving…` / `Unsaved`; `Unsaved` shows an inline `Save now` that calls `onSaveNow` and the other two do not; **no `Auto-save` control is present anywhere in the header** (the regression guard for the eviction); the theme button announces the current theme; the account chip shows the preferred name and falls back to `Account`.
- [ ] **Step 2–4: Run, implement, run.** Keep the existing logo SVG, theme cycle and account chip markup — they are correct today; this task restructures what is beside them.
- [ ] **Step 5: Commit** — `feat(shell): the header carries one save-state chip`

---

## Task 8: The mobile section sheet

**Files:** Create `frontend/src/shell/SectionSheet.jsx`, `frontend/src/shell/SectionSheet.test.jsx`; Modify `frontend/src/test/harness.jsx`

**Interfaces:**
- Consumes: `outline`, `useMediaQuery`.
- Produces: `<SectionSheet sections activeSection activeBand onNavigate />`; and from the harness, `mockMatchMedia(matches)`.

- [ ] **Step 1: Add `mockMatchMedia` to the harness.** `matchMedia` does not exist in jsdom and `useMediaQuery(query, fallback = true)` defaults to **desktop** on purpose, so a mobile branch is invisible without a stub. Three files already hand-roll one three different ways (`App.test.jsx`, `landing/Landing.test.jsx`, `landing/gate.test.jsx`); this is the fourth, and it goes in the harness instead:

```js
/** Stub `matchMedia` so a breakpoint branch is reachable. `matches` may be a
 *  boolean for every query, or a predicate on the query string. */
export function mockMatchMedia(matches) {
  const previous = window.matchMedia;
  const answer = typeof matches === "function" ? matches : () => matches;
  window.matchMedia = (query) => ({
    matches: answer(query), media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  });
  return { restore() { window.matchMedia = previous; } };
}
```

- [ ] **Step 2: Write the failing tests** — the trigger reads the active section's title with a chevron; opening lists every section; the active section's bands are nested beneath it and other sections' are not; choosing a band calls `onNavigate(section, band)` and closes the sheet; **any subsection is two taps away** (assert the count of interactive steps).
- [ ] **Step 3: Implement** with Radix Dialog, full height, slide 280ms `emphasized`, scrim fade 200ms.
- [ ] **Step 4: Run.** - [ ] **Step 5: Commit** — `feat(shell): the mobile section sheet replaces the horizontal strip`

---

## Task 9: Wire the shell into `App.jsx`

**Files:** Modify `frontend/src/App.jsx`; Test `frontend/src/App.test.jsx`

**Interfaces:** Consumes every earlier task.

- [ ] **Step 1: Write the failing tests** in `App.test.jsx` — a cold load of `#/preferences/communication` marks that band in the rail **before content mounts**; an unknown band replaces to `#/preferences` without a history entry; an unknown section replaces to `#/profile`; a rail click pushes; the horizontal tab strip is gone (`[data-at-start]` absent).
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.** Replace `activeTab` with `{section, band}` derived through `parseRoute(readRoute())`; keep the existing "re-pick a valid tab" effect, extended to validate the band against `outline()`. Render `<Header>`, `<Rail>` (desktop) and `<SectionSheet>` (mobile) around the existing content switch. **Delete** `useEdgeFade` (`App.jsx:98`), `tabStripRef`/`tabStripEdges`, `TAB_TRIGGER_CLASS`, and the whole `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` tree — content becomes a plain conditional. Keep `ProposalsPanel`'s `onViewSection` working: it now sets a section with a null band.
- [ ] **Step 4: Run the full suite.**
- [ ] **Step 5: Commit** — `feat(shell): App navigates by rail and two-segment route`

---

## Task 10: The autosave preference finds a home

**Files:** Modify `frontend/src/components/ConnectionSettings.jsx`, `frontend/src/App.jsx`; Test `frontend/src/components/ConnectionSettings.test.jsx`

The second foothold. Slice 5 rebuilds this dialog with an Account tab; today it has a segmented control over `connection | tokens | apps | data`, and the `connection` panel holds the signed-in row and Sign out. The preference goes there — **not** into a new tab, which would prejudge slice 5's structure.

- [ ] **Step 1: Write the failing tests** — the `connection` panel shows an `Auto-save` switch reflecting `isAutosaveEnabled`; toggling it calls `onAutosaveChange` with the new value; the copy explains what it does rather than naming a mechanism.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.** Two new props, `isAutosaveEnabled` and `onAutosaveChange`, and a row in the `connection` panel after the signed-in block. `App.jsx` passes its existing state and the `next && saveAll()` behaviour the header used to own.
- [ ] **Step 4: Run bare `npm test`** — both projects, 661+ expected.
- [ ] **Step 5: Commit** — `feat(shell): the autosave preference moves into Connection Settings`

---

## Fidelity checklist

Filled in the Docker preview at the end of the slice. Node IDs resolved against `Ti7FlZLYOvX3goyvfypJBk`, page `1:4` (`03 Shell & Navigation`) unless noted.

| Property | Value | Figma node | ✓ |
|---|---|---|---|
| Rail width | 240px | `03 Shell & Navigation` | |
| Header height | 60px, sticky, bottom border | `03 Shell & Navigation` | |
| Spy marker | 2px, `primary`, slides 200ms `standard` | `08 Motion` (page `1:9`) | |
| Divider above Review/Sections | present | `03 Shell & Navigation` | |
| Review badge | numeric, not a dot | `03 Shell & Navigation` | |
| Mobile trigger | sticky `Section ▾` under the header | `03 Shell & Navigation`, 390 | |
| Sheet | full height, 280ms `emphasized`, scrim 200ms | `08 Motion` | |
| Scroll-spy root margin | `-60px 0px -60% 0px` (tuned by eye) | — | |
| Version caption | `caption-2`, mono, rail foot | `03 Shell & Navigation` | |

## Self-review notes

- Task 3's build-grep step exists because a unit test asserting a class name passes with no CSS rule behind it — the lesson from the switch round.
- Task 4 merges `className` rather than replacing it; replacing would strip `space-y-3`/`space-y-4` and silently reflow every section.
- Task 5 does not touch the global observer stub. Six landing files depend on its always-intersecting behaviour.
- `goToRoute` is deliberately unchanged in Task 2 — it already interpolates a slash correctly.
- Task 10 puts the preference in the existing `connection` panel rather than inventing an Account tab, so slice 5 is not prejudged.
