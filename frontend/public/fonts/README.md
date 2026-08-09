# Fonts

Geist and Geist Mono are loaded from Google Fonts in `index.html`. This folder
is for the one face that cannot be, and it is currently **empty**.

## What is missing

| File | Family | Used by |
|---|---|---|
| `stack-sans-notch.woff2` | `Stack Sans Notch` | The marketing page's display type — every heading at 40px and above, plus the wordmark |

The `@font-face` rule is already written, in `src/globals.css`. Drop the file in
here with exactly that name and it starts working; nothing else needs changing.

## What happens until then

The rule never matches, so `font-display` falls through to the next family in
its stack — Geist. **Every display heading on the landing page is currently set
in the wrong face**, at the right size and weight. It does not look broken,
which is precisely why this file exists.

## The licence question, which is not settled

The design was set in Stack Sans Notch inside Figma, where it was available as a
desktop font. A desktop licence is not a webfont licence — they are separately
granted by most foundries, and self-hosting a `.woff2` on a public marketing
page is unambiguously web use.

So before this ships, one of:

1. **Buy the webfont licence** for the expected traffic tier and drop the file in.
2. **Substitute an openly-licensed display face.** This is a real design
   decision, not a swap: the 40px floor exists because *this* face's notches
   stop reading below it, and the type specimen on the Figma Foundations page
   was the gate that chose it. A different face wants that decision re-made.
3. **Drop the display face** and set headings in Geist at a heavier weight. The
   page already renders this way, so it is the status quo made deliberate.

Nothing here should be resolved by copying a font file out of a system fonts
folder. That is the one option that looks like it works and is not licensed.
