# MyGist App Redesign — Reshaped Design System

**Date:** 2026-08-04
**Status:** approved design, Figma prototype pending
**Scope:** every form and layout surface in the MyGist web UI
**Deliverable:** this spec, then a Figma prototype. Code migration gets its own
spec and plan afterwards.

## Why

Three problems, all confirmed by reading the current frontend rather than by
impression.

**Subsections are not divided.** `SectionRenderer.jsx` renders an entire section
as one `Card`, with every subsection stacked inside it. Hierarchy is expressed
as `h3 text-sm font-semibold` for a group against `h4 text-sm font-medium` for
its child — identical size, one weight step apart. Group boundaries are a bare
`<hr>` and a `border-l pl-4` indent. Preferences is four groups over nine leaf
nodes in a single scroll with no visual anchor anywhere in it.

**There is no way to navigate to a subsection.** The left rail lists sections
only. Inside a section there is no table of contents, no anchor, no sub-tab and
no scroll position indicator. Finding "Learning Style" inside Preferences means
scrolling and reading headings that look the same as their parents.

**Review weights every item equally.** `ProposalsPanel.jsx` toggles two modes
with two plain `Button`s, then renders a flat stack of cards, each carrying a
badge row, a `<dl>` of fields, a rationale, a blockquote and two buttons. A
two-second "yes, add that tool" looks exactly like "decide where this
observation belongs". The code's own comment states the split is "by how much
thought an item needs" — the layout does not show that split.

Adopting Reshaped is the lever. It supplies accessible primitives and, more
importantly, a token layer that lets the app wear the MyGist brand rather than
a library's default.

## Decisions taken

| Question | Decision |
|---|---|
| Theme | MyGist tokens fed into Reshaped's `ThemeDefinition`, not Reshaped's `slate` |
| Deliverable | Spec plus Figma prototype; code migration planned separately |
| Section navigation | Two-level rail with live scroll-spy, one card per subsection |
| Review | Weighted by effort — dense rows for Inbox, full cards for Observations |
| Onboarding | Non-blocking. A routing spine plus a basics panel built from the editor's own patterns; seeding delegated to the client as a peer option |
| Breakpoints | 1440 and 390 |
| Motion | A full motion layer. Purposeful, triggered, never idle |

## Reshaped: what we verified

- **MIT licensed and fully open source.** Free for commercial use, no per-seat
  cost. The Figma library is a free community file.
- **React 18** is what the repository develops against, which matches the app.
  ESM only; CSS Modules plus a PostCSS plugin. The app is Vite + PostCSS +
  React 18, so it drops in without a build change.
- **Full token override API** — `color` (light and dark pairs), `radius`,
  `fontFamily`, `fontWeight`, `font`, `shadow`, `duration`, `easing`,
  `viewport`, `zIndex`, `unit`. Applied through `getThemeCSS` / `transform`,
  with `generateThemeColors` computing accessible `on*` foregrounds.
- **Version skew.** The Figma community file is v3.9; npm is v4. v4 renamed the
  typography tokens (`title-1` becomes `headline-1`, `body-2` becomes `body-1`)
  and removed `-rgb` colour tokens. **We build to v4 naming** and treat the
  community file as visual reference only.

## Foundations

### Colour

Values are taken verbatim from the landing design system so the two surfaces
cannot drift. HSL triplets, light then dark.

| MyGist | Reshaped token | Light | Dark |
|---|---|---|---|
| paper | `backgroundPage`, `backgroundElevationBase` | `60 9% 98%` | `60 3% 7%` |
| card | `backgroundElevationRaised`, `backgroundElevationOverlay` | `0 0% 100%` | `60 2% 10%` |
| muted | `backgroundNeutralFaded` | `60 5% 96%` | `60 1% 14%` |
| ink | `foregroundNeutral` | `24 10% 10%` | `60 5% 96%` |
| muted-fg | `foregroundNeutralFaded` | `25 5% 45%` | `24 5% 64%` |
| border | `borderNeutralFaded` | `20 6% 90%` | `60 2% 16%` |
| indigo | `primary`, `brand`, `borderPrimary` | `228 69% 55%` | `228 94% 67%` |
| indigo-tint | `primaryFaded`, `backgroundPrimaryFaded` | `223 100% 96%` | `227 22% 20%` |
| destructive | `critical` | `0 65% 48%` | `0 74% 54%` |
| success | `positive` | `142 71% 35%` | `142 60% 50%` |
| warning | `warning` | `43 96% 40%` | `43 90% 55%` |

`on*` foregrounds are generated, never hand-picked.

**Clay and verdigris get one job each, not a semantic slot.** The landing rule
forbids both on body text, and a form-dense app has almost no tinted ground to
spend them on. Rather than drop them and lose the family resemblance:

- **clay** (`18 74% 60%` / `18 66% 62%`, tint `18 74% 94%` / `18 30% 18%`) tints
  the onboarding spine, the delegate-to-client offer, and empty-state surfaces.
- **verdigris** (`188 38% 36%` / `188 40% 50%`, tint `188 26% 93%` /
  `188 26% 15%`) means one thing only: **a client connection that is live**. The
  connected dot, the "connected" state in onboarding step 1, the live badge in
  Connected Apps.

Neither ever appears on a button, a label or body text. They are registered as
custom tokens `clay` / `clayFaded` / `verdigris` / `verdigrisFaded`.

### Typography

Stack Sans Notch is display-only at 40px and above. Making onboarding a
section-shaped destination rather than a hero screen removed the last 40px text
in the product, so **the app uses no display face at all** — it is Geist and
Geist Mono, end to end. That is correct for a tool built out of forms, and it
means Stack Sans Notch is a landing asset, not a shared one. It is not loaded by
the app, which is one less webfont on a surface people open every day.

| Reshaped token | Size / line height | Face and weight | Used for |
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

Every size above is a **MyGist override**, not a Reshaped v4 default — the token
names are v4's, the values are ours. Tokens not listed (`display-1`, `display-2`,
`featured-1`, `featured-4` through `featured-6`) keep Reshaped's defaults and are
unused by the app; they are left in place rather than deleted so the theme stays
a complete `ThemeDefinition`. `featured-1` is where Stack Sans Notch would be
bound if the app ever needs a display line, and the landing file binds it there.

### Radius, space, elevation

`radius` s / m / l / xl = **4 / 6 / 8 / 12**. Concentric: a 12 card holds 8 rows
holds 6 inputs. The landing scale's 16 / 24 / 32 are page-composition values and
do not appear in the app.

Base `unit` **4**. The app uses 4 · 8 · 12 · 16 · 24 · 32 and nothing above;
48 and up are landing rhythm.

`shadow` — all tinted with ink, never black. `raised` = `0 1px 2px ink/6%`,
`overlay` = `0 12px 32px ink/14%`. Cards use borders rather than shadow at rest;
shadow is reserved for things that float (modal, popover, flyout, dropdown).

### Motion

The landing spec forbids anything that loops, drifts, pulses or shimmers. That
rule exists for a page someone scans once. This is a surface someone edits for
an hour, where movement between states is what makes it feel continuous, so the
app takes a fuller motion layer. Four durations and four easings, bound as
theme tokens:

```
fast      120ms   press, hover, focus ring, switch, checkbox
medium    200ms   state change, tab indicator, chip add, save tick, spy marker
slow      280ms   card expand, sheet, modal, row exit, inline edit
scroll   ≤400ms   distance-scaled smooth scroll

decelerate  cubic-bezier(0, 0, .2, 1)     entrances
accelerate  cubic-bezier(.4, 0, 1, 1)     exits
standard    cubic-bezier(.4, 0, .2, 1)    on-screen moves and resizes
emphasized  cubic-bezier(.2, 0, 0, 1)     sheet, modal
```

Named motions, in order of how much they matter:

1. **The scroll-spy marker travels.** A 2px indigo bar slides between rail
   anchors over 200ms `standard` instead of cutting. This is the highest-value
   animation in the design: it is what makes a two-level rail read as one
   continuous place rather than a list of links.
2. **Subsection expand / collapse.** Height and opacity over 280ms
   `decelerate`, content fading in at 60% of the travel so text does not smear
   mid-resize.
3. **Approve / reject exit.** The row slides 8px toward the action taken
   (approve right, reject left), fades, and collapses its height over 240ms
   `accelerate`; rows below close the gap on the same curve. Today the row
   simply disappears, which is why a toast is needed to prove the click landed.
4. **Inline list edit.** A row expands in place into its edit form over 280ms,
   with the title holding position so the reader never loses their place.
5. **Save tick.** A per-card check scales 0.8 to 1 with a fade over 160ms, holds
   1.2s, fades out over 200ms. Plays once.
6. **Sheet** slides up 280ms `emphasized`, scrim fades 200ms. **Modal** scales
   0.96 to 1 over 240ms `decelerate`, exits over 160ms `accelerate`.
   **Chips** pop in over 160ms, out over 120ms. **Tab indicator** slides 200ms.
7. **Loading shimmers.** Skeleton blocks sweep on a 1.4s loop while a request is
   genuinely in flight and stop the instant it lands. Spinners unrestricted.

Rules that hold, because they are what separates smooth from busy:

- **Nothing animates while idle.** Every motion has a trigger — input, arrival,
  or a request in flight — and it ends.
- **Nothing exceeds 400ms and nothing blocks input.** Transform and opacity
  wherever possible; height animation goes through a measured wrapper.
- **Stagger caps at 5 items × 30ms**, so a twenty-row queue does not cascade for
  a full second.
- `prefers-reduced-motion: reduce` collapses every duration to 0 except opacity
  fades, capped at 100ms. Smooth scroll becomes an instant jump. Shimmer becomes
  a static faded block.

## Shell and navigation

### Header

60px, sticky, `backgroundElevationRaised` with a bottom border. Logo and
wordmark left. Right side, in order: save-state chip, theme control, account
chip.

Two changes from today:

**The autosave switch moves out of the header.** It currently sits there beside
a status sentence that expresses three states in prose ("Saving…" / "Saved just
now" / "Unsaved changes"). It is a once-per-lifetime preference competing with
content for the most valuable strip on the page. It moves to Connection
Settings → Account → Preferences. The header keeps one save-state chip with
three states: `Saved`, `Saving…`, and `Unsaved` with an inline `Save now`.

**The Review dot becomes the number.** `pendingCount` is already fetched from
`/proposals/count` and then spent on a decorative 2×2 dot with screen-reader-only
text. The rail item shows a numeric `Badge`.

### Rail — desktop

240px, up from 192. Sticky beneath the header inside a `ScrollArea`, so ten
sections plus expanded anchors never trap the page scroll.

```
 ▸ Profile            sections, as MenuItem
 ▾ Preferences        active section expands
 │   Code Style       subsection anchors, indented
 │   Communication ●  ● = live scroll-spy marker
 │   Learning Style
 │   Likes & Dislikes
 ▸ Lifestyle
 ▸ Knowledge
 ──────────────
 ▸ Review        3    numeric badge, not a dot
 ▸ Sections
   v2.0.0 (a1b2c3)    caption-2
```

Only the active section expands; switching collapses the previous one. Anchors
scroll the page with `scroll-margin-top` clearing the 60px header. The marker
tracks position live as the reader scrolls, and slides between anchors.

The divider is load-bearing: Review and Sections are not persona sections and
must not read as though they were.

### Rail — mobile, 390

**The horizontal tab strip is removed.** Today twelve tabs live in one
edge-faded horizontally scrolling strip with a `useEdgeFade` hook measuring
which side to fade. That strip is the single thing that makes navigation hard:
it hides most of its content off-screen, gives no indication of depth, and
introduces a second scroll axis on a surface that already scrolls vertically.

It is replaced by a sticky `Section ▾` selector under the header. Tapping it
opens a full-height sheet listing every section, with the active section's
subsections nested beneath it. Any subsection in the app is two taps away, on
one scroll axis, with the whole structure visible at once.

## Section editor

### Hierarchy: eyebrow bands over cards

The core structural change. **One card per subsection**, and a group becomes a
labelled band above its cards.

```
Preferences                                        featured-3
How you like AI to work                            caption-1, faded

CODE STYLE ────────────────────────────            caption-2, mono, faded
┌──────────────────────────────┐  ┌──────────────────────────────┐
│ Preferred languages   empty  │  │ Frameworks            empty  │
│ Nothing here yet. Add one,   │  │ Nothing here yet. Add one,   │
│ or let a client propose one.  │  │ or let a client propose one. │
│ [ Add language ]             │  │ [ Add framework ]            │
└──────────────────────────────┘  └──────────────────────────────┘

COMMUNICATION ─────────────────────────
┌────────────────────────────────────────────────────────────────┐
│ Default style                                         3 of 3   │
│  Tone                    Detail level                          │
│  [ direct           ▾]   [ concise             ▾]              │
│  Locale                                                        │
│  [ en-GB            ▾]                                         │
└────────────────────────────────────────────────────────────────┘
```

**Exactly two visual tiers — band, then card.** The manifest format allows
arbitrary group nesting. A third level renders as a `headline-3` label *inside*
a card, never as a third tier, so no future manifest can invent a hierarchy the
design cannot express.

**The fill summary is new and does real work.** Every card header carries a
right-aligned count. It makes gaps visible without collapsing anything, which
was the one genuine advantage of the accordion approach, kept without its cost
of hiding data behind a click.

Which form the count takes is determined by whether the node has a denominator,
so it is never a judgement call:

| Node kind | Denominator | Renders as |
|---|---|---|
| `fields` | yes — the manifest fixes the key set | `3 of 3`, `1 of 3` |
| `list`, `strings` | no — unbounded | `3 set`, `12 set` |
| `scalar` | n/a | nothing; the control shows its own state |
| any, when zero | — | `empty` |

### Field patterns

One pattern per manifest node `kind`. The existing renderer split
(`FieldsRenderer`, `ListRenderer`, `StringsRenderer`, `ScalarField`,
`fieldMeta`) is a good decomposition and is kept; only the components and
layout change.

**`fields`** — a two-column `Grid` of `FormControl`s. Label above, helper
below, error replacing helper. Long fields span the row, preserving today's
`needsFullRow` rule. Labels are `headline-3`, not the current
`text-xs text-muted-foreground`, which reads as helper text rather than as a
label.

**`strings`** — a chip input. Type, Enter commits, each chip carries a remove
affordance. **Paste splits on comma and newline**, which it does not today;
pasting "React, Vue, Svelte" currently creates one chip called
"React, Vue, Svelte".

**`list`** — the heaviest pattern and the biggest change.

- Rows show the title field prominently with secondary fields on one faded line
  beneath.
- **Row click expands inline to edit**, replacing today's separate edit form.
- Add sits top-right in the card header, not at the bottom of the list.
- **Search appears only past six items.** Below that it is chrome with nothing
  to do.
- Remove sits behind an overflow `DropdownMenu` and keeps its confirmation
  `Modal`. Destructive actions do not belong one stray click from a row body.

**`scalar`** — `TextField` / `NumberField` / `Select` / `Switch` / `TextArea`,
chosen by `fieldMeta` exactly as now.

**Empty states** are per card: one line naming what would live there and what
puts it there, plus one action. "Nothing here yet. Add a language, or let a
client propose one." Never "No data found", never an illustration at card size.

### Save feedback

Autosave debounces at 1500ms and currently fires a `toast({ title: "Saved" })`
on every single flush. Editing three fields in a row produces three stacked
toasts for something the reader never doubted. Toasts are for things that
happened away from the reader's attention.

Replaced by the per-card save tick described in the motion layer. Failures keep
a destructive toast, because a failure genuinely needs interrupting.

## Review

### Structure

The two plain `Button`s become **Reshaped `Tabs` carrying counts** —
`Inbox 3` · `Observations 2`.

**Inbox rows are one line.** Verb, entity, primary value, approve, reject,
expand.

```
Inbox 3  ·  Observations 2
─────────────────────────────────────────────────────────
 Add     hobby        bouldering          ✓   ✕   ⌄
 Add     tool         Vite                ✓   ✕   ⌄
 Update  preference   tone → direct       ✓   ✕   ⌄
```

The chevron expands in place to reveal the full field list, the rationale and
the evidence quote. Approving does not require expanding.

**Observations keep the full card**, because promoting one is a real decision
about where something belongs.

```
┌──────────────────────────────────────────────────────┐
│ OBSERVATION            claude · seen 2×              │
│ "Maya now owns the monthly newsletter"               │
│ ❝ quote from her ❞                                   │
│ suggested: Projects                                  │
│           [ Promote ]        [ Delete ]              │
└──────────────────────────────────────────────────────┘
```

### The Promote dialog

The roughest form in the app today: two raw unstyled `<select>` elements sharing
a hand-rolled `selectClass` string. Rebuilt with `FormControl` + Reshaped
`Select`, Type dependent on Section, and the agent's wording pre-filled in an
editable `TextField` — that field is the last point before an agent's phrasing
becomes the reader's data, and it should look like it.

### Keyboard

`j` / `k` move, `a` approve, `r` reject, `e` expand. Shortcuts are listed in the
panel's empty state and behind a `?`.

### No bulk approve, deliberately

A select-all checkbox is how "nothing reaches your persona until you approve it"
quietly stops being true. The dense single-line row already makes approving one
item about as fast as ticking a box. This is a product promise, not an
ergonomics gap.

### Empty state

"Nothing waiting. Agents propose changes here as they notice them." Plus, when
the connected client lacks the `propose` scope, a line saying so — see below.

## Onboarding

Not a wizard, and not a card with inputs crammed into it. Two pieces: a
**progress spine** that lives above the section title, and a **rail destination**
where the basics are actually filled in.

### The spine

A dismissible `Getting started` card above the section title, showing three
steps and nothing more. It routes; it does not collect.

```
┌──────────────────────────────────────────────────────────────┐
│ Getting started                                 1 of 3   ✕   │
│                                                              │
│ ✓ 1  Connect a client            ● connected · Claude        │
│   2  Fill in the basics                    [ Start ]         │
│   3  Ask your client to fill in the rest   optional          │
└──────────────────────────────────────────────────────────────┘
```

**Step 1 — connect a client.** Copy the MCP URL. Shows `waiting for first
call…` and flips to a **verdigris** connected state, naming the client, when the
first MCP call actually lands.

### Step 2 — the basics, as a rail destination

`Getting started` becomes an entry in the rail below the divider, with its own
subsection anchors, behaving exactly like a persona section. **It is built from
the section editor's own patterns** — eyebrow bands, subsection cards, fill
summaries, scroll-spy — rather than from a bespoke wizard layout. Two reasons,
and the second is the important one: it teaches the interface by being the
interface, and it cannot drift from the editor design because it *is* the editor
design applied to a curated cross-section of fields.

```
 ▸ Profile           │  Getting started                            2 of 3
 ▸ Preferences       │  Four groups, about five minutes. Skip any of it.
 ▸ Lifestyle         │
 ──────────          │  ┌────────────────────────────────────────────────┐
 ▸ Review         3  │  │ Would you rather your client did this?          │
 ▸ Sections          │  │ Paste one prompt and it proposes the lot for    │
 ▾ Getting started   │  │ you to approve.            [ Copy prompt ]      │
     About you     ● │  └────────────────────────────────────────────────┘
     How you like…   │
     Working on      │  ABOUT YOU ─────────────────────────
     Languages       │  ┌────────────────────────────────────────────────┐
                     │  │ Your name and role                   2 of 5    │
                     │  │  What we call you       Full name               │
                     │  │  [ Maya             ]   [ Maya Ellis        ]   │
                     │  │  Role                   Organisation           │
                     │  │  [ Marketing assis. ]   [                  ]   │
                     │  │  Location                                      │
                     │  │  [ Manchester       ]                          │
                     │  └────────────────────────────────────────────────┘
                     │  ┌────────────────────────────────────────────────┐
                     │  │ In a sentence                        empty     │
                     │  │  Anything a new assistant should know first    │
                     │  │  [                                         ]   │
                     │  └────────────────────────────────────────────────┘
```

Four bands, every field an existing manifest path. Nothing here is a new
concept the app has to learn:

| Band | Fields | Writes to |
|---|---|---|
| **About you** | `preferred_name`, `name`, `current_role`, `organisation`, `location`, `bio` | `profile` |
| **How you like answers** | `communication.default.{tone, detail_level, locale}`, `response_format`, `learning_style.preferred`, `learning_style.avoid` | `preferences` |
| **What you're working on** | `top_of_mind`, one `goal.title` | `projects`, `goals` |
| **Languages** | `language` rows (`name` + `fluency`) | `profile.languages_spoken` |

Three properties this shape buys:

- **The client option is a peer, not a footnote.** It sits at the top of the
  panel, above the first band, so delegating is a choice offered before any
  typing rather than a consolation found after it.
- **Non-blocking throughout.** The rail never disappears, so leaving mid-way is
  a click. Every answer is already saved by autosave, so leaving costs nothing
  and there is no "finish" to abandon.
- **Progress counts bands touched, not fields filled.** Skipping a band is a
  legitimate way through, and the counter should not turn that into a failure
  state. A band counts as touched once any field in it is set or it is
  explicitly skipped.

Writes go through the same `/files/{key}` endpoint the editors use, one request
per affected section, debounced identically. There is no onboarding-specific
write path.

### Step 3 — ask your client to fill in the rest

The secondary path, explicitly optional, and reachable both from the spine and
from the top of the basics panel. A copy-paste prompt, run by the client rather
than by the app:

> Use `get_schema` to learn my MyGist vocabulary, then propose what you know
> about me with `propose_update`. One call per fact, each with your reasoning
> and a short quote from me. Never write directly, and skip anything you are
> guessing at. I will approve or reject each one.

Below it: "Paste this into a client that has permission to propose. If it does
not know you yet, give it your CV or bio first."

This is the right shape for three reasons. The extraction happens in the client,
which already has a capable model, so **no backend work is required** — it uses
`propose_update`, which exists and is scoped. Nothing is written directly, so the
approval promise holds. And the reader's first real task becomes approving a
dozen rows in Review, which teaches the review mechanic on day one.

**Scope caveat, and it matters.** `propose_update` requires the `propose` scope,
and `mcp_scopes.py` *hides* out-of-scope tools rather than failing them. A
read-only connection means the pasted prompt does nothing at all, with no error
anywhere. So the spine's step 1 shows the connected client's granted scopes, and
when `propose` is absent both step 3 and the panel's delegate offer say so and
point at reconnection instead of a copy button. Without this, the feature's
failure mode is complete silence.

**Dismissal is not destructive.** Dismissing the spine also removes the
`Getting started` rail entry; both return from the account menu, because someone
who enables Media in three weeks is a first-run user again. The basics panel
itself is never deleted — it is a view over fields that already exist, so
"finishing" onboarding only hides the route to it.

## Auth, settings, consent

- **AuthShell** stays a centred 400px card on `backgroundPage`. Sign in, sign up
  and forgot become three states of one card with inline validation on blur
  through `FormControl`'s error slot.
- **OTP moves to Reshaped `PinField`**, removing the `input-otp` dependency.
- **InviteGate** — one field, one explanation, no chrome.
- **ResetPassword** — two fields with a live match hint.
- **ConnectionSettings** is one dialog doing three jobs. It becomes a `Modal`
  with `Tabs`: **Account** (email, add email, password, sign out, and the
  relocated autosave preference), **Server** (URL plus a connection test showing
  the verdigris live state), **Token** (create, copy, revoke a scoped token).
- **ConnectedApps** — one row per client with a verdigris live dot, granted
  scopes, last used, and revoke.
- **Consent** names the client, lists requested scopes as a `CheckboxGroup` in
  plain language, and pairs Allow with a **neutral** Deny. Deny is not
  destructive; it is the safe choice.

## Figma prototype

New file **`MyGist — App Redesign`**. Token names are identical to the landing
file's so the two merge into one library later.

```
00 Cover
01 Foundations          variable collections, light and dark modes, specimens
02 Components           Reshaped-derived component sets with all states
03 Shell & Navigation   header, rail, mobile sheet
04 Section editor       Profile (dense), Preferences (mixed), Goals (light)
05 Review               inbox, expanded row, observation, promote, empty
06 Onboarding           spine states, basics panel (4 bands), prompt, empty states
07 Auth & Settings      auth states, settings tabs, consent
08 Motion               annotated motion specs
```

Every screen at **1440 and 390**.

**Content is Maya Ellis**, the landing file's demo persona — 23, Manchester,
marketing assistant, British English, no exclamation marks, never "delve". She
is deliberately not a developer, which is useful here: Preferences' Code Style
group is genuinely empty for her, so it demonstrates the `empty` fill summary
and the teaching empty state honestly, while her Profile supplies the density
case. No second persona is needed.

**Build order**, with a review gate after each phase:

1. Foundations and Components
2. Shell & Navigation, and Section editor
3. Review
4. Onboarding
5. Auth & Settings
6. Motion annotations

**Reshaped Figma library.** The v3.9 community file has been duplicated into the
team, so it is discoverable through `get_libraries` on the new file and can be
subscribed to and searched with `search_design_system`. Components are still
built to **v4 token naming**, not the v3.9 file's — the duplicate is a source of
geometry and states, not of token names.

## Out of scope

- **Code migration.** No frontend file changes here. Swapping shadcn/Radix
  primitives for Reshaped gets its own spec and plan once the prototype is
  approved.
- **Backend changes.** None required. Delegating seeding to the client was
  chosen specifically to avoid inventing an extraction endpoint.
- **New persona sections or manifest format changes.** The design adapts to the
  manifest as it stands, including its unused capacity for deeper nesting.
- **The landing page.** Built in parallel on `design/landing-page`. This spec
  consumes its token values and demo persona and changes neither.

## Risks

| Risk | Mitigation |
|---|---|
| Two Figma files drift apart on tokens | Identical token names, values copied verbatim, merge into one library later |
| Reshaped v3.9 Figma vs v4 npm | Build to v4 naming; treat the community file as visual reference |
| Reshaped CSS Modules clash with Tailwind mid-migration | Migration spec decides: Reshaped owns primitives, Tailwind is removed per-file, never both styling one element |
| Scroll-spy accuracy with variable card heights | `IntersectionObserver` per card with a root margin matching the sticky header; the marker follows the topmost intersecting card |
| Seeding silently does nothing on a read-only connection | Onboarding shows granted scopes and calls out a missing `propose` scope |
| Onboarding basics write to two sections at once | Both paths already exist in the manifests; writes go through the same `/files/{key}` endpoint the editors use |
