"""Web 检索工具函数"""

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Dict


def save_results(data: dict, output_dir: Path) -> tuple:
    """保存检索结果到 JSON 和 Markdown

    Args:
        data: 检索结果数据
        output_dir: 输出目录

    Returns:
        (json_path, md_path) 保存的文件路径
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    query = data.get("query", "search")
    year = data.get("year", "")
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")

    # 简化查询词用于文件名
    simplified_query = re.sub(r"[^\w\u4e00-\u9fa5\s-]", "", query)
    simplified_query = re.sub(r"\s+", "-", simplified_query)[:50]

    year_suffix = f"-{year}" if year else ""
    base_filename = f"{timestamp}-{simplified_query}{year_suffix}"

    # 保存 JSON
    json_path = output_dir / f"{base_filename}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # 保存 Markdown
    md_path = output_dir / f"{base_filename}.md"
    md_content = _generate_markdown(data)
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)

    return str(json_path), str(md_path)


def _generate_markdown(data: dict) -> str:
    """生成 Markdown 格式报告

    Args:
        data: 检索结果数据

    Returns:
        Markdown 内容
    """
    query = data.get("query", "")
    year = data.get("year", "")
    url = data.get("url", "")
    results = data.get("results", [])
    ts = data.get("timestamp", datetime.now().isoformat())

    # 转换时间戳
    try:
        dt = datetime.fromtimestamp(ts) if isinstance(ts, (int, float)) else datetime.fromisoformat(ts)
        date_str = dt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        date_str = str(ts)

    md = f"""# Google Scholar 检索结果

**检索词:** {query}
"""

    if year:
        md += f"**年份:** {year}\n"

    md += f"""**URL:** {url}
**日期:** {date_str}
**结果数:** {len(results)}

---

"""

    for i, r in enumerate(results, 1):
        md += f"""## {i}. {r.get("title", "N/A")}

**元信息:** {r.get("meta", "N/A")}
**URL:** {r.get("url", "#")}
**被引次数:** {r.get("cited_by", 0)}

"""

        if r.get("abstract"):
            abstract = r["abstract"]
            if len(abstract) > 500:
                abstract = abstract[:500] + "..."
            md += f"""### 摘要

{abstract}

"""

        if r.get("pdf_link"):
            md += f"**PDF:** [下载]({r['pdf_link']})\n\n"

        md += "---\n\n"

    return md


def print_results(results: list) -> None:
    """打印结果到控制台

    Args:
        results: 结果列表
    """
    if not results:
        print("\n没有找到结果。")
        return

    print(f"\n找到 {len(results)} 条结果:")
    print("=" * 60)

    for i, r in enumerate(results, 1):
        print(f"\n{i}. {r.get('title', 'N/A')}")
        print(f"   元信息: {r.get('meta', 'N/A')}")

        # 摘要
        abstract = r.get("abstract", "")
        if abstract:
            # 限制摘要长度
            if len(abstract) > 200:
                abstract = abstract[:197] + "..."
            print(f"   摘要: {abstract}")

        if r.get("cited_by"):
            print(f"   被引: {r['cited_by']} 次")

        url = r.get("url", "#")
        if len(url) > 70:
            url = url[:67] + "..."
        print(f"   URL: {url}")

        if r.get("pdf_link"):
            print(f"   PDF: [可用]({r['pdf_link']})")
