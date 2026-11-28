#!/usr/bin/env python3
"""
LIS-RSS -> LIS-WIKI 文献增量同步脚本

职责：
1. 每日增量：读取 paper-pdf-summary 的 pdf_staging/daily/<YYYY-MM-DD>/<article_id>.pdf，
   复制到 LIS-WIKI 的 5 天周期目录，写入 article_tasks，成功后删除暂存文件。
2. 历史补录：扫描同步集合，有 PDF 的按 pending 入库，没有 PDF 的按
   awaiting_pdf 入库。不会覆盖 wiki 流水线状态或缓存列。

同步集合（两集合取并集，按 article_id 天然去重）：
- A：命中 scripts/lis-wiki/journals_list.yaml（无条件白名单）的文章，
  不论 ai_summary 是否有值；
- B：命中 scripts/lis-wiki/journals_summary_list.yaml（摘要白名单），
  且 ai_summary 非空的文章。

设计约束见 docs/lis-wiki-脚本/LIS-RSS同步脚本需求.md。
本脚本只写 lis_wiki.db 的 article_tasks 表，不写 sync_jobs / concepts 等其它表。
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import os
import re
import shutil
import sqlite3
import sys
import time
import uuid
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, timezone, tzinfo
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ENV_FILE = Path(__file__).resolve().parent / ".env"
DEFAULT_JOURNALS_LIST = Path(__file__).resolve().parent / "journals_list.yaml"
DEFAULT_SUMMARY_JOURNALS_LIST = (
    Path(__file__).resolve().parent / "journals_summary_list.yaml"
)

# 与 paper-pdf-summary 共用 safe_article_id，保证暂存文件名与同步脚本一致
_PAPER_SUMMARY_DIR = PROJECT_ROOT / "scripts" / "paper-pdf-summary"
if str(_PAPER_SUMMARY_DIR) not in sys.path:
    sys.path.insert(0, str(_PAPER_SUMMARY_DIR))

from utils.pdf_archive import safe_article_id  # noqa: E402

log = logging.getLogger("lis-wiki-sync")

ARTICLE_SELECT = """
SELECT
    a.id,
    a.title,
    a.url,
    a.ai_summary,
    a.published_at,
    a.rss_source_id,
    a.journal_id,
    COALESCE(s.name, j.name) AS source_name
FROM articles AS a
LEFT JOIN rss_sources AS s ON s.id = a.rss_source_id
LEFT JOIN journals AS j ON j.id = a.journal_id
"""

UPSERT_SQL = """
INSERT INTO article_tasks (
    article_id, title, url, ai_summary, ai_summary_sha256,
    pdf_filename, source_sha256, published_date, source_name,
    status, created_at, updated_at
) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, datetime('now', 'localtime'), datetime('now', 'localtime')
)
ON CONFLICT(article_id) DO UPDATE SET
    title             = excluded.title,
    url               = excluded.url,
    ai_summary        = excluded.ai_summary,
    ai_summary_sha256 = excluded.ai_summary_sha256,
    pdf_filename      = COALESCE(excluded.pdf_filename, article_tasks.pdf_filename),
    source_sha256     = COALESCE(excluded.source_sha256, article_tasks.source_sha256),
    published_date    = COALESCE(excluded.published_date, article_tasks.published_date),
    source_name       = COALESCE(excluded.source_name, article_tasks.source_name),
    status            = CASE
                            WHEN article_tasks.status = 'awaiting_pdf'
                             AND excluded.pdf_filename IS NOT NULL
                             AND excluded.source_sha256 IS NOT NULL
                            THEN 'pending'
                            ELSE article_tasks.status
                        END,
    updated_at        = datetime('now', 'localtime')
"""


@dataclass(frozen=True)
class SyncConfig:
    rss_db: Path
    wiki_db: Path
    pdf_root: Path
    staging_root: Path
    journals_list: Path
    journal_names: Tuple[str, ...]
    summary_journals_list: Path
    summary_journal_names: Tuple[str, ...]
    anchor_date: date
    daily_limit: int
    backfill_batch_size: int
    delete_source: bool
    enabled: bool

    @classmethod
    def from_env(cls) -> "SyncConfig":
        def path_env(name: str, default: Path) -> Path:
            raw = os.getenv(name)
            return (Path(raw).expanduser() if raw else default).resolve()

        anchor_raw = os.getenv("SYNC_ANCHOR_DATE", "1970-01-01").strip()
        try:
            anchor = date.fromisoformat(anchor_raw)
        except ValueError as exc:
            raise ValueError(f"SYNC_ANCHOR_DATE 非法: {anchor_raw}") from exc

        daily_limit = _int_env("SYNC_BATCH_SIZE", 3)
        backfill_batch = _int_env("BACKFILL_BATCH_SIZE", 200)
        journals_list = path_env("JOURNALS_LIST_PATH", DEFAULT_JOURNALS_LIST)
        journal_names = tuple(load_journal_whitelist(journals_list))
        summary_journals_list = path_env(
            "SUMMARY_JOURNALS_LIST_PATH", DEFAULT_SUMMARY_JOURNALS_LIST
        )
        summary_journal_names = tuple(load_journal_whitelist(summary_journals_list))

        return cls(
            rss_db=path_env("LIS_RSS_DB_PATH", PROJECT_ROOT / "data" / "rss-tracker.db"),
            wiki_db=path_env("WIKI_DB_PATH", Path("/opt/lis-wiki/data/lis_wiki.db")),
            pdf_root=path_env("WIKI_PDF_ROOT", Path("/opt/lis-wiki/data/pdfs")),
            staging_root=path_env(
                "SYNC_STAGING_ROOT",
                PROJECT_ROOT / "scripts" / "paper-pdf-summary" / "pdf_staging",
            ),
            journals_list=journals_list,
            journal_names=journal_names,
            summary_journals_list=summary_journals_list,
            summary_journal_names=summary_journal_names,
            anchor_date=anchor,
            daily_limit=max(1, daily_limit),
            backfill_batch_size=max(1, backfill_batch),
            delete_source=_bool_env("SYNC_DELETE_SOURCE_AFTER_SUCCESS", True),
            enabled=_bool_env("SYNC_ENABLED", True),
        )


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} 必须是整数: {raw}") from exc


def load_journal_whitelist(path: Path) -> List[str]:
    """加载并校验期刊白名单；缺失、格式错误或空列表都视为配置错误。"""
    if not path.is_file():
        raise ValueError(f"期刊白名单不存在: {path}")
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, yaml.YAMLError) as exc:
        raise ValueError(f"期刊白名单读取失败: {path}: {exc}") from exc
    if not isinstance(data, list):
        raise ValueError(f"期刊白名单必须是 YAML 列表: {path}")

    names: List[str] = []
    for item in data:
        name = str(item).strip()
        if name and name not in names:
            names.append(name)
    if not names:
        raise ValueError(f"期刊白名单为空: {path}")
    return names


@dataclass(frozen=True)
class JournalScope:
    """白名单命中 rss_sources / journals 后得到的文章归属范围。"""

    rss_source_ids: Tuple[int, ...]
    journal_ids: Tuple[int, ...]

    def contains(self, row: sqlite3.Row) -> bool:
        rss_source_id = row["rss_source_id"]
        journal_id = row["journal_id"]
        return (
            rss_source_id is not None and rss_source_id in self.rss_source_ids
        ) or (
            journal_id is not None and journal_id in self.journal_ids
        )

    def sql(self, alias: str = "a") -> Tuple[str, List[object]]:
        conditions: List[str] = []
        params: List[object] = []
        if self.rss_source_ids:
            placeholders = ",".join("?" for _ in self.rss_source_ids)
            conditions.append(f"{alias}.rss_source_id IN ({placeholders})")
            params.extend(self.rss_source_ids)
        if self.journal_ids:
            placeholders = ",".join("?" for _ in self.journal_ids)
            conditions.append(f"{alias}.journal_id IN ({placeholders})")
            params.extend(self.journal_ids)
        if not conditions:
            raise ValueError("期刊白名单未匹配任何来源")
        return "(" + " OR ".join(conditions) + ")", params


def resolve_journal_scope(
    conn: sqlite3.Connection, journal_names: Sequence[str]
) -> JournalScope:
    """把期刊名解析为 rss_sources / journals 的 ID 集合。"""
    if not journal_names:
        raise ValueError("期刊白名单为空")
    placeholders = ",".join("?" for _ in journal_names)
    name_params = list(journal_names)

    rss_rows = conn.execute(
        f"SELECT id, name FROM rss_sources WHERE TRIM(name) IN ({placeholders})",
        name_params,
    ).fetchall()
    journal_rows = conn.execute(
        f"SELECT id, name FROM journals WHERE TRIM(name) IN ({placeholders})",
        name_params,
    ).fetchall()

    rss_source_ids = tuple(row["id"] for row in rss_rows)
    journal_ids = tuple(row["id"] for row in journal_rows)
    if not rss_source_ids and not journal_ids:
        raise ValueError(
            "期刊白名单未匹配任何 rss_sources/journals: "
            + ", ".join(journal_names)
        )

    matched_names = {str(row["name"]).strip() for row in rss_rows + journal_rows}
    unmatched_names = [name for name in journal_names if name not in matched_names]
    if unmatched_names:
        log.warning("期刊白名单中以下名称未匹配任何来源: %s", ", ".join(unmatched_names))

    return JournalScope(rss_source_ids=rss_source_ids, journal_ids=journal_ids)


@dataclass(frozen=True)
class SyncScopes:
    """同步集合：无条件白名单 ∪（摘要白名单 ∩ ai_summary 非空）。"""

    unconditional: JournalScope
    summary_gated: JournalScope

    def contains(self, row: sqlite3.Row) -> bool:
        return self.unconditional.contains(row) or (
            self.summary_gated.contains(row) and normalized_summary(row) is not None
        )

    def sql(self, alias: str = "a") -> Tuple[str, List[object]]:
        a_sql, a_params = self.unconditional.sql(alias)
        b_sql, b_params = self.summary_gated.sql(alias)
        summary_sql = (
            f"({alias}.ai_summary IS NOT NULL AND TRIM({alias}.ai_summary) != '')"
        )
        return (
            f"({a_sql} OR ({b_sql} AND {summary_sql}))",
            [*a_params, *b_params],
        )


def resolve_sync_scopes(
    conn: sqlite3.Connection,
    journal_names: Sequence[str],
    summary_journal_names: Sequence[str],
) -> SyncScopes:
    """分别解析两份白名单，得到同步集合的归属范围。"""
    return SyncScopes(
        unconditional=resolve_journal_scope(conn, journal_names),
        summary_gated=resolve_journal_scope(conn, summary_journal_names),
    )


def normalized_summary(row: sqlite3.Row) -> Optional[str]:
    """返回非空 ai_summary；NULL 或纯空白统一视为无摘要。"""
    raw = row["ai_summary"]
    if raw is None:
        return None
    text = str(raw)
    return text if text.strip() else None


def is_sync_candidate(row: sqlite3.Row, scopes: SyncScopes) -> bool:
    """同步集合：无条件白名单 ∪（摘要白名单 ∩ ai_summary 非空）。"""
    return scopes.contains(row)


def sync_condition(scopes: SyncScopes, alias: str = "a") -> Tuple[str, List[object]]:
    """构造同步集合的 SQL 条件。"""
    return scopes.sql(alias)


def load_env_file(path: Path) -> None:
    """加载简单 KEY=VALUE 格式的 .env；已存在的环境变量优先。"""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


def period_folder(day: date, anchor: date) -> str:
    """按 5 天周期计算文件夹名（周期起始日期）。"""
    index = (day - anchor).days // 5
    return (anchor + timedelta(days=index * 5)).isoformat()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def local_date(value: object, tz: Optional[tzinfo] = None) -> Optional[str]:
    """把上游 published_at 转成部署所在地的 YYYY-MM-DD。"""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        match = re.match(r"^(\d{4}-\d{2}-\d{2})", text)
        return match.group(1) if match else None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    if tz is not None:
        parsed = parsed.astimezone(tz)
    else:
        parsed = parsed.astimezone()
    return parsed.date().isoformat()


def atomic_copy_and_hash(src: Path, target: Path, dry_run: bool = False) -> str:
    """
    复制 PDF 到目标路径并返回 SHA-256。

    - 目标已存在且哈希一致时直接复用；
    - 先写同目录临时文件，校验大小/哈希后用 os.replace 原子替换；
    - dry_run 只计算源文件哈希，不落盘。
    """
    if not src.is_file():
        raise FileNotFoundError(f"源 PDF 不存在: {src}")
    src_size = src.stat().st_size
    if src_size <= 0:
        raise ValueError(f"源 PDF 大小为 0: {src}")
    src_sha = sha256_file(src)

    if target.is_file():
        try:
            if sha256_file(target) == src_sha:
                return src_sha
        except OSError:
            pass

    if dry_run:
        return src_sha

    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.parent / f".{target.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"
    try:
        shutil.copy2(src, tmp)
        if tmp.stat().st_size != src_size:
            raise ValueError(f"复制后大小不一致: {tmp}")
        tmp_sha = sha256_file(tmp)
        if tmp_sha != src_sha:
            raise ValueError(f"复制后 SHA-256 不一致: {tmp}")
        os.replace(tmp, target)
        return src_sha
    finally:
        tmp.unlink(missing_ok=True)


def connect_upstream(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def connect_wiki(path: Path, *, readonly: bool = False) -> sqlite3.Connection:
    if readonly:
        conn = sqlite3.connect(
            f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=5
        )
    else:
        conn = sqlite3.connect(str(path), timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA foreign_keys = ON")
    if not readonly:
        conn.execute("PRAGMA journal_mode = WAL")
    return conn


def fetch_article(conn: sqlite3.Connection, article_id: object) -> Optional[sqlite3.Row]:
    return conn.execute(ARTICLE_SELECT + " WHERE a.id = ?", (_coerce_id(article_id),)).fetchone()


def fetch_backfill_batch(
    conn: sqlite3.Connection,
    after_id: object,
    limit: int,
    scopes: SyncScopes,
) -> List[sqlite3.Row]:
    condition, condition_params = sync_condition(scopes)
    sql = ARTICLE_SELECT + f"""
        WHERE {condition}
          AND a.id > ?
        ORDER BY a.id ASC
        LIMIT ?
    """
    params = [*condition_params, _coerce_id(after_id), limit]
    return conn.execute(sql, params).fetchall()


def _coerce_id(value: object) -> object:
    text = str(value).strip()
    try:
        return int(text)
    except ValueError:
        return text


def fetch_existing(conn: sqlite3.Connection, ids: Sequence[str]) -> Dict[str, sqlite3.Row]:
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"SELECT * FROM article_tasks WHERE article_id IN ({placeholders})",
        list(ids),
    ).fetchall()
    return {str(row["article_id"]): row for row in rows}


def build_item(
    cfg: SyncConfig,
    row: sqlite3.Row,
    pdf_path: Optional[Path],
    folder: Optional[str],
    *,
    allow_missing_pdf: bool,
    dry_run: bool,
) -> Dict[str, object]:
    article_id = str(row["id"]).strip()
    title_raw = row["title"]
    title = "" if title_raw is None else str(title_raw)
    summary = normalized_summary(row)
    if not article_id:
        raise ValueError("articles.id 为空")
    if not title.strip():
        raise ValueError("articles.title 为空")

    source_name = row["source_name"]
    if source_name is not None and not str(source_name).strip():
        source_name = None

    if pdf_path is not None:
        if not folder:
            raise ValueError("有 PDF 但缺少目标周期目录")
        safe_id = safe_article_id(article_id)
        if pdf_path.stem != safe_id:
            raise ValueError(
                f"暂存文件名 {pdf_path.stem!r} 与文章 ID 安全名 {safe_id!r} 不一致"
            )
        relative = f"{folder}/{safe_id}.pdf"
        target = cfg.pdf_root / folder / f"{safe_id}.pdf"
        source_sha = atomic_copy_and_hash(pdf_path, target, dry_run=dry_run)
        target_status = "pending"
    elif allow_missing_pdf:
        relative = None
        source_sha = None
        target_status = "awaiting_pdf"
    else:
        raise FileNotFoundError(f"每日同步缺少 PDF: article_id={article_id}")

    return {
        "article_id": article_id,
        "title": title,
        "url": row["url"],
        "ai_summary": summary,
        "ai_summary_sha256": sha256_text(summary) if summary is not None else None,
        "pdf_filename": relative,
        "source_sha256": source_sha,
        "published_date": local_date(row["published_at"]),
        "source_name": source_name,
        "target_status": target_status,
    }


def is_changed(existing: Optional[sqlite3.Row], item: Dict[str, object]) -> bool:
    """判断是否需要执行 UPDATE；无变化时不刷新 updated_at。"""
    if existing is None:
        return True
    if item["title"] != existing["title"]:
        return True
    if (item["url"] or None) != existing["url"]:
        return True
    if item["ai_summary"] != existing["ai_summary"]:
        return True
    if item["ai_summary_sha256"] != existing["ai_summary_sha256"]:
        return True
    if item["published_date"] is not None and item["published_date"] != existing["published_date"]:
        return True
    if item["source_name"] is not None and item["source_name"] != existing["source_name"]:
        return True
    if item["pdf_filename"] is not None and item["pdf_filename"] != existing["pdf_filename"]:
        return True
    if item["source_sha256"] is not None and item["source_sha256"] != existing["source_sha256"]:
        return True
    if (
        existing["status"] == "awaiting_pdf"
        and item["pdf_filename"] is not None
        and item["source_sha256"] is not None
    ):
        return True
    return False


def upsert_article(conn: sqlite3.Connection, item: Dict[str, object]) -> None:
    conn.execute(
        UPSERT_SQL,
        (
            item["article_id"],
            item["title"],
            item["url"],
            item["ai_summary"],
            item["ai_summary_sha256"],
            item["pdf_filename"],
            item["source_sha256"],
            item["published_date"],
            item["source_name"],
            item["target_status"],
        ),
    )


def delete_source(path: Optional[Path], keep_source: bool, dry_run: bool) -> None:
    if path is None or keep_source or dry_run:
        return
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:
        log.warning("删除暂存 PDF 失败 path=%s: %s", path, exc)


def build_staging_index(staging_root: Path) -> Dict[str, Tuple[Optional[date], Path]]:
    """
    建立 safe_article_id -> (日期, PDF 路径) 索引。

    只扫描 daily/ 与 history/，明确排除 manual/（手动/API 的 PDF 不进入 wiki）。
    同一文章出现在多个 daily 日期时取最新日期；daily 优先于 history。
    """
    index: Dict[str, Tuple[Optional[date], Path]] = {}

    daily_root = staging_root / "daily"
    if daily_root.is_dir():
        for date_dir in sorted(daily_root.iterdir()):
            if not date_dir.is_dir():
                continue
            try:
                folder_date = date.fromisoformat(date_dir.name)
            except ValueError:
                continue
            for pdf in date_dir.glob("*.pdf"):
                if not pdf.is_file():
                    continue
                previous = index.get(pdf.stem)
                if previous is None or (
                    previous[0] is not None and folder_date > previous[0]
                ):
                    index[pdf.stem] = (folder_date, pdf)

    history_root = staging_root / "history"
    if history_root.is_dir():
        for pdf in sorted(history_root.glob("*.pdf")):
            if pdf.is_file():
                index.setdefault(pdf.stem, (None, pdf))

    return index


def _new_stats() -> Dict[str, int]:
    return {
        "scanned": 0,
        "pending": 0,
        "awaiting_pdf": 0,
        "out_of_scope": 0,
        "skipped": 0,
        "failed": 0,
    }


def _log_stats(mode: str, stats: Dict[str, int], elapsed: float, **extra: object) -> None:
    fields = " ".join(f"{key}={value}" for key, value in extra.items())
    prefix = f"mode={mode} {fields}".rstrip()
    log.info(
        "%s scanned=%d pending=%d awaiting_pdf=%d out_of_scope=%d "
        "skipped=%d failed=%d elapsed=%.2fs",
        prefix,
        stats["scanned"],
        stats["pending"],
        stats["awaiting_pdf"],
        stats["out_of_scope"],
        stats["skipped"],
        stats["failed"],
        elapsed,
    )


def sync_daily(
    cfg: SyncConfig,
    sync_date: date,
    *,
    ids: Optional[Sequence[str]] = None,
    dry_run: bool = False,
    keep_source: bool = False,
) -> Dict[str, int]:
    """每日增量：只处理指定日期的 daily/ 暂存 PDF。"""
    stats = _new_stats()
    started = time.monotonic()
    staging_dir = cfg.staging_root / "daily" / sync_date.isoformat()

    if ids:
        candidates = [
            staging_dir / f"{safe_article_id(str(article_id).strip())}.pdf"
            for article_id in ids
            if str(article_id).strip()
        ]
    elif staging_dir.is_dir():
        candidates = sorted(staging_dir.glob("*.pdf"), key=lambda path: path.name)
    else:
        candidates = []

    if not candidates:
        log.info("daily 暂存目录为空或不存在: %s", staging_dir)
        _log_stats("daily", stats, time.monotonic() - started, date=sync_date.isoformat())
        return stats

    rss = connect_upstream(cfg.rss_db)
    wiki = connect_wiki(cfg.wiki_db, readonly=dry_run)
    try:
        scopes = resolve_sync_scopes(
            rss, cfg.journal_names, cfg.summary_journal_names
        )
        log.info(
            "每日同步无条件白名单=%d/摘要白名单=%d "
            "unconditional(rss=%d,journals=%d) summary(rss=%d,journals=%d)",
            len(cfg.journal_names),
            len(cfg.summary_journal_names),
            len(scopes.unconditional.rss_source_ids),
            len(scopes.unconditional.journal_ids),
            len(scopes.summary_gated.rss_source_ids),
            len(scopes.summary_gated.journal_ids),
        )

        in_scope_seen = 0
        for pdf_path in candidates:
            # --ids 是显式指定，不受每日上限限制；自动发现时只对同步集合计数。
            if ids is None and in_scope_seen >= cfg.daily_limit:
                break

            stats["scanned"] += 1
            try:
                if not pdf_path.is_file():
                    raise FileNotFoundError(f"暂存 PDF 不存在: {pdf_path}")

                row = fetch_article(rss, pdf_path.stem)
                if row is None:
                    raise ValueError(f"上游 articles 中不存在 ID={pdf_path.stem}")

                article_id = str(row["id"]).strip()
                if safe_article_id(article_id) != pdf_path.stem:
                    raise ValueError(
                        f"暂存文件名 {pdf_path.stem!r} 与上游 ID 安全名 "
                        f"{safe_article_id(article_id)!r} 不一致"
                    )

                if not is_sync_candidate(row, scopes):
                    stats["out_of_scope"] += 1
                    log.info(
                        "跳过同步集合外文章 article_id=%s"
                        "（既不在无条件白名单，也不满足摘要白名单+ai_summary）",
                        article_id,
                    )
                    continue

                in_scope_seen += 1
                folder = period_folder(sync_date, cfg.anchor_date)
                item = build_item(
                    cfg,
                    row,
                    pdf_path,
                    folder,
                    allow_missing_pdf=False,
                    dry_run=dry_run,
                )
                existing = fetch_existing(wiki, [article_id]).get(article_id)
                changed = is_changed(existing, item)

                if not changed:
                    stats["skipped"] += 1
                    log.info("跳过无变化 article_id=%s", article_id)
                elif dry_run:
                    stats["pending"] += 1
                    log.info(
                        "[dry-run] 将同步 article_id=%s -> %s",
                        article_id,
                        item["pdf_filename"],
                    )
                else:
                    with wiki:
                        upsert_article(wiki, item)
                    stats["pending"] += 1
                    log.info(
                        "已同步 article_id=%s -> %s",
                        article_id,
                        item["pdf_filename"],
                    )

                if not dry_run:
                    delete_source(pdf_path, keep_source, dry_run)
            except Exception as exc:
                stats["failed"] += 1
                log.error("每日同步失败 file=%s: %s", pdf_path, exc)
    finally:
        rss.close()
        wiki.close()

    _log_stats("daily", stats, time.monotonic() - started, date=sync_date.isoformat())
    return stats


def sync_backfill(
    cfg: SyncConfig,
    *,
    dry_run: bool = False,
    keep_source: bool = False,
) -> Dict[str, int]:
    """历史全量补录：无条件白名单 ∪（摘要白名单 ∩ 有摘要），允许无 PDF。"""
    stats = _new_stats()
    started = time.monotonic()
    index = build_staging_index(cfg.staging_root)
    log.info("历史补录暂存 PDF 索引数量=%d root=%s", len(index), cfg.staging_root)

    rss = connect_upstream(cfg.rss_db)
    wiki = connect_wiki(cfg.wiki_db, readonly=dry_run)
    cursor: object = 0
    try:
        scopes = resolve_sync_scopes(
            rss, cfg.journal_names, cfg.summary_journal_names
        )
        log.info(
            "历史补录无条件白名单=%d/摘要白名单=%d "
            "unconditional(rss=%d,journals=%d) summary(rss=%d,journals=%d)",
            len(cfg.journal_names),
            len(cfg.summary_journal_names),
            len(scopes.unconditional.rss_source_ids),
            len(scopes.unconditional.journal_ids),
            len(scopes.summary_gated.rss_source_ids),
            len(scopes.summary_gated.journal_ids),
        )
        while True:
            rows = fetch_backfill_batch(
                rss, cursor, cfg.backfill_batch_size, scopes
            )
            if not rows:
                break
            cursor = rows[-1]["id"]

            prepared: List[Tuple[Dict[str, object], Optional[Path]]] = []
            for row in rows:
                stats["scanned"] += 1
                try:
                    article_id = str(row["id"]).strip()
                    entry = index.get(safe_article_id(article_id))
                    if entry is None:
                        pdf_path = None
                        folder = None
                    else:
                        folder_date, pdf_path = entry
                        folder = (
                            period_folder(folder_date, cfg.anchor_date)
                            if folder_date is not None
                            else "history"
                        )
                    item = build_item(
                        cfg,
                        row,
                        pdf_path,
                        folder,
                        allow_missing_pdf=True,
                        dry_run=dry_run,
                    )
                    prepared.append((item, pdf_path))
                except Exception as exc:
                    stats["failed"] += 1
                    log.error("历史补录准备失败 article_id=%s: %s", row["id"], exc)

            if not prepared:
                continue

            try:
                existing = fetch_existing(
                    wiki, [str(item["article_id"]) for item, _ in prepared]
                )
            except Exception as exc:
                stats["failed"] += len(prepared)
                log.error(
                    "历史补录批次读取现有记录失败 article_id=%s..%s: %s",
                    prepared[0][0]["article_id"],
                    prepared[-1][0]["article_id"],
                    exc,
                )
                continue

            to_write: List[Tuple[Dict[str, object], Optional[Path]]] = []
            to_delete: List[Path] = []
            for item, source in prepared:
                if is_changed(existing.get(str(item["article_id"])), item):
                    to_write.append((item, source))
                else:
                    stats["skipped"] += 1
                    if source is not None:
                        to_delete.append(source)

            if to_write and not dry_run:
                try:
                    with wiki:
                        for item, _ in to_write:
                            upsert_article(wiki, item)
                except Exception as exc:
                    stats["failed"] += len(to_write)
                    log.error(
                        "历史补录批次写入失败 article_id=%s..%s: %s",
                        to_write[0][0]["article_id"],
                        to_write[-1][0]["article_id"],
                        exc,
                    )
                    continue

            for item, source in to_write:
                if dry_run:
                    log.info(
                        "[dry-run] 将补录 article_id=%s status=%s pdf=%s",
                        item["article_id"],
                        item["target_status"],
                        item["pdf_filename"],
                    )
                if item["target_status"] == "awaiting_pdf":
                    stats["awaiting_pdf"] += 1
                else:
                    stats["pending"] += 1
                if source is not None:
                    to_delete.append(source)

            for source in to_delete:
                delete_source(source, keep_source, dry_run)

            log.info(
                "历史补录进度 cursor=%s scanned=%d pending=%d awaiting_pdf=%d "
                "skipped=%d failed=%d",
                cursor,
                stats["scanned"],
                stats["pending"],
                stats["awaiting_pdf"],
                stats["skipped"],
                stats["failed"],
            )
    finally:
        rss.close()
        wiki.close()

    _log_stats("backfill", stats, time.monotonic() - started)
    return stats


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="LIS-RSS -> LIS-WIKI 文献增量同步 / 历史补录"
    )
    parser.add_argument(
        "--date",
        help="每日同步日期 YYYY-MM-DD（默认今天）；也决定 5 天周期目录",
    )
    parser.add_argument(
        "--ids",
        help="指定上游 articles.id，逗号分隔；只从指定日期的 daily/ 暂存区读取",
    )
    parser.add_argument(
        "--backfill-history",
        action="store_true",
        help="历史全量补录（无条件白名单 ∪（摘要白名单+有摘要），允许无 PDF）",
    )
    parser.add_argument("--dry-run", action="store_true", help="只检查，不写文件/数据库")
    parser.add_argument(
        "--keep-source",
        action="store_true",
        help="成功后保留暂存 PDF（默认删除）",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        help="覆盖 BACKFILL_BATCH_SIZE（仅历史补录）",
    )
    parser.add_argument(
        "--env-file",
        default=str(DEFAULT_ENV_FILE),
        help=f".env 路径（默认 {DEFAULT_ENV_FILE}）",
    )
    parser.add_argument("--verbose", action="store_true", help="输出 DEBUG 日志")
    args = parser.parse_args(argv)

    if args.backfill_history and args.ids:
        parser.error("--backfill-history 不能与 --ids 同时使用")
    if args.backfill_history and args.date:
        parser.error("--backfill-history 不能与 --date 同时使用")
    if args.batch_size is not None and args.batch_size < 1:
        parser.error("--batch-size 必须大于 0")
    if args.ids is not None:
        ids = [part.strip() for part in args.ids.split(",") if part.strip()]
        if not ids:
            parser.error("--ids 不能为空")
        args.ids = ids
    return args


def validate_config(cfg: SyncConfig) -> None:
    if not cfg.rss_db.is_file():
        raise SystemExit(f"上游数据库不存在: {cfg.rss_db}")
    if not cfg.wiki_db.is_file():
        raise SystemExit(f"LIS-WIKI 数据库不存在: {cfg.wiki_db}")
    if not cfg.journals_list.is_file():
        raise SystemExit(f"无条件白名单不存在: {cfg.journals_list}")
    if not cfg.journal_names:
        raise SystemExit(f"无条件白名单为空: {cfg.journals_list}")
    if not cfg.summary_journals_list.is_file():
        raise SystemExit(f"摘要白名单不存在: {cfg.summary_journals_list}")
    if not cfg.summary_journal_names:
        raise SystemExit(f"摘要白名单为空: {cfg.summary_journals_list}")


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    load_env_file(Path(args.env_file).expanduser())

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    try:
        cfg = SyncConfig.from_env()
    except ValueError as exc:
        log.error("配置错误: %s", exc)
        return 2

    if args.batch_size is not None:
        cfg = replace(cfg, backfill_batch_size=args.batch_size)

    if not cfg.enabled:
        log.info("SYNC_ENABLED=false，跳过本次同步")
        return 0

    try:
        validate_config(cfg)
    except SystemExit as exc:
        log.error("%s", exc)
        return 2

    try:
        if args.backfill_history:
            stats = sync_backfill(
                cfg, dry_run=args.dry_run, keep_source=args.keep_source
            )
        else:
            try:
                sync_date = date.fromisoformat(args.date) if args.date else date.today()
            except ValueError:
                log.error("--date 格式非法（应为 YYYY-MM-DD）: %s", args.date)
                return 2
            stats = sync_daily(
                cfg,
                sync_date,
                ids=args.ids,
                dry_run=args.dry_run,
                keep_source=args.keep_source,
            )
    except ValueError as exc:
        log.error("同步范围解析失败: %s", exc)
        return 2

    return 1 if stats["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
