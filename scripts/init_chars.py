#!/usr/bin/env python3
"""Codepoints for the init bundle atlas. Reads UI literals so # and $ never enter the Makefile."""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILES = [
    ROOT / "src/init/flow.ts",
    ROOT / "src/init/Init.tsx",
    ROOT / "src/init/StartupDialog.tsx",
    ROOT / "src/init/startup-copy.ts",
    ROOT / "src/init/DiagnosticsDialog.tsx",
    ROOT / "src/init/AdbDialog.tsx",
    ROOT / "src/shell/keypad.ts",
    ROOT / "src/shell/Keyboard.tsx",
    ROOT / "apps/settings/src/timezone-ids.ts",
]
LITERAL = re.compile(r'"([^"\\]|\\.)*"|\'([^\'\\]|\\.)*\'')
FORCE = (
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    " .:%+-*/_@!?#$&'=()~,;<>"
)


def literals(text: str) -> str:
    out = []
    for match in LITERAL.finditer(text):
        raw = match.group(0)[1:-1]
        raw = raw.replace("\\n", "\n").replace("\\t", "\t").replace("\\'", "'").replace('\\"', '"')
        out.append(raw)
    return "".join(out)


def main() -> None:
    chars = set(FORCE)
    for path in FILES:
        chars.update(literals(path.read_text(encoding="utf-8")))
    chars.discard("\n")
    chars.discard("\r")
    chars.discard('"')
    chars.discard("\\")
    chars.discard("`")
    sys.stdout.write("".join(sorted(chars)))


if __name__ == "__main__":
    main()
