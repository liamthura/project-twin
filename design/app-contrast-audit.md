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

All pairs pass. Four of six badge tones failed on the first run, one Primary
button state failed, and the rail's active row failed twice — each fixed at
the token level, the same method the landing audit established.

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

All pairs pass.

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
token defect. `border` is deliberately a near-invisible hairline (`20 6% 90%`
light), a decorative separator rather than an interactive component boundary
or a graphic required to understand content, so WCAG 2.1's non-text contrast
criterion (1.4.11) does not apply to it. Including it under an enforced
threshold was a scope bug in the calculator, not a colour problem; it has been
removed from `design/app-contrast.mjs` rather than weakened to a passing
threshold.
