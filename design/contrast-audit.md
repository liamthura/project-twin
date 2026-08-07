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
| indigo | card | bento tile title, 20px SemiBold | 3.0 | 5.55 | 3.79 |
| on-primary | indigo | button labels | 4.5 | 5.55 | 4.60 |
| on-inverse | ground-inverse | closing CTA and footer text | 4.5 | 16.07 | 14.32 |

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
below AA. **Recommended follow-up, not done here because it is app work rather
than design work:** add `--link` at `228 94% 68%` in `.dark` and point
interactive text at it.

## Not measured

Gradient artwork carries no text. Type over gradient sits on a solid or scrimmed
surface, which is what keeps this table to a page instead of a per-pixel problem.
