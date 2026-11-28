import hashlib
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import date, timedelta, timezone
from pathlib import Path
from unittest import mock

SCRIPT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPT_DIR))

import sync_to_wiki as sync  # noqa: E402


WIKI_SCHEMA = """
CREATE TABLE article_tasks (
    article_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT,
    ai_summary TEXT,
    ai_summary_sha256 TEXT,
    pdf_filename TEXT,
    source_sha256 TEXT,
    published_date TEXT,
    source_name TEXT,

    parser_version TEXT,
    parsed_md_path TEXT,
    parsed_at DATETIME,
    extract_prompt_version TEXT,
    extracted_source_sha256 TEXT,
    extracted_summary_sha256 TEXT,
    raw_extracted_json TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('awaiting_pdf', 'pending', 'parsed', 'extracted', 'merged', 'failed')),
    error_msg TEXT,
    created_at DATETIME NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now', 'localtime')),
    CHECK (status IN ('awaiting_pdf', 'failed') OR (pdf_filename IS NOT NULL AND source_sha256 IS NOT NULL))
);
"""

RSS_SCHEMA = """
CREATE TABLE rss_sources (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);
CREATE TABLE journals (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);
CREATE TABLE articles (
    id INTEGER PRIMARY KEY,
    rss_source_id INTEGER,
    journal_id INTEGER,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    ai_summary TEXT,
    published_at DATETIME,
    filter_status TEXT DEFAULT 'pending'
);
"""


class SyncTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.rss_db = self.tmp / "rss.db"
        self.wiki_db = self.tmp / "wiki.db"
        self.pdf_root = self.tmp / "pdfs"
        self.staging_root = self.tmp / "staging"
        self.journals_yaml = self.tmp / "journals_list.yaml"
        self.journals_yaml.write_text("- 测试期刊\n", encoding="utf-8")
        self.summary_journals_yaml = self.tmp / "journals_summary_list.yaml"
        self.summary_journals_yaml.write_text("- 摘要期刊\n", encoding="utf-8")
        self._init_rss()
        self._init_wiki()
        # 摘要白名单中的期刊必须在上游库中存在，否则 resolve_sync_scopes 会报错。
        self.add_source(99, "摘要期刊")

    def tearDown(self):
        self._tmp.cleanup()

    def _init_rss(self):
        conn = sqlite3.connect(self.rss_db)
        conn.executescript(RSS_SCHEMA)
        conn.commit()
        conn.close()

    def _init_wiki(self, schema=WIKI_SCHEMA):
        conn = sqlite3.connect(self.wiki_db)
        conn.executescript(schema)
        conn.commit()
        conn.close()

    def config(self, **overrides):
        values = dict(
            rss_db=self.rss_db,
            wiki_db=self.wiki_db,
            pdf_root=self.pdf_root,
            staging_root=self.staging_root,
            journals_list=self.journals_yaml,
            journal_names=("测试期刊",),
            summary_journals_list=self.summary_journals_yaml,
            summary_journal_names=("摘要期刊",),
            anchor_date=date(1970, 1, 1),
            daily_limit=3,
            backfill_batch_size=200,
            delete_source=True,
            enabled=True,
        )
        values.update(overrides)
        return sync.SyncConfig(**values)

    def add_source(self, source_id=1, name="测试期刊"):
        conn = sqlite3.connect(self.rss_db)
        conn.execute("INSERT INTO rss_sources (id, name) VALUES (?, ?)", (source_id, name))
        conn.commit()
        conn.close()

    def add_journal(self, journal_id=1, name="测试期刊"):
        conn = sqlite3.connect(self.rss_db)
        conn.execute("INSERT INTO journals (id, name) VALUES (?, ?)", (journal_id, name))
        conn.commit()
        conn.close()

    def add_article(
        self,
        article_id,
        title="测试文章",
        summary="这是摘要",
        *,
        url=None,
        published_at="2026-11-20T12:00:00Z",
        rss_source_id=1,
        journal_id=None,
    ):
        conn = sqlite3.connect(self.rss_db)
        conn.execute(
            """
            INSERT INTO articles
                (id, rss_source_id, journal_id, title, url, ai_summary, published_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                article_id,
                rss_source_id,
                journal_id,
                title,
                url or f"https://example.com/{article_id}",
                summary,
                published_at,
            ),
        )
        conn.commit()
        conn.close()

    def write_pdf(self, relative_path, content=b"%PDF-1.4 test"):
        path = self.staging_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def wiki_rows(self):
        conn = sqlite3.connect(self.wiki_db)
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM article_tasks ORDER BY article_id").fetchall()
        conn.close()
        return rows

    def wiki_row(self, article_id):
        conn = sqlite3.connect(self.wiki_db)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM article_tasks WHERE article_id = ?", (str(article_id),)
        ).fetchone()
        conn.close()
        return row

    def wiki_exec(self, sql, params=()):
        conn = sqlite3.connect(self.wiki_db)
        try:
            conn.execute(sql, params)
            conn.commit()
        finally:
            conn.close()

    def rss_exec(self, sql, params=()):
        conn = sqlite3.connect(self.rss_db)
        try:
            conn.execute(sql, params)
            conn.commit()
        finally:
            conn.close()


class HelperTests(unittest.TestCase):
    def test_period_folder(self):
        anchor = date(1970, 1, 1)
        self.assertEqual(sync.period_folder(date(2026, 11, 26), anchor), "2026-11-23")
        self.assertEqual(sync.period_folder(date(2026, 11, 23), anchor), "2026-11-23")
        self.assertEqual(sync.period_folder(date(2026, 11, 22), anchor), "2026-11-18")
        self.assertEqual(sync.period_folder(date(1970, 1, 1), anchor), "1970-01-01")
        self.assertEqual(sync.period_folder(date(1970, 1, 6), anchor), "1970-01-06")

    def test_safe_article_id(self):
        self.assertEqual(sync.safe_article_id("12345"), "12345")
        self.assertEqual(sync.safe_article_id("a/b:c d"), "a_b_c_d")
        self.assertEqual(sync.safe_article_id(" 42 "), "42")

    def test_local_date(self):
        tz = timezone(timedelta(hours=8))
        self.assertEqual(
            sync.local_date("2026-11-25T16:00:00Z", tz=tz), "2026-11-26"
        )
        self.assertEqual(sync.local_date("2026-11-25", tz=tz), "2026-11-25")
        self.assertEqual(
            sync.local_date("2026-11-25T23:30:00+08:00", tz=tz), "2026-11-25"
        )
        self.assertIsNone(sync.local_date(None))
        self.assertIsNone(sync.local_date(""))
        self.assertIsNone(sync.local_date("not-a-date"))

    def test_config_defaults(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            cfg = sync.SyncConfig.from_env()
        self.assertEqual(cfg.rss_db, sync.PROJECT_ROOT / "data" / "rss-tracker.db")
        self.assertEqual(cfg.wiki_db, Path("/opt/lis-wiki/data/lis_wiki.db").resolve())
        self.assertEqual(cfg.pdf_root, Path("/opt/lis-wiki/data/pdfs").resolve())
        self.assertEqual(cfg.journals_list, sync.DEFAULT_JOURNALS_LIST)
        self.assertEqual(cfg.journals_list.name, "journals_list.yaml")
        self.assertIn("中国图书馆学报", cfg.journal_names)
        self.assertEqual(cfg.summary_journals_list, sync.DEFAULT_SUMMARY_JOURNALS_LIST)
        self.assertEqual(cfg.summary_journals_list.name, "journals_summary_list.yaml")
        self.assertIn("图书情报知识", cfg.summary_journal_names)
        self.assertEqual(cfg.anchor_date, date(1970, 1, 1))
        self.assertEqual(cfg.daily_limit, 3)
        self.assertEqual(cfg.backfill_batch_size, 200)
        self.assertTrue(cfg.delete_source)
        self.assertTrue(cfg.enabled)

    def test_config_invalid_anchor(self):
        with mock.patch.dict(os.environ, {"SYNC_ANCHOR_DATE": "bad"}, clear=True):
            with self.assertRaises(ValueError):
                sync.SyncConfig.from_env()

    def test_config_journals_list_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "custom.yaml"
            path.write_text("- 自定义期刊\n", encoding="utf-8")
            with mock.patch.dict(
                os.environ, {"JOURNALS_LIST_PATH": str(path)}, clear=True
            ):
                cfg = sync.SyncConfig.from_env()
        self.assertEqual(cfg.journals_list, path.resolve())
        self.assertEqual(cfg.journal_names, ("自定义期刊",))

    def test_config_summary_journals_list_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "summary.yaml"
            path.write_text("- 自定义摘要期刊\n", encoding="utf-8")
            with mock.patch.dict(
                os.environ, {"SUMMARY_JOURNALS_LIST_PATH": str(path)}, clear=True
            ):
                cfg = sync.SyncConfig.from_env()
        self.assertEqual(cfg.summary_journals_list, path.resolve())
        self.assertEqual(cfg.summary_journal_names, ("自定义摘要期刊",))

    def test_load_journal_whitelist_trims_and_dedupes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "journals.yaml"
            path.write_text(
                "- 图书馆论坛\n- ' 图书馆论坛 '\n- 图书馆杂志\n",
                encoding="utf-8",
            )
            self.assertEqual(
                sync.load_journal_whitelist(path), ["图书馆论坛", "图书馆杂志"]
            )

    def test_load_journal_whitelist_rejects_missing_empty_and_non_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "missing.yaml"
            with self.assertRaises(ValueError):
                sync.load_journal_whitelist(missing)

            empty = Path(tmp) / "empty.yaml"
            empty.write_text("[]\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                sync.load_journal_whitelist(empty)

            not_list = Path(tmp) / "dict.yaml"
            not_list.write_text("journals: [图书馆论坛]\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                sync.load_journal_whitelist(not_list)

    def test_load_env_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env"
            env_file.write_text(
                "FOO=from_file\nBAR='quoted value'\nexport BAZ=exported\n",
                encoding="utf-8",
            )
            with mock.patch.dict(os.environ, {}, clear=True):
                sync.load_env_file(env_file)
                self.assertEqual(os.environ["FOO"], "from_file")
                self.assertEqual(os.environ["BAR"], "quoted value")
                self.assertEqual(os.environ["BAZ"], "exported")

    def test_load_env_file_does_not_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env"
            env_file.write_text("FOO=from_file\n", encoding="utf-8")
            with mock.patch.dict(os.environ, {"FOO": "existing"}, clear=True):
                sync.load_env_file(env_file)
                self.assertEqual(os.environ["FOO"], "existing")


class JournalScopeTests(SyncTestBase):
    def test_resolve_scope_matches_rss_and_journal(self):
        self.add_source(1, "测试期刊")
        self.add_source(2, "其他期刊")
        self.add_journal(1, "测试期刊")
        self.add_journal(2, "其他期刊")
        conn = sync.connect_upstream(self.rss_db)
        try:
            scope = sync.resolve_journal_scope(conn, ["测试期刊"])
        finally:
            conn.close()
        self.assertEqual(scope.rss_source_ids, (1,))
        self.assertEqual(scope.journal_ids, (1,))

    def test_resolve_scope_no_match(self):
        conn = sync.connect_upstream(self.rss_db)
        try:
            with self.assertRaises(ValueError):
                sync.resolve_journal_scope(conn, ["不存在的期刊"])
        finally:
            conn.close()

    def test_scope_contains(self):
        scope = sync.JournalScope(rss_source_ids=(1,), journal_ids=(2,))
        self.assertTrue(scope.contains({"rss_source_id": 1, "journal_id": None}))
        self.assertTrue(scope.contains({"rss_source_id": None, "journal_id": 2}))
        self.assertFalse(scope.contains({"rss_source_id": 9, "journal_id": 8}))
        self.assertFalse(scope.contains({"rss_source_id": None, "journal_id": None}))


class SyncScopesTests(unittest.TestCase):
    def setUp(self):
        self.scopes = sync.SyncScopes(
            unconditional=sync.JournalScope(rss_source_ids=(1,), journal_ids=()),
            summary_gated=sync.JournalScope(rss_source_ids=(), journal_ids=(2,)),
        )

    @staticmethod
    def row(rss_source_id, journal_id, summary):
        return {
            "rss_source_id": rss_source_id,
            "journal_id": journal_id,
            "ai_summary": summary,
        }

    def test_unconditional_scope_syncs_without_summary(self):
        self.assertTrue(
            sync.is_sync_candidate(self.row(1, None, None), self.scopes)
        )

    def test_summary_scope_syncs_only_with_summary(self):
        self.assertTrue(
            sync.is_sync_candidate(self.row(None, 2, "摘要"), self.scopes)
        )
        self.assertFalse(
            sync.is_sync_candidate(self.row(None, 2, ""), self.scopes)
        )
        self.assertFalse(
            sync.is_sync_candidate(self.row(None, 2, "   "), self.scopes)
        )
        self.assertFalse(
            sync.is_sync_candidate(self.row(None, 2, None), self.scopes)
        )

    def test_out_of_scope_row_never_syncs(self):
        self.assertFalse(
            sync.is_sync_candidate(self.row(9, 8, "摘要"), self.scopes)
        )
        self.assertFalse(
            sync.is_sync_candidate(self.row(None, None, "摘要"), self.scopes)
        )

    def test_sync_condition_sql_matches_python(self):
        sql, params = sync.sync_condition(self.scopes)
        self.assertEqual(
            sql,
            "((a.rss_source_id IN (?)) OR ((a.journal_id IN (?)) "
            "AND (a.ai_summary IS NOT NULL AND TRIM(a.ai_summary) != '')))",
        )
        self.assertEqual(params, [1, 2])


class AtomicCopyTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.src = self.tmp / "source.pdf"
        self.target = self.tmp / "out" / "target.pdf"
        self.src.write_bytes(b"%PDF-1.4 source")

    def tearDown(self):
        self._tmp.cleanup()

    def test_copy_creates_target_and_hash(self):
        digest = sync.atomic_copy_and_hash(self.src, self.target)
        self.assertTrue(self.target.is_file())
        self.assertEqual(self.target.read_bytes(), self.src.read_bytes())
        self.assertEqual(digest, hashlib.sha256(self.src.read_bytes()).hexdigest())
        self.assertEqual(list(self.target.parent.glob("*.tmp")), [])

    def test_reuses_identical_target(self):
        self.target.parent.mkdir(parents=True)
        self.target.write_bytes(self.src.read_bytes())
        inode = self.target.stat().st_ino
        sync.atomic_copy_and_hash(self.src, self.target)
        self.assertEqual(self.target.stat().st_ino, inode)

    def test_overwrites_different_target(self):
        self.target.parent.mkdir(parents=True)
        self.target.write_bytes(b"%PDF-1.4 old")
        sync.atomic_copy_and_hash(self.src, self.target)
        self.assertEqual(self.target.read_bytes(), self.src.read_bytes())

    def test_dry_run_does_not_write(self):
        digest = sync.atomic_copy_and_hash(self.src, self.target, dry_run=True)
        self.assertFalse(self.target.exists())
        self.assertEqual(digest, hashlib.sha256(self.src.read_bytes()).hexdigest())

    def test_rejects_empty_source(self):
        self.src.write_bytes(b"")
        with self.assertRaises(ValueError):
            sync.atomic_copy_and_hash(self.src, self.target)


class UpsertTests(SyncTestBase):
    def item(self, **overrides):
        values = {
            "article_id": "1",
            "title": "标题",
            "url": "https://example.com/1",
            "ai_summary": "摘要",
            "ai_summary_sha256": sync.sha256_text("摘要"),
            "pdf_filename": "2026-11-23/1.pdf",
            "source_sha256": "abc",
            "published_date": "2026-11-20",
            "source_name": "来源",
            "target_status": "pending",
        }
        values.update(overrides)
        return values

    def test_insert_pending(self):
        conn = sync.connect_wiki(self.wiki_db)
        with conn:
            sync.upsert_article(conn, self.item())
        conn.close()
        row = self.wiki_row("1")
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["pdf_filename"], "2026-11-23/1.pdf")
        self.assertEqual(row["source_sha256"], "abc")

    def test_insert_awaiting_pdf(self):
        conn = sync.connect_wiki(self.wiki_db)
        with conn:
            sync.upsert_article(
                conn,
                self.item(
                    pdf_filename=None, source_sha256=None, target_status="awaiting_pdf"
                ),
            )
        conn.close()
        row = self.wiki_row("1")
        self.assertEqual(row["status"], "awaiting_pdf")
        self.assertIsNone(row["pdf_filename"])
        self.assertIsNone(row["source_sha256"])

    def test_insert_null_summary(self):
        conn = sync.connect_wiki(self.wiki_db)
        with conn:
            sync.upsert_article(
                conn, self.item(ai_summary=None, ai_summary_sha256=None)
            )
        conn.close()
        row = self.wiki_row("1")
        self.assertIsNone(row["ai_summary"])
        self.assertIsNone(row["ai_summary_sha256"])
        self.assertEqual(row["status"], "pending")

    def test_promotes_awaiting_pdf_to_pending(self):
        conn = sync.connect_wiki(self.wiki_db)
        with conn:
            sync.upsert_article(
                conn,
                self.item(
                    pdf_filename=None, source_sha256=None, target_status="awaiting_pdf"
                ),
            )
        with conn:
            sync.upsert_article(conn, self.item())
        conn.close()
        row = self.wiki_row("1")
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["pdf_filename"], "2026-11-23/1.pdf")

    def test_coalesce_keeps_existing_pdf(self):
        conn = sync.connect_wiki(self.wiki_db)
        with conn:
            sync.upsert_article(conn, self.item())
        with conn:
            sync.upsert_article(
                conn,
                self.item(
                    title="新标题",
                    ai_summary="新摘要",
                    ai_summary_sha256=sync.sha256_text("新摘要"),
                    pdf_filename=None,
                    source_sha256=None,
                    target_status="awaiting_pdf",
                ),
            )
        conn.close()
        row = self.wiki_row("1")
        self.assertEqual(row["title"], "新标题")
        self.assertEqual(row["ai_summary"], "新摘要")
        self.assertEqual(row["pdf_filename"], "2026-11-23/1.pdf")
        self.assertEqual(row["source_sha256"], "abc")
        self.assertEqual(row["status"], "pending")

    def test_does_not_overwrite_pipeline_status_or_cache(self):
        self.wiki_exec(
            """
            INSERT INTO article_tasks
                (article_id, title, url, ai_summary, ai_summary_sha256,
                 pdf_filename, source_sha256, status,
                 parser_version, parsed_md_path, raw_extracted_json)
            VALUES ('1', '旧标题', 'https://old', '旧摘要', ?, 'old/1.pdf', 'oldsha',
                    'parsed', 'v1', '/tmp/old.md', '{"k":1}')
            """,
            (sync.sha256_text("旧摘要"),),
        )
        conn = sync.connect_wiki(self.wiki_db)
        with conn:
            sync.upsert_article(
                conn,
                self.item(
                    title="新标题",
                    ai_summary="新摘要",
                    ai_summary_sha256=sync.sha256_text("新摘要"),
                    pdf_filename=None,
                    source_sha256=None,
                    target_status="awaiting_pdf",
                ),
            )
        conn.close()
        row = self.wiki_row("1")
        self.assertEqual(row["status"], "parsed")
        self.assertEqual(row["pdf_filename"], "old/1.pdf")
        self.assertEqual(row["source_sha256"], "oldsha")
        self.assertEqual(row["parser_version"], "v1")
        self.assertEqual(row["parsed_md_path"], "/tmp/old.md")
        self.assertEqual(row["raw_extracted_json"], '{"k":1}')
        self.assertEqual(row["title"], "新标题")

    def test_failed_status_not_promoted(self):
        self.wiki_exec(
            """
            INSERT INTO article_tasks
                (article_id, title, url, ai_summary, ai_summary_sha256,
                 pdf_filename, source_sha256, status)
            VALUES ('1', '标题', 'https://example.com/1', '摘要', ?,
                    'old/1.pdf', 'oldsha', 'failed')
            """,
            (sync.sha256_text("摘要"),),
        )
        conn = sync.connect_wiki(self.wiki_db)
        with conn:
            sync.upsert_article(conn, self.item())
        conn.close()
        row = self.wiki_row("1")
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["pdf_filename"], "2026-11-23/1.pdf")
        self.assertEqual(row["source_sha256"], "abc")

    def test_is_changed_detects_noop_and_changes(self):
        conn = sync.connect_wiki(self.wiki_db)
        with conn:
            sync.upsert_article(conn, self.item())
        existing = sync.fetch_existing(conn, ["1"])["1"]
        conn.close()
        self.assertFalse(sync.is_changed(existing, self.item()))
        self.assertTrue(sync.is_changed(existing, self.item(title="另一个标题")))
        # 无 PDF 的重跑不应触发 UPDATE（COALESCE 会保护已有 PDF）
        self.assertFalse(
            sync.is_changed(
                existing,
                self.item(
                    pdf_filename=None,
                    source_sha256=None,
                    target_status="awaiting_pdf",
                ),
            )
        )
        awaiting = {
            "title": "标题",
            "url": "https://example.com/1",
            "ai_summary": "摘要",
            "ai_summary_sha256": sync.sha256_text("摘要"),
            "published_date": "2026-11-20",
            "source_name": "来源",
            "pdf_filename": None,
            "source_sha256": None,
            "status": "awaiting_pdf",
        }
        self.assertTrue(sync.is_changed(awaiting, self.item()))

    def test_is_changed_null_summary_noop(self):
        conn = sync.connect_wiki(self.wiki_db)
        with conn:
            sync.upsert_article(
                conn, self.item(ai_summary=None, ai_summary_sha256=None)
            )
        existing = sync.fetch_existing(conn, ["1"])["1"]
        conn.close()
        self.assertFalse(
            sync.is_changed(
                existing, self.item(ai_summary=None, ai_summary_sha256=None)
            )
        )
        # 上游后来补上摘要时，应触发更新。
        self.assertTrue(sync.is_changed(existing, self.item()))


class StagingIndexTests(SyncTestBase):
    def test_index_prefers_latest_daily_and_excludes_manual(self):
        old = self.write_pdf("daily/2026-11-20/1.pdf")
        new = self.write_pdf("daily/2026-11-26/1.pdf")
        history = self.write_pdf("history/2.pdf")
        self.write_pdf("manual/3.pdf")
        index = sync.build_staging_index(self.staging_root)
        self.assertEqual(set(index), {"1", "2"})
        self.assertEqual(index["1"][0], date(2026, 11, 26))
        self.assertEqual(index["1"][1], new)
        self.assertEqual(index["2"], (None, history))
        self.assertNotEqual(index["1"][1], old)

    def test_index_ignores_non_date_directories(self):
        self.write_pdf("daily/not-a-date/1.pdf")
        index = sync.build_staging_index(self.staging_root)
        self.assertEqual(index, {})


class DailySyncTests(SyncTestBase):
    def setUp(self):
        super().setUp()
        self.add_source()
        self.cfg = self.config()

    def test_daily_sync_end_to_end(self):
        self.add_article(101, title="每日文章", summary="每日摘要")
        source = self.write_pdf("daily/2026-11-26/101.pdf", b"%PDF-1.4 daily")
        stats = sync.sync_daily(self.cfg, date(2026, 11, 26))

        self.assertEqual(stats["scanned"], 1)
        self.assertEqual(stats["pending"], 1)
        self.assertEqual(stats["failed"], 0)
        self.assertFalse(source.exists())

        row = self.wiki_row("101")
        self.assertEqual(row["article_id"], "101")
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["pdf_filename"], "2026-11-23/101.pdf")
        self.assertEqual(row["source_sha256"], hashlib.sha256(b"%PDF-1.4 daily").hexdigest())
        self.assertEqual(row["ai_summary_sha256"], sync.sha256_text("每日摘要"))
        self.assertEqual(row["source_name"], "测试期刊")
        target = self.pdf_root / "2026-11-23" / "101.pdf"
        self.assertEqual(target.read_bytes(), b"%PDF-1.4 daily")

    def test_daily_sync_skips_unchanged(self):
        self.add_article(101)
        source = self.write_pdf("daily/2026-11-26/101.pdf")
        sync.sync_daily(self.cfg, date(2026, 11, 26))
        self.wiki_exec(
            "UPDATE article_tasks SET updated_at = '2000-01-01 00:00:00' WHERE article_id = '101'"
        )
        source.write_bytes(b"%PDF-1.4 test")
        stats = sync.sync_daily(self.cfg, date(2026, 11, 26))
        self.assertEqual(stats["skipped"], 1)
        self.assertEqual(stats["pending"], 0)
        self.assertFalse(source.exists())
        row = self.wiki_row("101")
        self.assertEqual(row["updated_at"], "2000-01-01 00:00:00")

    def test_daily_sync_dry_run(self):
        self.add_article(101)
        source = self.write_pdf("daily/2026-11-26/101.pdf")
        stats = sync.sync_daily(self.cfg, date(2026, 11, 26), dry_run=True)
        self.assertEqual(stats["pending"], 1)
        self.assertTrue(source.exists())
        self.assertIsNone(self.wiki_row("101"))
        self.assertFalse((self.pdf_root / "2026-11-23" / "101.pdf").exists())

    def test_daily_sync_keep_source(self):
        self.add_article(101)
        source = self.write_pdf("daily/2026-11-26/101.pdf")
        stats = sync.sync_daily(
            self.cfg, date(2026, 11, 26), keep_source=True
        )
        self.assertEqual(stats["pending"], 1)
        self.assertTrue(source.exists())
        self.assertIsNotNone(self.wiki_row("101"))

    def test_daily_sync_missing_summary_still_syncs(self):
        self.add_article(101, summary="   ")
        source = self.write_pdf("daily/2026-11-26/101.pdf")
        stats = sync.sync_daily(self.cfg, date(2026, 11, 26))
        self.assertEqual(stats["pending"], 1)
        self.assertEqual(stats["failed"], 0)
        self.assertFalse(source.exists())
        row = self.wiki_row("101")
        self.assertEqual(row["status"], "pending")
        self.assertIsNone(row["ai_summary"])
        self.assertIsNone(row["ai_summary_sha256"])

    def test_daily_sync_summary_whitelist_with_summary_syncs(self):
        self.add_source(2, "摘要期刊")
        self.add_article(101, summary="摘要期刊的摘要", rss_source_id=2)
        source = self.write_pdf("daily/2026-11-26/101.pdf")
        stats = sync.sync_daily(self.cfg, date(2026, 11, 26))
        self.assertEqual(stats["pending"], 1)
        self.assertEqual(stats["out_of_scope"], 0)
        self.assertFalse(source.exists())
        self.assertEqual(self.wiki_row("101")["ai_summary"], "摘要期刊的摘要")

    def test_daily_sync_summary_whitelist_without_summary_skips(self):
        self.add_source(2, "摘要期刊")
        self.add_article(101, summary="   ", rss_source_id=2)
        source = self.write_pdf("daily/2026-11-26/101.pdf")
        stats = sync.sync_daily(self.cfg, date(2026, 11, 26))
        self.assertEqual(stats["out_of_scope"], 1)
        self.assertEqual(stats["pending"], 0)
        self.assertIsNone(self.wiki_row("101"))
        self.assertTrue(source.exists())

    def test_daily_sync_non_whitelist_summary_skips(self):
        self.add_source(2, "其他期刊")
        self.add_article(101, summary="外部摘要", rss_source_id=2)
        source = self.write_pdf("daily/2026-11-26/101.pdf")
        stats = sync.sync_daily(self.cfg, date(2026, 11, 26))
        self.assertEqual(stats["out_of_scope"], 1)
        self.assertEqual(stats["pending"], 0)
        self.assertIsNone(self.wiki_row("101"))
        self.assertTrue(source.exists())

    def test_daily_sync_non_whitelist_without_summary_keeps_source(self):
        self.add_source(2, "其他期刊")
        self.add_article(101, summary="", rss_source_id=2)
        source = self.write_pdf("daily/2026-11-26/101.pdf")
        stats = sync.sync_daily(self.cfg, date(2026, 11, 26))
        self.assertEqual(stats["out_of_scope"], 1)
        self.assertEqual(stats["pending"], 0)
        self.assertIsNone(self.wiki_row("101"))
        self.assertTrue(source.exists())

    def test_daily_sync_missing_article_keeps_source(self):
        source = self.write_pdf("daily/2026-11-26/999.pdf")
        stats = sync.sync_daily(self.cfg, date(2026, 11, 26))
        self.assertEqual(stats["failed"], 1)
        self.assertTrue(source.exists())

    def test_daily_sync_db_failure_keeps_source(self):
        self.add_article(101)
        self.wiki_exec(
            """
            CREATE TRIGGER reject_insert BEFORE INSERT ON article_tasks
            BEGIN
                SELECT RAISE(ABORT, 'rejected');
            END;
            """
        )
        source = self.write_pdf("daily/2026-11-26/101.pdf")
        stats = sync.sync_daily(self.cfg, date(2026, 11, 26))
        self.assertEqual(stats["failed"], 1)
        self.assertTrue(source.exists())

    def test_daily_sync_respects_limit(self):
        for article_id in (1, 2, 3, 4):
            self.add_article(article_id)
            self.write_pdf(f"daily/2026-11-26/{article_id}.pdf")
        stats = sync.sync_daily(self.cfg, date(2026, 11, 26))
        self.assertEqual(stats["scanned"], 3)
        self.assertEqual(stats["pending"], 3)
        self.assertEqual(len(self.wiki_rows()), 3)
        self.assertTrue((self.staging_root / "daily" / "2026-11-26" / "4.pdf").exists())

    def test_daily_limit_counts_only_sync_candidates(self):
        self.add_source(2, "其他期刊")
        for article_id in (1, 2):
            self.add_article(article_id, summary="", rss_source_id=2)
            self.write_pdf(f"daily/2026-11-26/{article_id}.pdf")
        for article_id in (3, 4, 5):
            self.add_article(article_id, summary="")
            self.write_pdf(f"daily/2026-11-26/{article_id}.pdf")

        stats = sync.sync_daily(self.cfg, date(2026, 11, 26))

        self.assertEqual(stats["scanned"], 5)
        self.assertEqual(stats["out_of_scope"], 2)
        self.assertEqual(stats["pending"], 3)
        self.assertEqual({row["article_id"] for row in self.wiki_rows()}, {"3", "4", "5"})
        self.assertTrue((self.staging_root / "daily" / "2026-11-26" / "1.pdf").exists())
        self.assertTrue((self.staging_root / "daily" / "2026-11-26" / "2.pdf").exists())

    def test_daily_sync_ids(self):
        self.add_article(1)
        self.add_article(2)
        self.write_pdf("daily/2026-11-26/1.pdf")
        self.write_pdf("daily/2026-11-26/2.pdf")
        stats = sync.sync_daily(
            self.cfg, date(2026, 11, 26), ids=["2"]
        )
        self.assertEqual(stats["scanned"], 1)
        self.assertIsNone(self.wiki_row("1"))
        self.assertIsNotNone(self.wiki_row("2"))
        self.assertTrue((self.staging_root / "daily" / "2026-11-26" / "1.pdf").exists())

    def test_daily_sync_no_staging_is_noop(self):
        stats = sync.sync_daily(self.cfg, date(2026, 11, 26))
        self.assertEqual(stats["scanned"], 0)
        self.assertEqual(stats["failed"], 0)


class BackfillTests(SyncTestBase):
    def setUp(self):
        super().setUp()
        self.add_source()
        self.cfg = self.config()

    def test_backfill_no_pdf_awaiting(self):
        self.add_article(1, title="无 PDF")
        stats = sync.sync_backfill(self.cfg)
        self.assertEqual(stats["scanned"], 1)
        self.assertEqual(stats["awaiting_pdf"], 1)
        row = self.wiki_row("1")
        self.assertEqual(row["status"], "awaiting_pdf")
        self.assertIsNone(row["pdf_filename"])
        self.assertIsNone(row["source_sha256"])

    def test_backfill_history_pdf_pending(self):
        self.add_article(1)
        source = self.write_pdf("history/1.pdf", b"%PDF-1.4 history")
        stats = sync.sync_backfill(self.cfg)
        self.assertEqual(stats["pending"], 1)
        self.assertFalse(source.exists())
        row = self.wiki_row("1")
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["pdf_filename"], "history/1.pdf")
        self.assertTrue((self.pdf_root / "history" / "1.pdf").is_file())

    def test_backfill_daily_pdf_uses_period_folder(self):
        self.add_article(1)
        source = self.write_pdf("daily/2026-11-26/1.pdf")
        sync.sync_backfill(self.cfg)
        self.assertFalse(source.exists())
        row = self.wiki_row("1")
        self.assertEqual(row["pdf_filename"], "2026-11-23/1.pdf")
        self.assertTrue((self.pdf_root / "2026-11-23" / "1.pdf").is_file())

    def test_backfill_excludes_manual(self):
        self.add_article(1)
        manual = self.write_pdf("manual/1.pdf")
        stats = sync.sync_backfill(self.cfg)
        self.assertEqual(stats["awaiting_pdf"], 1)
        self.assertTrue(manual.exists())
        row = self.wiki_row("1")
        self.assertEqual(row["status"], "awaiting_pdf")
        self.assertIsNone(row["pdf_filename"])

    def test_backfill_includes_whitelisted_empty_summary(self):
        self.add_article(1, title="有摘要")
        self.add_article(2, title="空摘要", summary="")
        self.add_article(3, title="空白摘要", summary="   ")
        stats = sync.sync_backfill(self.cfg)
        self.assertEqual(stats["scanned"], 3)
        self.assertEqual(stats["awaiting_pdf"], 3)
        rows = self.wiki_rows()
        self.assertEqual(len(rows), 3)
        by_id = {row["article_id"]: row for row in rows}
        self.assertEqual(by_id["1"]["ai_summary"], "这是摘要")
        self.assertIsNone(by_id["2"]["ai_summary"])
        self.assertIsNone(by_id["3"]["ai_summary"])
        self.assertIsNone(by_id["2"]["ai_summary_sha256"])
        self.assertIsNone(by_id["3"]["ai_summary_sha256"])

    def test_backfill_includes_summary_whitelist_with_summary(self):
        self.add_source(2, "摘要期刊")
        self.add_article(1, summary="摘要期刊摘要", rss_source_id=2)
        stats = sync.sync_backfill(self.cfg)
        self.assertEqual(stats["scanned"], 1)
        self.assertEqual(stats["awaiting_pdf"], 1)
        row = self.wiki_row("1")
        self.assertEqual(row["ai_summary"], "摘要期刊摘要")
        self.assertEqual(row["source_name"], "摘要期刊")

    def test_backfill_excludes_summary_whitelist_without_summary(self):
        self.add_source(2, "摘要期刊")
        self.add_article(1, summary="", rss_source_id=2)
        stats = sync.sync_backfill(self.cfg)
        self.assertEqual(stats["scanned"], 0)
        self.assertEqual(stats["awaiting_pdf"], 0)
        self.assertIsNone(self.wiki_row("1"))

    def test_backfill_excludes_non_whitelist_summary(self):
        self.add_source(2, "其他期刊")
        self.add_article(1, summary="外部摘要", rss_source_id=2)
        stats = sync.sync_backfill(self.cfg)
        self.assertEqual(stats["scanned"], 0)
        self.assertEqual(stats["awaiting_pdf"], 0)
        self.assertIsNone(self.wiki_row("1"))

    def test_backfill_excludes_non_whitelist_without_summary(self):
        self.add_source(2, "其他期刊")
        self.add_article(1, summary="", rss_source_id=2)
        stats = sync.sync_backfill(self.cfg)
        self.assertEqual(stats["scanned"], 0)
        self.assertEqual(stats["awaiting_pdf"], 0)
        self.assertIsNone(self.wiki_row("1"))

    def test_backfill_excludes_null_source_summary(self):
        # 两份白名单都不命中时，即使有 ai_summary 也不同步。
        self.add_article(1, summary="邮件摘要", rss_source_id=None, journal_id=None)
        stats = sync.sync_backfill(self.cfg)
        self.assertEqual(stats["scanned"], 0)
        self.assertIsNone(self.wiki_row("1"))

    def test_backfill_excludes_null_source_without_summary(self):
        self.add_article(1, summary="", rss_source_id=None, journal_id=None)
        stats = sync.sync_backfill(self.cfg)
        self.assertEqual(stats["scanned"], 0)
        self.assertIsNone(self.wiki_row("1"))

    def test_backfill_matches_journal_id(self):
        self.add_journal(1, "测试期刊")
        self.add_article(
            1, summary="", rss_source_id=None, journal_id=1
        )
        stats = sync.sync_backfill(self.cfg)
        self.assertEqual(stats["scanned"], 1)
        self.assertEqual(stats["awaiting_pdf"], 1)
        self.assertEqual(self.wiki_row("1")["source_name"], "测试期刊")

    def test_backfill_whitelist_ignores_filter_status(self):
        self.add_article(1, summary="")
        self.rss_exec("UPDATE articles SET filter_status = 'rejected' WHERE id = 1")
        stats = sync.sync_backfill(self.cfg)
        self.assertEqual(stats["scanned"], 1)
        self.assertEqual(stats["awaiting_pdf"], 1)
        self.assertIsNotNone(self.wiki_row("1"))

    def test_backfill_union_no_duplicate(self):
        # 同时命中白名单和“有摘要”时，只应产生一条记录。
        self.add_article(1, summary="摘要")
        stats = sync.sync_backfill(self.cfg)
        self.assertEqual(stats["scanned"], 1)
        self.assertEqual(stats["awaiting_pdf"], 1)
        self.assertEqual(len(self.wiki_rows()), 1)

    def test_backfill_summary_filled_later_updates(self):
        self.add_article(1, summary="")
        sync.sync_backfill(self.cfg)
        row = self.wiki_row("1")
        self.assertEqual(row["status"], "awaiting_pdf")
        self.assertIsNone(row["ai_summary"])

        self.rss_exec("UPDATE articles SET ai_summary = '后补摘要' WHERE id = 1")
        sync.sync_backfill(self.cfg)
        row = self.wiki_row("1")
        self.assertEqual(row["status"], "awaiting_pdf")
        self.assertEqual(row["ai_summary"], "后补摘要")
        self.assertEqual(row["ai_summary_sha256"], sync.sha256_text("后补摘要"))

    def test_backfill_preserves_parsed_and_updates_pdf(self):
        self.wiki_exec(
            """
            INSERT INTO article_tasks
                (article_id, title, url, ai_summary, ai_summary_sha256,
                 pdf_filename, source_sha256, status,
                 parser_version, parsed_md_path, raw_extracted_json)
            VALUES ('1', '旧标题', 'https://old', '旧摘要', ?, 'old/1.pdf', 'oldsha',
                    'parsed', 'v1', '/tmp/old.md', '{"k":1}')
            """,
            (sync.sha256_text("旧摘要"),),
        )
        self.add_article(1, title="新标题", summary="新摘要")
        self.write_pdf("history/1.pdf", b"%PDF-1.4 new")
        sync.sync_backfill(self.cfg)
        row = self.wiki_row("1")
        self.assertEqual(row["title"], "新标题")
        self.assertEqual(row["ai_summary"], "新摘要")
        self.assertEqual(row["status"], "parsed")
        self.assertEqual(row["pdf_filename"], "history/1.pdf")
        self.assertEqual(
            row["source_sha256"], hashlib.sha256(b"%PDF-1.4 new").hexdigest()
        )
        self.assertEqual(row["parser_version"], "v1")
        self.assertEqual(row["parsed_md_path"], "/tmp/old.md")
        self.assertEqual(row["raw_extracted_json"], '{"k":1}')

    def test_backfill_coalesce_keeps_existing_pdf(self):
        self.wiki_exec(
            """
            INSERT INTO article_tasks
                (article_id, title, url, ai_summary, ai_summary_sha256,
                 pdf_filename, source_sha256, status)
            VALUES ('1', '旧标题', 'https://old', '旧摘要', ?, 'old/1.pdf', 'oldsha', 'pending')
            """,
            (sync.sha256_text("旧摘要"),),
        )
        self.add_article(1, title="新标题", summary="新摘要")
        sync.sync_backfill(self.cfg)
        row = self.wiki_row("1")
        self.assertEqual(row["title"], "新标题")
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["pdf_filename"], "old/1.pdf")
        self.assertEqual(row["source_sha256"], "oldsha")

    def test_backfill_promotes_awaiting_pdf(self):
        self.wiki_exec(
            """
            INSERT INTO article_tasks
                (article_id, title, url, ai_summary, ai_summary_sha256,
                 pdf_filename, source_sha256, status)
            VALUES ('1', '标题', 'https://example.com/1', '摘要', ?, NULL, NULL, 'awaiting_pdf')
            """,
            (sync.sha256_text("摘要"),),
        )
        self.add_article(1)
        self.write_pdf("history/1.pdf")
        sync.sync_backfill(self.cfg)
        row = self.wiki_row("1")
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["pdf_filename"], "history/1.pdf")

    def test_backfill_dry_run(self):
        self.add_article(1)
        source = self.write_pdf("history/1.pdf")
        stats = sync.sync_backfill(self.cfg, dry_run=True)
        self.assertEqual(stats["pending"], 1)
        self.assertTrue(source.exists())
        self.assertIsNone(self.wiki_row("1"))
        self.assertFalse((self.pdf_root / "history" / "1.pdf").exists())

    def test_backfill_keep_source(self):
        self.add_article(1)
        source = self.write_pdf("history/1.pdf")
        stats = sync.sync_backfill(self.cfg, keep_source=True)
        self.assertEqual(stats["pending"], 1)
        self.assertTrue(source.exists())
        self.assertIsNotNone(self.wiki_row("1"))

    def test_backfill_db_failure_keeps_source(self):
        self.add_article(1)
        self.wiki_exec(
            """
            CREATE TRIGGER reject_insert BEFORE INSERT ON article_tasks
            BEGIN
                SELECT RAISE(ABORT, 'rejected');
            END;
            """
        )
        source = self.write_pdf("history/1.pdf")
        stats = sync.sync_backfill(self.cfg)
        self.assertEqual(stats["failed"], 1)
        self.assertTrue(source.exists())

    def test_backfill_batches(self):
        for article_id in (1, 2, 3):
            self.add_article(article_id)
        stats = sync.sync_backfill(self.config(backfill_batch_size=1))
        self.assertEqual(stats["scanned"], 3)
        self.assertEqual(stats["awaiting_pdf"], 3)
        self.assertEqual(len(self.wiki_rows()), 3)


if __name__ == "__main__":
    unittest.main()
