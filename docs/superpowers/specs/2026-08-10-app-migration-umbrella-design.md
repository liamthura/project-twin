# App Migration — Umbrella Design

**Status:** shared contracts fixed; five child specs to follow.

**Deliverable:** this document, then one child spec per slice. No `frontend/`
file changes are authorised by this spec alone — it exists to stop five child
specs from each inventing an answer to the same four questions.

## Why

`docs/superpowers/specs/2026-08-04-mygist-app-reshaped-design.md` designed the
app and shipped a Figma prototype (`Ti7FlZLYOvX3goyvfypJBk`). Both it and the
phase 2 spec list **the code migration** as out of scope, and everything else
that was parked is now either shipped or explicitly ruled off. The migration is
what is left.

One earlier ruling shrinks it usefully. The phase 2 decisions table says
**"Keep shadcn/Radix/Tailwind. Reshaped is not adopted."** So this is not a
primitive swap; it is implementing the prototype's structure in the stack the
app already has.

The work spans five subsystems and cannot be one spec. But four questions are
read by every slice, and answering them per-slice guarantees they disagree:

1. How is a subsection addressed?
2. Where does the rail's sub-item list come from, and who owns the anchors?
3. What are the motion primitives?
4. What does "done" mean, when nothing automated compares the app to the
   prototype?

This document answers those four, records the sequencing consequences of
landing slice by slice, and corrects the stale instructions in the design spec.

## Decisions taken

| Question | Ruling |
|---|---|
| One spec or five | **Umbrella spec first**, fixing shared contracts; per-slice detail deferred to child specs |
| Subsection in the URL | **Yes, two segments.** `#/<section>/<band>`. Rail clicks `pushState`, scroll-spy `replaceState` |
| Band identity | **Slug of the title**, with a deterministic `-2` suffix on collision. Fails loudly: an unknown band bounces to the section root |
| Anchor ownership | **Manifest-derived.** A pure `outline(pack)` in `paths.js`; rail and editor both derive from it |
| How it lands | **Slice by slice to `main`.** Every merge leaves the app shippable and the suite green |
| Fidelity verification | **Per-slice checklist naming Figma node IDs**, checked in the Docker preview. No new tooling |
| Motion off-scale values | **Snap to the four tokens** by direction: exits take the shorter token, entrances the longer |
| Reshaped | **Not adopted** (carried from phase 2). `input-otp` stays |

## Decomposition

Five child specs, in dependency order.

| # | Child spec | Carries |
|---|---|---|
| 1 | **Shell & navigation** | Header (save-state chip, theme, account); 240px rail, two levels, scroll-spy; mobile `Section ▾` sheet; two-segment routing; `outline()`; motion tokens. Deletes `useEdgeFade` and the horizontal tab strip |
| 2 | **Section editor** | Eyebrow bands, one card per subsection, the two-tier cap, save feedback |
| 3 | **Review** | `ProposalsPanel` structure, Promote dialog, keyboard, empty state, approve/reject exit |
| 4 | **Onboarding** | The spine; step 2 as a rail destination; step 3 |
| 5 | **Auth & settings** | `AuthShell` three states, `InviteGate` segmented field, `ResetPassword` match hint, `ConnectionSettings` modal with tabs, `ConnectedApps` plain-language grants, `Consent` with a neutral Deny |

**Slice 5 shipped as two specs**, split at the owner's direction because the row
above covers seven components across two surfaces that share almost no code:
`2026-08-14-settings-slice-design.md` (the dialog) and
`2026-08-14-auth-slice-design.md` (the screens shown without a credential). It
was the last slice of the umbrella.

Two of that row's items turned out to be already built when 5b was scoped —
`InviteGate`'s segmented field and `Consent`'s plain language and neutral Deny.
The row was written from the prototype rather than against the code.

**Motion is not a slice.** Its tokens are defined once in slice 1; each slice
implements its own named motions against them.

Slice 1 is first because it is where every shared contract becomes real code:
the routing model, `outline()`, the observer, and the motion tokens. Doing it
second means designing the scroll-spy contract twice — once provisionally, then
again. It is also the heaviest slice (`App.jsx` is 872 lines), which is a reason
to take it while the prototype is fresh rather than last.

### The two footholds slice 1 carries

"Every merge ships" forces slice 1 to reach slightly into files later slices
own. Both were ruled in, deliberately:

**The autosave preference.** Slice 1 removes the switch from the header, and
slice 5 owns its destination (Connection Settings → Account). Between them the
preference would be homeless, and `isAutosaveEnabled` (`frontend/src/App.jsx:186`)
is real state a tester can currently turn off. So slice 1 inserts the
preference row into Connection Settings → Account as part of the same change.
Slice 5 later restyles it; it does not introduce it.

**Anchor ids on today's headings.** Slice 1's rail derives sub-items from
`outline()` and renders the marker, but `data-band` is stamped by slice 2's
bands. Merging slice 1 alone would give a rail that lists subsections with
nothing to scroll to — worse than today's working tab strip. Today's
`SectionRenderer` already renders group headings through `NodeHeading` at
`depth` (`frontend/src/renderers/SectionRenderer.jsx:230`), so slice 1 stamps
ids on the existing depth-1 heading wrappers. Slice 2 then restructures the
content beneath them without touching the contract.

---

## Contract 1 — Routing

`frontend/src/lib/routes.js` is a deliberate hash router, and its own header
explains why: the app is a static bundle served from one origin, so `#/profile`
needs no server-side fallback rule duplicated across FastAPI, the Dockerfile's
static mount, and anything placed in front of it. That promise is kept.

### Grammar

```
#/<section>                 a section, no band selected
#/<section>/<band>          a band within a section
#/signin | signup | forgot  auth screens, single segment, never coexisting
```

`<section>` is an enabled pack key, or `review`, or `sections`.
`<band>` is an id from `outline(pack)`.

### Validation

Ordered, and every correction uses `replaceState` — which is exactly what
`routes.js` reserves `replace` for ("corrections nobody navigated to"):

| Input | Result |
|---|---|
| Unknown or disabled `<section>` | `replaceState` to `#/profile` |
| Valid section, unknown `<band>` | `replaceState` to `#/<section>` — visible, and the rail marks nothing |
| Valid section, no band | Section renders from the top; the marker resolves on first scroll |

### Writes

| Trigger | Method | Why |
|---|---|---|
| Rail item or sub-item click | `pushState` | A deliberate move. Back walks the clicks you made |
| Scroll-spy resolves a new band | `replaceState` | A position you scrolled to, not a place you navigated to. Invisible to Back |
| Validation correction | `replaceState` | Never a history entry |

Scroll-spy writes **only when the resolved band id changes**, not on every
observer callback.

**Back, after scrolling.** Because spy writes replace and clicks push, Back
returns to the last band you *clicked* — not the one you had scrolled to — and
the shell scrolls there. That is the intended reading of "Back walks the clicks
you made", and it is stated here so a child spec does not read it as a bug.

### Code shape

`goToRoute(route, { replace })` needs **no change**: it interpolates `route`
into `#/${route}` and compares against `readRoute()`, both of which already
tolerate a slash. What is added is a parser:

```js
// routes.js — pure
export function parseRoute(raw) // → { section: string, band: string | null }
```

`readRoute()` keeps its current contract (the raw string after `#/`) so the auth
screens are untouched.

## Contract 2 — The outline

### A rail sub-item is a top-level child of the section, whatever its kind

This was derived from the manifests, not assumed. `group` nodes carry
`path: []` — no path at all — and the design spec's example rail under
Preferences lists *Code Style, Communication, Learning Style, Likes &
Dislikes*. In `backend/section_packs/preferences/manifest.json` the first three
are `group` nodes and the fourth is a top-level `list`. So the level is not
"groups"; it is top-level children.

Checked across packs:

| Pack | Rail sub-items |
|---|---|
| `preferences` | Code Style, Communication, Learning Style, Likes & Dislikes |
| `profile` | Personal Information, Education, Work Experience, Contact & Links, Languages |
| `lifestyle` | Hobbies & Activities, Interests, Personality Traits, Values, Wellness |
| `knowledge` | Skills & Domains, Mental Tabs |
| `learning_log` | **none** — its single child is untitled, and the Card's own header already names it |

A `group` renders as an eyebrow band with its titled cards beneath. A top-level
`list` / `strings` / `fields` renders as its own band. A rail item whose section
has no titled top-level children simply has no children — which is what the app
does today.

### Signature

In `frontend/src/renderers/paths.js`, which states its own contract as "no
React import, no DOM access, no side effects" — an outline derivation is pure
and belongs there. Built on the existing `normalizeUi(pack)`.

```js
export function outline(pack) // → [{ id, label, kind, index }]
```

- One entry per **top-level** child of `normalizeUi(pack).sections`.
- Children with no `title` are **omitted**.
- `index` is the child's position in the unfiltered `sections` array. It is for
  ordering and diagnostics — **not identity**.
- `id` is the slug of `label`.

This is the only place band ids are derived. The rail reads it; the editor
stamps `data-band={id}` from it; the shell's observer looks for
`[data-band]`. They cannot disagree, and a test asserts that the ids the editor
stamps are exactly the ids `outline()` returns.

### Slugify

Total, deterministic, and defined here so two slices cannot implement it twice:

1. Normalise (NFKD) and strip diacritics.
2. Lowercase.
3. Remove `'` and `’`.
4. Replace every run of non-`[a-z0-9]` with a single `-`.
5. Trim leading and trailing `-`.
6. If the result is empty, fall back to `band-<index>`.

| Title | Id |
|---|---|
| `Code Style` | `code-style` |
| `Contact & Links` | `contact-links` |
| `Skills & Domains` | `skills-domains` |
| `Sleep — weekdays` | `sleep-weekdays` |
| `When I'm feeling...` | `when-im-feeling` |

**Collisions:** iterating in order, the first occurrence keeps the bare slug;
each subsequent one takes `-2`, `-3`, and so on. Deterministic, so the same
manifest always yields the same ids.

**Accepted cost:** renaming a group changes its URL. For a pre-release,
invite-only app with no external links, a visible bounce to the section root is
the better failure — a sibling index would instead point silently at the wrong
band after any manifest reorder.

## Contract 3 — Scroll-spy

One `IntersectionObserver`, owned by the shell, observing `[data-band]`.

- **Root margin** starts at `-60px 0px -60% 0px`: a band becomes eligible once
  it clears the 60px sticky header, and stops being current once it leaves the
  top 40% of the viewport. This is a starting value, tuned in the preview and
  recorded in slice 1's fidelity checklist.
- **Current band** = among intersecting entries, the one with the smallest
  `boundingClientRect.top`.
- **Anchors** carry `scroll-margin-top: 60px` so a click leaves the heading
  clear of the header.
- **The marker** slides 200ms `standard` between sub-items. The design spec
  calls this the highest-value animation in the design: it is what makes a
  two-level rail read as one continuous place rather than a list of links.
- **On resolve**, the shell `replaceState`s the band into the URL, only on
  change.

**Cold load ordering.** `outline(pack)` is derived from the manifest, which
arrives with `packs` from `/settings` (`frontend/src/App.jsx:410`) — the same
object handed to `SectionRenderer` as `pack` (`frontend/src/App.jsx:777`). So on
a deep link the rail renders complete and correctly marked **before any content
mounts**. The scroll itself waits for the band to exist: the shell scrolls to the
URL's band once that `[data-band]` element is first observed, then hands over to
the spy. This ordering is why the outline is manifest-derived rather than
registered by the bands themselves — a registration-based contract has an empty
rail until content mounts, which is exactly the cold-deep-link case.

## Contract 4 — Motion tokens

Four durations and four easings, defined once in `frontend/src/globals.css` as
custom properties and exposed through `tailwind.config.js`
(`theme.extend.transitionDuration` and `transitionTimingFunction`) so
`duration-medium ease-standard` are real classes.

```
--duration-fast     120ms   press, hover, focus ring, switch, checkbox, exits
--duration-medium   200ms   state change, tab indicator, spy marker, entrances
--duration-slow     280ms   card expand, sheet, modal in
--duration-scroll   400ms   distance-scaled smooth scroll, ceiling

--ease-decelerate   cubic-bezier(0, 0, .2, 1)     entrances
--ease-accelerate   cubic-bezier(.4, 0, 1, 1)     exits
--ease-standard     cubic-bezier(.4, 0, .2, 1)    on-screen moves and resizes
--ease-emphasized   cubic-bezier(.2, 0, 0, 1)     sheet, modal
```

### The snap rule

The design spec's named motions use **160ms** and **240ms**, neither of which is
on the scale, and both are exactly 40ms from two tokens — so "nearest" has no
answer. The rule resolves it by direction:

> An off-scale duration snaps to the **shorter** token if it is an exit, the
> **longer** token if it is an entrance.

| Named motion | Spec said | Token |
|---|---|---|
| Chips in | 160ms | `medium` 200 |
| Chips out | 120ms | `fast` 120 |
| Save tick fade-in | 160ms | `medium` 200 |
| Modal scale-in | 240ms | `slow` 280 |
| Modal exit | 160ms | `fast` 120 |
| Approve / reject row exit | 240ms | `medium` 200 |

The rule is stated rather than the results alone, so a future component resolves
its own off-scale value instead of copying the nearest hardcoded number.

Non-transition durations are unaffected and stay as specified: the save tick's
1.2s hold, and the 1.4s skeleton shimmer loop.

### Reduced motion

`prefers-reduced-motion: reduce` collapses every duration to 0 except opacity
fades, which cap at 100ms. Smooth scroll becomes an instant jump. Shimmer
becomes a static faded block. Implemented in the same `globals.css` block that
defines the tokens, so no component opts in individually.

## Corrections to the design spec

The no-Reshaped ruling leaves stale instructions in
`2026-08-04-mygist-app-reshaped-design.md`. It mentioned Reshaped 23 times
before this round, but only four were component-level instructions, and one has
teeth:

| Section | Says | Reads as |
|---|---|---|
| Auth, settings, consent | "OTP moves to Reshaped `PinField`, removing the `input-otp` dependency" | **`input-otp` stays.** The dependency removal is cancelled, and so are the three jsdom workarounds it would have retired |
| Review → Structure | "Reshaped `Tabs` carrying counts" | shadcn `Tabs` carrying counts — the component already at `frontend/src/components/ui/tabs.jsx` |
| Decisions taken → Theme | MyGist tokens into Reshaped's `ThemeDefinition` | No code consequence; `frontend/src/globals.css` is the theme |
| Follow-up: `Link` | a variant representing Reshaped's `icon` prop | Figma-only note; the component's properties are unaffected |

All four are corrected in place in that spec, in the same commit as this one, so
no child spec trips on them. They are referenced by section rather than line
number because annotating them shifted the line numbers.

## Landing strategy

Slice by slice to `main`, each on its own short-lived branch:

```
main ──┬─ shell ──┬─ editor ──┬─ review ──┬─ onboarding ──┬─ settings
       merge      merge       merge       merge           merge
```

Every merge must leave the app **shippable and the suite green**. Testers will
see a mixed old/new app for roughly four slices; that is accepted, and the app
is in invite-only testing with a small known audience. The two footholds above
exist precisely so no merge ships a knowingly-degraded state.

No long-lived branch (it would diverge from a moving `main` and produce one
enormous final review) and no feature flag (two shells maintained at once would
roughly double the section-editor slice).

## Verification and the fidelity checklist

Nothing automated compares the app to the prototype, and this spec does not
build that. Storybook is configured but has **one** story file
(`frontend/src/renderers/SectionRenderer.stories.jsx`) holding **two** stories,
`Populated` and `Empty` — for `SectionRenderer`, the component that already has
180 unit tests.

**Correction, measured 2026-08-10.** Every prior spec says this project cannot
run because Playwright is unavailable locally. That is no longer true: chromium
is present in `~/Library/Caches/ms-playwright`, `npm test -- --project storybook`
passes 2 tests in ~2.2s, and bare `npm test` passes **31 files / 661 tests in
13.4s**. The rule "never run bare `npm test`" is retired — it costs about 3
seconds over `--project unit` and covers two more tests.

So fidelity is verified by a checklist, per slice:

```
npm test -- --project unit      structure and behaviour
node design/app-contrast.mjs    colour pairs, exits 0
fidelity checklist              every visual property, against a Figma node ID
Docker preview                  owner signs off
```

Each child spec ends with a table in this shape. Every row names the Figma node
the value comes from, so the review works from a list rather than a memory of
the prototype:

| Property | Value | Figma node | ✓ |
|---|---|---|---|
| Rail width | 240px | `03 Shell & Navigation` (page `1:4`) | |
| Header height | 60px | `03 Shell & Navigation` | |
| Spy marker | 2px, `indigo`, slides 200ms `standard` | `08 Motion` (page `1:9`) | |
| Band label | mono, `caption-2`, faded | `04 Section editor` (page `1:5`) | |

Node IDs are resolved when each child spec is written, not guessed here.

## Testing

### Two jsdom facts that constrain slice 1

**The `IntersectionObserver` stub reports everything as intersecting.**
`frontend/src/test/setup.js` stubs it so `observe(target)` immediately fires
`isIntersecting: true`. That is deliberate and correct for its current consumer
— Magic UI's blur-fade on the landing page, where content behind a scroll
entrance must be present and assertable.

It is wrong for scroll-spy: every band would report intersecting at once, so
"the topmost intersecting band" resolves to whichever entry the loop happens to
hit, and a spy test would pass without proving anything. That is the failure
mode the file's own comment warns about. **Slice 1 introduces a controllable
observer** — one a test can drive to say *band X is intersecting, the others are
not* — without changing the always-intersecting default that six landing test
files depend on.

**`matchMedia` does not exist in jsdom, and the fallback is desktop.**
`useMediaQuery(query, fallback = true)` defaults to the desktop answer on
purpose, so existing tests keep asserting the controls they always did
(`frontend/src/lib/useMediaQuery.js`). Consequences:

- The mobile `Section ▾` sheet is invisible to unit tests unless a file stubs
  `matchMedia`. Three files already do, three different ways: `App.test.jsx`,
  `landing/Landing.test.jsx`, `landing/gate.test.jsx`.
- The reduced-motion collapse reads the same API, so it has the same problem.

Slice 1 puts one stub helper in `frontend/src/test/harness.jsx`, which already
exists for shared test scaffolding, rather than adding a fourth hand-rolled
copy.

### What unit tests can and cannot prove

| Provable | Not provable |
|---|---|
| `outline()` against real manifest fixtures | that the marker is 2px indigo |
| Slugify, including collisions and the empty fallback | that the rail is 240px |
| Route grammar: parse, validate, bounce an unknown band | that the marker *slides* rather than cuts |
| Rail sub-items render from `outline()`, in order | scroll-spy accuracy against real layout |
| `data-band` ids exactly match `outline()` ids | that bands read as bands |
| Observer wired to the right targets and root margin | |
| A rail click pushes; a spy resolve replaces | |
| Reduced motion collapses durations | |

The right-hand column is what the fidelity checklist and the preview are for.

Test command is `npm test -- --project unit` from `frontend/` for the fast loop
(10.6s). Bare `npm test` also works and is the honest pre-merge check — 661
tests in 13.4s, including the two Storybook stories. See the correction under
Verification: the old "Playwright is unavailable locally" constraint no longer
holds.

**Three files run without jsdom** (`paths.test.js`, `listPipeline.test.js`,
`fieldMeta.test.js`), via a `// @vitest-environment node` docblock. Their
subjects import nothing or import only constants, and a jsdom environment cost
~700ms each against 4–19ms of actual test time. Measured effect on the whole
suite: environment setup 20.9s → 18.6s summed, CPU 50.2s → 48.9s. Wall clock on
8 cores is unchanged within noise; the saving lands on a 2-core CI runner, where
CPU is the binding constraint. **A file that renders anything must not carry that
docblock** — and the two `session` test files deliberately do not, because the
password-reset path they exercise calls `resetCallbackUrl()`, which reads
`window.location.origin`.

## Out of scope

- **Reshaped adoption.** Ruled in phase 2 and not reopened. `input-otp` stays.
- **Manifest format changes.** Band ids are slugs precisely because adding an
  explicit `id` to the 11 manifests and `meta_schema.json` is out of scope. If
  that boundary is ever lifted, an explicit id is the better identity and this
  contract should be revisited.
- **Backend changes.** None required by any slice.
- **Visual regression tooling.** No Playwright, no pixel snapshots. Fidelity is
  a checklist against Figma node IDs.
- **The landing page.** Untouched, but its tests constrain the observer stub —
  see Testing.
- **Persisting sort, or sorting by anything but a date.** Carried from phase 2.
- **The 40 detached prototype nodes.** A recorded cost of the Plugin API, not a
  migration item.

## Risks

| Risk | Mitigation |
|---|---|
| A child spec re-answers a shared contract | The four contracts are stated here with signatures and validation tables; each child spec cites this file rather than restating it |
| Band ids drift between rail and editor | One derivation in `paths.js`, and a test asserting the stamped ids are exactly `outline()`'s |
| Renaming a group breaks a bookmark | Accepted, and it fails loudly — unknown band bounces to the section root. The alternative fails silently |
| The observer stub silently makes spy tests meaningless | Called out above as slice 1 work, with the landing-page default preserved |
| A mixed old/new app confuses testers | Invite-only audience; the two footholds keep every merge coherent rather than knowingly degraded |
| `App.jsx` is 872 lines and slice 1 is the heaviest | Slice 1's child spec decomposes it explicitly; the shell, rail and spy become separate files rather than more of `App.jsx` |
| The snap rule retimes motions the owner chose deliberately | The rule and all six results are tabled above, so an overrule is a one-line change to a table rather than an archaeology exercise |
| Root margin tuned by eye | Recorded as a value in slice 1's fidelity checklist, not left implicit in a component |
