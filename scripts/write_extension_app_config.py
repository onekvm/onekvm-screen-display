#!/usr/bin/env python3
from pathlib import Path
import json
import os
import sys

if len(sys.argv) != 6:
    raise SystemExit("usage: write_extension_app_config.py extension title icon kind actions-json")
extension, title, icon, kind, actions = sys.argv[1:]
json.loads(actions)
configured_root = os.environ.get("ONEKVM_EXTENSION_APP_ROOT")
root = Path(configured_root) if configured_root else Path(__file__).resolve().parents[1].joinpath("apps/extension-screen")
root.joinpath("src/config.ts").write_text(
    "export const CONFIG = " + json.dumps({
        "extension": extension,
        "title": title,
        "icon": icon,
        "statusMethod": "status",
        "actions": json.loads(actions),
        "kind": kind,
    }, ensure_ascii=False, indent=2) + " as const;\n"
)
