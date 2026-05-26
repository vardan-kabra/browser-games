"""Throwaway generator for the Bulls & Cows PWA icons.

Draws a dark indigo gradient tile (matching the game background) with the two
bull/cow accent dots over a bold "1234" — the 4-digit motif of the game.
Outputs icon-192.png, icon-512.png, and a full-bleed icon-512-maskable.png.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))

BG_TOP = (15, 23, 42)     # #0f172a
BG_BOT = (30, 27, 75)     # #1e1b4b
GREEN  = (34, 197, 94)    # bull dot
AMBER  = (251, 191, 36)   # cow dot
WHITE  = (248, 250, 252)


def load_font(px):
    for p in (r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, px)
    return ImageFont.load_default()


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
    cx = size // 2

    # bull (green) + cow (amber) accent dots
    r = int(size * 0.05)
    cy = int(size * 0.355)
    gap = int(size * 0.085)
    d.ellipse([cx - gap - r, cy - r, cx - gap + r, cy + r], fill=GREEN)
    d.ellipse([cx + gap - r, cy - r, cx + gap + r, cy + r], fill=AMBER)

    # "1234" centered with a little letter spacing
    font = load_font(int(size * 0.30))
    text = "1234"
    spacing = int(size * 0.015)
    bboxes = [d.textbbox((0, 0), ch, font=font) for ch in text]
    chw = [b[2] - b[0] for b in bboxes]
    total = sum(chw) + spacing * (len(text) - 1)
    asc, desc = font.getmetrics()
    x = cx - total // 2
    ty = int(size * 0.50)
    for i, ch in enumerate(text):
        d.text((x - bboxes[i][0], ty), ch, font=font, fill=WHITE)
        x += chw[i] + spacing
    return img


for s in (192, 512):
    make(s).save(os.path.join(OUT, f"icon-{s}.png"))
make(512, maskable=True).save(os.path.join(OUT, "icon-512-maskable.png"))
print("icons written to", OUT)
