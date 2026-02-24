#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CNKI 期刊导航爬虫
使用 Camoufox 实现的中国知网期刊论文爬取工具

功能：
1. 爬取指定期刊的某一期论文列表
2. 可选择是否获取论文摘要等详细信息
3. 支持命令行参数配置
"""

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Optional, List, Union
from urllib.parse import urlparse

from camoufox.sync_api import Camoufox

from paper_detail import PaperDetailSpider
from paper_filter import create_default_filter


class CNKISpider:
    """CNKI 期刊爬虫类"""

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
                    if not CNKISpider.MIN_ISSUE <= issue <= CNKISpider.MAX_ISSUE:
                        raise ValueError(f"期号 {issue} 超出有效范围 ({CNKISpider.MIN_ISSUE}-{CNKISpider.MAX_ISSUE})")
                    issues.add(issue)
            else:
                # 单个期号
                issue = int(part)
                if not CNKISpider.MIN_ISSUE <= issue <= CNKISpider.MAX_ISSUE:
                    raise ValueError(f"期号 {issue} 超出有效范围 ({CNKISpider.MIN_ISSUE}-{CNKISpider.MAX_ISSUE})")
                issues.add(issue)

        return sorted(list(issues))

    def __init__(self, url: str, year: int, issues: Union[int, str, List[int]],
                 journal_name: Optional[str] = None,
                 get_details: bool = False, headless: bool = True, timeout: int = 30000):
        """
        初始化爬虫

        Args:
            url: 期刊导航页 URL
            year: 年份
            issues: 期号，支持以下格式:
                - 整数: 3 (单期)
                - 字符串: "3", "1-3", "1,5,7", "1-3,5,7-9"
                - 列表: [3], [1, 2, 3], [1, 5, 7]
            journal_name: 期刊名称（可选，用于检索页面搜索）
            get_details: 是否获取论文摘要详情
            headless: 是否无头模式运行
            timeout: 超时时间（毫秒）
        """
        self.url = url
        self.year = year
        self.journal_name = journal_name
        self.get_details = get_details
        self.headless = headless
        self.timeout = timeout
        self.results = []

        # 初始化论文过滤器
        self.paper_filter = create_default_filter()

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

        # 验证 URL
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            raise ValueError(f"无效的 URL: {url}")

    def _goto_journal_page(self, page, url: str):
        """直接导航到期刊页面"""
        print(f"正在导航到期刊页面: {url}", file=sys.stderr)
        page.goto(url, timeout=30000, wait_until="domcontentloaded")
        time.sleep(2)
        print("已到达期刊页面", file=sys.stderr)

    def _should_skip_title(self, title: str) -> bool:
        """
        判断是否应该跳过该标题（使用统一的论文过滤器）

        Args:
            title: 论文标题

        Returns:
            True 表示跳过，False 表示保留
        """
        return self.paper_filter.should_skip(title)

    def crawl(self, issue: Optional[int] = None) -> list:
        """
        爬取单期论文

        Args:
            issue: 期号，如果为 None 则使用第一期

        Returns:
            论文列表
        """
        target_issue = issue if issue is not None else self.issues[0]
        url = self.url

        with Camoufox(headless=self.headless) as browser:
            page = browser.new_page()

            try:
                # 1. 访问 CNKI 首页
                print("正在访问 CNKI 首页...", file=sys.stderr)
                page.goto("https://www.cnki.net", timeout=30000, wait_until="domcontentloaded")
                time.sleep(1)
                print("首页加载完成", file=sys.stderr)

                # 2. 点击"出版物检索"链接
                print("正在点击'出版物检索'链接...", file=sys.stderr)
                navi_link = page.locator("#naviSearch")
                if navi_link.count() > 0:
                    # 先获取链接的 href 属性，直接导航而不是点击
                    href = navi_link.first.get_attribute("href")
                    print(f"出版物检索链接: {href}", file=sys.stderr)
                    if href:
                        page.goto(href, timeout=30000, wait_until="domcontentloaded")
                    else:
                        navi_link.first.click()
                    time.sleep(3)
                    print(f"当前页面 URL: {page.url}", file=sys.stderr)
                    print("已进入出版物检索页面，等待会话建立...", file=sys.stderr)
                    # 在检索页面停留一段时间，建立会话
                    time.sleep(5)
                else:
                    print("未找到'出版物检索'链接，直接导航到检索页面", file=sys.stderr)
                    page.goto("https://navi.cnki.net/knavi/", timeout=30000, wait_until="domcontentloaded")
                    time.sleep(5)

                # 3. 如果提供了期刊名称，通过搜索进入期刊页面
                if self.journal_name:
                    print(f"正在搜索期刊: {self.journal_name}", file=sys.stderr)

                    # 等待搜索输入框出现
                    try:
                        page.wait_for_selector("#txt_1_value1", timeout=10000)
                        print("找到搜索输入框", file=sys.stderr)
                    except Exception as e:
                        print(f"等待搜索输入框超时: {e}", file=sys.stderr)
                        print("当前页面 URL:", page.url, file=sys.stderr)
                        self._goto_journal_page(page, url)

                    # 输入期刊名称
                    search_input = page.locator("#txt_1_value1")
                    if search_input.count() > 0:
                        search_input.first.fill(self.journal_name)
                        time.sleep(0.5)
                        # 点击搜索按钮
                        search_btn = page.locator("#btnSearch")
                        if search_btn.count() > 0:
                            print("点击搜索按钮", file=sys.stderr)
                            search_btn.first.click()
                            time.sleep(3)
                            # 点击第一个搜索结果
                            result_link = page.locator(".re_brief h1 a")
                            if result_link.count() > 0:
                                print("找到搜索结果，点击进入", file=sys.stderr)
                                # 获取链接的 href，直接导航而不是点击
                                result_href = result_link.first.get_attribute("href")
                                if result_href:
                                    page.goto(result_href, timeout=30000, wait_until="domcontentloaded")
                                else:
                                    result_link.first.click()
                                    # 等待页面跳转
                                    try:
                                        page.wait_for_load_state("networkidle", timeout=10000)
                                    except:
                                        pass
                                time.sleep(3)
                                print("已进入期刊页面", file=sys.stderr)
                            else:
                                print("未找到搜索结果，使用直接导航", file=sys.stderr)
                                self._goto_journal_page(page, url)
                        else:
                            print("未找到搜索按钮，使用直接导航", file=sys.stderr)
                            self._goto_journal_page(page, url)
                    else:
                        print("未找到搜索输入框，使用直接导航", file=sys.stderr)
                        self._goto_journal_page(page, url)
                else:
                    # 直接导航到目标期刊页面
                    self._goto_journal_page(page, url)

                # 调试：打印页面内容
                time.sleep(3)
                body_text = page.inner_text("body")[:2000]
                print(f"页面内容预览: {body_text}", file=sys.stderr)

                # 2. 展开年份列表
                self._expand_year(page)

                # 3. 选择期号
                self._select_issue(page, target_issue)

                # 4. 等待论文列表加载
                self._wait_for_papers(page)

                # 5. 爬取论文列表
                papers = self._extract_papers(page, target_issue)

                # 6. 如果需要获取详情
                if self.get_details and papers:
                    papers = self._get_paper_details(page, papers)

                self.results = papers
                return papers

            except Exception as e:
                print(f"爬取过程中发生错误: {e}", file=sys.stderr)
                raise

    def _expand_year(self, page):
        """展开指定年份的列表"""
        year_str = str(self.year)

        try:
            # 方法1: 直接点击年份元素
            year_dt = page.locator(f"dt:has-text('{year_str}')")
            if year_dt.count() > 0:
                year_dt.first.click()
                time.sleep(0.5)
                print(f"已点击年份: {year_str}", file=sys.stderr)
                return

            # 方法2: 查找包含年份的 dt 元素
            all_dts = page.locator("dt")
            for i in range(all_dts.count()):
                dt = all_dts.nth(i)
                dt_text = dt.inner_text()
                if year_str in dt_text:
                    dt.click()
                    time.sleep(0.5)
                    print(f"已点击年份: {year_str}", file=sys.stderr)
                    return

            # 方法3: 查找年份对应的 dl 元素并展开
            year_dl = page.locator(f"dl[id*='{year_str}']")
            if year_dl.count() > 0:
                dt = year_dl.locator("dt")
                if dt.count() > 0:
                    dt.click()
                    time.sleep(0.5)
                    print(f"已点击年份: {year_str}", file=sys.stderr)
                    return

            print(f"警告: 未找到年份 {year_str}，将尝试使用当前展开的期号", file=sys.stderr)

        except Exception as e:
            print(f"展开年份列表时出错: {e}", file=sys.stderr)

    def _select_issue(self, page, issue: int):
        """选择指定期号"""
        issue_id = f"yq{self.year}{issue:02d}"
        print(f"正在选择期号: {self.year}年第{issue}期 (ID: {issue_id})", file=sys.stderr)

        try:
            # 尝试通过 ID 选择
            issue_link = page.locator(f"#{issue_id}")
            if issue_link.count() > 0:
                issue_link.first.click()
                time.sleep(1)
                print(f"已选择期号: {self.year}年第{issue}期", file=sys.stderr)
                return

            # 尝试通过文本选择 (No.XX 格式)
            issue_no = f"No.{issue}"
            all_issues = page.locator("a[id^='yq']")
            for i in range(all_issues.count()):
                link = all_issues.nth(i)
                link_text = link.inner_text()
                if issue_no in link_text:
                    link.click()
                    time.sleep(1)
                    print(f"已选择期号: {self.year}年第{issue}期", file=sys.stderr)
                    return

            # 尝试模糊匹配
            all_issues = page.locator("a[id^='yq']")
            for i in range(all_issues.count()):
                link = all_issues.nth(i)
                link_id = link.get_attribute("id") or ""
                if f"{self.year}" in link_id:
                    link_text = link.inner_text()
                    if f"{issue:02d}" in link_id or f"No.{issue}" in link_text:
                        link.click()
                        time.sleep(1)
                        print(f"已选择期号: {self.year}年第{issue}期", file=sys.stderr)
                        return

            print(f"警告: 未找到期号 {self.year}年第{issue}期，将使用当前显示的期号", file=sys.stderr)

        except Exception as e:
            print(f"选择期号时出错: {e}", file=sys.stderr)

    def _wait_for_papers(self, page, max_wait: int = 10):
        """等待论文列表加载"""
        print("正在加载论文列表...", file=sys.stderr)
        try:
            # 使用 wait_for_selector 等待论文行元素出现
            page.wait_for_selector("dd.row", timeout=max_wait * 1000)
            count = page.locator("dd.row").count()
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
        paper_rows = page.locator("dd.row")
        count = paper_rows.count()

        print(f"正在提取论文信息 (共 {count} 篇)...", file=sys.stderr)
        skip_count = 0

        for i in range(count):
            try:
                row = paper_rows.nth(i)

                # 获取标题链接
                title_link = row.locator("span.name a")
                title = ""
                abstract_url = ""

                if title_link.count() > 0:
                    title = title_link.inner_text().strip()
                    abstract_url = title_link.get_attribute("href") or ""

                # 检查是否需要跳过
                if self._should_skip_title(title):
                    skip_count += 1
                    continue

                # 获取作者
                author_span = row.locator("span.author")
                author = ""
                if author_span.count() > 0:
                    author = author_span.inner_text().strip()

                # 获取页码
                company_span = row.locator("span.company")
                pages = ""
                if company_span.count() > 0:
                    pages = company_span.inner_text().strip()

                paper = {
                    "year": self.year,
                    "issue": issue,
                    "title": title,
                    "author": author,
                    "pages": pages,
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
        """获取论文摘要详情 - 在当前页面点击链接获取"""
        total = len(papers)
        print(f"\n正在获取 {total} 篇论文的详细信息...", file=sys.stderr)

        success_count = 0
        fail_count = 0
        skip_count = 0

        # 保存当前页面 URL，以便返回
        journal_page_url = page.url

        for i, paper in enumerate(papers):
            if not paper.get("abstract_url"):
                print(f"  [{i+1}/{total}] 跳过: 无摘要链接", file=sys.stderr)
                skip_count += 1
                continue

            try:
                title_short = paper['title'][:40] + "..." if len(paper['title']) > 40 else paper['title']
                print(f"  [{i+1}/{total}] 获取: {title_short}", end=" ", file=sys.stderr)

                # 在当前页面导航到摘要页
                page.goto(paper["abstract_url"], timeout=self.timeout, wait_until="domcontentloaded")
                time.sleep(1)

                # 获取摘要信息
                abstract = ""
                keywords = ""
                doi = ""

                try:
                    # 尝试多种选择器获取摘要
                    abstract_selectors = [
                        "#ChDivSummary",
                        ".abstract-text",
                        "div[class*='abstract']",
                        "#abstract"
                    ]

                    for selector in abstract_selectors:
                        elem = page.locator(selector)
                        if elem.count() > 0:
                            text = elem.inner_text().strip()
                            if text and len(text) > 10:
                                abstract = text
                                break

                    # 获取关键词
                    keyword_selectors = [
                        "#ChDivKeywords",
                        ".keywords",
                        "div[class*='keyword']"
                    ]

                    for selector in keyword_selectors:
                        elem = page.locator(selector)
                        if elem.count() > 0:
                            text = elem.inner_text().strip()
                            if text:
                                keywords = text
                                break

                    # 获取 DOI
                    doi_selectors = [
                        "span[class*='doi']",
                        "div[class*='doi']",
                        "#DOI"
                    ]

                    for selector in doi_selectors:
                        elem = page.locator(selector)
                        if elem.count() > 0:
                            text = elem.inner_text().strip()
                            if "doi" in text.lower():
                                doi = text
                                break

                except Exception as e:
                    print(f"提取详情时出错: {e}", file=sys.stderr)

                if abstract:
                    paper["abstract"] = abstract
                    paper["keywords"] = keywords
                    paper["doi"] = doi
                    print("成功", file=sys.stderr)
                    success_count += 1
                else:
                    paper["abstract"] = "未找到摘要"
                    print("失败", file=sys.stderr)
                    fail_count += 1

                # 返回期刊页面
                page.goto(journal_page_url, timeout=30000, wait_until="domcontentloaded")
                time.sleep(1)

            except Exception as e:
                print(f"错误: {e}", file=sys.stderr)
                paper["abstract"] = f"获取失败: {str(e)}"
                fail_count += 1
                # 尝试返回期刊页面
                try:
                    page.goto(journal_page_url, timeout=30000, wait_until="domcontentloaded")
                    time.sleep(1)
                except:
                    pass

        print(f"\n摘要获取完成: 成功 {success_count} 篇，失败 {fail_count} 篇，跳过 {skip_count} 篇", file=sys.stderr)
        return papers


def main():
    """主函数"""
    parser = argparse.ArgumentParser(
        description="CNKI 期刊论文爬虫 - 使用 Camoufox",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 爬取 2025 年第 6 期论文列表
  python cnki_spider.py -u "https://navi.cnki.net/knavi/journals/ZGTS/detail" -y 2025 -i 6

  # 爬取 2025 年第 1-3 期论文列表（范围格式）
  python cnki_spider.py -u "https://navi.cnki.net/knavi/journals/ZGTS/detail" -y 2025 -i "1-3"

  # 爬取并获取论文摘要
  python cnki_spider.py -u "https://navi.cnki.net/knavi/journals/ZGTS/detail" -y 2025 -i 6 -d

  # 输出到 stdout
  python cnki_spider.py -u "https://navi.cnki.net/knavi/journals/ZGTS/detail" -y 2025 -i 6 -o -

  # 非无头模式运行（显示浏览器）
  python cnki_spider.py -u "https://navi.cnki.net/knavi/journals/ZGTS/detail" -y 2025 -i 6 --no-headless
        """
    )

    parser.add_argument(
        "-u", "--url",
        required=True,
        help="期刊导航页 URL (如: https://navi.cnki.net/knavi/journals/ZGTS/detail)"
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
        "-n", "--name",
        type=str,
        default=None,
        help="期刊名称（可选，用于通过检索页面搜索进入期刊）"
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
        issues = CNKISpider.parse_issue_string(args.issue)
        print(f"解析期号: {args.issue} -> {issues}", file=sys.stderr)
    except ValueError as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)

    # 创建爬虫
    spider = CNKISpider(
        url=args.url,
        year=args.year,
        issues=issues,
        journal_name=args.name,
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
