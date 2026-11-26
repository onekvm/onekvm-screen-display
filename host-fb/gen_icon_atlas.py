#!/usr/bin/env python3
"""Raster the same Lucide icons OneKVM Vue uses (@lucide/vue) into icon_atlas.h."""

from __future__ import annotations

import io
import re
from pathlib import Path

from PIL import Image, ImageDraw

try:
    from cairosvg import svg2png
except ImportError as exc:  # pragma: no cover
    raise SystemExit("need cairosvg (python3 -m venv && pip install cairosvg)") from exc

LUCIDE_JS = Path(
    "/home/samlm/projects/onekvm/onekvm-ui/node_modules/@lucide/vue/dist/cjs/lucide-vue.js"
)
OUT = Path(__file__).with_name("icon_atlas.h")

# Vue / manifest names -> Lucide createLucideIcon() kebab id
ICONS = (
    ("settings", "settings"),
    ("hdmi", "hdmi-port"),
    ("usb", "usb"),
    ("net", "network"),
)
SIZE = 32
HI = 64


def extract_nodes(source: str) -> dict[str, str]:
    nodes: dict[str, str] = {}
    for match in re.finditer(
        r"const (__iconNode\$\w+) = \[(.*?)\];\s*const \w+ = createLucideIcon\(\"([^\"]+)\"",
        source,
        re.S,
    ):
        nodes[match.group(3)] = match.group(2)
    return nodes


def node_to_svg(body: str) -> str:
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"']
    parts.append(' stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">')
    for tag, raw in re.findall(r'\["(\w+)",\s*\{([^}]*)\}', body):
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


def raster(svg: str) -> list[int]:
    png = svg2png(bytestring=svg.encode(), output_width=HI, output_height=HI)
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    lo = im.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    return [px[3] for px in lo.getdata()]


def emit(icons: list[tuple[str, list[int]]]) -> str:
    bitmap: list[int] = []
    rows = []
    for name, pix in icons:
        off = len(bitmap)
        bitmap.extend(pix)
        rows.append(f'\t{{ "{name}", {SIZE}, {SIZE}, {off} }},')
    parts = [str(v) for v in bitmap]
    wrapped = []
    for i in range(0, len(parts), 16):
        wrapped.append("\t" + ", ".join(parts[i : i + 16]) + ",")
    return (
        "#ifndef SCREEN_DISPLAY_ICON_ATLAS_H\n"
        "#define SCREEN_DISPLAY_ICON_ATLAS_H\n\n"
        "#include <stdint.h>\n\n"
        "struct icon_bitmap {\n"
        "\tconst char *id;\n"
        "\tuint8_t w, h;\n"
        "\tuint32_t off;\n"
        "};\n\n"
        f"#define ICON_ATLAS_SIZE {SIZE}\n"
        f"#define ICON_ATLAS_COUNT {len(icons)}\n"
        f"#define ICON_ATLAS_BYTES {len(bitmap)}\n"
        "static const uint8_t ICON_ATLAS_BITMAP[ICON_ATLAS_BYTES] = {\n"
        + "\n".join(wrapped)
        + "\n};\n"
        "static const struct icon_bitmap ICON_ATLAS[ICON_ATLAS_COUNT] = {\n"
        + "\n".join(rows)
        + "\n};\n\n#endif\n"
    )


def main() -> None:
    source = LUCIDE_JS.read_text()
    nodes = extract_nodes(source)
    missing = [kebab for _, kebab in ICONS if kebab not in nodes]
    if missing:
        raise SystemExit(f"lucide icons not found: {missing}")
    rendered = []
    for name, kebab in ICONS:
        svg = node_to_svg(nodes[kebab])
        rendered.append((name, raster(svg)))
        print(name, "<-", kebab, "svg", len(svg))
    OUT.write_text(emit(rendered))
    print("wrote", OUT, "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
