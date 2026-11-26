#!/usr/bin/env python3
"""Reject mixed source/resource/bytecode artifacts before packaging."""
import hashlib
import json
from pathlib import Path
import sys


def check(root):
    sources = sorted(root.rglob("main.vue-vapor.js"))
    if not sources:
        raise ValueError(f"no screen bundles in {root}; run make app")
    for source in sources:
        code = source.with_suffix(".jsc")
        resource = source.with_suffix(".pak")
        meta = json.loads(Path(f"{code}.meta").read_text())
        expected = {
            "abi": Path(f"{code}.abi").read_text(),
            "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "resources_sha256": hashlib.sha256(resource.read_bytes()).hexdigest(),
            "bytecode_sha256": hashlib.sha256(code.read_bytes()).hexdigest(),
        }
        if meta != expected:
            raise ValueError(f"stale or mixed screen bundle: {source.parent}; run make app")
    return len(sources)


if __name__ == "__main__":
    try:
        count = check(Path(sys.argv[1] if len(sys.argv) > 1 else "dist"))
        print(f"verified {count} screen bundles")
    except (OSError, ValueError, KeyError) as error:
        sys.exit(f"screen bundle check failed: {error}")
