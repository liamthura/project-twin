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

All pairs pass or are known, accepted, and tracked. Four of six badge tones
failed on the first run, one Primary button state failed, and the rail's
active row failed twice — each fixed at the token level, the same method the
landing audit established. One pair — the input field boundary — fails and is
**not** fixed here; see "Known, accepted failure" below for why.

| Pair | Context | Need | Light | Dark |
|---|---|---|---|---|
| ink / paper | body and headings | 4.5 | 16.74 | 17.18 |
| ink / card | text in cards | 4.5 | 17.49 | 15.97 |
| muted-fg / paper | sub copy | 4.5 | 5.08 | 7.44 |
| muted-fg / card | helper text, counts | 4.5 | 5.31 | 6.91 |
| muted-fg / muted | segmented control, inactive | 4.5 | 4.87 | 6.17 |
| link / paper | Ghost buttons, text links | 4.5 | 5.31 | 5.29 |
| link / card | Tabs active, RailSubItem current | 4.5 | 5.55 | 4.91 |
| link / indigo-tint | RailItem active row | 4.5 | 4.87 | 4.80 |
| on-primary / indigo | Primary button label | 4.5 | 5.55 | 4.62 |
| ink / muted | Badge Neutral | 4.5 | 16.03 | 14.24 |
| indigo-ink / indigo-tint | Badge Primary | 4.5 | 4.87 | 8.53 |
| success-ink / success-tint | Badge Positive | 4.5 | 5.21 | 10.96 |
| destructive-ink / destructive-tint | Badge Critical | 4.5 | 5.91 | 9.13 |
| warning-ink / warning-tint | Badge Warning | 4.5 | 6.84 | 11.58 |
| verdigris / verdigris-tint | Badge Live | 4.5 | 4.55 | 4.95 |
| muted-fg / clay-tint | delegate offer sub copy | 4.5 | 4.58 | 5.50 |
| ink / clay-tint | delegate offer heading | 4.5 | 15.08 | 12.69 |
| input border / card | text field boundary (WCAG 1.4.11) | 3.0 | 1.26 KNOWN | 1.21 KNOWN |

All pairs pass (or are known, accepted, and tracked).

## Resolved: the input field boundary

**Ruled 2026-08-10 — the token moved, the exemption did not stand.** `--input`
is now `20 6% 57%` Light and `60 2% 40%` Dark: in each mode, the *minimum*
lightness that clears 3:1 against both `card` and `paper`. Measured 3.16/3.03
Light and 3.11/3.35 Dark. `design/app-contrast.mjs`'s `KNOWN_FAILURES` list is
now empty, and the pair passes on its own merits.

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

### Still open: the Neutral button's edge

`Button`'s `Variant=Neutral` fills with `card` and sits on `card` surfaces, so
its border is the only thing that identifies it as a control — the same
argument that moved `--input`. Its stroke is still bound to `border`, measuring
the same failing ~1.26. It was left alone because the ruling covered form
fields, and a button is a distinct judgement: the label inside it is arguably
identification enough, which is a defensible reading of 1.4.11 that a text
field's empty box cannot claim. **Not fixed, not exempt — undecided.**

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

**Known and accepted:** icon vector strokes in `02 Components` were left bound
to `indigo` rather than rebound to `link` alongside the text nodes Task 3
moved. The two tokens are identical in Light and only marginally different in
Dark, and icon strokes sit at the 3.0 large-text/component threshold under
either token, so the practical risk is nil — but the file is not internally
consistent on this point, and it should be swept the next time either token's
value changes.

## Not measured

Disabled states, which carry a 50% paint opacity and are exempt. Gradient
artwork, which the app does not use — that's a landing-page-only surface (see
`design/contrast-audit.md`).

`border`/`card` (hairline dividers) was in an earlier draft of this script at
a 3.0 threshold and measured 1.26 Light / 1.21 Dark — a clear fail, but not a
token defect: `border` is a decorative separator, exempt from WCAG 1.4.11 (see
"Known, accepted failure" above, which covers this token's other use — the
input field boundary — where the same exemption does *not* apply). Including
the divider pair under an enforced threshold was a scope bug in the
calculator, not a colour problem; it has been removed from
`design/app-contrast.mjs` rather than weakened to a passing threshold.
