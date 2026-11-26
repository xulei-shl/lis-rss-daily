#!/usr/bin/env python3
"""
PDF 归档/清理模块。

职责：
1. 每日 cron 的 3 篇文献：LIS-RSS 数据库提交成功后，把工作 PDF 原子移动到
   pdf_staging/daily/<YYYY-MM-DD>/<article_id>.pdf，供 LIS-WIKI 同步脚本消费。
2. 手动/API 触发的总结：不进入 LIS-WIKI 同步范围，直接删除工作 PDF，保持原有清理行为。

注意：
- 这里只负责“移动到暂存区”，不负责写 LIS-WIKI 数据库，也不负责复制到 wiki PDF 根目录。
- 真正的“剪切到 LIS-WIKI”由 scripts/lis-wiki/sync_to_wiki.py 完成：
  复制 -> 校验 -> 落盘 -> DB 提交 -> 删除暂存文件。
"""

import errno
import os
import re
import shutil
import uuid
from datetime import date
from pathlib import Path
from typing import Dict, Optional

from utils.project_root import PROJECT_ROOT


def safe_article_id(article_id) -> str:
    """把 article_id 转成安全的文件名片段；数据库 article_id 不受影响。"""
    value = re.sub(r'[\\/:*?"<>|\s]+', "_", str(article_id).strip())
    value = value.strip("._")
    return value or "unknown"


def _normalize_date(date_str: Optional[str]) -> str:
    """优先使用调用方传入的日期，非法时回退到当天。"""
    if date_str:
        try:
            return date.fromisoformat(str(date_str).strip()).isoformat()
        except ValueError:
            pass
    return date.today().isoformat()


def _archive_root(config: Dict) -> Optional[Path]:
    storage = config.get("storage", {}) or {}
    if not storage.get("archive_enabled", True):
        return None
    root = Path(storage.get("archive_root", "pdf_staging"))
    if not root.is_absolute():
        root = PROJECT_ROOT / root
    return root


def _atomic_move(src: Path, dest: Path) -> None:
    """
    原子移动。同文件系统直接 os.replace；跨文件系统时复制到临时文件后替换。
    目标已存在时会被原子覆盖。
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    if src.resolve() == dest.resolve():
        return

    tmp = dest.parent / f".{dest.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"
    try:
        try:
            os.replace(src, dest)
            return
        except OSError as exc:
            if exc.errno != errno.EXDEV:
                raise

        shutil.copy2(src, tmp)
        if tmp.stat().st_size <= 0:
            raise ValueError("归档文件大小为 0")
        os.replace(tmp, dest)
        src.unlink()
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def finalize_pdf(
    pdf_path: str,
    article_id: int,
    date_str: Optional[str],
    source: str,
    config: Dict,
) -> Optional[Path]:
    """
    摘要成功后处理工作 PDF。

    Args:
        pdf_path: 已下载并验证通过的 PDF 路径
        article_id: 上游 articles.id；<=0 表示没有关联文献
        date_str: 每日工作目录名（YYYY-MM-DD）
        source: "daily" 进入 LIS-WIKI 暂存区；"manual" 直接删除
        config: config.yaml 配置字典

    Returns:
        归档后的路径；删除或失败时返回 None。
    """
    src = Path(pdf_path)
    if not src.exists():
        print(f"[归档] PDF 不存在，跳过: {src}")
        return None

    article_key = str(article_id).strip() if article_id is not None else ""

    # 没有 article_id 的手动总结无法关联到 wiki 文献，保持原有清理行为
    if not article_key or article_key == "0":
        try:
            src.unlink()
            print(f"[清理] 已删除无关联文献的 PDF: {src}")
        except OSError as exc:
            print(f"[警告] 删除 PDF 失败: {src}: {exc}")
        return None

    if source != "daily":
        try:
            src.unlink()
            print(f"[清理] 手动/API 总结 PDF 不进入 wiki 暂存区，已删除: {src}")
        except OSError as exc:
            print(f"[警告] 删除 PDF 失败: {src}: {exc}")
        return None

    root = _archive_root(config)
    if root is None:
        try:
            src.unlink()
            print(f"[清理] 归档功能未启用，已删除 PDF: {src}")
        except OSError as exc:
            print(f"[警告] 删除 PDF 失败: {src}: {exc}")
        return None

    target_dir = root / "daily" / _normalize_date(date_str)
    target = target_dir / f"{safe_article_id(article_key)}.pdf"

    try:
        _atomic_move(src, target)
        print(f"[归档] PDF 已移入 LIS-WIKI 暂存区: {target}")
        return target
    except Exception as exc:
        # 归档失败时不删除 PDF，避免丢文件；摘要流程继续成功。
        print(f"[错误] PDF 归档失败，文件保留在工作目录: {src}: {exc}")
        return None
