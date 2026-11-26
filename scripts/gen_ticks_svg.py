#!/usr/bin/env python3
"""Bezel ticks as fill-only SVG for PocketJS bake-svg."""

from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "src" / "ticks.svg"
CX = CY = 120
OUTER = 118

parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 240 240">',
]
for i in range(60):
    hour = i % 15 == 0
    five = i % 5 == 0
    inner = 105 if hour else 111 if five else 115
    length = OUTER - inner
    width = 2 if hour else 1.2 if five else 0.7
    fill = "#f4f0e6" if hour else "#8b8794" if five else "#3a3842"
    x = CX - width / 2
    y = CY - OUTER
    # bake-svg applies rotate(a cx cy) in document order
    parts.append(
        f'<rect x="{x:.2f}" y="{y:.2f}" width="{width:.2f}" height="{length:.2f}" '
        f'fill="{fill}" transform="rotate({i * 6} {CX} {CY})" />'
    )
parts.append("</svg>")
OUT.write_text("\n".join(parts) + "\n")
print(f"wrote {OUT}")

try:
    from cairosvg import svg2png
except ImportError:
    svg2png = None
if svg2png:
    png = OUT.with_suffix(".png")
    png.write_bytes(svg2png(url=str(OUT), output_width=256, output_height=256))
    print(f"wrote {png}")
