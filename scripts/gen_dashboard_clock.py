#!/usr/bin/env python3
"""Bake white 32 px clock glyphs for native image scaling."""
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
font = ImageFont.truetype(sys.argv[1], 32)
top, bottom = font.getbbox("0123456789")[1::2]
for char in "0123456789:":
    image = Image.new("RGBA", (32, 64), (0, 0, 0, 0))
    ImageDraw.Draw(image).text((0, (64 - bottom - top) / 2), char, font=font, fill="white")
    image.save(root / "src" / f'dashboard-clock-{"colon" if char == ":" else char}.png')

period_font = font
for period in ["AM", "PM"]:
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    left, top, right, bottom = period_font.getbbox(period)
    ImageDraw.Draw(image).text(((64 - right - left) / 2, (64 - bottom - top) / 2), period, font=period_font, fill="white")
    image.save(root / "src" / f"dashboard-clock-{period.lower()}.png")
