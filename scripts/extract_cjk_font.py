#!/usr/bin/env python3
"""Install the screen-display CJK UI faces into .fonts/.

Noto Sans CJK SC is extracted first: its denser hinted forms stay clearer on
the 172×320 RGB565 panel. IBM Plex Sans SC remains the network fallback.
"""

from pathlib import Path
import hashlib
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".fonts"
NOTO_TTC = Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")
NOTO_TTC_BOLD = Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc")

# IBM/plex master unhinted complete TTFs (OFL). PocketJS bakes outlines, so
# native hinter tables do not matter.
PLEX = (
    (
        "IBMPlexSansSC-Regular.ttf",
        "https://raw.githubusercontent.com/IBM/plex/master/packages/plex-sans-sc/fonts/complete/ttf/unhinted/IBMPlexSansSC-Regular.ttf",
    ),
    (
        "IBMPlexSansSC-Bold.ttf",
        "https://raw.githubusercontent.com/IBM/plex/master/packages/plex-sans-sc/fonts/complete/ttf/unhinted/IBMPlexSansSC-Bold.ttf",
    ),
    (
        "OFL-IBM-Plex-Sans-SC.txt",
        "https://raw.githubusercontent.com/IBM/plex/master/packages/plex-sans-sc/fonts/complete/ttf/unhinted/license.txt",
    ),
)


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"fetch {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "onekvm-screen-display/font-fetch"})
    with urllib.request.urlopen(req, timeout=120) as src, tmp.open("wb") as out:
        while True:
            chunk = src.read(1024 * 256)
            if not chunk:
                break
            out.write(chunk)
    tmp.replace(dest)
    digest = hashlib.sha256(dest.read_bytes()).hexdigest()[:16]
    print(f"wrote {dest} ({dest.stat().st_size} bytes, sha256 {digest}…)")


def fetch_plex() -> bool:
    try:
        for name, url in PLEX:
            dest = OUT / name
            if dest.is_file() and dest.stat().st_size > 1024:
                continue
            _download(url, dest)
        return (OUT / "IBMPlexSansSC-Regular.ttf").is_file()
    except Exception as err:
        print(f"IBM Plex Sans SC fetch failed: {err}", file=sys.stderr)
        return False


def extract_noto_sc(ttc_path: Path, dest: Path, bold: bool) -> bool:
    try:
        from fontTools.ttLib import TTCollection
    except ImportError:
        print("fonttools missing; cannot extract Noto SC fallback", file=sys.stderr)
        return False
    if not ttc_path.is_file():
        return False
    ttc = TTCollection(str(ttc_path))
    chosen = None
    for font in ttc.fonts:
        names = []
        for rec in font["name"].names:
            if rec.nameID in (1, 4, 6, 16):
                try:
                    names.append(rec.toUnicode())
                except Exception:
                    pass
        blob = " ".join(names)
        if "CJK SC" in blob or "CJKsc" in blob or "NotoSansCJKsc" in blob:
            if "Mono" in blob:
                continue
            chosen = font
            break
    if chosen is None:
        print(f"no SC face in {ttc_path}", file=sys.stderr)
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    chosen.save(str(dest))
    print(f"wrote {dest} from {ttc_path.name} ({'Bold' if bold else 'Regular'} SC)")
    return True


def main() -> int:
    regular = OUT / "NotoSansCJK-SC-Regular.otf"
    bold = OUT / "NotoSansCJK-SC-Bold.otf"
    ok = regular.is_file() or extract_noto_sc(NOTO_TTC, regular, False)
    if not bold.is_file():
        extract_noto_sc(NOTO_TTC_BOLD, bold, True)
    if ok:
        return 0
    print("Noto Sans CJK SC unavailable; falling back to IBM Plex Sans SC", file=sys.stderr)
    fetch_plex()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
