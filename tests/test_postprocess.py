"""Checks the Python CLI cleans messages exactly like the VS Code extension (shared cases).

Run: python -m unittest tests.test_postprocess
"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from commit_model.postprocess import clean_message  # noqa: E402

CASES = json.loads((ROOT / "vscode-extension" / "test" / "clean-cases.json").read_text())


class CleanMessageTest(unittest.TestCase):
    def test_shared_cases(self):
        for message, expected in CASES:
            with self.subTest(message=message):
                self.assertEqual(clean_message(message), expected)


if __name__ == "__main__":
    unittest.main()
