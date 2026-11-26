#!/usr/bin/env python3
"""Build the screen App sources owned by the contributing repositories."""

import argparse
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
EXTENSIONS = ("tailscale", "netbird", "zerotier", "easytier", "wake-on-lan")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("extensions", nargs="*", choices=EXTENSIONS)
    parser.add_argument("--workspace", type=Path, default=ROOT.parent)
    parser.add_argument("--pocketjs", type=Path, default=ROOT.parent / "tmp/pocketjs")
    parser.add_argument("--bun", default=shutil.which("bun"))
    args = parser.parse_args()
    if not args.bun:
        parser.error("bun is required")
    for extension in args.extensions or EXTENSIONS:
        repo = args.workspace.resolve() / f"onekvm-extension-{extension}"
        command = ["make", "-C", str(repo / "screen-app"),
                   f"POCKETJS={args.pocketjs.resolve()}", f"BUN={args.bun}",
                   f"SCREEN_UI={ROOT / 'packages/screen-ui'}"]
        for weight, variable in (("Regular", "FONT_REG"), ("Bold", "FONT_BOLD")):
            font = ROOT / f".fonts/NotoSansCJK-SC-{weight}.otf"
            if font.is_file():
                command.append(f"{variable}={font}")
        subprocess.run(command, cwd=ROOT, check=True)
        print(f"Built {extension}: {repo / 'screen-app/dist'}", flush=True)


if __name__ == "__main__":
    main()
