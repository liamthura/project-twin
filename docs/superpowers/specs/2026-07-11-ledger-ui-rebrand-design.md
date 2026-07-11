# MyGist "Ledger" UI Rebrand — Design

**Date:** 2026-07-11
**Status:** Approved by user (wireframes reviewed in Figma)
**Wireframes:** Figma file `G7jFu9BaQ1EOeyka9clX9I`, page "Ledger Rebrand" (Foundations frame + 4 desktop frames + dialog + mobile). Tokens exist there as the "Ledger Colors" variable collection with Light/Dark modes.

## Problem

The current UI reads as AI-generated: neon-lime accent on near-black, mono
uppercase nav labels, default shadcn styling, and cards nested inside tinted
cards. The rebrand replaces the visual language while preserving the
information architecture, navigation structure, and all functionality.

## Decisions

- **Overhaul, not refine** (user-confirmed): new palette, new type, calmer
  surfaces. IA, tab structure, copy, and interactions stay.
- Direction **"Ledger"** (user-picked): light-first professional tool in the
  Notion/Linear/Stripe family, full dark mode retained via tokens.
- lucide icons stay (existing dependency), locked at 1.75 stroke.
- Sticky section headers on scroll (user-requested).
- Version + commit indicator at sidebar bottom left (user-requested).

## 1. Foundations

### Color tokens (CSS variables in `globals.css`, consumed via Tailwind)

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg/page` | `#FAFAF9` | `#131312` | app background |
| `bg/panel` | `#FFFFFF` | `#1B1B1A` | panels, inputs, header |
| `bg/subtle` | `#F5F5F4` | `#232322` | hover, segmented track, toggle off |
| `border/hairline` | `#E7E5E4` | `#2A2A28` | all borders and dividers |
| `text/primary` | `#1C1917` | `#F5F5F4` | headings, values, row titles |
| `text/secondary` | `#78716C` | `#A8A29E` | meta, placeholders, inactive nav |
| `accent/primary` | `#3B5BDB` | `#5C7CFA` | primary buttons, active nav, focus, links |
| `accent/hover` | `#364FC7` | `#748FFC` | primary button hover |
| `accent/tint` | `#EDF2FF` | `#232A44` | active nav bg, avatar/selection tints |
| `text/on-accent` | `#FFFFFF` | `#FFFFFF` | text on accent |
| `destructive` | `#C92A2A` | `#E03131` | destructive actions, confirm flows only |

Rules: one accent, used only for the roles above. No lime anywhere. No pure
black. Dark mode follows `prefers-color-scheme` with the existing manual
override untouched.

### Type

**Geist** (replaces Sora), **Geist Mono** (replaces Space Mono; used ONLY for
ids, timestamps, tokens, URLs, and the version label — never nav or headings).

| Role | Spec |
|---|---|
| Page title | Geist SemiBold 20 |
| Section/panel title | Geist SemiBold 16 |
| Item row title | Geist Medium 14 |
| Body, inputs, nav labels | Geist Regular/Medium 14 (sentence case; mono-uppercase labels are gone) |
| Meta, field labels | Geist 12 (labels Medium) |
| Ids/timestamps/version | Geist Mono Regular 11–12 |

### Shape, space, icons, motion

- One radius system: **8px** for panels, inputs, buttons, nav items, account
  chip; full-pill only for badges, chips, and toggles. 6px for segments inside
  a segmented control.
- 8px spacing grid; desktop panels padded 24px, mobile 16px.
- lucide at `strokeWidth 1.75`; 16px in rows/controls, 18px in nav.
- Motion: 150–200ms ease on collapse/hover/dialog; nothing ambient.

## 2. App shell

- **Header** (60px, panel bg, bottom hairline): wordmark "MyGist" (Geist
  SemiBold 18, ink) left; right cluster: auto-save toggle + "Auto-save" label,
  save status text, account chip. The old floating "Save All / Reload /
  Auto-save" footer card is removed entirely.
  - **Autosave ON:** toggle filled accent; status "Saved just now" (12,
    secondary); no save button.
  - **Autosave OFF:** toggle off (subtle bg + hairline); status "Unsaved
    changes"; primary **"Save changes"** button appears between status and
    account chip (this replaces Save All).
  - **Account chip:** bordered 8px chip with user icon (14px) + preferred name
    ("Liam"), replaces the avatar circle; opens connection/account settings
    (same action as today's ConnectionStatus button).
  - Connection state: only surfaced when disconnected (existing error screen
    unchanged).
- **Sidebar** (224px, page bg, borderless): nav items 8px radius, icon 16 +
  label Geist Medium 14; active = accent text/icon on accent-tint bg; inactive
  = secondary. Stretches to content height; pinned at its bottom left is the
  **version label** `v{version} ({commit})` in Geist Mono 11 secondary.
- **Content**: page-bg column, padded 32, panels stacked with 24px gaps.

## 3. Editor patterns

- **One panel per section, dividers inside.** Section = white panel, hairline
  border, 8px radius. No tinted sub-cards anywhere.
- **Panel header row**: title left; when the section list is longer than
  roughly one viewport, an **add button is embedded at the right of the panel
  header** in addition to the one at the list bottom. Short lists keep only
  the header button (never two visible adds for a two-item list).
- **Sticky section headers**: each panel header is `position: sticky;
  top: <app header height>` within the scroll container; while stuck it drops
  its top radius/border and gains a soft shadow (`0 2px 8px` ink at 8%), so
  the card context persists until the section's end scrolls past (mid-scroll
  frame in Figma).
- **Collapsible rows** (work experience, education, projects, learning
  entries): flat rows separated by hairline dividers — chevron 16, title
  Medium 14, meta as plain secondary text (period/date; dates in mono), count
  badges (pill, subtle bg) only where counts matter, trash icon right.
  Expanded form renders on the same white surface, no tinted wrapper.
- **Forms**: labels above at 12 Medium; inputs white with hairline border,
  8px radius, 36px height, accent focus ring; 2-col grid on desktop, 1-col
  mobile.
- **Learning Log**: page header row carries the primary "Add entry" button on
  the right; search field (with search icon) at panel top; rows show topic +
  mono date + source/tag/follow-up badges.
- **Sections page**: toggle rows (name + one-line description left, switch
  right) in a single panel; switch = 36×20 pill, accent when on.
- **Dialog** (server connection): 480px panel, 8px radius, hairline border +
  soft shadow; Cloud/Self-hosted becomes a **segmented control** (subtle
  track, selected segment white with hairline border); right-aligned button
  row (secondary "Test connection", primary "Connect").

## 4. Mobile (< 768px)

- Header 52px: wordmark; right cluster auto-save toggle + account chip.
- Sidebar replaced by a horizontally scrollable **chip strip**: active chip =
  accent tint + its section icon (14px) + label; inactive chips = text-only
  with hairline border.
- Panels single-column, 16px padding. Version label lives at the bottom of
  the Sections page on mobile (no sidebar).

## 5. Versioning system (new, project-wide)

- **Source of truth:** `version` in `frontend/package.json`, bumped to
  `2.0.0` with this rebrand (the rebrand is the 2.0 milestone; semver
  thereafter).
- **Commit hash:** injected at build time via Vite `define` (e.g.
  `__APP_VERSION__` and `__APP_COMMIT__` from `package.json` +
  `git rev-parse --short HEAD`), with a `dev` fallback when git is
  unavailable (e.g. Docker builds pass it as a build arg).
- **Display:** `v2.0.0 (17de021)` format, Geist Mono 11, secondary color,
  sidebar bottom-left (desktop) / Sections page footer (mobile).
- **Backend:** `/health` and `/api/settings` may expose the backend version
  later; out of scope for this rebrand.

## 6. Implementation shape (for the plan)

1. **Token overhaul:** rewrite `globals.css` variables (both modes) +
   `tailwind.config.js` font stack (Geist/Geist Mono via Google Fonts link in
   `index.html`, replacing Sora/Space Mono).
2. **Versioning:** package.json bump + Vite define + sidebar/mobile label.
3. **Shell rework in `App.jsx`:** header (status cluster, account chip,
   conditional Save changes), sidebar restyle + version, remove floating save
   bar, mobile chip strip.
4. **Component sweep:** panel/divider pattern replacing nested cards, row
   restyle, form styles, badges, toggles, segmented control in
   ConnectionSettings, sticky headers.
5. **Verification:** Playwright screenshots against the Figma frames, both
   themes, desktop + mobile widths.

## Out of scope

- Any IA, copy, routing, or behavioral changes beyond those specified.
- Backend changes (except optionally exposing version later).
- New features; this is a reskin plus the header save-state and versioning
  mechanics described above.
