#!/usr/bin/env python3
"""Raster Noto Sans CJK into grayscale atlases.

Glyphs are packed relative to the typographic baseline (Pillow anchor=ls)
so every character on a line shares one baseline. Render at 2x and
downsample with LANCZOS for coverage AA.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT = Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")
OUT = Path(__file__).with_name("font_atlas.h")

UI_CHARS = (
    " 0123456789:%"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    "设置亮度图标列表过渡滑动淡入显示"
)
TIME_CHARS = "0123456789:"


def unique(chars: str) -> list[str]:
    seen: list[str] = []
    for ch in chars:
        if ch not in seen:
            seen.append(ch)
    return seen


def load(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT), size=size, index=0)


def raster(font_hi: ImageFont.FreeTypeFont, ch: str, scale: int, pad: int):
    bbox = font_hi.getbbox(ch, anchor="ls")
    adv = font_hi.getlength(ch)
    if not bbox:
        x0 = y0 = 0
        x1 = max(1, round(adv))
        y1 = 1
    else:
        x0, y0, x1, y1 = bbox
        if x1 <= x0:
            x1 = x0 + max(1, round(adv))
        if y1 <= y0:
            y1 = y0 + 1
    w = max(scale, x1 - x0 + pad * 2 * scale)
    h = max(scale, y1 - y0 + pad * 2 * scale)
    im = Image.new("L", (w, h), 0)
    ImageDraw.Draw(im).text(
        (pad * scale - x0, pad * scale - y0),
        ch,
        font=font_hi,
        fill=255,
        anchor="ls",
    )
    lo = im.resize(
        (max(1, (w + scale - 1) // scale), max(1, (h + scale - 1) // scale)),
        Image.Resampling.LANCZOS,
    )
    return {
        "cp": ord(ch),
        "w": lo.size[0],
        "h": lo.size[1],
        "adv": max(1, round(adv / scale)),
        "ox": round(x0 / scale) - pad,
        "oy": round(y0 / scale) - pad,
        "pix": list(lo.getdata()),
    }


def emit(name: str, px: int, glyphs: list[dict], ascent: int) -> str:
    bitmap: list[int] = []
    rows = []
    for g in glyphs:
        off = len(bitmap)
        bitmap.extend(g["pix"])
        ch = chr(g["cp"])
        shown = ch if ch.isprintable() and ch != "\\" else hex(g["cp"])
        rows.append(
            f"\t{{ {g['cp']}, {g['w']}, {g['h']}, {g['adv']}, {g['ox']}, {g['oy']}, {off} }}, /* '{shown}' */"
        )
    bytes_n = len(bitmap)
    parts = [str(v) for v in bitmap]
    wrapped = []
    for i in range(0, len(parts), 16):
        wrapped.append("\t" + ", ".join(parts[i : i + 16]) + ",")
    return (
        f"/* {name} {px}px from Noto Sans CJK SC Regular, baseline-relative */\n"
        f"#define {name}_PX {px}\n"
        f"#define {name}_ASCENT {ascent}\n"
        f"#define {name}_COUNT {len(glyphs)}\n"
        f"#define {name}_BYTES {bytes_n}\n"
        f"static const uint8_t {name}_BITMAP[{name}_BYTES] = {{\n"
        + "\n".join(wrapped)
        + "\n};\n"
        f"static const struct atlas_glyph {name}_GLYPHS[{name}_COUNT] = {{\n"
        + "\n".join(rows)
        + "\n};\n"
    )


def main() -> None:
    ui_font = load(32)
    time_font = load(104)
    ui = [g for ch in unique(UI_CHARS) if (g := raster(ui_font, ch, 2, 1))]
    time = [g for ch in unique(TIME_CHARS) if (g := raster(time_font, ch, 2, 1))]
    ui_ascent = round(ui_font.getmetrics()[0] / 2)
    time_ascent = round(time_font.getmetrics()[0] / 2)
    body = (
        "#ifndef SCREEN_DISPLAY_FONT_ATLAS_H\n"
        "#define SCREEN_DISPLAY_FONT_ATLAS_H\n\n"
        "#include <stdint.h>\n\n"
        "struct atlas_glyph {\n"
        "\tuint16_t cp;\n"
        "\tuint8_t w, h, adv;\n"
        "\tint8_t ox, oy;\n"
        "\tuint32_t off;\n"
        "};\n\n"
        + emit("FONT_UI", 16, ui, ui_ascent)
        + "\n"
        + emit("FONT_TIME", 52, time, time_ascent)
        + "\n#endif\n"
    )
    OUT.write_text(body)
    print(f"wrote {OUT} ui={len(ui)} time={len(time)} bytes={OUT.stat().st_size}")
    print("time oy", {chr(g["cp"]): g["oy"] for g in time})
    print("ui sample oy", {chr(g["cp"]): g["oy"] for g in ui if chr(g["cp"]) in "0:TUE设"})


if __name__ == "__main__":
    main()
