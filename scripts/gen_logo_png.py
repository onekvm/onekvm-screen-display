#!/usr/bin/env python3
"""Raster the inverse OneKVM wordmark for the init welcome screen.

PocketJS image entries must be square-power-of-two and at most 512px, so the
3.5:1 mark is centered on a transparent 256x128 canvas.
"""

from io import BytesIO
from pathlib import Path

from cairosvg import svg2png
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
raw = svg2png(url=str(ROOT / "assets" / "onekvm-logo-inverse.svg"), output_width=256)
mark = Image.open(BytesIO(raw)).convert("RGBA")
canvas = Image.new("RGBA", (256, 128), (0, 0, 0, 0))
canvas.paste(mark, (0, (128 - mark.height) // 2), mark)
out = ROOT / "src" / "logo.png"
canvas.save(out)
print(f"wrote {out} {canvas.size}")
