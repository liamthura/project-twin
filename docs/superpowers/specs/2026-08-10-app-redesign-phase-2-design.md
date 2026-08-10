# App Redesign Phase 2 — Closing Out Ruling 1 and the Design Leftovers

## Why

Phase 0 reconciled the Figma prototype's foundations with `main`'s token layer;
Phase 1 fixed the code defects the design round surfaced. Both landed
(`4d53b82`, `design/app-redesign-phase-2`). What is left is a short list of
items the rounds deliberately parked, plus two consequences of Phase 1's own
`--input` ruling that nothing in the repo measured.

The parked items were already written down — `design/app-contrast-audit.md`
records the Neutral button's edge as "**Not fixed, not exempt — undecided**",
and the reshaped-design spec lists the icon-stroke sweep and the sort control
under "Not built, stated rather than hidden". The two new ones were found by
reading every consumer of `--input` before starting work, which is the step
that should have followed the ruling and did not.

**Code migration is still out of scope.** Bringing the prototype into
`frontend/` remains a separate project, to be decomposed along the prototype's
own page structure. One ruling relevant to it was taken during this round's
scoping and is recorded under "Decisions taken" so the migration spec does not
have to relitigate it.

## Decisions taken

| # | Question | Ruling |
|---|---|---|
| 1 | The Switch's off track, now that `--input` is a control-boundary token | Off becomes `border-input bg-muted-foreground/25`, hover `/40` |
| 2 | The landing page's FAQ outline button, whose border darkened with the app's | Accepted as-is; `1.4.11` applies on the marketing page too |
| 3 | Figma's `Button` `Variant=Neutral`, still binding `border` at 1.26 | Rebind 4 states to `input`; leave `State=Disabled` on `border` |
| 4 | Icon strokes reading `indigo` where text reads `link` | Sweep the overrides, not the main component (see below) |
| 5 | A user-facing sort control | **Build it**, date fields only — `Newest` / `Oldest` |
| 6 | Where the entry count sits for a `searchable` node | No change; the reason is now recorded |
| 7 | The calculator that missed items 1 and 2 | Teach it fills, and grounds beyond `card`/`paper` |
| — | Reshaped npm vs the existing stack, for the later migration | **Keep shadcn/Radix/Tailwind.** Reshaped is not adopted |

Ruling 5 overruled a recommendation not to build. The last row is not phase 2
work at all; it is recorded here because the question was settled here.

## The two unmeasured consequences of ruling 1

Ruling 1 moved `--input` off the value it shared with `--border`: `20 6% 90%`
→ `20 6% 57%` Light, `60 2% 16%` → `60 2% 40%` Dark. `design/app-contrast.mjs`
verified the pair it was ruled for — a field boundary against `card` — and
reported "All pairs pass." That was true and also incomplete: the script models
one token, as a border, against one ground.

`--input` has **nine consumers** in `frontend/src`. Seven are borders on
genuine controls, moved correctly, and need nothing: `input.jsx:9`,
`textarea.jsx:8`, `select.jsx:14`, `input-otp.jsx:51`,
`ProposalsPanel.jsx:201`, and the two suggestion chips at
`ListRenderer.jsx:323` and `AddEntryDialog.jsx:115`.

The remaining two are the subject of this section. One binds the token to the
wrong kind of property; the other binds it correctly but on a surface nobody
re-reviewed.

### The Switch uses it as a fill

`switch.jsx:28` reads `border-border bg-input hover:bg-muted-foreground/20`.
The token is the **track fill**, not a border, and the comment above it
justifies the choice as *"the token every field border already uses"* — an
assumption ruling 1 invalidated. The off track went from 90% to 57% lightness
in Light and 16% to 40% in Dark, so **Off now carries more visual weight than
On**, inverting the one thing a switch exists to communicate.

The same line has a second defect that predates ruling 1: the switch's outer
boundary binds `border`, measuring 1.26 / 1.21. A switch is a control and its
extent is exactly what 1.4.11 asks to be identifiable. Until now the dark
`bg-input` fill was doing that work; lightening the fill without moving the
boundary would leave the control harder to find than before.

**Both layers move, each to the token that matches its job:**

```
- : "border-border bg-input hover:bg-muted-foreground/20",
+ : "border-input bg-muted-foreground/25 hover:bg-muted-foreground/40",
```

Measured, and recorded because two of the three numbers are uncomfortable:

| Pair | Light | Dark | Reading |
|---|---|---|---|
| boundary `input` / `card` | 3.16 | 3.11 | passes 1.4.11 — this is the fix |
| off track / `card` | 1.39 | 1.59 | the track is deliberately quiet |
| off track / on track | 3.98 | **2.38** | below 3:1 in Dark |
| knob (white) / off track | **1.39** | 10.97 | near-invisible in Light |

The first and last rows read 1.39 in Light for the same reason rather than by
coincidence: the knob is white and so is `card`, so "track against the card"
and "knob against the track" are the same measurement there.

The last two are accepted, not overlooked:

- **Dark's 2.38 between off and on** is below the 3:1 that 1.4.11 asks of
  states. It is accepted because a switch does not convey state by colour: the
  knob's **position** is the primary cue, and position is not a colour signal.
  The track's tone reinforces it and is not the sole carrier.
- **Light's 1.39 between the white knob and a near-white track** means the knob
  reads by its shadow and by the new `border-input` ring around the track, not
  by fill contrast. `switch.jsx` already gives the knob a shadow for exactly
  this reason — *"the thumb carries a shadow so it reads as a raised object"* —
  and this is how a light-mode switch conventionally looks.

Hover is `/40` rather than `/35` because `/35` measures **1.16** against the
off state, which is not a perceptible change. `/40` gives 1.26 / 1.37 — subtle,
as a hover tint should be, but visible.

### The landing page inherited it

`Faq.jsx:136` renders the non-primary CTA as `variant="outline"`, which binds
`border-input`. That button sits inside a `ContactCard` whose own hairline is
`border-border`, so the button's edge is now visibly darker than the card
containing it — a change to a signed-off marketing design that no review saw.

**Accepted.** The button is a real control, so 1.4.11 applies to it on the
marketing page exactly as it does in the app. Pinning it back to
`border-border` would reintroduce the same 1.26 failure ruling 1 rejected, one
page across. What is owed is the record: `design/contrast-audit.md` still
assumes `--input` and `--border` share a value, and must stop implying it.

**The waitlist form is not affected.** `WaitlistForm` uses the shared `Input`,
but passes `border-0` (`WaitlistForm.jsx:129`) because the surrounding pill
owns the border and the focus ring. Verified rather than assumed, since it was
the consumer most likely to be hurt.

## Item 3 — Figma's Neutral button

`Button`'s `Variant=Neutral` binds `border` on its stroke across all five
states, over a `card` fill, measuring **1.26 / 1.21**. The code made this
decision long ago and made it correctly: the `outline` variant
(`button.jsx:13`) binds `border-input`, so it moved with ruling 1 and now
measures 3.16 against `card` and 3.03 against `background`. **The prototype is
the thing out of step, not the shipping app.**

Rebind the stroke from `border` to `input` (`VariableID:348:59`) on four
variants, leaving the fifth:

| Node | Variant | Action |
|---|---|---|
| `56:10` | `State=Default` | rebind → `input` |
| `56:12` | `State=Hover` | rebind → `input` |
| `56:14` | `State=Pressed` | rebind → `input` |
| `56:18` | `State=Loading` | rebind → `input` |
| `56:16` | `State=Disabled` | **leave on `border`** |

Disabled stays put for the reason the 48 field strokes did: 1.4.11 exempts
inactive components, and a muted edge is the intended reading.

## Item 4 — the icon-stroke sweep, correctly scoped

`design/app-contrast-audit.md` records this as *"icon vector strokes in `02
Components` were left bound to `indigo` rather than rebound to `link`"*, and
the obvious reading — fix the icon component — is **wrong**. Verified against
the file:

- `IconProfile` (`220:30`) binds both its vectors (`220:28`, `220:29`) to
  **`ink`**, which is correct and must not change. Rebinding the main component
  would recolour every icon in the file, including inactive rail rows.
- The eight `indigo` readings are **instance-level override paints** on four
  `RailItem` active-state variants: `75:51` (`State=Active, Badge=None`),
  `75:52` (`State=Active, Badge=Count`), `75:53` (`State=Active Expanded,
  Badge=None`) and `75:54` (`State=Active Expanded, Badge=Count`), all within
  the `RailItem` set (`75:55`).

So the sweep is 8 override paints on 4 variants — the active rail row's icon,
which should read `link` alongside the row's label. Cosmetic in Light, where
`indigo` and `link` are the same value, and marginal in Dark.

## Item 5 — the sort control

Ruled: **build it, date fields only.**

### What the schema permits, and what it forbids

`meta_schema.json` calls `sort` *"Display order only. Rows are sorted by this
storage key; the stored array is never reordered."* An entity's `actions` enum
is exactly `add | update | remove`, so hand-reordering has no write that could
persist it and is not in question. A **display** sort control writes nothing,
which is what makes it cheap.

### The invariant that makes it cheap

`ListRenderer.jsx:170` calls `buildOrder(items, node.sort)`, and `buildOrder`
sorts **stored indexes**, never the array — deliberately, so `updateItem` and
`removeItem` keep addressing real stored positions. `filterVisible` and
`applyFacets` preserve that contract, and `expanded` is keyed by stored index
too. **Changing the display order therefore cannot desynchronise expansion
state**, which is the risk that would otherwise make this feature expensive.

The whole engine change is that one call site:

```js
- const order = buildOrder(items, node.sort);
+ const order = buildOrder(items, sortOverride ?? node.sort);
```

### When the control appears

A list node offers it when `display_formats` marks one of its `display_fields`
as `datetime` or `date`. Today that is **exactly one node**:
`learning_log/entries` (`display_fields: ["timestamp"]`,
`display_formats: {timestamp: "datetime"}`, `sort: {field: "timestamp", dir:
"desc"}`).

The rule is deliberately sourced from `display_formats` rather than from any
key that looks like a date, which excludes `knowledge`'s `created_at`. The
`knowledge` manifest records why that field must not be rendered or sorted:
its two write paths disagree, one producing local time labelled UTC and the
other real UTC, *"so any rendering of it would be wrong by the local offset
for whichever half of the entries came from the other path."* A sort control
that guessed at date-like keys would have found it.

### Behaviour

- Two options, `Newest` and `Oldest`, on the qualifying field.
- The default is the node's declared direction, so `learning_log/entries` opens
  on `Newest` exactly as it does today. Adding the control changes no node's
  initial order.
- Rendered as a `Select` with a visible `Sort` label, in the count/facet row
  (`ListRenderer.jsx:264`), after the facets — order and filter feedback in one
  row, beside the count that reflects them.
- **Not persisted.** It is display state, so it needs no storage key and adds
  nothing to the storage-keys reference.
- Missing and blank dates keep `buildOrder`'s existing behaviour: they sort
  last in **both** directions, because an undated row is unknown rather than
  oldest.

### The copy this makes false

The prototype's `Desktop — Sort` frame states *"Newest first — this order is
set by the section, not by you."* Building the control makes that a lie. The
frame gains the control and the caption is rewritten; the reshaped-design
spec's matching passages — the `Desktop — Sort` section and the "Not built"
entry reading *"A user-facing sort control. See above — real but new"* — are
updated to record the ruling.

## Item 6 — the count row, closed

Recorded as a deferred minor: *"the count row sits below the search box for
`searchable` nodes."* Closed as **no change**, with the reason written down so
it stops being re-asked.

`ListRenderer.jsx:264` already places the count beside the facet controls,
which is what the prototype's `Desktop — Filters active` frame shows. The only
difference is the search box rendering above that row, and feedback belonging
*after* the control that changes it is correct — the count is the answer to
both the query and the facets, so it sits below both.

## Item 7 — the calculator

`design/app-contrast.mjs` is a good script that missed two real defects,
because of what it cannot express, not because of a bug:

1. Every pair is a **foreground against a ground**. A token used as a *fill*
   has no way to be measured as one, so `bg-input` on the Switch was invisible
   to it.
2. Grounds are drawn from an app-only table. The landing page's surfaces —
   `ground-inverse` above all — are not in it, so a token shared between the
   two surfaces is only ever checked on one of them.

Both are addressed by extending the table and the pair list, not by rewriting
the script:

- Pairs may name a **role** (`boundary`, `fill`, `text`), so a fill is reported
  as a fill and a reader can see which layer is being measured.
- The ground set gains the landing surfaces already defined in `globals.css`,
  including `ground-inverse`, which does not invert between modes.
- New pairs, at minimum: the Switch's boundary and its off/on tracks, the
  outline button's edge on `card` and on `paper`, and the suggestion chips.

`KNOWN_FAILURES` stays as it is — an empty, reasoned exemption list — and the
Dark off/on track figure of 2.38 is recorded there **only if** the extended
script reports it as a failure, with the knob-position reasoning above as its
stated reason. It is not added pre-emptively.

## Out of scope

- **The code migration.** Unchanged from the reshaped-design spec: no reshaping
  of `frontend/` here. Decomposition and sequencing are its own spec's problem.
- **Persisting sort, or sorting by anything but a date.** The ruling was "just
  the date sort for now". Title and enum orders are not built and not designed.
- **Hand-reordering entries.** No write can persist it.
- **Re-auditing the landing page.** Its one affected control is ruled on here;
  a full re-run of `design/contrast-audit.md` against the new token is not part
  of this round.
- **The 40 detached prototype nodes.** A known, recorded cost of the Plugin
  API's refusal to `appendChild` into a live instance, not a phase 2 item.

## Testing

Unit tests only, via `npm test -- --project unit` from `frontend/`. Never bare
`npm test`: that runs a Storybook browser project needing Playwright, which is
not available locally.

- **Switch:** off carries `border-input` and `bg-muted-foreground/25`; hover
  carries `/40`; the on state is unchanged.
- **Sort control visibility:** rendered for a node whose `display_formats`
  marks a `display_field` `datetime`; absent for a node with no date field;
  absent for a node whose only date-like key is not a `display_field`.
- **Sort behaviour:** `Oldest` reverses the displayed order; the default
  matches the node's declared direction; undated rows stay last in both
  directions.
- **Sorting never writes:** changing the order does not call `onItems`.
- **The invariant:** a row expanded before a sort change is still expanded, and
  still the same row, after it — the guarantee that makes the feature cheap.
- **Figma** is verified by read-back, not by tests: `56:10`/`56:12`/`56:14`/
  `56:18` bind `input`, `56:16` still binds `border`, and no vector on `02
  Components` binds `indigo`.
- **`node design/app-contrast.mjs`** exits 0 with the extended pair list.

## Risks

| Risk | Mitigation |
|---|---|
| The Switch's Light-mode knob relies on shadow and ring, not fill contrast | Measured and recorded above; the knob's shadow already exists for this reason, and the new `border-input` ring is added by the same change |
| Off/on track contrast is 2.38 in Dark | Accepted: knob position carries the state, not colour. Recorded rather than hidden, and the extended calculator will keep reporting it |
| Rebinding the icon main component instead of the overrides | Explicitly scoped to 8 override paints on `75:51`–`75:54`; `220:30` must keep binding `ink` |
| The sort control contradicts shipped prototype copy | The frame and both spec passages are rewritten in the same round, not left to drift |
| Extending the calculator surfaces further pre-existing failures | Expected, and the point. Anything it finds is reported, ruled on, or entered in `KNOWN_FAILURES` with a reason — never silenced |
| A future token change drags the Switch again | The track no longer reads `--input` at all, so a border ruling cannot move it |
