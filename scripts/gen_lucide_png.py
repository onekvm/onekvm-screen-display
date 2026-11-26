#!/usr/bin/env python3
"""Raster Lucide icons from @lucide/vue into PNG assets for PocketJS Image."""

from __future__ import annotations

import io
import re
import sys
from pathlib import Path

from PIL import Image

try:
    from cairosvg import svg2png
except ImportError as exc:  # pragma: no cover
    raise SystemExit("need cairosvg") from exc

ROOT = Path(__file__).resolve().parents[1]
LUCIDE_JS = Path(
    "/home/samlm/projects/onekvm/onekvm-ui/node_modules/@lucide/vue/dist/cjs/lucide-vue.js"
)
OUT = ROOT / "src"

# Vue / manifest names -> Lucide createLucideIcon() id
ICONS = (
    ("settings", "settings"),
    ("security", "shield-check"),
    ("virtual-media", "disc-3"),
    ("keyboard", "keyboard"),
    ("hdmi", "hdmi-port"),
    ("usb", "usb"),
    ("net", "network"),
    ("screen", "sun"),
    ("display", "layout-grid"),
    ("about", "info"),
    ("back", "chevron-left"),
    ("apply", "check"),
    ("stream", "monitor-play"),
    ("zoom", "search"),
    ("stick", "joystick"),
    ("power", "zap"),
    ("region", "globe"),
    ("lock", "lock-keyhole"),
    # globe.png is the welcome-line internet mark, drawn by write_internet_globe.
    # Lucide globe's meridian collapses into a plus at ~18px, and Lucide earth
    # reads as a wheel. Do not map either onto globe.png.
    ("backspace", "delete"),
    ("enter", "corner-down-left"),
    ("forward", "chevron-right"),
    ("wifi", "wifi"),
    ("key", "key-round"),
)
SIZE = 64
ICON = 32
DIST_ICONS = ROOT / "dist" / "icons"


def extract_array_before(source: str, needle: str) -> str:
    pos = source.find(needle)
    if pos < 0:
        raise KeyError(needle)
    start = source.rfind("= [", 0, pos)
    if start < 0:
        raise KeyError(needle)
    i = start + 2
    depth = 0
    for j, ch in enumerate(source[i:], i):
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return source[i + 1 : j]
    raise KeyError(needle)


def extract_node_array(source: str, icon_name: str) -> str:
    """Read the node array used by current object-shaped Lucide bundles."""
    match = re.search(rf'\bname:\s*"{re.escape(icon_name)}"', source)
    if not match:
        raise KeyError(icon_name)
    end = source.find("};", match.end())
    node = source.find("node:", match.end(), end if end >= 0 else len(source))
    if node < 0:
        raise KeyError(icon_name)
    start = source.find("[", node)
    if start < 0:
        raise KeyError(icon_name)
    depth = 0
    for pos, char in enumerate(source[start:], start):
        if char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return source[start + 1 : pos]
    raise KeyError(icon_name)


def node_to_svg(body: str) -> str:
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"',
        ' fill="none" stroke="#f4f0e6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
    ]
    i = 0
    while True:
        m = re.search(r'\[\s*"(\w+)",\s*\{', body[i:])
        if not m:
            break
        tag = m.group(1)
        brace = i + m.end() - 1
        depth = 0
        k = brace
        while k < len(body):
            if body[k] == "{":
                depth += 1
            elif body[k] == "}":
                depth -= 1
                if depth == 0:
                    break
            k += 1
        raw = body[brace + 1 : k]
        i = k + 1
        attrs = []
        for key, val in re.findall(r'(\w+):\s*"([^"]*)"', raw):
            if key == "key":
                continue
            attrs.append(f'{key}="{val}"')
        if tag == "path" and "d=" not in " ".join(attrs):
            continue
        parts.append(f"<{tag} {' '.join(attrs)} />")
    parts.append("</svg>")
    return "\n".join(parts)


# Filled graticule, zinc-100 (#f4f4f5). Bands stay wide enough that bilinear
# sampling at the 18px welcome line still shows a globe, not a circled plus.
INTERNET_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
<path fill="#f4f4f5" fill-rule="evenodd" d="M16 2.2 C23.6 2.2 29.8 8.4 29.8 16 C29.8 23.6 23.6 29.8 16 29.8 C8.4 29.8 2.2 23.6 2.2 16 C2.2 8.4 8.4 2.2 16 2.2 Z M16 4.6 C9.7 4.6 4.6 9.7 4.6 16 C4.6 22.3 9.7 27.4 16 27.4 C22.3 27.4 27.4 22.3 27.4 16 C27.4 9.7 22.3 4.6 16 4.6 Z"/>
<path fill="#f4f4f5" fill-rule="evenodd" d="M16 2.2 C21.2 2.2 24.3 8.4 24.3 16 C24.3 23.6 21.2 29.8 16 29.8 C10.8 29.8 7.7 23.6 7.7 16 C7.7 8.4 10.8 2.2 16 2.2 Z M16 4.6 C12.3 4.6 9.6 9.3 9.6 16 C9.6 22.7 12.3 27.4 16 27.4 C19.7 27.4 22.4 22.7 22.4 16 C22.4 9.3 19.7 4.6 16 4.6 Z"/>
<rect fill="#f4f4f5" x="14.95" y="2.6" width="2.1" height="26.8"/>
<rect fill="#f4f4f5" x="2.6" y="14.95" width="26.8" height="2.1"/>
<path fill="#f4f4f5" d="M4.8 7.6 Q16 12.6 27.2 7.6 L27.2 9.8 Q16 14.8 4.8 9.8 Z M4.8 22.2 Q16 17.2 27.2 22.2 L27.2 24.4 Q16 19.4 4.8 24.4 Z"/>
</svg>"""


def write_raster(out_name: str, im: Image.Image) -> None:
    dest = OUT / f"{out_name}.png"
    im.save(dest)
    icon = im.resize((ICON, ICON), Image.Resampling.LANCZOS)
    raw = bytearray(b"ICO1")
    raw += ICON.to_bytes(2, "little")
    raw += ICON.to_bytes(2, "little")
    alpha = bytearray()
    for y in range(ICON):
        for x in range(ICON):
            r, g, b, a = icon.getpixel((x, y))
            rgb565 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
            raw += int(rgb565).to_bytes(2, "little")
            alpha.append(a)
    raw += alpha
    DIST_ICONS.mkdir(parents=True, exist_ok=True)
    icon_bin = DIST_ICONS / f"{out_name}.icon.bin"
    icon_bin.write_bytes(raw)
    (OUT / f"{out_name}.icon.bin").write_bytes(raw)
    if out_name in ("settings", "stream", "stick", "power"):
        app_icon = ROOT / "dist" / "apps" / out_name / "icon.bin"
        app_icon.parent.mkdir(parents=True, exist_ok=True)
        app_icon.write_bytes(raw)
    print(f"wrote {dest} {icon_bin}")


def write_space_bar() -> None:
    # Lucide's space mark sits on the bottom edge of the viewBox and disappears
    # on a 16px key. Draw a centered space bar instead.
    svg = """<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <path d="M14 24v14h36V24" fill="none" stroke="#f4f0e6" stroke-width="5"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>"""
    png = svg2png(bytestring=svg.encode(), output_width=SIZE, output_height=SIZE)
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    write_raster("space", im)


def write_internet_globe() -> None:
    png = svg2png(bytestring=INTERNET_SVG.encode(), output_width=SIZE, output_height=SIZE)
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    write_raster("globe", im)


def main() -> int:
    if not LUCIDE_JS.is_file():
        print(f"missing {LUCIDE_JS}", file=sys.stderr)
        return 1
    source = LUCIDE_JS.read_text()
    OUT.mkdir(parents=True, exist_ok=True)
    for out_name, lucide_id in ICONS:
        try:
            body = extract_array_before(source, f'createLucideIcon("{lucide_id}"')
        except KeyError:
            try:
                body = extract_node_array(source, lucide_id)
            except KeyError:
                print(f"lucide icon {lucide_id} not found", file=sys.stderr)
                return 1
        svg = node_to_svg(body)
        if "<path" not in svg and lucide_id == "settings":
            print(svg, file=sys.stderr)
            return 1
        png = svg2png(bytestring=svg.encode(), output_width=SIZE, output_height=SIZE)
        im = Image.open(io.BytesIO(png)).convert("RGBA")
        write_raster(out_name, im)
    write_space_bar()
    write_internet_globe()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
