#!/usr/bin/env python3
# Generate amber circle PNG icons at 16, 32, 48, 128 sizes
import os
from PIL import Image, ImageDraw

ICONS_DIR = os.path.expanduser("~/tabamber/icons")
SIZES = [16, 32, 48, 128]
COLORS = ["#d4a017", "#f0c040", "#b8920f"]  # outer, inner, core

for size in SIZES:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    r = int(size * 0.42)

    # Outer ring
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=COLORS[0])
    # Inner glow
    r2 = int(r * 0.7)
    draw.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=COLORS[1])
    # Core
    r3 = int(r * 0.3)
    draw.ellipse([cx - r3, cy - r3, cx + r3, cy + r3], fill=COLORS[2])

    out = os.path.join(ICONS_DIR, f"icon{size}.png")
    img.save(out, "PNG")
    print(f"Wrote {out}")

print("Done.")
