import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPT_DIR))

import main  # noqa: E402


class ProcessArticleArchiveTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.daily_dir = self.tmp / "download" / "2026-11-26"
        self.daily_dir.mkdir(parents=True)
        self.pdf_path = self.daily_dir / "测试文章.pdf"
        self.pdf_path.write_bytes(b"%PDF-1.4 test")
        self.md_path = self.daily_dir / "测试文章.md"
        self.md_path.write_text("这是一段正常的摘要内容。" * 20, encoding="utf-8")
        self.staging = self.tmp / "staging"
        self.config = {
            "storage": {
                "download_root": str(self.tmp / "download"),
                "logs_root": str(self.tmp / "logs"),
                "archive_enabled": True,
                "archive_root": str(self.staging),
            },
            "pdf_download": {"match_threshold": 0},
        }
        self.article = {"id": 101, "title": "测试文章", "source_name": "测试来源"}
        self.logger = mock.Mock()

    def tearDown(self):
        self._tmp.cleanup()

    def run_process_article(self, *, lis_rss_ok=True, archive_source="daily", summary=None):
        events = []

        async def fake_upload(**kwargs):
            events.append("upload")
            return {
                "hiagent_rag": True,
                "lis_rss": lis_rss_ok,
                "memos": True,
                "blinko": False,
                "wechat": False,
            }

        real_finalize = main.finalize_pdf

        def fake_finalize(*args, **kwargs):
            events.append("finalize")
            return real_finalize(*args, **kwargs)

        with (
            mock.patch("main.download_pdf", return_value=str(self.pdf_path)),
            mock.patch("main.validate_and_cleanup", return_value=(True, "ok")),
            mock.patch("main.summarize_pdf", side_effect=summary),
            mock.patch("main.parallel_upload", side_effect=fake_upload),
            mock.patch("main.notify_main_app_pdf_summary", return_value=True),
            mock.patch("main.finalize_pdf", side_effect=fake_finalize) as finalize_mock,
        ):
            result = main.process_article(
                self.article,
                self.config,
                self.daily_dir,
                self.logger,
                archive_source=archive_source,
            )
        return result, events, finalize_mock

    def normal_summary(self, pdf_path, config):
        return str(self.md_path)

    def test_daily_stages_after_lis_rss_commit(self):
        result, events, finalize_mock = self.run_process_article(
            lis_rss_ok=True, summary=self.normal_summary
        )
        self.assertTrue(result["success"])
        self.assertEqual(events, ["upload", "finalize"])
        finalize_mock.assert_called_once()
        self.assertEqual(finalize_mock.call_args.args[3], "daily")
        target = self.staging / "daily" / "2026-11-26" / "101.pdf"
        self.assertTrue(target.is_file())
        self.assertFalse(self.pdf_path.exists())

    def test_daily_does_not_stage_when_lis_rss_fails(self):
        result, events, finalize_mock = self.run_process_article(
            lis_rss_ok=False, summary=self.normal_summary
        )
        self.assertTrue(result["success"])
        self.assertEqual(events, ["upload"])
        finalize_mock.assert_not_called()
        self.assertFalse(self.pdf_path.exists())
        self.assertFalse((self.staging / "daily" / "2026-11-26" / "101.pdf").exists())

    def test_manual_deletes_before_upload(self):
        result, events, finalize_mock = self.run_process_article(
            lis_rss_ok=True, archive_source="manual", summary=self.normal_summary
        )
        self.assertTrue(result["success"])
        self.assertEqual(events, ["finalize", "upload"])
        finalize_mock.assert_called_once()
        self.assertEqual(finalize_mock.call_args.args[3], "manual")
        self.assertFalse(self.pdf_path.exists())
        self.assertFalse(self.staging.exists())

    def test_summary_failure_keeps_pdf(self):
        result, events, finalize_mock = self.run_process_article(
            summary=lambda pdf_path, config: None
        )
        self.assertFalse(result["success"])
        self.assertEqual(events, [])
        finalize_mock.assert_not_called()
        self.assertTrue(self.pdf_path.exists())

    def test_summary_error_deletes_pdf(self):
        self.md_path.write_text("处理失败", encoding="utf-8")

        def error_summary(pdf_path, config):
            return str(self.md_path)

        result, events, finalize_mock = self.run_process_article(summary=error_summary)
        self.assertFalse(result["success"])
        self.assertEqual(events, [])
        finalize_mock.assert_not_called()
        self.assertFalse(self.pdf_path.exists())
        self.assertFalse(self.md_path.exists())


class SummaryOnlyArchiveTests(unittest.TestCase):
    def test_summary_only_manual_deletes_pdf(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            daily_dir = tmp / "download" / "2026-11-26"
            daily_dir.mkdir(parents=True)
            pdf_path = daily_dir / "测试文章.pdf"
            pdf_path.write_bytes(b"%PDF-1.4 test")
            md_path = daily_dir / "测试文章.md"
            md_path.write_text("正常摘要" * 100, encoding="utf-8")
            config = {
                "storage": {
                    "archive_enabled": True,
                    "archive_root": str(tmp / "staging"),
                }
            }
            article = {"id": 101, "title": "测试文章"}
            with (
                mock.patch("main.download_pdf", return_value=str(pdf_path)),
                mock.patch("main.validate_and_cleanup", return_value=(True, "ok")),
                mock.patch("main.summarize_pdf", return_value=str(md_path)),
                mock.patch("main.finalize_pdf") as finalize_mock,
            ):
                result = main.process_article_summary_only(article, config, daily_dir)
            self.assertTrue(result["success"])
            finalize_mock.assert_called_once()
            self.assertEqual(finalize_mock.call_args.args[3], "manual")


if __name__ == "__main__":
    unittest.main()
