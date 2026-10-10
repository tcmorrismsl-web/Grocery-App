"""Draws the Shelf Tag app icons into ../icons. Run: python3 tools/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

GREEN = (29, 90, 69)
YELLOW = (245, 198, 46)
INK = (35, 28, 2)
OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)


def draw(size, safe=1.0):
    s = 4  # supersample
    W = size * s
    im = Image.new("RGB", (W, W), GREEN)
    d = ImageDraw.Draw(im)
    # shelf tag: rectangle with a pointed left end, centered, tilted feel via offset
    w = W * 0.62 * safe
    h = W * 0.40 * safe
    cx, cy = W / 2, W / 2
    left, right = cx - w / 2, cx + w / 2
    top, bot = cy - h / 2, cy + h / 2
    point = left - h * 0.42
    r = h * 0.14
    d.rounded_rectangle([left, top, right, bot], radius=r, fill=YELLOW)
    d.polygon([(left + 1, top), (point, cy), (left + 1, bot)], fill=YELLOW)
    # hole
    hr = h * 0.10
    hx = left + h * 0.05
    d.ellipse([hx - hr, cy - hr, hx + hr, cy + hr], fill=GREEN)
    # price bars (abstract "$" lines)
    bx = left + w * 0.30
    bw = w * 0.56
    lh = h * 0.13
    d.rounded_rectangle([bx, cy - h * 0.24, bx + bw, cy - h * 0.24 + lh * 1.6], radius=lh * 0.5, fill=INK)
    d.rounded_rectangle([bx, cy + h * 0.06, bx + bw * 0.62, cy + h * 0.06 + lh], radius=lh * 0.5, fill=INK)
    return im.resize((size, size), Image.LANCZOS)


draw(192).save(OUT / "icon-192.png")
draw(512).save(OUT / "icon-512.png")
draw(512, safe=0.8).save(OUT / "icon-maskable-512.png")
draw(180).save(OUT / "apple-touch-icon.png")
print("icons written to", OUT)
