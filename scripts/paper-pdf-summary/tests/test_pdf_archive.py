import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPT_DIR))

from utils.pdf_archive import finalize_pdf, safe_article_id  # noqa: E402


class PdfArchiveTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.staging = self.tmp / "staging"
        self.work = self.tmp / "download" / "2026-11-26"
        self.work.mkdir(parents=True)
        self.config = {
            "storage": {
                "archive_enabled": True,
                "archive_root": str(self.staging),
            }
        }

    def tearDown(self):
        self._tmp.cleanup()

    def make_pdf(self, name="123.pdf", content=b"%PDF-1.4 test"):
        path = self.work / name
        path.write_bytes(content)
        return path

    def test_safe_article_id(self):
        self.assertEqual(safe_article_id(123), "123")
        self.assertEqual(safe_article_id("a/b:c d"), "a_b_c_d")

    def test_daily_moves_pdf_to_staging(self):
        source = self.make_pdf()
        target = finalize_pdf(str(source), 123, "2026-11-26", "daily", self.config)
        self.assertIsNotNone(target)
        self.assertFalse(source.exists())
        self.assertEqual(target, self.staging / "daily" / "2026-11-26" / "123.pdf")
        self.assertEqual(target.read_bytes(), b"%PDF-1.4 test")

    def test_daily_overwrites_existing_target(self):
        target = self.staging / "daily" / "2026-11-26" / "123.pdf"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"%PDF-1.4 old")
        source = self.make_pdf(content=b"%PDF-1.4 new")
        result = finalize_pdf(str(source), 123, "2026-11-26", "daily", self.config)
        self.assertEqual(result, target)
        self.assertEqual(target.read_bytes(), b"%PDF-1.4 new")
        self.assertFalse(source.exists())

    def test_manual_deletes_pdf(self):
        source = self.make_pdf()
        result = finalize_pdf(str(source), 123, "2026-11-26", "manual", self.config)
        self.assertIsNone(result)
        self.assertFalse(source.exists())
        self.assertFalse(self.staging.exists())

    def test_zero_article_id_deletes_pdf(self):
        source = self.make_pdf()
        result = finalize_pdf(str(source), 0, "2026-11-26", "daily", self.config)
        self.assertIsNone(result)
        self.assertFalse(source.exists())

    def test_disabled_archive_deletes_pdf(self):
        self.config["storage"]["archive_enabled"] = False
        source = self.make_pdf()
        result = finalize_pdf(str(source), 123, "2026-11-26", "daily", self.config)
        self.assertIsNone(result)
        self.assertFalse(source.exists())
        self.assertFalse(self.staging.exists())

    def test_invalid_date_uses_today(self):
        source = self.make_pdf()
        target = finalize_pdf(str(source), 123, "not-a-date", "daily", self.config)
        self.assertEqual(
            target, self.staging / "daily" / date.today().isoformat() / "123.pdf"
        )

    def test_missing_source_returns_none(self):
        result = finalize_pdf(
            str(self.work / "missing.pdf"), 123, "2026-11-26", "daily", self.config
        )
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
