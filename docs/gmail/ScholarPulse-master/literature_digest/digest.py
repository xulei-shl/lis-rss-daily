from __future__ import annotations

import json
import os
from html import escape
from pathlib import Path

from .models import DigestRun, RankedPaper


def write_digest(run: DigestRun, output_dir: str | Path) -> Path:
    """Backward-compatible Markdown-only writer."""

    target_dir = Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{run.date_label}-digest.md"
    target.write_text(render_markdown(run), encoding="utf-8")
    return target


def write_digests(
    run: DigestRun,
    output_dir: str | Path,
    formats: list[str] | None = None,
    *,
    overwrite_existing: bool = True,
) -> list[Path]:
    target_dir = Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    selected = [item.lower() for item in (formats or ["md", "html"])]
    extensions = _selected_extensions(selected)
    stem = _unique_output_stem(target_dir, f"{run.date_label}-digest", extensions, overwrite_existing)
    written: list[Path] = []

    if "md" in selected or "markdown" in selected:
        markdown_path = target_dir / f"{stem}.md"
        markdown_path.write_text(render_markdown(run), encoding="utf-8")
        written.append(markdown_path)

    if "html" in selected:
        html_path = target_dir / f"{stem}.html"
        html_path.write_text(render_html(run, target_dir), encoding="utf-8")
        written.append(html_path)

    return written


def render_markdown(run: DigestRun) -> str:
    lines: list[str] = []
    lines.append(f"# 科研文献摘要 - {run.date_label}")
    lines.append("")
    if run.warnings:
        lines.append("## 运行提示")
        lines.extend(f"- {warning}" for warning in run.warnings)
        lines.append("")

    stats = run.stats
    lines.append("## 总体统计")
    lines.append(f"- 邮件读取数：{stats.emails_read}")
    lines.append(f"- 跳过无用邮件：{stats.skipped_emails}")
    lines.append(f"- 提取论文条目：{stats.paper_entries_extracted}")
    lines.append(f"- 去重移除：{stats.duplicates_removed}")
    lines.append(f"- 高相关论文：{stats.high_relevance}")
    lines.append(f"- 中相关论文：{stats.medium_relevance}")
    lines.append(f"- 低相关论文：{stats.low_relevance}")
    lines.append(f"- 样例模式：{'是' if stats.sample_mode else '否'}")
    lines.append("")

    lines.append("## 近期研究兴趣摘要")
    lines.append(run.interest_profile.summary_zh or "未生成研究兴趣摘要。")
    lines.append("")
    if run.interest_profile.high_priority_topics:
        lines.append("高优先级主题：" + "；".join(run.interest_profile.high_priority_topics))
        lines.append("")

    _append_markdown_section(lines, "高相关论文", [paper for paper in run.papers if paper.relevance == "high"])
    _append_markdown_section(lines, "中相关论文", [paper for paper in run.papers if paper.relevance == "medium"])
    _append_markdown_section(lines, "低相关论文", [paper for paper in run.papers if paper.relevance == "low"], short=True)

    if run.skipped:
        lines.append("## 跳过的邮件")
        for skipped in run.skipped:
            lines.append(f"- {skipped.subject} | {skipped.sender} | {skipped.reason}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _selected_extensions(selected: list[str]) -> list[str]:
    extensions: list[str] = []
    if "md" in selected or "markdown" in selected:
        extensions.append(".md")
    if "html" in selected:
        extensions.append(".html")
    return extensions


def _unique_output_stem(
    output_dir: Path,
    base_stem: str,
    extensions: list[str],
    overwrite_existing: bool,
) -> str:
    if overwrite_existing or not extensions:
        return base_stem
    if not any((output_dir / f"{base_stem}{extension}").exists() for extension in extensions):
        return base_stem
    for index in range(2, 10000):
        candidate = f"{base_stem}-{index}"
        if not any((output_dir / f"{candidate}{extension}").exists() for extension in extensions):
            return candidate
    raise RuntimeError(f"Could not find an available output filename for {base_stem}")


def render_html(run: DigestRun, output_dir: str | Path | None = None) -> str:
    stats = run.stats
    stats_cards = [
        ("邮件读取", stats.emails_read),
        ("论文条目", stats.paper_entries_extracted),
        ("去重移除", stats.duplicates_removed),
        ("高相关", stats.high_relevance),
        ("中相关", stats.medium_relevance),
        ("低相关", stats.low_relevance),
        ("跳过邮件", stats.skipped_emails),
    ]
    warnings = "".join(f"<li>{escape(warning)}</li>" for warning in run.warnings)
    high_topics = run.interest_profile.high_priority_topics
    high_topic_html = "".join(f"<span>{escape(topic)}</span>" for topic in high_topics)
    paper_cards = "\n".join(_render_paper_card(paper, index, output_dir) for index, paper in enumerate(run.papers, 1))
    skipped_items = "".join(
        f"<li><strong>{escape(item.subject)}</strong><span>{escape(item.sender)}</span><em>{escape(item.reason)}</em></li>"
        for item in run.skipped
    )
    data = {
        "high": stats.high_relevance,
        "medium": stats.medium_relevance,
        "low": stats.low_relevance,
        "total": len(run.papers),
    }

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>科研文献摘要 - {escape(run.date_label)}</title>
  <style>
    :root {{
      --bg: #f4f7f6;
      --surface: #fbfcfa;
      --surface-strong: #ffffff;
      --text: #17201c;
      --muted: #64716b;
      --border: #dce4df;
      --accent: #13756d;
      --accent-strong: #0a4a45;
      --accent-soft: #e3f2ee;
      --amber: #b7791f;
      --rose: #b04436;
      --slate: #607083;
      --high: #b04436;
      --medium: #b7791f;
      --low: #607083;
      --shadow: 0 18px 50px rgba(23, 32, 28, 0.10);
      --shadow-soft: 0 8px 24px rgba(23, 32, 28, 0.07);
      color-scheme: light;
      font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background:
        linear-gradient(180deg, rgba(19, 117, 109, 0.08) 0%, rgba(244, 247, 246, 0) 380px),
        var(--bg);
      color: var(--text);
      line-height: 1.65;
    }}
    a {{ color: var(--accent-strong); text-decoration-thickness: 1px; text-underline-offset: 3px; }}
    header {{
      padding: 42px 28px 28px;
      border-bottom: 1px solid rgba(220, 228, 223, 0.82);
      background:
        radial-gradient(circle at 12% 0%, rgba(19, 117, 109, 0.16), transparent 34%),
        linear-gradient(135deg, #ffffff 0%, #f5faf8 54%, #eef3f0 100%);
    }}
    .shell {{ width: min(1180px, calc(100vw - 32px)); margin: 0 auto; }}
    .hero {{
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      gap: 28px;
    }}
    h1 {{ margin: 0 0 10px; font-size: 38px; line-height: 1.15; font-weight: 760; letter-spacing: 0; }}
    .subtitle {{ margin: 0; color: var(--muted); font-size: 15px; }}
    .hero-summary {{
      display: grid;
      grid-template-columns: repeat(3, minmax(76px, 1fr));
      gap: 8px;
      min-width: 290px;
    }}
    .hero-summary div {{
      border: 1px solid rgba(19, 117, 109, 0.18);
      background: rgba(255, 255, 255, 0.76);
      border-radius: 8px;
      padding: 10px 12px;
      box-shadow: var(--shadow-soft);
    }}
    .hero-summary strong {{ display: block; font-size: 22px; line-height: 1.1; }}
    .hero-summary span {{ display: block; margin-top: 3px; color: var(--muted); font-size: 12px; }}
    .toolbar {{
      position: sticky;
      top: 0;
      z-index: 10;
      background: rgba(244, 247, 246, 0.92);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--border);
      padding: 14px 0;
    }}
    .toolbar-row {{ display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: center; }}
    input[type="search"] {{
      width: 100%;
      min-height: 44px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0 15px;
      background: var(--surface-strong);
      color: var(--text);
      font-size: 14px;
      outline: none;
    }}
    input[type="search"]:focus {{ border-color: var(--accent); box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12); }}
    .filters {{ display: flex; gap: 8px; flex-wrap: wrap; }}
    button {{
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-strong);
      color: var(--text);
      min-height: 40px;
      padding: 0 13px;
      font-size: 14px;
      cursor: pointer;
      transition: border-color 140ms ease, background 140ms ease, color 140ms ease, transform 140ms ease;
    }}
    button:hover {{ transform: translateY(-1px); border-color: rgba(19, 117, 109, 0.38); }}
    button[aria-pressed="true"] {{ background: var(--accent); border-color: var(--accent); color: white; }}
    .secondary-actions button {{
      color: var(--accent-strong);
      background: #f8fbfa;
    }}
    main {{ padding: 28px 0 56px; }}
    .stats {{
      display: grid;
      grid-template-columns: repeat(7, minmax(110px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }}
    .stat {{
      background: rgba(255, 255, 255, 0.86);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      min-height: 74px;
      box-shadow: var(--shadow-soft);
    }}
    .stat strong {{ display: block; font-size: 25px; line-height: 1.1; color: var(--accent-strong); }}
    .stat span {{ color: var(--muted); font-size: 13px; }}
    .panel {{
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: var(--shadow-soft);
    }}
    .panel h2, .section-title {{ margin: 0 0 12px; font-size: 20px; line-height: 1.3; }}
    .topics {{ display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }}
    .topics span, .tag {{
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent-strong);
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 650;
    }}
    .paper-list {{ display: grid; gap: 18px; }}
    .paper-card {{
      background: var(--surface-strong);
      border: 1px solid var(--border);
      border-left: 5px solid var(--low);
      border-radius: 8px;
      padding: 20px 20px 18px;
      box-shadow: var(--shadow-soft);
      transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
    }}
    .paper-card:hover {{ transform: translateY(-2px); box-shadow: var(--shadow); border-color: rgba(19, 117, 109, 0.24); }}
    .paper-card[data-level="high"] {{ border-left-color: var(--high); }}
    .paper-card[data-level="medium"] {{ border-left-color: var(--medium); }}
    .paper-card[data-level="low"] {{ border-left-color: var(--low); }}
    .paper-top {{ display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }}
    .paper-card h3 {{ margin: 0 0 8px; font-size: 20px; line-height: 1.35; letter-spacing: 0; }}
    .meta {{ margin: 0 0 10px; color: var(--muted); font-size: 13px; }}
    .venue {{
      display: inline-flex;
      width: fit-content;
      margin: 0 0 10px;
      padding: 4px 9px;
      border-radius: 8px;
      background: #eef6f3;
      color: var(--accent-strong);
      font-size: 13px;
      font-weight: 700;
    }}
    .score {{
      flex: 0 0 auto;
      border-radius: 999px;
      border: 1px solid var(--border);
      padding: 6px 11px;
      color: var(--text);
      font-size: 13px;
      font-weight: 700;
      background: #faf8f2;
      white-space: nowrap;
    }}
    .paper-card[data-level="high"] .score {{ color: var(--high); background: #fff1ee; border-color: #f0c7bf; }}
    .paper-card[data-level="medium"] .score {{ color: var(--medium); background: #fff7df; border-color: #ead49f; }}
    .paper-card[data-level="low"] .score {{ color: var(--low); background: #f2f5f7; border-color: #d4dde4; }}
    .summary {{ margin: 10px 0; }}
    details {{ margin-top: 10px; }}
    summary {{ cursor: pointer; color: var(--accent-strong); font-weight: 650; }}
    details[open] {{ border-top: 1px solid var(--border); padding-top: 10px; }}
    .actions {{ display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }}
    .action {{
      display: inline-flex;
      align-items: center;
      min-height: 38px;
      padding: 0 13px;
      border: 1px solid rgba(19, 117, 109, 0.26);
      border-radius: 8px;
      background: #f1faf7;
      text-decoration: none;
      font-size: 14px;
      font-weight: 650;
      transition: background 140ms ease, transform 140ms ease;
    }}
    .action:hover {{ background: #e4f4f0; transform: translateY(-1px); }}
    .image-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 14px; }}
    .image-grid img {{
      width: 100%;
      max-height: 320px;
      object-fit: contain;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: white;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.7);
    }}
    .skipped-list {{ margin: 0; padding-left: 18px; }}
    .skipped-list span, .skipped-list em {{ color: var(--muted); margin-left: 8px; font-size: 13px; }}
    .empty {{ display: none; padding: 24px; text-align: center; color: var(--muted); }}
    footer {{ color: var(--muted); font-size: 12px; padding: 28px 0; }}
    @media (max-width: 860px) {{
      h1 {{ font-size: 27px; }}
      .hero {{ grid-template-columns: 1fr; align-items: start; }}
      .hero-summary {{ min-width: 0; grid-template-columns: repeat(3, minmax(0, 1fr)); }}
      .toolbar-row {{ grid-template-columns: 1fr; }}
      .stats {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
      .paper-top {{ display: block; }}
      .score {{ display: inline-flex; margin-bottom: 10px; }}
    }}
  </style>
</head>
<body>
  <header>
    <div class="shell hero">
      <div>
        <h1>科研文献摘要</h1>
        <p class="subtitle">{escape(run.date_label)} · 浏览器阅读版 · 共 {len(run.papers)} 篇候选论文</p>
      </div>
      <div class="hero-summary" aria-label="相关性概览">
        <div><strong>{stats.high_relevance}</strong><span>高相关</span></div>
        <div><strong>{stats.medium_relevance}</strong><span>中相关</span></div>
        <div><strong>{stats.low_relevance}</strong><span>低相关</span></div>
      </div>
    </div>
  </header>
  <nav class="toolbar" aria-label="阅读工具">
    <div class="shell toolbar-row">
      <input id="search" type="search" placeholder="搜索标题、摘要、主题、DOI 或来源邮件">
      <div class="filters" role="group" aria-label="相关性筛选">
        <button type="button" data-filter="all" aria-pressed="true">全部</button>
        <button type="button" data-filter="high" aria-pressed="false">高相关</button>
        <button type="button" data-filter="medium" aria-pressed="false">中相关</button>
        <button type="button" data-filter="low" aria-pressed="false">低相关</button>
        <span class="secondary-actions">
          <button type="button" id="expand-all">展开详情</button>
          <button type="button" id="collapse-all">收起详情</button>
        </span>
      </div>
    </div>
  </nav>
  <main class="shell">
    <section class="stats" aria-label="总体统计">
      {''.join(f'<div class="stat"><strong>{value}</strong><span>{escape(label)}</span></div>' for label, value in stats_cards)}
    </section>
    {'<section class="panel"><h2>运行提示</h2><ul>' + warnings + '</ul></section>' if warnings else ''}
    <section class="panel">
      <h2>近期研究兴趣摘要</h2>
      <p>{escape(run.interest_profile.summary_zh or '未生成研究兴趣摘要。')}</p>
      {'<div class="topics">' + high_topic_html + '</div>' if high_topic_html else ''}
    </section>
    <h2 class="section-title">论文列表</h2>
    <section class="paper-list" id="papers" aria-live="polite">
      {paper_cards or '<p class="panel">暂无论文条目。</p>'}
    </section>
    <p class="empty" id="empty">当前筛选条件下没有匹配论文。</p>
    {'<section class="panel"><h2>跳过的邮件</h2><ul class="skipped-list">' + skipped_items + '</ul></section>' if skipped_items else ''}
    <footer>由本地 literature_digest 工作流生成。Markdown 与 HTML 文件包含相同 digest 内容，HTML 额外提供搜索、筛选和图片浏览。</footer>
  </main>
  <script type="application/json" id="digest-data">{escape(json.dumps(data, ensure_ascii=False))}</script>
  <script>
    const search = document.querySelector('#search');
    const buttons = Array.from(document.querySelectorAll('[data-filter]'));
    const cards = Array.from(document.querySelectorAll('.paper-card'));
    const expandAll = document.querySelector('#expand-all');
    const collapseAll = document.querySelector('#collapse-all');
    const empty = document.querySelector('#empty');
    let activeFilter = 'all';

    function applyFilters() {{
      const query = search.value.trim().toLowerCase();
      let visible = 0;
      for (const card of cards) {{
        const matchesLevel = activeFilter === 'all' || card.dataset.level === activeFilter;
        const matchesSearch = !query || card.dataset.search.includes(query);
        const show = matchesLevel && matchesSearch;
        card.hidden = !show;
        if (show) visible += 1;
      }}
      empty.style.display = visible ? 'none' : 'block';
    }}

    for (const button of buttons) {{
      button.addEventListener('click', () => {{
        activeFilter = button.dataset.filter;
        for (const item of buttons) item.setAttribute('aria-pressed', String(item === button));
        applyFilters();
      }});
    }}
    search.addEventListener('input', applyFilters);
    expandAll.addEventListener('click', () => {{
      for (const item of document.querySelectorAll('.paper-card:not([hidden]) details')) item.open = true;
    }});
    collapseAll.addEventListener('click', () => {{
      for (const item of document.querySelectorAll('.paper-card details')) item.open = false;
    }});
  </script>
</body>
</html>
"""


def _append_markdown_section(lines: list[str], title: str, papers: list[RankedPaper], *, short: bool = False) -> None:
    lines.append(f"## {title}")
    if not papers:
        lines.append("暂无。")
        lines.append("")
        return

    for index, paper in enumerate(papers, start=1):
        entry = paper.entry
        link = f" | [链接]({entry.url})" if entry.url else ""
        doi = f" | DOI: `{entry.doi}`" if entry.doi else ""
        title_zh = _display_title_zh(paper)
        lines.append(f"### {index}. {title_zh}")
        lines.append(f"- 英文原题：{entry.title}{link}{doi}")
        lines.append(f"- 期刊/来源：{entry.venue or '未识别'}")
        lines.append(f"- 相关性：{paper.relevance} / {paper.score:.2f}")
        if paper.matched_topics:
            lines.append(f"- 匹配主题：{'；'.join(paper.matched_topics)}")
        if short:
            lines.append(f"- 简注：{paper.reason_zh}")
        else:
            lines.append(f"- 中文摘要：{paper.summary_zh}")
            lines.append(f"- 推荐理由：{paper.reason_zh}")
        if entry.image_paths:
            lines.append("- TOC/邮件图片：")
            for image_path in entry.image_paths:
                lines.append(f"  - ![]({image_path})")
        lines.append(f"- 来源邮件：{entry.source_subject} | {entry.source_sender}")
        lines.append("")


def _render_paper_card(paper: RankedPaper, index: int, output_dir: str | Path | None) -> str:
    entry = paper.entry
    title_zh = _display_title_zh(paper)
    search_blob = " ".join(
        [
            entry.title,
            title_zh,
            paper.summary_zh,
            paper.reason_zh,
            entry.doi,
            entry.source_subject,
            " ".join(paper.matched_topics),
        ]
    ).lower()
    topic_html = "".join(f'<span class="tag">{escape(topic)}</span>' for topic in paper.matched_topics)
    image_html = _render_images(entry.image_paths, output_dir)
    original_link = (
        f'<a class="action" href="{escape(entry.url)}" target="_blank" rel="noreferrer">打开原文</a>'
        if entry.url
        else ""
    )
    venue_html = escape(entry.venue or "未识别")
    doi_html = f'<span>DOI: <code>{escape(entry.doi)}</code></span>' if entry.doi else ""
    return f"""
      <article class="paper-card" data-level="{escape(paper.relevance)}" data-search="{escape(search_blob)}">
        <div class="paper-top">
          <div>
            <h3>{index}. {escape(title_zh)}</h3>
            <p class="meta">英文原题：{escape(entry.title)}</p>
            <p class="venue">期刊/来源：{venue_html}</p>
          </div>
          <div class="score">{escape(_level_label(paper.relevance))} · {paper.score:.2f}</div>
        </div>
        {'<div class="topics">' + topic_html + '</div>' if topic_html else ''}
        <p class="summary">{escape(paper.summary_zh)}</p>
        <details>
          <summary>查看推荐理由与来源</summary>
          <p>{escape(paper.reason_zh)}</p>
          <p class="meta">来源邮件：{escape(entry.source_subject)} | {escape(entry.source_sender)}</p>
          {doi_html}
        </details>
        {image_html}
        <div class="actions">{original_link}</div>
      </article>
"""


def _render_images(paths: list[Path | str], output_dir: str | Path | None) -> str:
    if not paths:
        return ""
    items = []
    for path in paths:
        src = _image_src(path, output_dir)
        items.append(f'<img src="{escape(src)}" alt="TOC 或邮件图片" loading="lazy">')
    return '<div class="image-grid">' + "".join(items) + "</div>"


def _display_title_zh(paper: RankedPaper) -> str:
    title = (paper.title_zh or "").strip()
    original = paper.entry.title.strip()
    if title and title != original and _contains_cjk(title):
        return title
    return "中文标题暂未生成"


def _contains_cjk(text: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in text)


def _image_src(path: Path | str, output_dir: str | Path | None) -> str:
    raw = str(path)
    if raw.startswith(("http://", "https://", "data:", "file:")):
        return raw
    image_path = Path(raw)
    if image_path.is_absolute():
        return image_path.as_uri()
    if output_dir is not None:
        base = Path(output_dir).resolve()
        absolute = image_path.resolve()
        try:
            return os.path.relpath(absolute, base).replace("\\", "/")
        except ValueError:
            return absolute.as_uri()
    return image_path.as_posix()


def _level_label(level: str) -> str:
    return {"high": "高相关", "medium": "中相关", "low": "低相关"}.get(level, level)
