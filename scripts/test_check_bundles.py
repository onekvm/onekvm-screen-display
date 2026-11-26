import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from check_bundles import check


class BundleAbiTests(unittest.TestCase):
    def test_target_abi_is_checked_in_addition_to_hashes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for bundle in (root, root / "init", root / "apps" / "settings"):
                bundle.mkdir(parents=True, exist_ok=True)
                hashes = {}
                for suffix, field in (("js", "source"), ("pak", "resources"), ("jsc", "bytecode")):
                    content = suffix.encode()
                    (bundle / f"main.vue-vapor.{suffix}").write_bytes(content)
                    hashes[f"{field}_sha256"] = hashlib.sha256(content).hexdigest()
                (bundle / "main.vue-vapor.jsc.abi").write_text("pocketjs/qjs-0.12.2/64-le")
                (bundle / "main.vue-vapor.jsc.meta").write_text(json.dumps({
                    "abi": "pocketjs/qjs-0.12.2/64-le", **hashes,
                }))
            self.assertEqual(check(root), 3)
            self.assertEqual(check(root, "pocketjs/qjs-0.12.2/64-le"), 3)
            with self.assertRaisesRegex(ValueError, "wrong screen bytecode ABI"):
                check(root, "pocketjs/qjs-0.12.2/32-le")
            (root / "main.vue-vapor.js").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "stale or mixed"):
                check(root, "pocketjs/qjs-0.12.2/64-le")


if __name__ == "__main__":
    unittest.main()
