#!/usr/bin/env python3
"""Bake scaleable clock digits from the same bold font as the PocketJS atlas."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
font = ImageFont.truetype(str(root / '.fonts/IBMPlexSansSC-Bold.ttf'), 54)
for char in '0123456789:':
    image = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    ImageDraw.Draw(image).text((22 if char == ':' else 15, 0), char, font=font, fill=(244, 240, 230, 255))
    image.save(root / 'src' / f'clock-{"colon" if char == ":" else char}.png')
