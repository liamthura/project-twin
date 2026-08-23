# Contrast audit

Every foreground/background pair used on the landing page, measured in both
colour modes against WCAG 2.1 AA. Computed, not eyeballed — the ratios below come
from the token HSL values run through the standard relative-luminance formula.

Thresholds: **4.5** for normal text, **3.0** for large text (≥18.66px bold or
≥24px regular) and for UI component boundaries.

## Result

All pairs pass. Five failed on the first run and each was fixed at the token
level rather than by nudging individual layers.

| Foreground | Ground | Context | Need | Light | Dark |
|---|---|---|---|---|---|
| ink | paper | body and headings on page ground | 4.5 | 16.80 | 17.18 |
| ink | card | text inside cards and tiles | 4.5 | 17.49 | 16.01 |
| ink | clay-tint | text on the How-it-works ground | 4.5 | 15.10 | 12.70 |
| ink | verdigris-tint | text on a verdigris ground | 4.5 | 15.20 | 13.07 |
| muted-fg | paper | sub copy on page ground | 4.5 | 5.10 | 7.43 |
| muted-fg | card | tile body copy | 4.5 | 5.31 | 6.92 |
| muted-fg | clay-tint | step-card sub copy | 4.5 | 4.58 | 5.49 |
| muted-fg | muted | muted surfaces | 4.5 | 4.88 | 6.17 |
| link | paper | interactive text on page ground | 4.5 | 5.33 | 5.29 |
| link | card | interactive text in cards | 4.5 | 5.55 | 4.93 |
| on-primary | indigo | button labels | 4.5 | 5.55 | 4.60 |
| on-inverse | ground-inverse | closing CTA and footer text | 4.5 | 16.07 | 14.32 |
| on-inverse/70 | waitlist pill | closing CTA placeholder | 4.5 | 4.89 | 4.89 |

## What was wrong, and why

**`muted-fg` was too light at `25 5% 45%`.** It failed on clay-tint (4.10) and on
muted (4.36), and only scraped past on paper (4.56). Now `25 5% 42%`, which lifts
all four pairs clear. One value, no side effects.

**One token was doing two jobs with opposite requirements.** `--primary` served
both as a button fill and as interactive text. Those pull in opposite directions:
text on a fill wants the fill darker, while the same colour used as text wants it
lighter. The app's dark value of `228 94% 67%` was tuned for the text case, which
left white button labels at **3.69** — a real AA failure on every primary button in
dark mode, in the shipping app, before this audit existed.

Splitting the roles fixes both:

- `indigo` — fills and buttons. Dark `228 94% 62%`. White labels now measure 4.60.
- `link` — interactive text. Dark `228 94% 68%`. Measures 5.29 on paper, 4.93 on card.

Light mode needed no split; `228 69% 55%` already passes in both roles.

## Changes made outside the design file

`frontend/src/globals.css` and `docs-site/app/global.css`:

- `--muted-foreground` light: `25 5% 45%` → `25 5% 42%`
- `.dark --primary`: `228 94% 67%` → `228 94% 62%`
- `.dark --ring`: `228 94% 67%` → `228 94% 62%` (tracks primary)

The app does not yet have a separate link token. It uses `--primary` for
interactive text, which after this change measures 4.06 on the dark page ground —
below AA. This was fixed rather than deferred, because darkening `--primary` **introduced**
the failure — primary-as-text measured 5.06 before this branch and 4.06 after.
Shipping that as a "follow-up" would have meant knowingly leaving a regression in
the app.

`--link` now exists at `228 69% 55%` light and `228 94% 68%` dark, is exposed
through `tailwind.config.js`, and the two genuine interactive-text usages point at
it: `components/ui/button.jsx`'s `link` variant and `renderers/ListRenderer.jsx`.
The remaining `text-primary` usages are icons and a bullet glyph, which are UI
components at the 3.0 threshold and pass at 4.06.

## One pair deliberately absent

`indigo` on `card` is not in the table. An earlier draft listed it as the bento
tile title and passed it at the 3.0 large-text threshold on the strength of "20px
SemiBold". That was the table's only verdict resting on a judgement call, and the
call was doubtful: WCAG's large-text allowance wants **bold**, and weight 600 is
not obviously that. At the 4.5 normal-text threshold the pair measured 3.79 and
would have failed.

It is moot now. Tile titles bind to `link`, not `indigo`, so the pair in use is
`link` on `card` — 5.55 light, 4.93 dark, passing at 4.5 with no judgement call
required. `indigo` is fills only.

## Reached by an app ruling, 2026-08-10

**`--input` and `--border` no longer share a value, and this page has a control
that reads the first one.** The app's contrast round ruled that a form field's
edge is not a decorative divider and moved `--input` to the minimum lightness
that clears 3:1 — `20 6% 57%` Light, `60 2% 40%` Dark — while `--border` stayed
where it was. Anything on this page written on the assumption that the two are
interchangeable is now wrong.

One landing control is affected: the FAQ contact card's non-primary CTA
(`Faq.jsx:136`) renders as `variant="outline"`, which binds `border-input`. Its
edge is now visibly darker than the `border-border` hairline of the
`ContactCard` around it.

**Ruled: accepted.** That button is a real control, so WCAG 1.4.11 applies to it
here exactly as it does in the app — pinning it back to `border-border` would
reintroduce the same 1.26 failure the app's ruling rejected, one page across.
The edge measures **3.16** against `card`.

**The waitlist form is not affected**, though it is the consumer that looks most
at risk: `WaitlistForm` renders the shared `Input`, but passes `border-0`
(`WaitlistForm.jsx:129`) because the surrounding pill owns both the border and
the focus ring. Checked rather than assumed.

The full reasoning, and the app-side defect found alongside this one, are in
`design/app-contrast-audit.md` and
`docs/superpowers/specs/2026-08-10-app-redesign-phase-2-design.md`.
`design/app-contrast.mjs` now carries this page's `ground-inverse` surface, so a
token shared between the two pages cannot again be checked on only one of them.

**The hero field was mounted on the section, and this table could not see it.**
`Hero.jsx` painted `hero-field-light.webp` at `inset-0` across the whole hero
while its own docstring six lines above said the field was a pool behind the
mockup. Two opposing specs in one file, and the wash won. Measured off the
rendered page in light mode: the eyebrow at **3.72**, the body copy at **3.33**
and the invite-only note -- the sentence doing all the trust work at the moment
of the ask -- at **3.21**, against a 4.5 floor. Dark mode passed at 5.95, which
is why it survived review.

The table did not catch it because the table checks `muted-fg` against **paper**
and the shipped page was not using paper. That is the blind spot worth naming:
every row here is a token against a token, so a composite -- type over artwork,
or type over a translucent fill over artwork -- is invisible to it no matter how
many pairs are added. The fix was to make the composite stop existing: the field
now lives on the `ProductShot` wrapper, so hero copy is back on paper at 5.10 and
the pair is checkable once, which is what the rule below was always for.

**The closing CTA's placeholder was its own label at 2.71.** `WaitlistForm`
renders the real `<label>` as `sr-only`, so on the inverse pill a sighted
visitor has nothing but the placeholder -- and it was set at
`text-on-inverse/40` over `bg-on-inverse/10`. It is a composite, so it was never
in this table either. Now `/70`, measuring **4.89**, and both layers are carried
in `design/app-contrast.mjs` as hand-computed values next to `switch-off`.

## Not measured

Gradient artwork carries no text. Type over gradient sits on a solid or scrimmed
surface, which is what keeps this table to a page instead of a per-pixel problem.
