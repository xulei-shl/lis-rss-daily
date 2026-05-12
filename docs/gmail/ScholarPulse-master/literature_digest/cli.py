from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from time import perf_counter
from typing import Any

from .config import load_config
from .dedupe import deduplicate_entries
from .digest import write_digests
from .email_filter import classify_email
from .env import load_dotenv_file
from .gmail_client import GmailClient
from .interests import analyze_research_interests, fallback_interest_profile, read_research_interests
from .llm import build_llm_client
from .models import DigestRun, RunStats, SkippedEmail
from .parsers import parse_emails
from .ranking import count_relevance, rank_papers
from .sample_data import sample_emails


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    base_dir = Path.cwd()
    load_dotenv_file(base_dir / ".env")
    config = load_config(args.config)
    progress = ProgressReporter(
        enabled=bool(config.get("progress", {}).get("enabled", True)) and not args.quiet,
        show_timestamps=bool(config.get("progress", {}).get("show_timestamps", True)),
    )

    dry_run = _resolve_dry_run(args, config)
    if args.max_emails is not None:
        config["gmail"]["max_emails_per_run"] = args.max_emails

    sample_mode, warnings = _should_use_sample(args, config, dry_run, base_dir)
    progress.step("初始化完成")
    llm = build_llm_client(config, sample_mode=sample_mode)

    if sample_mode:
        progress.step("读取内置样例邮件")
        emails = sample_emails()
    else:
        progress.step(
            f"搜索 Gmail 未读邮件，query={config['gmail'].get('query', 'is:unread')!r}，"
            f"max={config['gmail']['max_emails_per_run']}"
        )
        gmail = GmailClient(config, base_dir=base_dir)
        emails = gmail.fetch_unread_emails(max_results=config["gmail"]["max_emails_per_run"])
    progress.step(f"邮件读取完成：{len(emails)} 封")

    skipped: list[SkippedEmail] = []
    accepted = []
    for index, email in enumerate(emails, start=1):
        progress.item(index, len(emails), f"过滤邮件：{_shorten(email.subject, 58)}")
        decision = classify_email(email, config)
        if decision.skip:
            skipped.append(
                SkippedEmail(
                    email_id=email.id,
                    subject=email.subject,
                    sender=email.sender,
                    reason=decision.reason,
                )
            )
        else:
            accepted.append(email)
    progress.step(f"邮件过滤完成：保留 {len(accepted)} 封，跳过 {len(skipped)} 封")

    progress.step("解析论文条目")
    entries = parse_emails(
        accepted,
        llm=llm,
        llm_structure_non_scholar=bool(config["parsing"].get("llm_structure_non_scholar", True)),
    )
    progress.step(f"解析完成：{len(entries)} 个候选条目")

    progress.step("执行 DOI、URL、标题和模糊标题去重")
    deduped = deduplicate_entries(
        entries,
        fuzzy_title_threshold=int(config["parsing"].get("fuzzy_title_threshold", 92)),
    )
    progress.step(
        f"去重完成：保留 {len(deduped.unique_entries)} 个条目，移除 {deduped.duplicates_removed} 个重复项"
    )

    interests_path = _resolve_path(config["research_interests"]["path"], base_dir)
    interest_text = read_research_interests(interests_path)
    if deduped.unique_entries:
        progress.step("调用 LLM 提炼近期研究兴趣")
        interest_profile = analyze_research_interests(interest_text, llm)
        progress.step(f"调用 LLM 分批排序和摘要：{len(deduped.unique_entries)} 篇论文")
        ranked = rank_papers(
            deduped.unique_entries,
            interest_profile,
            llm,
            progress=lambda current, total: progress.item(current, total, "LLM 排序批次"),
        )
        progress.step("LLM 排序和摘要完成")
    else:
        warnings.append("没有找到可处理的未读论文条目，本次生成空 digest。")
        interest_profile = fallback_interest_profile(interest_text)
        ranked = []

    if not config["digest"].get("include_low_relevance", True):
        ranked = [paper for paper in ranked if paper.relevance != "low"]

    stats = RunStats(
        emails_read=len(emails),
        skipped_emails=len(skipped),
        paper_entries_extracted=len(entries),
        duplicates_removed=deduped.duplicates_removed,
        high_relevance=count_relevance(ranked, "high"),
        medium_relevance=count_relevance(ranked, "medium"),
        low_relevance=count_relevance(ranked, "low"),
        sample_mode=sample_mode,
    )
    date_label = args.date or datetime.now().strftime("%Y-%m-%d")
    run = DigestRun(
        date_label=date_label,
        stats=stats,
        interest_profile=interest_profile,
        papers=_apply_digest_limits(ranked, config),
        skipped=skipped if config["filtering"].get("audit_skipped_emails", True) else [],
        warnings=warnings,
    )
    progress.step("写出 Markdown 和 HTML digest")
    output_paths = write_digests(
        run,
        _resolve_path(config["digest"]["output_dir"], base_dir),
        formats=list(config["digest"].get("output_formats", ["md", "html"])),
        overwrite_existing=bool(config["digest"].get("overwrite_existing", True)),
    )

    if not dry_run and not sample_mode and config["gmail"].get("mark_as_read", False):
        progress.step(f"标记已处理邮件为已读：{len(accepted)} 封")
        gmail = GmailClient(config, base_dir=base_dir)
        gmail.mark_as_read([email.id for email in accepted])

    progress.done("运行完成")
    print("Digest written:")
    for output_path in output_paths:
        print(f"  - {output_path}")
    print(
        "Stats: "
        f"emails={stats.emails_read}, entries={stats.paper_entries_extracted}, "
        f"duplicates={stats.duplicates_removed}, high={stats.high_relevance}, "
        f"medium={stats.medium_relevance}, low={stats.low_relevance}, skipped={stats.skipped_emails}"
    )
    if dry_run:
        print("Dry-run mode: no email state was modified and no emails were sent.")
    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate a daily academic literature digest.")
    parser.add_argument("--config", help="Path to config YAML. Defaults to config.local.yaml if present.")
    parser.add_argument("--dry-run", action="store_true", help="Do not modify Gmail state.")
    parser.add_argument("--no-dry-run", action="store_true", help="Allow configured non-dry-run actions.")
    parser.add_argument("--max-emails", type=int, help="Override gmail.max_emails_per_run.")
    parser.add_argument("--sample", action="store_true", help="Use built-in sample emails.")
    parser.add_argument("--date", help="Override output date label, e.g. 2026-04-28.")
    parser.add_argument("--quiet", action="store_true", help="Suppress progress messages.")
    return parser


def _resolve_dry_run(args: argparse.Namespace, config: dict[str, Any]) -> bool:
    if args.no_dry_run:
        return False
    if args.dry_run:
        return True
    return bool(config["safety"].get("dry_run_default", True))


def _should_use_sample(
    args: argparse.Namespace,
    config: dict[str, Any],
    dry_run: bool,
    base_dir: Path,
) -> tuple[bool, list[str]]:
    warnings: list[str] = []
    if args.sample:
        warnings.append("使用内置样例邮件进行 dry-run；未读取真实 Gmail。")
        return True, warnings
    credentials_path = _resolve_path(config["gmail"].get("credentials_path", "credentials.json"), base_dir)
    if (
        dry_run
        and config["safety"].get("allow_sample_without_credentials", True)
        and not credentials_path.exists()
    ):
        warnings.append(
            f"未找到 Gmail OAuth 凭据 {credentials_path}，本次 dry-run 使用内置样例邮件。"
        )
        return True, warnings
    return False, warnings


def _apply_digest_limits(ranked, config: dict[str, Any]):
    high_limit = int(config["digest"].get("max_high_relevance", 20))
    medium_limit = int(config["digest"].get("max_medium_relevance", 30))
    raw_low_limit = config["digest"].get("max_low_relevance")
    low_limit = None if raw_low_limit is None else int(raw_low_limit)
    high_count = medium_count = low_count = 0
    result = []
    for paper in ranked:
        if paper.relevance == "high":
            if high_count >= high_limit:
                continue
            high_count += 1
        elif paper.relevance == "medium":
            if medium_count >= medium_limit:
                continue
            medium_count += 1
        elif paper.relevance == "low":
            if low_limit is not None and low_count >= low_limit:
                continue
            low_count += 1
        result.append(paper)
    return result


def _resolve_path(value: str | Path, base_dir: Path) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return base_dir / path


class ProgressReporter:
    def __init__(self, *, enabled: bool = True, show_timestamps: bool = True) -> None:
        self.enabled = enabled
        self.show_timestamps = show_timestamps
        self.started_at = perf_counter()

    def step(self, message: str) -> None:
        if not self.enabled:
            return
        print(f"{self._prefix()} {message}", flush=True)

    def item(self, current: int, total: int, message: str) -> None:
        if not self.enabled:
            return
        width = 24
        ratio = current / total if total else 1
        filled = min(width, max(0, int(width * ratio)))
        bar = "#" * filled + "-" * (width - filled)
        print(f"{self._prefix()} [{bar}] {current}/{total} {message}", flush=True)

    def done(self, message: str) -> None:
        if not self.enabled:
            return
        elapsed = perf_counter() - self.started_at
        print(f"{self._prefix()} {message}，耗时 {elapsed:.1f}s", flush=True)

    def _prefix(self) -> str:
        if not self.show_timestamps:
            return "[literature-digest]"
        return f"[{datetime.now().strftime('%H:%M:%S')}]"


def _shorten(value: str, max_length: int) -> str:
    text = " ".join((value or "(no subject)").split())
    if len(text) <= max_length:
        return text
    return text[: max_length - 3].rstrip() + "..."
