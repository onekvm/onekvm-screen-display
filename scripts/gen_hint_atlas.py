#!/usr/bin/env python3
"""Bake a coverage atlas for the host hint API (ASCII + home-swipe CJK)."""

from pathlib import Path
import struct
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dist" / "hint-atlas.bin"
FONTS = (
    ROOT / ".fonts" / "IBMPlexSansSC-Regular.ttf",
    ROOT / ".fonts" / "NotoSansCJK-SC-Regular.otf",
    ROOT / ".fonts" / "NotoSansCJK-Regular.otf",
    Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
)
EXTRA = "再滑一次返回首页首頁继续按下将返回繼續按下將返回"
CELL_W, CELL_H = 16, 20
FONT_PX = 14


def main() -> int:
    font = None
    for path in FONTS:
        if path.is_file():
            font = ImageFont.truetype(str(path), FONT_PX, index=0)
            break
    if font is None:
        print("no CJK font for hint atlas", file=sys.stderr)
        return 1
    cps = list(range(32, 127)) + [ord(ch) for ch in EXTRA]
    seen = set()
    unique = []
    for cp in cps:
        if cp not in seen:
            seen.add(cp)
            unique.append(cp)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    raw = bytearray(b"HAT2")
    raw += struct.pack("<HHH", CELL_W, CELL_H, len(unique))
    for cp in unique:
        ch = chr(cp)
        im = Image.new("L", (CELL_W, CELL_H), 0)
        draw = ImageDraw.Draw(im)
        left, top, right, bottom = font.getbbox(ch)
        gw = max(1, right - left)
        gh = max(1, bottom - top)
        x = max(0, (CELL_W - gw) // 2 - left)
        y = max(0, (CELL_H - gh) // 2 - top)
        draw.text((x, y), ch, font=font, fill=255)
        advance = 8 if cp < 127 else 14
        raw += struct.pack("<IH", cp, advance)
        raw += im.tobytes()
    OUT.write_bytes(raw)
    print(f"wrote {OUT} ({len(unique)} glyphs, cell {CELL_W}x{CELL_H})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
