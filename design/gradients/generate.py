#!/usr/bin/env python3
"""
Generate every MyGist gradient still from the owner's reference ramp.

    python3 design/gradients/generate.py

This script IS the reproducibility record. An earlier version of the plan asked
for a prose block of slider values per asset; that is approximate and rots. This
is exact: run it and you get the committed PNGs back, byte for byte.

Why not GRADIENTOOL itself? The tool renders in a canvas, and driving it through
Playwright at 2880x1600 with its grain workers exhausted memory on the owner's
machine. The two things that actually matter are reimplemented here:

  * OKLab stop interpolation. This is why the reference ramp stays clean through
    the blue-to-pink transition where a naive sRGB lerp muddies it.
  * Soft-light grain in two octaves, which is the tactile layer the design
    depends on (the display face is cool and screen-native, so warmth and
    texture have to come from colour and grain).

Reference ramp, from the GRADIENTOOL state the owner supplied. The state's first
stop is #000000; it is Ink here so the page carries one black, and a warm one.

    0.00 #1C1917    0.44 #2345E0    0.72 #FF9DC5    1.00 #FBF0EE
    grain 0.52

An earlier attempt locked this artwork to the five brand colours and produced
grey-brown mud, because Clay and Verdigris are near-complementary. Do not
"correct" the ramp back toward the brand palette.
"""
import os
import numpy as np
from PIL import Image

OUT = os.path.dirname(os.path.abspath(__file__))

STOPS = [(0.00, "#1C1917"), (0.44, "#2345E0"), (0.72, "#FF9DC5"), (1.00, "#FBF0EE")]
GRAIN = 0.52
PAPER_LIGHT = "#FAFAF9"   # brand paper, light mode
PAPER_DARK = "#121211"    # brand paper, dark mode (60 3% 7%)


# ---------------------------------------------------------------- colour maths
def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64) / 255.0


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def rgb_to_oklab(rgb):
    r, g, b = (srgb_to_linear(rgb[..., i]) for i in range(3))
    l = np.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = np.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = np.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return np.stack([
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ], axis=-1)


def oklab_to_rgb(lab):
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
    m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
    s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
    return np.stack([
        linear_to_srgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        linear_to_srgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        linear_to_srgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    ], axis=-1)


_LABS = [rgb_to_oklab(hex_rgb(c)) for _, c in STOPS]


def ramp(t, lo=0.0, hi=1.0):
    """Sample the reference ramp in OKLab, over the sub-range [lo, hi]."""
    t = np.clip(lo + np.clip(t, 0.0, 1.0) * (hi - lo), 0.0, 1.0)
    out = np.zeros(t.shape + (3,), dtype=np.float64)
    for i in range(len(STOPS) - 1):
        p0, p1 = STOPS[i][0], STOPS[i + 1][0]
        seg = (t >= p0) & (t <= p1)
        if seg.any():
            f = ((t[seg] - p0) / (p1 - p0))[..., None]
            out[seg] = _LABS[i] * (1 - f) + _LABS[i + 1] * f
    out[t <= STOPS[0][0]] = _LABS[0]
    out[t >= STOPS[-1][0]] = _LABS[-1]
    return oklab_to_rgb(out)


# ---------------------------------------------------------------------- grain
def soft_light(base, blend):
    d = np.where(base <= 0.25, ((16 * base - 12) * base + 4) * base, np.sqrt(np.clip(base, 0, 1)))
    return np.where(blend <= 0.5,
                    base - (1 - 2 * blend) * base * (1 - base),
                    base + (2 * blend - 1) * (d - base))


def add_grain(img, intensity, seed):
    """Two octaves: a soft medium and a fine speckle, as the tool layers them."""
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    fine = rng.normal(0.5, 0.10, size=(h, w, 1))
    ch, cw = max(1, h // 3), max(1, w // 3)
    coarse = np.clip(rng.normal(0.5, 0.16, size=(ch, cw)), 0, 1)
    coarse = np.asarray(
        Image.fromarray((coarse * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC),
        dtype=np.float64)[..., None] / 255.0
    out = soft_light(img, coarse)
    out = out * (1 - intensity * 0.30) + soft_light(out, fine) * (intensity * 0.30)
    return np.clip(img * (1 - intensity * 0.95) + out * (intensity * 0.95), 0, 1)


def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def write(name, arr):
    path = os.path.join(OUT, name)
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path, optimize=True)
    print(f"  {name:34s} {arr.shape[1]}x{arr.shape[0]}")


# ------------------------------------------------------------------ the assets
def edge_strip(dark):
    """The signature: a 12px band on the page frame, generated at 2x.

    Generated at its true 2880x24 rather than rotated from a taller canvas and
    resampled — that workaround banded the left half of the first attempt.
    """
    W, H = 2880, 24
    t = np.tile(np.linspace(0.0, 1.0, W), (H, 1))
    img = ramp(t)
    if dark:
        # Hold the hues but pull the cream end down so it does not glare on ink.
        img = img * 0.82
    return add_grain(img, GRAIN, seed=11)


def hero_field(dark):
    """A soft pooled wash behind the hero mockup. Blue-leaning, per the owner.

    Must not compete with the product mockup sitting on top of it, so it peaks
    at 30% ink over paper and never carries the ramp's dark end.
    """
    HW, HH = 1440, 800                      # half res; a soft field has no fine detail
    yy, xx = np.mgrid[0:HH, 0:HW].astype(np.float64)
    cx, cy = HW * 0.34, HH * 0.42
    r = np.sqrt(((xx - cx) / (HW * 0.78)) ** 2 + ((yy - cy) / (HH * 0.95)) ** 2)
    pool = 1.0 - smoothstep(r)
    field = ramp(smoothstep(xx / HW) * 0.62 + 0.02, lo=0.40, hi=0.86)

    paper = hex_rgb(PAPER_DARK if dark else PAPER_LIGHT)
    strength = ((0.42 if dark else 0.30) * pool)[..., None]
    field = paper * (1 - strength) + field * strength

    field = np.asarray(
        Image.fromarray((np.clip(field, 0, 1) * 255).astype(np.uint8)).resize((2880, 1600), Image.BICUBIC),
        dtype=np.float64) / 255.0
    return add_grain(field, GRAIN * 0.7, seed=23)


# Three tile caps are three slices of the one ramp, rather than three separate
# brand hues. Same element, recoloured by position — which is what makes it a
# system instead of decoration.
TILE_SLICES = {"blue": (0.34, 0.56), "violet": (0.56, 0.74), "pink": (0.74, 0.92)}


def tile_cap(slice_name, dark):
    W, H = 1200, 16
    lo, hi = TILE_SLICES[slice_name]
    t = np.tile(np.linspace(0.0, 1.0, W), (H, 1))
    img = ramp(t, lo=lo, hi=hi)
    if dark:
        img = img * 0.86
    return add_grain(img, GRAIN, seed=31 + list(TILE_SLICES).index(slice_name))


if __name__ == "__main__":
    print("Generating gradient assets from the reference ramp:")
    for dark in (False, True):
        suffix = "dark" if dark else "light"
        write(f"edge-strip-{suffix}.png", edge_strip(dark))
        write(f"hero-field-{suffix}.png", hero_field(dark))
        for name in TILE_SLICES:
            write(f"tile-cap-{name}-{suffix}.png", tile_cap(name, dark))
    print("Done. 10 assets.")
