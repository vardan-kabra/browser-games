"""Throwaway generator for the "Browser Games" collection PWA icons.

Draws the same dark indigo gradient tile as the games, with a centered 2x2 grid
of rounded squares (violet / teal / green / amber) to read as "a collection of
games". Outputs icon-192.png, icon-512.png, and a full-bleed icon-512-maskable.png.
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.dirname(os.path.abspath(__file__))

BG_TOP = (15, 23, 42)     # #0f172a
BG_BOT = (30, 27, 75)     # #1e1b4b
TILES = [
    (139, 92, 246),       # violet
    (45, 212, 191),       # teal
    (34, 197, 94),        # green
    (251, 191, 36),       # amber
]


def gradient(size):
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        d.line([(0, y), (size, y)], fill=(
            int(BG_TOP[0] * (1 - t) + BG_BOT[0] * t),
            int(BG_TOP[1] * (1 - t) + BG_BOT[1] * t),
            int(BG_TOP[2] * (1 - t) + BG_BOT[2] * t),
        ))
    return img.convert("RGBA")


def rounded(img, radius):
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def make(size, maskable=False):
    img = gradient(size)
    if not maskable:
        img = rounded(img, int(size * 0.22))
    d = ImageDraw.Draw(img)

    grid = size * (0.46 if maskable else 0.52)   # keep inside the maskable safe zone
    gap = size * 0.055
    tile = (grid - gap) / 2
    rad = int(tile * 0.28)
    x0 = (size - grid) / 2
    y0 = (size - grid) / 2
    coords = [
        (x0, y0),
        (x0 + tile + gap, y0),
        (x0, y0 + tile + gap),
        (x0 + tile + gap, y0 + tile + gap),
    ]
    for (tx, ty), color in zip(coords, TILES):
        d.rounded_rectangle([tx, ty, tx + tile, ty + tile], radius=rad, fill=color)
    return img


for s in (192, 512):
    make(s).save(os.path.join(OUT, f"icon-{s}.png"))
make(512, maskable=True).save(os.path.join(OUT, "icon-512-maskable.png"))
print("icons written to", OUT)
