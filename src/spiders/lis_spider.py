#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
图书情报知识 (lis.ac.cn) 期刊爬虫
使用 Camoufox 实现的图书情报知识期刊论文爬取工具

功能：
1. 爬取指定期刊的某一期论文列表
2. 直接从列表页提取摘要（无需跳转）
3. 支持命令行参数配置
"""

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path
from typing import Optional, List, Union

from camoufox.sync_api import Camoufox
from camoufox.async_api import AsyncCamoufox

from paper_filter import LISPaperFilter


class LISSpider:
    """图书情报知识 (lis.ac.cn) 期刊爬虫类"""

    # 年卷对应关系：2024=68卷, 2025=69卷, 2026=70卷
    # 公式：卷号 = 年份 - 1956
    YEAR_VOLUME_MAP = {
        2024: 68,
        2025: 69,
        2026: 70,
    }

    # 支持的年份范围：无下限，上限为当前年份
    MAX_YEAR = 2026  # TODO: 可改为动态获取当前年份

    # 期号范围（半月刊，每年24期）
    MIN_ISSUE = 1
    MAX_ISSUE = 24

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
                    if not LISSpider.MIN_ISSUE <= issue <= LISSpider.MAX_ISSUE:
                        raise ValueError(f"期号 {issue} 超出有效范围 ({LISSpider.MIN_ISSUE}-{LISSpider.MAX_ISSUE})")
                    issues.add(issue)
            else:
                # 单个期号
                issue = int(part)
                if not LISSpider.MIN_ISSUE <= issue <= LISSpider.MAX_ISSUE:
                    raise ValueError(f"期号 {issue} 超出有效范围 ({LISSpider.MIN_ISSUE}-{LISSpider.MAX_ISSUE})")
                issues.add(issue)

        return sorted(list(issues))

    @staticmethod
    def get_volume_by_year(year: int) -> int:
        """
        根据年份获取卷号

        使用公式：卷号 = 年份 - 1956
        （基于已知映射：2024=68卷, 2025=69卷, 2026=70卷）

        Args:
            year: 年份

        Returns:
            卷号

        Raises:
            ValueError: 年份超出支持范围
        """
        if year > LISSpider.MAX_YEAR:
            raise ValueError(f"年份 {year} 不能超过当前年份 ({LISSpider.MAX_YEAR})")
        return year - 1956

    @staticmethod
    def validate_year_volume_issue(year: int, volume: Optional[int] = None, issue: Optional[int] = None) -> dict:
        """
        校验年卷期参数是否合理

        Args:
            year: 年份
            volume: 卷号（可选，用于校验）
            issue: 期号（可选，用于校验）

        Returns:
            包含校验结果的字典

        Raises:
            ValueError: 参数无效时抛出
        """
        # 校验年份：只检查上限
        if year > LISSpider.MAX_YEAR:
            raise ValueError(f"年份 {year} 不能超过当前年份 ({LISSpider.MAX_YEAR})")

        # 获取对应卷号
        expected_volume = LISSpider.get_volume_by_year(year)

        # 如果提供了卷号，校验是否匹配
        if volume is not None and volume != expected_volume:
            raise ValueError(f"年份 {year} 应对应卷号 {expected_volume}，但提供了卷号 {volume}")

        # 校验期号
        if issue is not None:
            if issue < LISSpider.MIN_ISSUE or issue > LISSpider.MAX_ISSUE:
                raise ValueError(f"期号 {issue} 超出有效范围 ({LISSpider.MIN_ISSUE}-{LISSpider.MAX_ISSUE})")

        return {
            "valid": True,
            "year": year,
            "volume": expected_volume,
            "issue": issue,
            "error": None
        }

    @staticmethod
    def build_url(year: int, volume: int, issue: int) -> str:
        """
        构建期刊页面 URL

        Args:
            year: 年份
            volume: 卷号
            issue: 期号

        Returns:
            期刊页面 URL
        """
        return f"https://www.lis.ac.cn/CN/Y{year}/V{volume}/I{issue}"

    def __init__(self, year: int, issues: Union[int, str, List[int]],
                 volume: Optional[int] = None,
                 headless: bool = True, timeout: int = 180000, max_retries: int = 3):
        """
        初始化爬虫

        Args:
            year: 年份
            issues: 期号，支持以下格式:
                - 整数: 3 (单期)
                - 字符串: "3", "1-3", "1,5,7", "1-3,5,7-9"
                - 列表: [3], [1, 2, 3], [1, 5, 7]
            volume: 卷号（可选，会根据年份自动校验）
            headless: 是否无头模式运行
            timeout: 超时时间（毫秒），默认 3 分钟
            max_retries: 最大重试次数，默认 3 次
        """
        self.year = year
        self.headless = headless
        self.timeout = timeout
        self.max_retries = max_retries
        self.results = []

        # 初始化论文过滤器（LIS 专用）
        self.paper_filter = LISPaperFilter()

        # 校验年卷期参数并获取卷号
        validation = self.validate_year_volume_issue(year, volume)
        self.volume = validation["volume"]

        # 解析期号
        if isinstance(issues, str):
            self.issues = self.parse_issue_string(issues)
        elif isinstance(issues, int):
            # 校验单期
            self.validate_year_volume_issue(year, volume, issues)
            self.issues = [issues]
        elif isinstance(issues, list):
            # 校验所有期号
            for issue in issues:
                self.validate_year_volume_issue(year, volume, issue)
            self.issues = sorted(set(issues))
        else:
            raise TypeError(f"不支持的期号类型: {type(issues)}")

    def _should_skip_title(self, title: str) -> bool:
        """
        判断是否应该跳过该标题（使用 LIS 专用过滤器）

        Args:
            title: 论文标题

        Returns:
            True 表示跳过，False 表示保留
        """
        return self.paper_filter.should_skip(title)

    def _parse_volume_issue(self, text: str) -> tuple:
        """
        从卷期文本中解析卷号和期号

        输入格式: "2025, 69(24): 4-15."
        输出: (year, volume, issue, pages)

        Args:
            text: 卷期文本

        Returns:
            (year, volume, issue, pages) 或 None
        """
        # 匹配格式: 2026, 70(1): 5-15.
        pattern = r'(\d+),\s*(\d+)\((\d+)\):\s*([\d\-\s]+)\.'
        match = re.search(pattern, text)

        if match:
            year = int(match.group(1))
            volume = int(match.group(2))
            issue = int(match.group(3))
            pages = match.group(4).strip()
            return year, volume, issue, pages

        return None

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
        paper_list = page.locator("li.noselectrow")
        count = paper_list.count()

        print(f"正在提取论文信息 (共 {count} 条记录)...", file=sys.stderr)

        skip_count = 0

        for i in range(count):
            try:
                row = paper_list.nth(i)

                # 获取标题
                title_elem = row.locator(".j-title-1 a")
                title = ""
                abstract_url = ""

                if title_elem.count() > 0:
                    title = title_elem.inner_text().strip()
                    abstract_url = title_elem.get_attribute("href") or ""

                # 检查是否需要跳过
                if self._should_skip_title(title):
                    skip_count += 1
                    continue

                # 获取作者
                author_elem = row.locator(".j-author")
                author = ""
                if author_elem.count() > 0:
                    author = author_elem.inner_text().strip()

                # 获取卷期和页码
                vol_elem = row.locator(".j-volumn")
                pages = ""
                parsed_year = self.year
                parsed_volume = self.volume
                parsed_issue = issue

                if vol_elem.count() > 0:
                    vol_text = vol_elem.inner_text().strip()
                    result = self._parse_volume_issue(vol_text)
                    if result:
                        parsed_year, parsed_volume, parsed_issue, pages = result
                    else:
                        # 如果解析失败，尝试单独提取页码
                        page_match = re.search(r'([\d\-\s]+)\.', vol_text)
                        if page_match:
                            pages = page_match.group(1).strip()

                # 获取 DOI
                doi_elem = row.locator(".j-doi")
                doi = ""
                if doi_elem.count() > 0:
                    doi = doi_elem.inner_text().strip()
                    # 或者从 href 获取
                    doi_href = doi_elem.get_attribute("href") or ""
                    if doi_href and not doi:
                        doi = doi_href

                # 获取摘要（直接在列表页）
                abstract_elem = row.locator(".j-abstract")
                abstract = ""
                if abstract_elem.count() > 0:
                    abstract = abstract_elem.inner_text().strip()
                    # 清理摘要中的换行符和多余空白，避免 JSON 解析问题
                    abstract = ' '.join(abstract.split())

                paper = {
                    "year": parsed_year,
                    "volume": parsed_volume,
                    "issue": parsed_issue,
                    "title": title,
                    "author": author,
                    "pages": pages,
                    "abstract_url": abstract_url,
                    "doi": doi,
                    "abstract": abstract
                }

                papers.append(paper)

            except Exception as e:
                print(f"提取第 {i+1} 条记录时出错: {e}", file=sys.stderr)
                continue

        print(f"已提取 {len(papers)} 篇论文 (跳过 {skip_count} 条非论文记录)", file=sys.stderr)
        return papers

    def crawl_single_issue(self, issue: int) -> list:
        """
        爬取单期论文（带重试机制）

        Args:
            issue: 期号

        Returns:
            论文列表
        """
        url = self.build_url(self.year, self.volume, issue)
        last_error = None

        for attempt in range(self.max_retries):
            try:
                return self._crawl_with_retry(url, issue)
            except Exception as e:
                last_error = e
                if attempt < self.max_retries - 1:
                    print(f"第 {attempt + 1} 次尝试失败: {e}，3秒后重试...", file=sys.stderr)
                    import time
                    time.sleep(3)
                else:
                    print(f"所有 {self.max_retries} 次尝试均失败", file=sys.stderr)

        raise last_error

    def _crawl_with_retry(self, url: str, issue: int) -> list:
        """
        执行爬取（带元素等待）

        Args:
            url: 期刊页面 URL
            issue: 期号

        Returns:
            论文列表
        """
        print(f"正在访问: {url} (超时: {self.timeout}ms)", file=sys.stderr)

        with Camoufox(headless=self.headless) as browser:
            page = browser.new_page()

            try:
                # 访问期刊页面 - 先等待 domcontentloaded
                page.goto(url, timeout=self.timeout, wait_until="domcontentloaded")

                # 等待文章列表元素出现（核心元素）
                page.wait_for_selector("li.noselectrow", timeout=self.timeout)

                # 提取论文列表
                papers = self._extract_papers(page, issue)

                self.results = papers
                return papers

            except Exception as e:
                print(f"爬取过程中发生错误: {e}", file=sys.stderr)
                raise


def main():
    """主函数"""
    parser = argparse.ArgumentParser(
        description="图书情报知识 (lis.ac.cn) 期刊论文爬虫 - 使用 Camoufox",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 爬取 2025 年第 24 期论文列表
  python lis_spider.py -y 2025 -i 24

  # 爬取 2025 年第 1-3 期论文列表（范围格式）
  python lis_spider.py -y 2025 -i "1-3"

  # 保存到指定路径
  python lis_spider.py -y 2025 -i 24 -o outputs/图书情报知识/2025-24.json
        """
    )

    parser.add_argument(
        "-y", "--year",
        type=int,
        required=True,
        help=f"要爬取的年份 (不能超过当前年份: {LISSpider.MAX_YEAR})"
    )

    parser.add_argument(
        "-v", "--volume",
        type=int,
        default=None,
        help=f"卷号 (可选，会根据年份自动校验。对应关系: 2024年=68卷, 2025年=69卷, 2026年=70卷)"
    )

    parser.add_argument(
        "-i", "--issue",
        type=str,
        required=True,
        help="要爬取的期号，支持以下格式:\n"
             "  - 单期: 24\n"
             "  - 范围: 1-3 (表示 1,2,3 期)\n"
             "  - 离散: 1,5,7 (表示 1,5,7 期)\n"
             "  - 混合: 1-3,5,7-9\n"
             f"  (期刊为半月刊，期号范围: {LISSpider.MIN_ISSUE}-{LISSpider.MAX_ISSUE})"
    )

    parser.add_argument(
        "--no-headless",
        action="store_true",
        help="非无头模式运行，显示浏览器窗口"
    )

    parser.add_argument(
        "-t", "--timeout",
        type=int,
        default=180000,
        help="页面加载超时时间（毫秒），默认 180000 (3分钟)"
    )

    parser.add_argument(
        "-r", "--retries",
        type=int,
        default=3,
        help="最大重试次数，默认 3"
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
        issues = LISSpider.parse_issue_string(args.issue)
        print(f"解析期号: {args.issue} -> {issues}", file=sys.stderr)
    except ValueError as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)

    # 创建爬虫
    try:
        spider = LISSpider(
            year=args.year,
            issues=issues,
            volume=args.volume,
            headless=not args.no_headless,
            timeout=args.timeout,
            max_retries=args.retries
        )
        print(f"卷号: {spider.volume} (年份 {args.year}), 超时: {args.timeout}ms, 重试: {args.retries}次", file=sys.stderr)
    except ValueError as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)

    # 确保输出目录存在
    output_path = Path(args.output)
    if args.output != '-':
        output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        # 只爬取第一期（单期模式）
        papers = spider.crawl_single_issue(issues[0])

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
