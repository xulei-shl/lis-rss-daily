#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
人大报刊资料期刊爬虫
使用 Camoufox 实现的论文爬取工具

功能：
1. 爬取指定期刊代码的某一期论文列表
2. 可选择是否获取论文摘要等详细信息
3. 支持命令行参数配置

网址格式：
https://www.rdfybk.com/qk/detail?DH=G9&NF=2024&QH=06&ST=1
- DH: 期刊代码 (如 G9)
- NF: 年份
- QH: 期号
"""

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Optional, List, Union
from urllib.parse import urlparse

from camoufox.sync_api import Camoufox

from rdfybk_detail import RDFYBKDetailSpider


class RDFYBKSpider:
    """人大报刊资料期刊爬虫类"""

    BASE_URL = "https://www.rdfybk.com/qk/detail"

    # 期号范围
    MIN_ISSUE = 1
    MAX_ISSUE = 12

    @staticmethod
    def parse_issue_string(issue_str: str) -> List[int]:
        """
        解析期数字符串，支持多种格式

        支持的格式：
        - 单期: "3" -> [3]
        - 范围: "1-3" -> [1, 2, 3]
        - 离散: "1,5,7" -> [1, 5, 7]
        - 混合: "1-3,5,7-9" -> [1, 2, 3, 5, 7, 8, 9]

        Args:
            issue_str: 期数字符串

        Returns:
            期号列表

        Raises:
            ValueError: 期号格式无效或超出范围
        """
        issues = set()

        # 去除空格
        issue_str = issue_str.strip()

        # 按逗号分割
        parts = issue_str.split(',')

        for part in parts:
            part = part.strip()
            if not part:
                continue

            # 检查是否是范围格式 (如 "1-3")
            if '-' in part:
                range_parts = part.split('-')
                if len(range_parts) != 2:
                    raise ValueError(f"无效的范围格式: {part}")

                start = int(range_parts[0].strip())
                end = int(range_parts[1].strip())

                if start > end:
                    raise ValueError(f"范围起始值不能大于结束值: {part}")

                for issue in range(start, end + 1):
                    if not RDFYBKSpider.MIN_ISSUE <= issue <= RDFYBKSpider.MAX_ISSUE:
                        raise ValueError(f"期号 {issue} 超出有效范围 ({RDFYBKSpider.MIN_ISSUE}-{RDFYBKSpider.MAX_ISSUE})")
                    issues.add(issue)
            else:
                # 单个期号
                issue = int(part)
                if not RDFYBKSpider.MIN_ISSUE <= issue <= RDFYBKSpider.MAX_ISSUE:
                    raise ValueError(f"期号 {issue} 超出有效范围 ({RDFYBKSpider.MIN_ISSUE}-{RDFYBKSpider.MAX_ISSUE})")
                issues.add(issue)

        return sorted(list(issues))

    def __init__(self, journal_code: str, year: int, issues: Union[int, str, List[int]], 
                 get_details: bool = False, headless: bool = True, timeout: int = 30000):
        """
        初始化爬虫

        Args:
            journal_code: 期刊代码 (如 "G9")
            year: 年份
            issues: 期号，支持以下格式:
                - 整数: 3 (单期)
                - 字符串: "3", "1-3", "1,5,7", "1-3,5,7-9"
                - 列表: [3], [1, 2, 3], [1, 5, 7]
            get_details: 是否获取论文摘要详情
            headless: 是否无头模式运行
            timeout: 超时时间（毫秒）
        """
        self.journal_code = journal_code
        self.year = year
        self.get_details = get_details
        self.headless = headless
        self.timeout = timeout
        self.results = []

        # 解析期号
        if isinstance(issues, str):
            self.issues = self.parse_issue_string(issues)
        elif isinstance(issues, int):
            self.issues = [issues]
        elif isinstance(issues, list):
            self.issues = sorted(set(issues))
        else:
            raise TypeError(f"不支持的期号类型: {type(issues)}")

        # 验证期号
        for issue in self.issues:
            if not self.MIN_ISSUE <= issue <= self.MAX_ISSUE:
                raise ValueError(f"期号 {issue} 超出有效范围 ({self.MIN_ISSUE}-{self.MAX_ISSUE})")

        # 构建基础 URL
        self.base_url = f"{self.BASE_URL}?DH={journal_code}&NF={year}"

    def _build_url(self, issue: int) -> str:
        """构建指定期号的 URL"""
        return f"{self.base_url}&QH={issue:02d}&ST=1"

    def _should_skip_title(self, title: str) -> bool:
        """
        判断是否应该跳过该标题

        跳过规则：
        1. 空标题
        2. 标题为 "目录"
        3. 标题包含非论文关键词

        Args:
            title: 论文标题

        Returns:
            True 表示跳过，False 表示保留
        """
        if not title:
            return True

        title = title.strip()

        # 跳过 "目录"
        if title == "目录":
            return True

        # 跳过非论文条目
        skip_keywords = ["优秀审稿专家", "优秀编委", "优秀论文", "年度优秀", "编者按", "声明", "征稿"]
        for keyword in skip_keywords:
            if keyword in title:
                return True

        return False

    def crawl(self, issue: Optional[int] = None) -> list:
        """
        爬取单期论文

        Args:
            issue: 期号，如果为 None 则使用第一期

        Returns:
            论文列表
        """
        target_issue = issue if issue is not None else self.issues[0]
        url = self._build_url(target_issue)

        with Camoufox(headless=self.headless) as browser:
            page = browser.new_page()

            try:
                # 1. 访问期刊页面
                print(f"正在访问: {url}", file=sys.stderr)
                page.goto(url, timeout=self.timeout, wait_until="domcontentloaded")

                # 2. 等待论文列表加载
                self._wait_for_papers(page)

                # 3. 爬取论文列表
                papers = self._extract_papers(page, target_issue)

                # 4. 如果需要获取详情
                if self.get_details and papers:
                    papers = self._get_paper_details(page, papers)

                self.results = papers
                return papers

            except Exception as e:
                print(f"爬取过程中发生错误: {e}", file=sys.stderr)
                raise

    def _wait_for_papers(self, page, max_wait: int = 10):
        """等待论文列表加载"""
        print("正在加载论文列表...", file=sys.stderr)
        try:
            # 使用 wait_for_selector 等待论文行元素出现
            page.wait_for_selector("tr.t1, tr.t2", timeout=max_wait * 1000)
            count = page.locator("tr.t1, tr.t2").count()
            print(f"已找到 {count} 篇论文", file=sys.stderr)
        except Exception as e:
            print(f"等待论文列表时出错: {e}", file=sys.stderr)

    def _extract_papers(self, page, issue: int) -> list:
        """
        提取论文列表

        Args:
            page: Playwright 页面对象
            issue: 期号

        Returns:
            论文列表
        """
        papers = []
        paper_rows = page.locator("tr.t1, tr.t2")
        count = paper_rows.count()

        print(f"正在提取论文信息 (共 {count} 篇)...", file=sys.stderr)
        skip_count = 0

        for i in range(count):
            try:
                row = paper_rows.nth(i)

                # 获取标题链接
                title_link = row.locator("td.bt a")
                title = ""
                abstract_url = ""

                if title_link.count() > 0:
                    title = title_link.inner_text().strip()
                    # 获取相对路径
                    href = title_link.get_attribute("href") or ""
                    # 拼接完整 URL
                    if href and not href.startswith("http"):
                        abstract_url = f"https://www.rdfybk.com{href}"
                    else:
                        abstract_url = href

                # 检查是否需要跳过
                if self._should_skip_title(title):
                    skip_count += 1
                    continue

                # 获取作者（第二个 td）
                author_td = row.locator("td").nth(1)
                author = ""
                author_link = author_td.locator("a")
                if author_link.count() > 0:
                    author = author_link.inner_text().strip()
                else:
                    # 如果没有链接，直接获取 td 文本
                    author = author_td.inner_text().strip()

                paper = {
                    "year": self.year,
                    "issue": issue,
                    "title": title,
                    "author": author,
                    "abstract_url": abstract_url,
                    "abstract": "" if self.get_details else None
                }

                papers.append(paper)

            except Exception as e:
                print(f"提取第 {i+1} 篇论文时出错: {e}", file=sys.stderr)
                continue

        print(f"已提取 {len(papers)} 篇论文 (跳过 {skip_count} 条非论文记录)", file=sys.stderr)
        return papers

    def _get_paper_details(self, page, papers: list) -> list:
        """获取论文摘要详情"""
        total = len(papers)
        print(f"\n正在获取 {total} 篇论文的详细信息...", file=sys.stderr)

        # 使用独立的详情爬取模块
        detail_spider = RDFYBKDetailSpider(timeout=self.timeout, delay=0.3)

        success_count = 0
        fail_count = 0
        skip_count = 0

        for i, paper in enumerate(papers):
            if not paper.get("abstract_url"):
                print(f"  [{i+1}/{total}] 跳过: 无摘要链接", file=sys.stderr)
                skip_count += 1
                continue

            try:
                title_short = paper['title'][:40] + "..." if len(paper['title']) > 40 else paper['title']
                print(f"  [{i+1}/{total}] 获取: {title_short}", end=" ", file=sys.stderr)

                # 在新标签页打开摘要页
                context = page.context
                detail_page = context.new_page()
                detail_page.set_default_timeout(self.timeout)

                # 使用独立模块获取详情
                detail = detail_spider.fetch_detail(detail_page, paper["abstract_url"])

                if detail:
                    paper["abstract"] = detail.get("abstract", "")
                    print("成功", file=sys.stderr)
                    success_count += 1
                else:
                    paper["abstract"] = "获取失败"
                    print("失败", file=sys.stderr)
                    fail_count += 1

                detail_page.close()

            except Exception as e:
                print(f"错误: {e}", file=sys.stderr)
                paper["abstract"] = f"获取失败: {str(e)}"
                fail_count += 1

        print(f"\n摘要获取完成: 成功 {success_count} 篇，失败 {fail_count} 篇，跳过 {skip_count} 篇", file=sys.stderr)
        return papers


def main():
    """主函数"""
    parser = argparse.ArgumentParser(
        description="人大报刊资料期刊论文爬虫 - 使用 Camoufox",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 爬取 G9 期刊 2024 年第 6 期论文列表
  python rdfybk_spider.py -j G9 -y 2024 -i 6

  # 爬取 G9 期刊 2024 年第 1-3 期论文列表（范围格式）
  python rdfybk_spider.py -j G9 -y 2024 -i "1-3"

  # 爬取并获取论文摘要
  python rdfybk_spider.py -j G9 -y 2024 -i 6 -d

  # 输出到 stdout
  python rdfybk_spider.py -j G9 -y 2024 -i 6 -o -

  # 非无头模式运行（显示浏览器）
  python rdfybk_spider.py -j G9 -y 2024 -i 6 --no-headless
        """
    )

    parser.add_argument(
        "-j", "--journal-code",
        required=True,
        help="期刊代码 (如: G9)"
    )

    parser.add_argument(
        "-y", "--year",
        type=int,
        required=True,
        help="要爬取的年份"
    )

    parser.add_argument(
        "-i", "--issue",
        type=str,
        required=True,
        help="要爬取的期号，支持以下格式:\n"
             "  - 单期: 6\n"
             "  - 范围: 1-3 (表示 1,2,3 期)\n"
             "  - 离散: 1,5,7 (表示 1,5,7 期)\n"
             "  - 混合: 1-3,5,7-9"
    )

    parser.add_argument(
        "-d", "--details",
        action="store_true",
        default=False,
        help="是否获取论文摘要等详细信息 (默认: 不获取)"
    )

    parser.add_argument(
        "--no-headless",
        action="store_true",
        help="非无头模式运行，显示浏览器窗口"
    )

    parser.add_argument(
        "-t", "--timeout",
        type=int,
        default=30000,
        help="页面加载超时时间（毫秒），默认 30000"
    )

    parser.add_argument(
        "-o", "--output",
        type=str,
        default="results.json",
        help="输出文件路径，默认 results.json，使用 '-' 输出到 stdout"
    )

    args = parser.parse_args()

    # 解析期号字符串
    try:
        issues = RDFYBKSpider.parse_issue_string(args.issue)
        print(f"解析期号: {args.issue} -> {issues}", file=sys.stderr)
    except ValueError as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)

    # 创建爬虫
    spider = RDFYBKSpider(
        journal_code=args.journal_code,
        year=args.year,
        issues=issues,
        get_details=args.details,
        headless=not args.no_headless,
        timeout=args.timeout
    )

    # 确保输出目录存在
    output_path = Path(args.output)
    if args.output != '-':
        output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        # 只爬取第一期（单期模式）
        papers = spider.crawl(issues[0])

        if papers:
            # 输出 JSON 结果
            if args.output == '-':
                # 输出到 stdout
                # 使用 sys.stdout.write 确保完整输出
                json_str = json.dumps(papers, ensure_ascii=False, indent=2)
                sys.stdout.write(json_str)
                sys.stdout.flush()
            else:
                # 保存到文件
                with open(args.output, 'w', encoding='utf-8') as f:
                    json.dump(papers, f, ensure_ascii=False, indent=2)
                print(f"\n成功爬取 {len(papers)} 篇论文，保存到: {output_path.absolute()}", file=sys.stderr)
        else:
            print("\n未找到任何论文", file=sys.stderr)
            # 输出空数组
            if args.output == '-':
                sys.stdout.write('[]')
                sys.stdout.flush()

    except KeyboardInterrupt:
        print("\n\n用户中断执行", file=sys.stderr)
        sys.exit(0)
    except Exception as e:
        print(f"\n错误: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        # 输出错误 JSON
        if args.output == '-':
            error_json = json.dumps({"error": str(e), "articles": []}, ensure_ascii=False)
            sys.stdout.write(error_json)
            sys.stdout.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
