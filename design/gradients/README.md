# Gradient assets

Ten stills, five light and five dark, in **two** live roles on the landing page:
a 12px **edge strip** across the very top of the page, full-bleed to the viewport
edges, and a soft **hero field** behind the product mockup.

**The six `tile-cap-*` files are currently unused.** A third role put a gradient
cap on each bento tile; it was cut when the bento's direction was set from
reference images, because an 8px saturated band fought the calm of plain cards
whose colour comes from an Indigo title and the bleeding product UI. The files are
kept rather than deleted since `generate.py` reproduces them in nine seconds.

## Regenerating

```bash
python3 design/gradients/generate.py
```

That script is the reproducibility record, not this file. Seeds are fixed, so
running it returns the committed PNGs identically. An earlier version of this
README carried a prose block of slider values per asset; that is approximate, and
it went stale within a day.

Needs `numpy` and `Pillow`. Takes about nine seconds.

## The ramp

From a GRADIENTOOL state supplied by the project owner:

```
0.00  #1C1917      0.44  #2345E0      0.72  #FF9DC5      1.00  #FBF0EE
grain 0.52
```

The state's first stop is `#000000`; it is Ink `#1C1917` here so the page carries
one black rather than two, and a warm one.

Interpolation is in **OKLab**. This matters — a naive sRGB lerp muddies the
blue-to-pink transition and OKLab does not.

## Why not drive GRADIENTOOL directly

It renders in a canvas, and driving it through Playwright at 2880×1600 with its
grain workers exhausted memory on the owner's machine. `generate.py` reimplements
the two things that actually matter: OKLab stop interpolation, and soft-light
grain in two octaves. Nine seconds instead of half an hour, and no browser.

## Three things not to undo

**Do not lock the artwork to the brand palette.** That was the first attempt.
Clay `#E47B4E` and Verdigris `#39757F` are near-complementary, so interpolating
between them passes through grey-brown — and that mud sat in the middle of the
element repeating on every section. The reference ramp works for a structural
reason: lightness rises monotonically and every hue step is adjacent to the last.

**Verify what the interpolations pass through, not the stops.** The first attempt
scanned for stray *stop* colours, found none, and reported the palette lock as
holding. The stops were never the problem. A usable check is the share of pixels
that are desaturated at mid lightness; all ten assets currently sit at or below
0.18%.

**Do not generate the edge strip by rotating a taller canvas and resampling.**
The first attempt did, to work around a 120:1 canvas failing to render, and it
banded the left half while leaving the right half clean. It is generated directly
at 2880×24.

## Roles

| Asset | Size | Notes |
|---|---|---|
| `edge-strip-{light,dark}` | 2880×24 | The signature element. Reads at 12px on the page, so the band structure stays coarse. |
| `hero-field-{light,dark}` | 2880×1600 | Deliberately pale, peaking at 30% ink over paper (42% dark). A product mockup sits on top and type sits nearby. Blue-leaning, chosen over a pink-forward variant so it harmonises with Indigo as the brand primary. |
| `tile-cap-{blue,violet,pink}-{light,dark}` | 1200×16 | **Unused.** Three slices of the same ramp, kept in case tile caps return. |

## Rule

Gradient artwork never sits under text. Type over gradient sits on a solid or
scrimmed surface, which keeps WCAG checking confined to a handful of pairs
instead of every pixel.
