#!/usr/bin/env python3
"""Print built-in and contributed App titles for PocketJS launcher glyphs."""

import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parents[1]
out: list[str] = []


def walk(value: object) -> None:
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, dict):
        for item in value.values():
            walk(item)
    elif isinstance(value, list):
        for item in value:
            walk(item)


for path in sorted((root / "apps").glob("*/plugin.json")):
    walk(json.loads(path.read_text(encoding="utf-8")))
sys.stdout.write("".join(out))
