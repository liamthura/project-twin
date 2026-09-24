# Wave 2: navigation and Settings

**Date:** 2026-09-24
**Status:** Built, then revised after review (see the end)
**Source:** `.impeccable/critique/2026-09-24T19-26-30Z__frontend-src-app-jsx.md`
(25/40). Wave 1 (trust fixes) and the move to `/app/` are merged.

## Problem

The approve loop is the product, and Review is the twelfth item in the rail,
below a divider. Settings is six tabs that wrap onto two rows even at 1440px,
and two of them do one job (Tokens, Connected apps). History restores a
section, but lives in Settings, three clicks and a dropdown away from the
section it restores. A separate page (`#/sections`) exists only to switch
optional sections on and off.

## Decisions already made

- The app opens on **Review when anything is waiting**, otherwise Profile.
- Everything in the critique is in scope, in waves; this is wave 2 of 4.

## Design

### 1. Rail

```
Review (3)            ← first, above the sections
─────────
Profile … Learning Log   (enabled sections only, as today)
+ More sections          ← disclosure, replaces the Sections item
```

- **Review moves to the top**, count badge unchanged (`Rail.jsx:85-104`).
- **Opening on Review.** Only on a cold open with no route in the URL
  (`/app/` with no hash) and `pendingCount > 0`. A deep link or a refresh is
  never redirected; it is where the reader asked to be. Implemented where the
  initial route is chosen today (`App.jsx:158`), after the first count fetch.
- **"+ More sections"** expands in place to list the disabled optional
  sections, each with an **Add** button that enables it. Hiding a section
  moves to that section's own header ("Hide this section"), offered only on
  sections that can be hidden (not `core`). Hiding is a settings change that
  leaves the data in place (`togglePack`, `App.jsx:523`), so it needs no
  confirm, as today; the toast carries an Undo. The `#/sections` route and page go;
  an old `#/sections` link lands on Profile through the existing
  unknown-route correction (`App.jsx:296-305`).
- The version string moves out of the rail into Settings → Account.

Mobile uses the same order in its section switcher. Swapping the pull-up
sheet for a dropdown is wave 3, not this one.

### 2. Settings: six tabs to three

| Tab | Holds |
|---|---|
| **Account** | Identity, email, password, linked accounts, autosave, "show getting started", version |
| **Connections** | Tokens and connected apps as one list, grouped under two headings, each row saying how it connects. The token form keeps Wave 1's safe defaults |
| **Data** | Export, import, and an **Advanced** disclosure holding the Server panel |

- Signed out, the dialog shows the Server panel alone with no tabs. That is
  the only thing it can do without a credential today, and the error screen's
  "Settings" button already asks for it.
- `initialTab` (Wave 1) keeps working: `"tokens"` and `"apps"` both map to
  `connections`, `"server"` opens Data with Advanced expanded.
- The dialog gets a fixed minimum height so it stops jumping between tabs.

### 3. History next to what it restores

- A **History** button in each section's header opens the existing
  HistoryPanel in a dialog, scoped to that section: no section picker, since
  the section is the one you are on.
- The History tab goes. HistoryPanel gains a `section` prop; with it, the
  picker is hidden.

### 4. Header

- An **account menu** (the existing name button) holding Settings, Theme
  (Light / Dark / System as a labelled choice) and Sign out. The standalone
  theme icon button goes; it is the unlabelled icon the critique flagged.
- The save chip stays where it is.

### 5. The email banner

Shown on Profile only, the same rule the Getting-started card already follows
(`App.jsx:739`), not on every section.

## Not in this wave

- Editor de-boxing, the type scale, mobile dropdown, tap targets, labelled
  Approve/Reject (wave 3). Onboarding (wave 4).
- Any backend change. Everything here is frontend.

## Testing

- Rail: Review renders first; "More sections" lists exactly the disabled
  optional sections, and Add enables one.
- Landing: cold open with a pending count opens Review; a deep link with a
  pending count does not.
- Settings: three tabs signed in, Server alone signed out; each old
  `initialTab` value lands on its new home.
- History: opened from a section header, it lists only that section.
- Header: theme and sign-out reachable from the account menu.
- One pass on the running preview at 1440 and 390, as for Wave 1.

## Revised after review (2026-09-24)

Three changes from Liam after trying the first build:

- **Sections are switched on and off in one control pane, Settings →
  Sections**, not by an Add in the rail and a Hide in each section header.
  Switching a section off is not a view preference: it removes the section
  from every AI read and write path (`get_context`, `search_context`,
  `get_entity`, `get_raw`, `persona_modify` all check it), so it belongs with
  the other settings and says so. The rail keeps a small "Manage sections"
  link into that pane.
- **Settings is a page, `#/settings/<tab>`**, not a dialog: four tabs had
  outgrown a modal. Tabs: Account, Connections, Sections, Data. The load-error
  screen, where the shell cannot render, gets its own inline "Change server".
- **The add-email banner shows on every screen again.** It is a nudge, and a
  nudge that only appears on Profile is easy to never see.
