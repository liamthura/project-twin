# App contrast audit

Every foreground/ground pair the app prototype uses that the landing audit
never measured — badge tones, the rail's active row, and the tinted pills —
measured in both colour modes against WCAG 2.1 AA. Computed, not eyeballed:
the ratios below come from `design/app-contrast.mjs`, a rerunnable script
following the precedent of `design/gradients/generate.py`, rather than
hand-written prose with no artifact to check it against.

Thresholds: **4.5** for normal text, **3.0** for large text (≥18.66px bold or
≥24px regular) and for UI component boundaries.

Run: `node design/app-contrast.mjs`

## Result

Four of six badge tones failed on the first run, one Primary button state
failed, and the rail's active row failed twice — each fixed at the token level,
the same method the landing audit established. The input field boundary and the
Switch's off/on track each failed and each was ruled on separately (see below).
**Nothing is exempt: `KNOWN_FAILURES` is empty, and every pair below passes on
its own merits.**

Pairs now carry a **role**, because the absence of one is what let a token
change break a control this table could not see: `text`, `boundary`, `fill` and
`state` say which layer is being measured, so a token used two ways is reported
twice. A `need` of `--` means reported but not enforced — no success criterion
governs it, and inventing a threshold would either fail the build for no reason
or teach the reader that the column is decorative.

| Pair | Context | Role | Need | Light | Dark |
|---|---|---|---|---|---|
| ink / paper | body and headings | text | 4.5 | 16.74 | 17.18 |
| ink / card | text in cards | text | 4.5 | 17.49 | 15.97 |
| muted-fg / paper | sub copy | text | 4.5 | 5.08 | 7.44 |
| muted-fg / card | helper text, counts | text | 4.5 | 5.31 | 6.91 |
| muted-fg / muted | segmented control, inactive | text | 4.5 | 4.87 | 6.17 |
| link / paper | Ghost buttons, text links | text | 4.5 | 5.31 | 5.29 |
| link / card | Tabs active, RailSubItem current | text | 4.5 | 5.55 | 4.91 |
| link / indigo-tint | RailItem active row | text | 4.5 | 4.87 | 4.80 |
| on-primary / indigo | Primary button label | text | 4.5 | 5.55 | 4.62 |
| ink / muted | Badge Neutral | text | 4.5 | 16.03 | 14.24 |
| indigo-ink / indigo-tint | Badge Primary | text | 4.5 | 4.87 | 8.53 |
| success-ink / success-tint | Badge Positive | text | 4.5 | 5.21 | 10.96 |
| destructive-ink / destructive-tint | Badge Critical | text | 4.5 | 5.91 | 9.13 |
| warning-ink / warning-tint | Badge Warning | text | 4.5 | 6.84 | 11.58 |
| verdigris / verdigris-tint | Badge Live | text | 4.5 | 4.55 | 4.95 |
| muted-fg / clay-tint | delegate offer sub copy | text | 4.5 | 4.58 | 5.50 |
| ink / clay-tint | delegate offer heading | text | 4.5 | 15.08 | 12.69 |
| input border / card | field, outline button, chip, switch track | boundary | 3 | 3.16 | 3.11 |
| input border / paper | the same edges, on the page ground | boundary | 3 | 3.03 | 3.35 |
| switch off / switch on | Switch off vs on track | state | 3 | 3.98 | 3.09 |
| switch thumb / on track | white thumb on the on track | boundary | 3 | 5.55 | 3.54 |
| switch off / card | off track on a card -- watched, not required | fill | -- | 1.39 | 1.59 |
| switch off / muted | off track on a muted card | fill | -- | 1.38 | 1.60 |
| switch thumb / off track | white thumb; reads by shadow and ring | fill | -- | 1.39 | 10.97 |
| on-inverse / ground-inverse | landing dark break section | text | 4.5 | 16.03 | 14.27 |

All pairs pass.

## Resolved: the input field boundary

**Ruled 2026-08-10 — the token moved, the exemption did not stand.** `--input`
is now `20 6% 57%` Light and `60 2% 40%` Dark: in each mode, the *minimum*
lightness that clears 3:1 against both `card` and `paper`. Measured 3.16/3.03
Light and 3.11/3.35 Dark. The pair passes on its own merits, and its
`KNOWN_FAILURES` entry was removed rather than weakened.

**`border` deliberately did not move with it.** The two tokens held the same
value for as long as they did because nobody had separated their jobs; they now
differ in value because they differ in job. Darkening `border` too would have
repainted every hairline divider in the app to fix a control boundary, and it
would have pulled against the editorial direction the redesign chose.

The Figma prototype gained a matching `input` variable
(`VariableID:348:59`, `STROKE_COLOR` scope only) and 48 field-boundary strokes
across `TextField`, `Select`, `TextArea`, `PinField`, `InviteCodeField`,
`Checkbox` and `SectionSelector` were rebound from `border` to it. Four
`Disabled` variants were deliberately left on `border`: 1.4.11 exempts
inactive components, and a muted edge is the intended reading.

The reasoning that produced the ruling is kept below, because it is the part
worth re-reading if `--input` is ever revisited.

### Why it needed a ruling at all

`border` and `--input` (`frontend/src/globals.css`) held the same value —
`20 6% 90%` Light, `60 2% 16%` Dark — but they carry two different jobs, and
only one of those jobs is exempt from a contrast requirement.

**Hairline dividers are decorative.** A divider line between list rows or
sections carries no information a user needs to operate the interface; remove
it and nothing breaks. WCAG 2.1's non-text contrast criterion (1.4.11) does
not apply to purely decorative separators, which is why `border`/`card` was
removed from the enforced pairs in `design/app-contrast.mjs` rather than kept
at a failing 3.0 (see "Not measured" below for that history).

**A text field's boundary is not decorative.** 1.4.11 explicitly requires 3:1
for "visual information required to identify user interface components and
states," and the edge of a `TextField`/`Select`/`TextArea` is exactly that —
without it, the field's extent is invisible against `card`. At the current
`--input` value this measures **~1.26 Light / 1.21 Dark**, a real failure, not
a decorative exemption.

It was a **pre-existing condition in the shipping app**, not something the
reconciliation introduced — `--input` had held that value since before the work
started, and it agreed exactly with the Figma prototype's own `border` binding
on every form primitive. It was tracked rather than quietly fixed, because
correcting it changes every input border in both the production CSS and the
prototype, which is a visible system-wide change and an owner's call rather
than a contrast audit's.

**One thing the numbers made plain, and which is worth remembering:** passing
3:1 was not a nudge. It moved the border from `90%` to `57%` lightness in Light
and `16%` to `40%` in Dark — a visible mid-grey edge on every field, not a
firmer hairline. The tradeoff was real in both directions, and the ruling went
to the criterion: a field whose extent you cannot see is precisely what 1.4.11
exists to prevent.

### Resolved: the Neutral button's edge

**Ruled 2026-08-10 — the prototype was the thing out of step, not the app.**
This was recorded here as undecided, on the reading that a button's label might
be identification enough where a text field's empty box is not. Reading the code
settled it: `button.jsx:13` binds `border-input`, not `border-border`, so the
shipping `outline` button moved with `--input` and already measures **3.16**
against `card` and **3.03** against `background`. The decision had in effect
been taken years ago by shadcn's own convention, and the only thing still
failing was the Figma prototype.

Four `Button` `Variant=Neutral` variants were rebound from `border` to `input`
(`VariableID:348:59`): `56:10` Default, `56:12` Hover, `56:14` Pressed and
`56:18` Loading. `56:16` Disabled was deliberately left on `border`, the same
rule the 48 field strokes followed — 1.4.11 exempts inactive components.

### Found while closing that: two consumers nothing had measured

Ruling 1 was verified against the pair it was made for and reported "All pairs
pass", which was true and incomplete. `--input` has **nine consumers** in
`frontend/src`, and this table could only ever see one of them, as a border,
against `card`.

- **`switch.jsx:28` used `bg-input` as the track FILL**, justified in its own
  comment as "the token every field border already uses" — an assumption the
  ruling invalidated. The off track went 90% → 57% lightness Light and 16% →
  40% Dark, so **Off came to outweigh On**, inverting the one thing a switch
  communicates. The same line bound the switch's own boundary to `border` at
  1.26, a pre-existing 1.4.11 failure the dark fill had been masking. Both
  layers moved: off is now `border-input bg-muted-foreground/25`, hover `/40`.
- **`Faq.jsx:136` on the landing page** renders its non-primary CTA as
  `variant="outline"`, so that edge darkened too, inside a card whose own
  hairline did not. Accepted — a control is a control on a marketing page — and
  recorded in `design/contrast-audit.md`.

`design/app-contrast.mjs` was extended so this class of miss is visible next
time: pairs now carry a **role** (`text`, `boundary`, `fill`, `state`) so a
token used two ways is reported twice, and the ground set includes the landing
page's `ground-inverse`. A `need` of `--` means reported but not enforced, for
numbers worth watching that no success criterion governs.

### Resolved: the Switch's off/on track

Fixing the fill and the boundary left the two tracks **2.38** apart in Dark,
under the 3:1 that 1.4.11 asks of states. That was briefly entered in
`KNOWN_FAILURES` on the argument that a switch conveys state by thumb
**position** rather than colour. **Ruled 2026-08-10: the token moves instead** —
the same call as `--input`, and the exemption came straight back out.

**The on track binds `link`, not `primary`.** Identical in Light (`228 69% 55%`
for both), lighter in Dark (68% vs 62%), so the pair clears at **3.09** and
Light is untouched. `indigo` never moved, so Primary buttons are unaffected.

`link` is nominally the text-role token, and using it as a fill is defensible
here specifically: the split exists because a fill carrying a **label** wants to
be darker so the label passes, and this track carries no label — the knob is a
shape. Recorded in `switch.jsx` so nobody "corrects" it back.

Two alternatives were measured and rejected, both of which pass the state pair
while breaking something else:

| Dark option | off vs on | off vs card | Why not |
|---|---|---|---|
| darken the off track to `/10` | 3.20 | **1.18** | the track nearly vanishes on the card — the complaint that put `bg-input` there originally |
| lighten the off track to `/55` | **1.25** | 3.01 | the two states become near-identical in weight |
| **move the on track to `link`** | **3.09** | 1.59 | chosen: nothing else has to give |

The prototype's `Switch` diverged further than the code did and was brought into
line: `State=On` and `State=On Disabled` (`32:11`, `32:13`) moved from `indigo`
to `link`, and `State=Off` (`32:10`) — which filled flat `muted` and carried **no
stroke at all**, so nothing identified the control's extent — now fills
`muted-fg` at 25% with an `input`-bound 1px ring. Both `On` variants moved
because this is the on state's colour identity rather than a contrast fix, so the
"leave Disabled alone" rule that governed the field and button boundaries does
not apply. `State=Off Disabled` keeps its `border` fill.

## What was wrong, and why

**`muted-fg` and dark `indigo` were stale copies of the pre-audit landing
values; the app prototype never received the split.** The landing page fixed
`muted-fg` to `25 5% 42%` light and split `indigo`/`link` apart with a dark
`indigo` of `228 94% 62%` months before this round started. The app's Figma
prototype was built from the pre-fix landing library and inherited both stale
values verbatim — it never received the split at all, so `indigo` was still
carrying text duty as well as fill duty going into this round.

**Primary button labels were bound to `card`, measuring 3.77 in Dark.** A
white label on `card` (`60 2% 10%` in Dark) reads as strong text-on-dark
contrast on its own, but the actual paint order put white text on an indigo
fill, not on the card underneath it — the binding itself pointed at the wrong
variable, so the number the file reported bore no relationship to what a user
would see. `on-primary` exists as its own token, rather than reusing an
existing neutral, because a Primary button is indigo in both modes, so its
label is white in both modes — there is no light/dark split to carry, only a
fill/text role to keep separate from `indigo` itself.

**The badge wash failed four of six tones, worst at 2.52.** Every badge
grounded itself on a 12% opacity wash of its own foreground colour — Neutral
excepted, since it isn't a wash. That formula produces almost no separation
between ink and ground once alpha-compositing is accounted for, and it drifts
further apart between Light and Dark because 12% of a light colour and 12% of
a dark colour land in very different places relative to the page underneath.
The fix adopts the tint/ink structure the app's own `VALUE_META` chips
already use — `success-ink`/`success-tint`, `destructive-ink`/
`destructive-tint`, `warning-ink`/`warning-tint`, each an opaque, purpose-built
pair rather than a wash. Live measurements: 6.84 (Warning/amber), 5.21
(Positive/emerald), 5.91 (Critical/rose) in Light — all comfortably clear of
4.5, and all pull further ahead in Dark (11.58 / 10.96 / 9.13).

**`indigo-tint` was darkened in Dark for the rail's active row.** RailItem's
active row sits `link` text on `indigo-tint` ground, and rebinding the text
alone from `indigo` to `link` did not fix it — 3.69 → 3.86, still failing.
The ground had to move: `indigo-tint` Dark went from a pale, low-contrast tint
to `rgb(28,26,45)`, after which `link`/`indigo-tint` clears at 4.80 (and 4.87
in Light, which needed no change).

**Swept 2026-08-10, and not where this note implied.** Icon vector strokes in
`02 Components` had been left bound to `indigo` rather than `link`, alongside
the text nodes Task 3 moved. The obvious fix — rebind the icon component — would
have been wrong: `IconProfile` (`220:30`) binds both its vectors to **`ink`**,
correctly, and changing it would have recoloured every icon in the file,
inactive rail rows included.

The eight `indigo` readings were **instance-level override paints** on four
`RailItem` active-state variants — `75:51`, `75:52`, `75:53`, `75:54` — i.e. the
active rail row's icon, which should read `link` alongside its own label. Those
eight paints were rebound; `220:30` was not touched. Verified by read-back: no
vector on `02 Components` binds `indigo`.

## Not measured

Disabled states, which carry a 50% paint opacity and are exempt. Gradient
artwork, which the app does not use — that's a landing-page-only surface (see
`design/contrast-audit.md`).

`border`/`card` (hairline dividers) was in an earlier draft of this script at
a 3.0 threshold and measured 1.26 Light / 1.21 Dark — a clear fail, but not a
token defect: `border` is a decorative separator, exempt from WCAG 1.4.11 (see
"Resolved: the input field boundary" above, which covers the use this token
*used* to share with `--input` — a field's edge — where the same exemption does
not apply, and which is why the two no longer hold the same value). Including
the divider pair under an enforced threshold was a scope bug in the
calculator, not a colour problem; it has been removed from
`design/app-contrast.mjs` rather than weakened to a passing threshold.
