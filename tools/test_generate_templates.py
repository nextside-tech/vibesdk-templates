import json
import tempfile
import unittest
from pathlib import Path

import yaml

from tools.generate_templates import TemplateGenerator


class TemplateGeneratorTest(unittest.TestCase):
    def test_overlay_package_and_dev_vars_example_are_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            reference = root / "reference" / "vite-reference"
            overlay = root / "definitions" / "golden"
            reference.mkdir(parents=True)
            overlay.mkdir(parents=True)
            (reference / "package.json").write_text(
                json.dumps({"name": "reference", "scripts": {"build": "vite build"}}),
                encoding="utf-8",
            )
            (overlay / "package.json").write_text(
                json.dumps({"name": "golden", "scripts": {"validate": "bash scripts/validate.sh"}}),
                encoding="utf-8",
            )
            (overlay / ".dev.vars.example").write_text(
                "BETTER_AUTH_SECRET=replace-me\n",
                encoding="utf-8",
            )
            definition = {
                "name": "golden",
                "base_reference": "vite-reference",
                "overlay_package_json": True,
            }
            (root / "definitions" / "golden.yaml").write_text(
                yaml.safe_dump(definition),
                encoding="utf-8",
            )

            generated = TemplateGenerator(root).generate_specific_template("golden")

            self.assertTrue(generated)
            package = json.loads((root / "build" / "golden" / "package.json").read_text())
            self.assertEqual(package["name"], "golden")
            self.assertIn("validate", package["scripts"])
            self.assertTrue((root / "build" / "golden" / ".dev.vars.example").is_file())


if __name__ == "__main__":
    unittest.main()
