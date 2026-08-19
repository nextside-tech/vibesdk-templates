import tempfile
import unittest
import zipfile
from pathlib import Path

from create_zip import create_zip


class CreateZipTest(unittest.TestCase):
    def test_keeps_dev_vars_example_and_excludes_runtime_secret(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            source = root / "template"
            archive = root / "template.zip"
            source.mkdir()
            (source / ".dev.vars").write_text("SECRET=real\n", encoding="utf-8")
            (source / ".dev.vars.example").write_text(
                "SECRET=replace-me\n",
                encoding="utf-8",
            )

            self.assertTrue(create_zip(source, archive))

            with zipfile.ZipFile(archive) as zipped:
                self.assertIn(".dev.vars.example", zipped.namelist())
                self.assertNotIn(".dev.vars", zipped.namelist())


if __name__ == "__main__":
    unittest.main()
