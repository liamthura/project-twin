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

**See [Prototype divergences](#prototype-divergences):** the built prototype
implements a standalone stepped flow instead of the rail-embedded panel
described below, reversed deliberately at the user's direction. Anyone
implementing from this section of the spec body would build the wrong
onboarding; read the divergence entry first.

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
- **InviteGate** — one field, one explanation, no chrome. The field is a
  segmented `InviteCodeField`, not a plain text input: four cells, a
  prerendered dash, four cells. See iteration round 2 below.
- **ResetPassword** — two fields with a live match hint.
- **ConnectionSettings** is one dialog doing three jobs. It becomes a `Modal`
  with `Tabs`: **Account** (email, add email, password, sign out, and the
  relocated autosave preference), **Server** (MyGist Cloud shown as the default
  with self-hosting demoted to a hint; the URL field and connection test move to
  their own custom-server state), **Token** (a list of named tokens, each with
  copy and a red revoke, plus a create form).
- **ConnectedApps** — one row per client with a verdigris live dot, its grants
  in plain language rather than raw scope strings, last used, and a red revoke.
- **Consent** names the client, lists requested scopes as a `CheckboxGroup` in
  plain language, and pairs Allow with a **neutral** Deny. Deny is not
  destructive; it is the safe choice.

## Figma prototype

New file **`MyGist — App Redesign`** — `Ti7FlZLYOvX3goyvfypJBk`
(<https://www.figma.com/design/Ti7FlZLYOvX3goyvfypJBk/MyGist-%E2%80%94-App-Redesign>).
Token names are identical to the landing file's so the two merge into one
library later.

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

## Prototype divergences

Recorded during Task 14's final audit of the Figma file
(`Ti7FlZLYOvX3goyvfypJBk`), against this spec. Where a check failed outright it
is marked **FAIL**; everything else either matches the spec or is a considered,
justified departure from it.

- **Font: none.** `Geist` and `Geist Mono` were both available in
  `listAvailableFontsAsync()` (`Regular`, `SemiBold`, no space), so no
  Inter/Roboto Mono substitution was ever needed. Recorded on the cover.
- **Reshaped v3.9 was never usable as a geometry reference.** Neither the
  duplicated community file nor the user-provided reference file
  (`oR8g1o9qiluZAqHzMfieg0`) exposed component geometry through `get_metadata`
  or `get_screenshot` — the community file showed only a cover page. Every
  component (Tasks 5–7) was built from the brief's explicit values; no
  proportions were borrowed from Reshaped.
- **Detached container components.** `SubsectionCard`, `Modal` and `Sheet` are
  deliberately detached on screens, because the Plugin API refuses
  `appendChild` into a descendant of a live instance. 38 detached/cloned
  non-instance frames are present in the file today: 1 `Sheet` (`03 Shell &
  Navigation`, mobile section sheet, `96:67`), 27 `SubsectionCard` (`04 Section
  editor`), 5 `SubsectionCard`/`Modal` (`05 Review`), 5 `Modal`/`Sheet` (`07
  Auth & Settings`). **Cost:** later edits to those three components in `02
  Components` will not propagate into any of these 38 built screens — each is
  a frozen copy from the moment it was detached.
  **A 39th detached node exists outside this count and was missed by the
  original sweep:** `201:1863` on `08 Motion`, a detached `RailSubItem`
  (`Indent`/`Label`/`Spy marker`, marker `opacity:1`, `Label` bound to
  `indigo`) acting as the fourth genuine-current row of `Rail — Live
  (animated, 200ms standard)`. It had to be detached for the same reason as
  every other node on this list — the Plugin API refuses to add an animation
  to a node living inside an instance — except here the thing being animated
  is Task 13's `Spy marker` Y-position on that specific frame, not a content
  slot.
  **A 40th detached node exists outside this count and was also missed by the
  original sweep:** `210:79` on `08 Motion`, a non-instance `FRAME` named
  `Tabs` — Task 13's ruling-(f) diagnostic copy, detached from the fixed
  `Tabs` component (`78:43`) and kept purely as a motion demonstration next to
  caption `206:63` (see the caption correction above; the caption used to
  claim this frame proved the component fix, which a detached copy cannot
  do).
  **Correcting Step 4's own figure, a second time:** the sweep's three-list
  result was reported as enumerated-and-found 38, enumerated-but-missing 10,
  found-but-unenumerated **0** — that last number was wrong twice over; it is
  **2** (`201:1863` and `210:79`), not the 1 recorded after the first
  correction. Two compounding, independent blind spots let both through: (1)
  the sweep's detach heuristic matched non-instance frames with a **nonzero
  corner radius**, and neither `RailSubItem` (`201:1863`) nor this `Tabs`
  copy (`210:79`, `cornerRadius: 0`) carries one, so both were structurally
  invisible to that check; (2) the sweep's component-name cross-check never
  included `Tabs`, `Modal` or `Sheet` in its watch-list at all — it relied on
  the plan's own enumerated detach lists for those three components rather
  than searching for their names directly, so a detach the plan's prose never
  mentioned (this one) had no second path to be caught by. Read plainly: the
  sweep has two independent blind spots, not one, and a "0" from it should
  not be trusted for any component that is both radius-free and outside its
  name watch-list.
- **Onboarding was redesigned late, at the user's direction**, into a
  **standalone stepped flow with no app shell** (`Onboarding — Welcome`, `—
  About you`, `— How you like answers`, `— Complete`, plus a mobile variant),
  deliberately reversing the earlier decision that made onboarding a rail
  destination inside the app shell. As a side effect, `06 Onboarding` now
  holds **zero fractional-opacity paints** file-wide (confirmed by audit) —
  only twelve node-level `Spy marker` opacities remain across the file, none
  of them on this page's new flow.
  **The page also still contains the pre-redesign rail-embedded flow**
  (`Desktop — Spine`, `Desktop — Delegate offer`, `Desktop — Spine complete`,
  `Mobile — Spine`, each still wrapped in a `Header`/`Body` app shell) — this
  is deliberate, not leftover: the coordinator's Task 11R brief instructs
  keeping these because the **spine card lives on the Profile screen as the
  entry point and resume affordance into onboarding**, and is unaffected by
  the standalone-flow ruling. Read together: the spine card is the entry
  point (and, via `Desktop — Delegate offer`, the expanded prompt view
  reachable from either path), and the standalone flow (`Onboarding —
  Welcome`/`— About you`/`— How you like answers`/`— Complete`) is the work
  itself. Both are intentional and neither supersedes the other.
- **Spec check 6 (delegate offer before the field groups): PASS, after a
  fix.** The redesign's Task 11R brief placed the offer on `Onboarding — How
  you like answers` (step 2 of 4), where it landed **after** that step's own
  `Tone`/`Locale`/`Detail level` fields — the fault was the placement
  instruction, not the build. Fixed by moving the card (`235:319`, not a
  copy — the original node) into `Onboarding — Welcome`'s column, directly
  below the heading/supporting line and above the `Group preview` list and
  the primary `Get started` action; its body copy was generalised from
  "proposes answers here" to "proposes your whole profile", since it now
  precedes all four groups rather than just one. Confirmed by a fresh
  file-wide text search: the offer's copy now appears in exactly two places —
  once on `Onboarding — Welcome` (the current flow, before any field) and
  once on the superseded `Desktop — Delegate offer` (the retained expanded
  view, see above) — and zero times on `— How you like answers`, which now
  reads `Progress row → Hairline → Heading block → Fields → Footer` with no
  gap where the card used to sit. Delegation is offered before the work, not
  after, on the flow a reader actually uses today.
- **`RailItem` gained an `INSTANCE_SWAP` icon slot** (`Icon#224:0`) **and
  thirteen icon components** late in the build — `IconProfile`,
  `IconPreferences`, `IconLifestyle`, `IconKnowledge`, `IconGettingStarted`,
  `IconProjects`, `IconGoals`, `IconCircle`, `IconMedia`, `IconAesthetics`,
  `IconLearningLog`, `IconReview`, `IconSections` — replacing placeholder black
  squares across the rail on four pages. (A separate three-icon set,
  `IconTick`/`IconCross`/`IconChevron`, was added earlier for `Button`'s icon
  slot — 16 `Icon*` components total on `02 Components`.)
- **`Tabs` gained `Count=Four`**, not `Count=Three`. Four settings tabs
  (`Account`/`Server`/`Token`/`Connected apps`) were required once Step 3's own
  table was reconciled; `Count=Three` was built first, then kept in place
  unused rather than churned, per the coordinator's instruction. Confirmed
  live: `Tabs`' property definitions read `Count: [Two, Three, Four]`. `Tabs`
  was also repaired after Task 7 signed off — its `Tab` frames had
  `clipsContent: true`, which clipped the `Indicator` out of any transition.
- **A `scrim` token was added** (`VariableID:140:2`, key
  `93bb5f52ae2ad5c9936d61dda83cec01e41e6446`) after the token layer was built,
  because binding scrims to `ink` inverted them in dark mode (a semantic text
  token that goes near-white in Dark). Confirmed mode-invariant: both `4:0` and
  `4:1` resolve to the same value.
- **`Button` gained a hidden-by-default swappable `Icon` slot**
  (`Icon#139:0`) so row actions could carry icons alongside labels, at the
  user's direction.
- **`RailSubItem`'s `State=Current` trap, closed by full enumeration — the
  figure is 12, not 15, and not universal.** A prior pass through this record
  stated 15 without reading every instance's actual `State`, marker presence
  and marker opacity; a re-reviewer correctly refused to accept that number
  and asked for it to be read, not carried forward. It has now been read,
  file-wide, node by node (table in the Task 14 report). **The enumerated
  figures: 65 `RailSubItem`-shaped nodes total (64 `INSTANCE`s + the one
  detached `FRAME`, `201:1863`, above) — 38 `State=Default`, 26
  `State=Current`, 0 `State=Hover`. Of the 26 `Current` instances, 14 are
  genuinely current and 12 carry the fake-`Default` workaround, split 3 on
  `06 Onboarding` and 9 on `08 Motion`.**
  Of the 64 instances: **49** (`03 Shell & Navigation` 8, `04 Section editor`
  17, `05 Review` 24) are plain, unmodified variants with no workaround at
  all — 38 `State=Default` (no `Spy marker` child present — `createInstance()`
  dropped it, since the master's `Default`-variant marker is
  `visible:false`, which is harmless here because these rails only ever show
  one static "you are here" row) and 11 `State=Current` (marker present,
  `opacity:1`, `Label` bound to `indigo`). The remaining **15** instances (`06
  Onboarding` 4, `08 Motion` 11) all report `State=Current` as their variant
  property, confirming the earlier "15, not twelve" correction was right
  about *which instances are built from the `Current` master* — but of those
  15, only **12** actually carry the fake-`Default` workaround (`Spy marker`
  present, `opacity:0`, `Label` rebound from `indigo` to `ink`: 3 on `06
  Onboarding`, 9 on `08 Motion`). The other **3** of the 15 are simply,
  correctly current (marker `opacity:1`, `Label` on `indigo`: `159:346` on
  Onboarding; `201:58` and `201:96` on Motion) — plus the detached frame
  `201:1863` is the 14th genuinely-current row (see above for why it had to
  be detached: its `Spy marker`'s Y-position is what Task 13 animates on that
  frame, and the Plugin API refuses to add an animation inside a live
  instance). **The trap applies to exactly those 12**, not to all 15 and not to
  all 64 or 65: "correcting" `165:1545`/`165:1549`/`165:1553` (Onboarding) or
  `201:62`/`201:66`/`201:70`/`201:79`/`201:83`/`201:87`/`201:92`/`201:100`/
  `201:104` (Motion) back to a plain `State=Default` build would delete the
  animation target and silently break the scroll-spy/motion demo on those two
  pages — the other 53 `RailSubItem`-shaped nodes in the file (49 plain
  instances + 3 genuinely-current instances-on-demo-pages + the 1 detached
  frame) are not at risk from that particular correction.
- **Consent scopes are `read`/`propose`/`write`**, not `read`/`search`/
  `propose` — the code (`Consent.jsx`) was the source of truth, not the
  brief's table. Confirmed live: the three `CheckboxGroup` labels read "Read
  your persona", "Suggest changes for your approval", "Change your persona
  directly".
- **Seven of the ten sections have no screen of their own.** `04 Section
  editor` holds exactly `Desktop — Preferences`, `— Profile`, `— Goals` (plus
  variant frames of those three) — confirmed by reading the page's frame list.
  Lifestyle, Knowledge, Projects, Circle, Media, Aesthetics and Learning log
  are structurally identical to Goals and were not built separately.
- **Five of the seven motions are annotated rather than animated**,
  deliberately (Task 13). Confirmed on `08 Motion`: exactly five Before/After
  static comparison pairs exist (subsection expand, inline list edit, save
  tick, sheet/modal, **loading shimmer**); the **scroll-spy marker travel**
  (`201:1866`, `TRANSLATION_Y` 0→36px, 200ms) and the **approve/reject exit**
  (`204:95`/`204:104`, `TRANSLATION_X`/`OPACITY`/`HEIGHT`, 240ms) are the two
  built as real motion rather than annotation — **of the seven numbered
  motions**, exactly two are genuinely animated; the loading shimmer is
  static, one of the five annotated pairs, not one of the two. **Correcting
  a drift from the build ledger:** an earlier pass through this record named
  the animated pair as the scroll-spy marker and the loading shimmer, which
  is wrong; the build ledger (Task 14 report) had the approve/reject exit
  right, and this entry now matches it. A third animated frame also exists
  outside the seven-motion numbering: the `Tabs` `Indicator` diagnostic on
  this page (`206:62`/`210:84`, `TRANSLATION_X`/`WIDTH`, 200ms), built to
  verify the `Tabs` `clipsContent` component fix, not counted among the seven
  named motions.
- **The single most useful warning in this handoff: viewing any page of this
  file in Dark mode permanently strips every paint-level opacity in the
  file.** Anyone who opens this prototype and switches a page to Dark to look
  at it — not to edit it, just to review it — will silently flatten every
  tinted overlay (`Button` hover/pressed states, `Badge`/`Chip` tints, both
  `scrim`s, the `Scope notice`, `SaveStateChip Unsaved`) to full opacity.
  Node-level opacity (`Button Disabled`, the `Spy marker`s) is unaffected.
  This is invisible until it has already happened — there is no warning
  dialog, and switching back to Light does not undo it, since the restore
  triggers the same reset. **Anyone reviewing this file in Dark mode should
  expect every tinted surface to render at full strength afterward, and
  should re-apply the values below (or re-run this audit) before treating the
  file as clean again.** Fractional-opacity fragility is real, and now
  measured precisely. Switching a frame's `Colour` collection mode resets
  every **paint-level**
  fractional opacity back to `1` — confirmed freshly in this audit on `Button`
  hover/pressed overlays, `Badge`/`Chip` tints, both `scrim` rectangles, the
  `Scope notice`, and `SaveStateChip Unsaved`, both going into Dark and again
  restoring to Light (each of the ~57 file-wide fractional-opacity paints had
  to be re-applied and re-measured twice). **Node-level** opacity does not
  reset: `Button`'s four `State=Disabled` variants (`opacity: 0.5`) and all
  twelve `Spy marker` node-opacities (`0`) read back unchanged across every
  mode switch, with no reapplication needed, confirmed by a direct
  before/after read on the same nodes across a live mode switch. **This means
  the prototype is fragile in the user's hands, not just at build time**: any
  future editor who binds a semi-transparent *paint* and then previews Dark
  mode will silently lose that opacity; the same editor is safe if they use
  node-level opacity instead. Recommend node-level opacity for any future
  overlay/tint that must survive casual mode-switching.
- **Residual off-token spacing, left unfixed.** `TextField`/`Select`/
  `TextArea` (`02 Components`) carry an internal `itemSpacing: 6` on their own
  label/input/helper stack (18 occurrences across the three component sets'
  variants, inherited by roughly 44 downstream instances across `04`–`07`).
  6px is off the 4·8·12·16·24·32 scale — a real constraint violation — but
  every frame that uses these components has an explicit, screenshot-verified
  pixel height recorded in the plan (Tasks 9–12). Changing the shared
  component's internal spacing would change every one of those heights at
  once and require re-verifying every affected frame; left untouched as
  previously logged in Tasks 9–12, and reconfirmed here rather than fixed.
  Separately, **15 off-token `itemSpacing: 2` gaps found on `01 Foundations`**
  (the colour-swatch `labels` frames) were new, page-local, and safe — fixed
  to `space-4` and reverified (`itemSpacing: 4`, bound to `VariableID:7:7`),
  with no downstream instances affected.
- **`Logo Mark`'s glyph stroke is a named, considered exception — left
  literal on purpose, not by oversight.** Its two vector paths carry a
  literal white stroke (`{r:1,g:1,b:1}`) with no bound variable — 2 hits on
  the source component plus 14 on its nested instances across `07 Auth &
  Settings`, the only residual colour-audit hits in the file. Binding was
  evaluated and rejected: `Logo Mark`'s own fill is bound to `indigo`, and
  `indigo` **does not invert** between modes (`4:0` `{0.24,0.36,0.86}` vs
  `4:1` `{0.36,0.48,0.98}` — both a medium-bright saturated blue), so a
  literal white glyph reads correctly against it in both themes already.
  Both candidate tokens **do** invert and would each break one mode: `ink`
  goes near-black in Light (`{0.11,0.10,0.09}`) — muddy, low-contrast against
  indigo, precisely where the mark needs to be crisp — and `card` goes
  near-black in Dark (`{0.10,0.10,0.10}`) for the same reason in the other
  direction. Binding to either token trades a mark that is correct in both
  themes today for one that is correct in only one. Left literal; recorded
  here as the exception rather than silently passed over.
- **No no-`propose`-scope onboarding state was built; recorded here rather
  than built.** The spec requires the spine's step 1 to show the connected
  client's granted scopes, and requires step 3 and the delegate offer to say
  so and point at reconnection when `propose` is missing — the spec calls
  this failure mode "complete silence" and lists it in its Risks table.
  `05 Review` has its equivalent frame (`130:975`, `Desktop — No propose
  scope`); onboarding has none — step 1 shows only `connected · Claude`
  (`I151:277;58:22`, on `Desktop — Spine`, `149:2`) with no scopes listed at
  all. This is a genuine gap against the spec, not a silent omission: it is
  recorded honestly here instead of being built under this fix round.
- **The post-redesign `clay` treatment now differs by page, and the spec's
  own sentence about it is stale.** `06 Onboarding`'s redesign (above) left
  `clay` as only a 2px left rule on the delegate-offer card. But `04 Section
  editor`'s `Desktop — Preferences` (`109:2`) still opens with three large
  `clay-tint` `EmptyState` panels (`109:116`, `109:133`, `109:150`, confirmed
  live) — the same filled-panel pattern the user objected to elsewhere, which
  the colour rule does sanction on `EmptyState` grounds. The Foundations →
  Colour section's sentence "clay tints the onboarding spine, the
  delegate-to-client offer, and empty-state surfaces" is therefore now true
  of only the third clause; the first two describe the pre-redesign
  onboarding, not what is built. Recorded rather than reconciled: reconciling
  it means either reintroducing filled clay panels to onboarding (reversing
  the redesign) or removing them from Preferences' empty states (a
  components-page change out of scope for this fix round).
- **The brief expected `Switch`/`Checkbox` disabled states to use fractional
  opacity; they don't.** Both components render their `Disabled` variants at
  full opacity (`1`) at both paint and node level, using a colour change
  instead. Not a defect — just a correction to a stale expectation, confirmed
  by reading all `Switch` and `Checkbox` variants directly.
- **`Button`'s icon slot holds one unbound paint, and it is harmless.** A
  build note once listed it as an outstanding defect. It is not: the unbound
  white fill belongs to the slot's invisible placeholder, which renders
  nothing, while every swapped-in icon is properly bound. The file's only
  genuine unbound-paint exception is the `Logo Mark` stroke recorded above.
  Noted here because the original claim lived only in a scratch ledger that
  does not survive this branch, so without this line the correction would
  vanish and the stale version is the one people might remember.

## Iteration round 2 — user-directed changes, 2026-08-08

A second review of the built file produced eleven directed changes. They are
recorded here because several of them **supersede sentences written above**, and
because three involved a judgement call that the reader may want to overrule.

### Component additions

- **`Button` gained a `Show label` boolean** (`Show label#275:0`), bound to
  `Label.visible` across all 16 labelled variants. The four `Loading` variants
  have no `Label` layer and are correctly unbound. Setting it `false` yields a
  48×36 icon-only button. **A hidden label disappears from `instance.children`
  entirely** — detect icon-only buttons through `componentProperties`, not by
  looking for an invisible child. That cost one wasted pass.
- **`ProgressBar`** (`276:51`), variants `Step=One…Four` at 25/50/75/100%. It is
  deliberately **not** auto-layout: the `Fill` child uses `SCALE`/`STRETCH`
  constraints so resizing an instance keeps the proportion. Verified at 640
  (→160) and 358 (→90).
- **`InviteCodeField`** (`278:103`), `State=Empty|Partial|Complete|Error`. Cells
  are 32 wide rather than PinField's 40 so that eight of them plus the dash fit
  the 352px auth panel; fill, stroke, 6px radius and 20px SemiBold type are
  taken from `PinField` by measurement, not by guess.
- **`IconChevronDown`** (`289:43`) and **`IconChevronUp`** (`289:45`), built to
  `IconChevron`'s own stroke weight (1.667) and `ROUND` cap.

### The eleven changes

1. **Approve and Reject keep icon + label; Expand does not.** Nine expand
   controls across `Desktop — Inbox`, `Desktop — Inbox row expanded` and
   `Mobile — Inbox` are now icon-only at 48px.
2. **Expand uses a down chevron, not the right-pointing `IconChevron`.** Once
   the label went, direction carried all the meaning, and the spec says the row
   "expands in place". The one row that is already open
   (`Row — Add hobby` on `126:69`, the row followed by a `Row detail —` sibling)
   gets `IconChevronUp`.
3. **Destructive actions are red.** The four observation `Delete` buttons and
   the two Connected-apps `Revoke` buttons moved to `Variant=Critical`. Token-tab
   revoke and `Sign out` were already Critical.
4. **`Forgot password?` moved below the Sign in button** on `Auth — Sign in` and
   `Mobile — Sign in`. It previously sat between the username and password
   fields.
5. **"Use an access token instead" is gone** from Sign in, Sign up and
   Mobile — Sign in. BetterAuth supersedes it.
6. **The invite code is a segmented field** with the dash prerendered, so the
   helper no longer claims the dash is optional to type.
7. **The Server tab leads with MyGist Cloud.** Self-hosting is a one-line hint
   plus a ghost link. The URL field and connection test were not deleted — they
   moved to a new frame, `Settings — Server (custom)` (`281:235`).
8. **The Token tab lists three named tokens** (`Laptop CLI`, `Raycast script`,
   `Home server backup`), each with a masked secret, a grants-and-last-used line,
   Copy and a red Revoke. The create form gained a `Name` field, since tokens are
   now plural and need telling apart.
9. **Connected apps state grants in plain language** — "Can read and propose
   changes to your persona" rather than `persona:read persona:propose` — and
   those lines moved off **Geist Mono**, which was right for a scope string and
   wrong for a sentence.
10. **Onboarding shows a progress bar instead of "Step N of 4".** The bar
    replaces the hairline rather than sitting beside it, so the divider and the
    progress indicator are the same object.
11. **The section editor has breathing space, and the mobile section switcher is
    a dropdown.** See the two subsections below.

### The section editor's spacing was literally zero

Every `Content` column on `04 Section editor` was `VERTICAL gap=0` — measured,
not inferred: title block, eyebrow bands and subsection cards all butted
directly against each other, held apart only by their own borders. Each column
is now grouped, one `Group` frame per eyebrow band (anything before the first
band forms its own group), with **`space-16` inside a group and `space-32`
between groups**, both bound. `Desktop — Preferences` grew 1471 → 1663 and
`Desktop — Profile` 1177 → 1305; the three 1024-tall frames had slack and were
left alone. `Mobile — Preferences` was on a uniform `24` and outside `Body`, so
the first pass skipped it — it now carries the same grouped rhythm.

### The section sheet is now a dropdown

`Mobile 390 — Section sheet` was the inconsistency: the `SectionSelector` bar sat
in its `Open` state while what opened below it was sheet chrome — a grab handle
and a "Sections" title. Both are gone. The panel is renamed `Section dropdown`,
anchored under the selector at `(16, 108)`, 358 wide, `card` ground, `border`
stroke, `radius-l`, and it borrows `Modal`'s elevation so it speaks the same
elevation language. The frame is renamed `Mobile 390 — Section dropdown`. The
scrim stays, because tap-outside-to-dismiss is still the behaviour.

Two Figma traps showed up here and are worth knowing: the panel is itself an
auto-layout frame, so `body.x = 8` was silently ignored and the inset had to come
from **padding**; and the body carried stretch constraints, so resizing the panel
dragged the list from 342 to 310 wide.

### Judgement calls the reader may want to overrule

- **`Reject` was left `Neutral`, not red.** The instruction named delete and
  revoke. Reject discards a suggestion rather than destroying stored data, and
  making it Critical would put a filled red button on every inbox row. Stated
  rather than assumed.
- **`Revoke` is a filled red button, not red text.** This follows the file's own
  precedent (`Sign out`, token revoke) at the cost of two fairly loud buttons in
  a two-row list.
- **Token metadata was shortened to fit.** The first build of the token list
  clipped its own text: the info column had 310px and the strings wanted ~328.
  The grants line is now terse ("Read and propose · last used 2 hours ago")
  while Connected apps, which has more room, keeps the full sentence. Widest row
  now measures 301 of 310 available.

### Audit after the round

Per-page paint audit, instance-opacity repair and gap sweep across the six
touched pages: **zero unbound paints introduced.** The 14 hits on
`07 Auth & Settings` are all instances of the `Logo Mark` glyph stroke already
recorded above as a deliberate exception; the 2 on `02 Components` are its
source. Every off-token gap found (18 + 16 + 3 + 13 + 12) is the same inherited
`6px` `TextField`/`Select`/`TextArea` internal already on record — the new
components and frames added none. All nine pages confirmed in Light.

**The paint-opacity fragility recorded above bit again, exactly as predicted.**
Cloning the `connected` badge produced a solid green pill with invisible text,
because the `Positive` ground is `success` at **0.12 paint opacity** and the
clone came back at `1.0`. It was fixed by a general repair — compare each
instance's ground paint against its main component's and restore the opacity
where the bound colour matches but the opacity has drifted — which found a second
drifted badge on the custom-server frame that had not been noticed. That repair
is worth re-running after any future clone-heavy edit.

### Follow-up: `Link`, because a Ghost Button is not a link

The partner spotted that every text link in the file "seems to be missing an
accompanying icon since they all have a left padding", and pointed at
<https://www.reshaped.so/docs/components/link>. The diagnosis was exactly right
and the cause was a **wrong primitive**, not a missing icon: these affordances
were `Button` instances at `Variant=Ghost`, and `Button` carries `0/16/0/16`
padding. In a left-aligned column that indents the label 16px from the text above
it, which the eye reads as a hole where an icon should be. Visible on
`Settings — Account` ("Add email", "Change password" indented from
`maya@example.com`) and on `Settings — Server` ("Use a custom server" indented
from its own hint line).

**`Link` (`294:67`)** is now a real component, modelled on Reshaped's:

- **Zero padding on all six variants** — that is the whole point of it.
- `Variant=Plain|Underline` × `State=Default|Hover|Disabled`. Type is copied off
  `Button`'s Ghost label by measurement (Geist Regular 14, 155% line height), so
  swapping one for the other changes position and nothing else.
- `Show icon#294:0` (BOOLEAN, default `false`) and `Icon#294:7` (INSTANCE_SWAP),
  representing Reshaped's `icon` prop. No link in the file uses it yet.

**Where each variant is used, and why not just underline everything.** Reshaped
recommends `underline` "to visually differentiate it from the rest of the text" —
advice aimed at a link sitting *inside a sentence*. So:

- **`Underline`** for links inside a sentence. The four auth footers were single
  Ghost buttons whose label was a whole sentence
  ("New to MyGist? Create an account"), which is a modelling error as much as a
  padding one. They are now prose in `muted-fg` plus an underlined `Link` on the
  clickable part only.
- **`Plain`** for the eleven standalone action links on their own row, where the
  indigo already carries the affordance and an underline would read as heavy:
  Add email, Change password (×2 breakpoints each), Use a custom server, Use
  MyGist Cloud instead, Forgot password? (×2), Resend code, Back to sign in (×2),
  Reconnect, and Skip this group (×3).

**What deliberately stayed a Ghost `Button`:** `Copy` in the token rows (it sits
in a cluster with a filled red `Revoke`, so it should read as a button), the nine
icon-only expand controls, and onboarding's `Back` (paired with a Primary
`Continue`). A padded box is correct in a button cluster.

Divergences worth stating: **only `color="primary"` is built** — Reshaped also
offers `critical`, `positive`, `warning` and `inherit`. And **hover inverts the
underline in both directions** (Plain gains one, Underline loses one) because the
palette has no darker indigo to shift to; a colour shift would be the more
conventional choice if a token is added later. A `Link` is 22px tall against the
Ghost Button's 36, which is inherent to an inline text link but is under the 44px
touch-target guidance on the mobile frames.

Re-audited after the swap: `02 Components` still shows only the two `Logo Mark`
strokes, `07 Auth & Settings` only its 14 `Logo Mark` instances (asserted by
predicate, not by reading the list), `06 Onboarding` zero. `Link` added no
unbound paint and no off-token gap, and instance-opacity drift is zero across all
three.

### Follow-up: empty states against a six-point checklist

`EmptyState` was audited against a supplied checklist (icon, heading, description,
primary action, zero-vs-no-results, error variant). It failed four of the six.

**What was actually wrong, measured not assumed:**

- **The card variant had no heading and no icon** — it was a single line of
  `Regular 13` text doing both jobs at once ("Nothing here yet. Add a language, or
  let a client propose one.").
- **Neither variant had any visual.**
- **There was no zero / no-results / error distinction at all** — one `Context`
  axis, nothing else.
- **Both Review empty states had their CTA hidden.** This was invisible to a
  normal read: Figma omits an invisible instance sub-layer from `children` *and*
  from `findAll`, and `getNodeByIdAsync` will not return it either. It only showed
  up in `instance.overrides`, which reported `visible` overridden on
  `I130:400;62:12`. So `Desktop — Empty` had shipped with no next step. Fixed with
  `resetOverrides()`, which was safe here because the component's own copy was
  already identical to the instance's.

**`EmptyState` now has six variants** — `Context=Card|Page` ×
`Kind=Zero|NoResults|Error`:

| | Zero | NoResults | Error |
|---|---|---|---|
| Icon | `IconPlus` | `IconSearch`, `muted-fg` | `IconAlert`, `destructive` |
| Card ground | `clay-tint` | `muted` | `muted` |
| Page disc | `clay-tint` | `border` | `border` |
| Action | creates the first item | `Clear search` / `Clear filters` | `Try again` |

Three new 16×16 icons back this — `IconPlus` (`300:43`), `IconSearch` (`300:45`),
`IconAlert` (`300:48`) — all built to `IconChevron`'s stroke weight (1.667) and
`ROUND` cap, so the set stays coherent and they are reusable in `Button` and
`RailItem` slots.

**Reconciling the checklist with this spec's own rule.** The Review section above
says empty states must never carry "an illustration at card size". Both hold: the
**card** variant gets a 16px icon, which is not an illustration; the **page**
variant gets a 40px tinted disc around the icon, which is the illustration role at
page scale. That is why the two contexts are visually different rather than one
scaled copy.

**Copy now separates heading from description.** The six section-editor card
states name what is missing and then say what belongs there — "No languages yet" /
"The languages you speak, so replies match. A client can propose these too." — 
rather than compressing both into one sentence. Their actions already created the
first item (`Add a language`, not `Go to settings`), which was the one checklist
point the original passed.

**The error copy states that nothing is lost**, because the specific failure the
checklist warns about is a user reading a load error as data loss: "Something went
wrong on our end. Nothing has been lost — try again."

**Two new frames, so these states exist in situ and not only in the library:**

- **`Desktop — Failed to load`** (`306:654`, `05 Review`). Beyond swapping the
  variant it also **blanks the tab counts to `—`** and **removes the keyboard-shortcut
  line**, because counts cannot be known when the fetch failed and shortcuts are
  meaningless with nothing loaded. A variant switch **preserves text overrides**,
  so the zero-state copy had to be rewritten explicitly rather than left to follow
  the variant.
- **`Desktop — List search no results`** (`307:636`, `04 Section editor`). Carries
  a real query ("brack") in a `Filled` search field with "Searching 14 entries."
  as its helper, so the no-results state has something to be the result *of*. The
  escape route is `Clear search`.

**Deliberate gaps, stated rather than hidden:**

- **`Desktop — No propose scope` keeps its CTA hidden.** Its emptiness is caused
  by a missing scope, and the fix — `Reconnect` — already sits on the frame in the
  Scope notice. A second button telling the reader to copy a prompt would be
  actively wrong there, since the spec notes a read-only connection makes the
  pasted prompt do nothing.
- **`Context=Page, Kind=NoResults` is a library variant with no screen using it.**
  Review has tabs, not filters, so there is nowhere for a page-level no-results
  state to live until a filter UI exists. Built for completeness against the
  checklist; its copy assumes a filter.
- **No mobile frame for either no-results or error.** Both new frames are 1440
  only.
- The icon disc's `cornerRadius` is a literal `20` — a full-round shape on a 40px
  square, not a radius-token decision.

Re-audited: `02 Components` still only the two `Logo Mark` strokes, `04` and `05`
zero unbound, zero opacity drift on all three, and every off-token gap remains the
inherited `6px` field internal.
