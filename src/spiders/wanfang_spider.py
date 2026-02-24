#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
万方数据期刊爬虫
使用 Playwright 实现的万方期刊论文爬取工具

功能：
1. 爬取指定期刊代码的某一期论文列表
2. 自动获取论文摘要等详细信息
3. 支持命令行参数配置

网址格式：
https://c.wanfangdata.com.cn/magazine/{code}?publishYear={year}&issueNum={issue}&page=1&isSync=0
- code: 期刊代码 (如 zgtsgxb)
- publishYear: 年份
- issueNum: 期号
"""

import argparse
import json
import sys
import time
import re
from pathlib import Path
from typing import Optional, List, Union

from playwright.sync_api import sync_playwright, Page, TimeoutError as PlaywrightTimeout
from paper_filter import create_default_filter


class WanfangSpider:
    """万方数据期刊爬虫类"""

    BASE_URL = "https://c.wanfangdata.com.cn/magazine"
    LIST_WAIT_SELECTOR = ".magazine-paper-box"
    DETAIL_WAIT_SELECTOR = ".summary.list, .detailTitle"

    # 期号范围（默认支持半月刊）
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
                    if not WanfangSpider.MIN_ISSUE <= issue <= WanfangSpider.MAX_ISSUE:
                        raise ValueError(f"期号 {issue} 超出有效范围 ({WanfangSpider.MIN_ISSUE}-{WanfangSpider.MAX_ISSUE})")
                    issues.add(issue)
            else:
                # 单个期号
                issue = int(part)
                if not WanfangSpider.MIN_ISSUE <= issue <= WanfangSpider.MAX_ISSUE:
                    raise ValueError(f"期号 {issue} 超出有效范围 ({WanfangSpider.MIN_ISSUE}-{WanfangSpider.MAX_ISSUE})")
                issues.add(issue)

        return sorted(list(issues))

    def __init__(self, journal_code: str, year: int, issues: Union[int, str, List[int]], 
                 get_details: bool = True, headless: bool = True, timeout: int = 30000):
        """
        初始化爬虫

        Args:
            journal_code: 期刊代码 (如 "zgtsgxb")
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
        
        # 初始化论文过滤器
        self.paper_filter = create_default_filter()
        
        # Playwright 对象
        self.playwright = None
        self.browser = None
        self.context = None

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

    def _build_url(self, issue: int, page: int = 1) -> str:
        """构建指定期号和页码的 URL"""
        return f"{self.BASE_URL}/{self.journal_code}?publishYear={self.year}&issueNum={issue}&page={page}&isSync=0"

    def _should_skip_title(self, title: str) -> bool:
        """
        判断是否应该跳过该标题（使用统一的论文过滤器）

        Args:
            title: 论文标题

        Returns:
            True 表示跳过，False 表示保留
        """
        return self.paper_filter.should_skip(title)

    def _start_browser(self):
        """启动浏览器"""
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=self.headless)
        self.context = self.browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 720}
        )

    def _stop_browser(self):
        """关闭浏览器"""
        if self.context:
            self.context.close()
        if self.browser:
            self.browser.close()
        if self.playwright:
            self.playwright.stop()

    def crawl(self, issue: Optional[int] = None) -> list:
        """
        爬取单期论文

        Args:
            issue: 期号，如果为 None 则使用第一期

        Returns:
            论文列表
        """
        target_issue = issue if issue is not None else self.issues[0]
        url = self._build_url(target_issue, page=1)

        self._start_browser()
        page = self.context.new_page()

        try:
            # 1. 访问期刊页面
            print(f"正在访问: {url}", file=sys.stderr)
            if not self._safe_goto(page, url, wait_selector=self.LIST_WAIT_SELECTOR, retries=1):
                raise RuntimeError("期刊页面加载失败")
            time.sleep(1)

            # 2. 等待论文列表加载
            self._wait_for_papers(page)

            # 3. 爬取论文列表（可能有多页）
            papers = self._extract_papers(page, target_issue)

            # 4. 如果需要获取详情
            if self.get_details and papers:
                papers = self._get_paper_details(page, papers)

            self.results = papers
            return papers

        except Exception as e:
            print(f"爬取过程中发生错误: {e}", file=sys.stderr)
            raise
        finally:
            self._stop_browser()

    def _wait_for_papers(self, page, max_wait: int = 10):
        """等待论文列表加载"""
        print("正在加载论文列表...", file=sys.stderr)
        try:
            page.wait_for_selector(".magazine-paper-box", timeout=max_wait * 1000)
            count = len(page.query_selector_all(".periodical-list-item"))
            print(f"已找到 {count} 篇论文", file=sys.stderr)
        except Exception as e:
            print(f"等待论文列表时出错: {e}", file=sys.stderr)

    def _extract_papers(self, page, issue: int) -> list:
        """
        提取论文列表（支持多页）

        Args:
            page: Playwright 页面对象
            issue: 期号

        Returns:
            论文列表
        """
        papers = []
        current_page = 1
        max_pages = 10  # 最多爬取10页
        article_index = 1  # 文章序号，用于构建详情页 URL

        while current_page <= max_pages:
            print(f"正在提取第 {current_page} 页论文信息...", file=sys.stderr)

            # 等待当前页加载
            try:
                page.wait_for_selector(".magazine-paper-box", timeout=5000)
            except:
                print(f"第 {current_page} 页没有找到文章", file=sys.stderr)
                break

            # 使用 JavaScript 提取当前页所有文章信息
            articles_on_page = self._extract_article_links(page)
            
            if not articles_on_page:
                print(f"第 {current_page} 页没有找到文章", file=sys.stderr)
                break

            skip_count = 0

            for article_info in articles_on_page:
                title = article_info.get("title", "")
                
                # 检查是否需要跳过
                if self._should_skip_title(title):
                    skip_count += 1
                    continue

                # 使用从页面提取的详情链接，如果没有则构建
                detail_url = article_info.get("detailUrl", "")
                if not detail_url:
                    detail_url = f"https://d.wanfangdata.com.cn/periodical/{self.journal_code}{self.year}{issue:02d}{article_index:03d}"

                paper = {
                    "year": self.year,
                    "issue": issue,
                    "title": title,
                    "url": detail_url,
                    "author": article_info.get("author", ""),
                    "pages": article_info.get("pageRange", ""),
                    "abstract": "",
                    "publish_date": ""
                }

                papers.append(paper)
                article_index += 1

            print(f"第 {current_page} 页提取了 {len(articles_on_page) - skip_count} 篇论文 (跳过 {skip_count} 条非论文记录)", file=sys.stderr)

            # 检查是否有下一页
            next_btn = page.query_selector(".next")
            if next_btn and next_btn.is_visible():
                current_page += 1
                # 构建下一页URL并导航
                next_url = self._build_url(issue, current_page)
                print(f"继续下一页: {next_url}", file=sys.stderr)
                if not self._safe_goto(page, next_url, wait_selector=self.LIST_WAIT_SELECTOR):
                    print("分页加载失败，提前结束", file=sys.stderr)
                    break
                time.sleep(1)
            else:
                print("已到达最后一页", file=sys.stderr)
                break

        print(f"总共提取了 {len(papers)} 篇论文", file=sys.stderr)
        return papers

    def _extract_article_links(self, page: Page) -> list:
        """使用 JavaScript 从页面提取所有文章的详情链接"""
        js_code = """
        () => {
            const articles = [];
            const boxes = document.querySelectorAll('.magazine-paper-box');
            
            boxes.forEach(box => {
                const columnElem = box.querySelector('.magazine-paper-column span');
                const column = columnElem ? columnElem.innerText.trim() : '';
                
                const items = box.querySelectorAll('.periodical-list-item');
                items.forEach(item => {
                    const titleElem = item.querySelector('.title .periotitle');
                    const title = titleElem ? titleElem.innerText.trim() : '';
                    
                    const authorElem = item.querySelector('.author span');
                    const author = authorElem ? authorElem.innerText.trim() : '';
                    
                    const pageElem = item.querySelector('.page');
                    const pageRange = pageElem ? pageElem.innerText.trim() : '';
                    
                    // 获取详情链接 - 尝试多种方式
                    let detailUrl = '';
                    
                    // 方式1: 从标题的父元素 a 标签获取
                    const titleLink = item.querySelector('.title a');
                    if (titleLink && titleLink.href) {
                        detailUrl = titleLink.href;
                    }
                    
                    // 方式2: 从 periotitle 的 onclick 属性解析
                    if (!detailUrl && titleElem) {
                        const onclick = titleElem.getAttribute('onclick');
                        if (onclick) {
                            const match = onclick.match(/['"]([^'"]+)['"]/);
                            if (match) {
                                detailUrl = match[1];
                            }
                        }
                    }
                    
                    // 方式3: 从 data-url 或 data-href 属性获取
                    if (!detailUrl) {
                        const dataUrl = item.getAttribute('data-url') || item.getAttribute('data-href');
                        if (dataUrl) {
                            detailUrl = dataUrl;
                        }
                    }
                    
                    if (title) {
                        articles.push({
                            title,
                            author,
                            pageRange,
                            column,
                            detailUrl
                        });
                    }
                });
            });
            
            return articles;
        }
        """
        return page.evaluate(js_code)

    def _get_paper_details(self, page, papers: list) -> list:
        """获取论文摘要详情"""
        total = len(papers)
        print(f"\n正在获取 {total} 篇论文的详细信息...", file=sys.stderr)

        success_count = 0
        fail_count = 0
        skip_count = 0
        max_detail_retries = 2

        for i, paper in enumerate(papers):
            if not paper.get("url"):
                print(f"  [{i+1}/{total}] 跳过: 无详情链接", file=sys.stderr)
                skip_count += 1
                continue

            try:
                title_short = paper['title'][:40] + "..." if len(paper['title']) > 40 else paper['title']
                print(f"  [{i+1}/{total}] 获取: {title_short}", end=" ", file=sys.stderr)

                success = False
                last_error = ""

                for attempt in range(max_detail_retries + 1):
                    detail_page = self.context.new_page()
                    try:
                        # 访问详情页并等待主要内容
                        nav_ok = self._safe_goto(
                            detail_page,
                            paper["url"],
                            wait_selector=self.DETAIL_WAIT_SELECTOR,
                            wait_timeout=12000
                        )
                        if not nav_ok:
                            raise RuntimeError("页面未及时就绪")

                        # 提取详情
                        detail = self._extract_detail(detail_page)

                        if detail.get("abstract"):
                            paper["abstract"] = detail.get("abstract", "")
                            paper["publish_date"] = detail.get("publish_date", "")
                            print("成功", file=sys.stderr)
                            success_count += 1
                            success = True
                            break

                        last_error = "未找到摘要"
                    except Exception as e:
                        last_error = str(e)
                    finally:
                        detail_page.close()

                    if attempt < max_detail_retries:
                        print("重试...", file=sys.stderr)
                        time.sleep(1)

                if success:
                    time.sleep(0.5)
                    continue

                paper["abstract"] = f"获取失败: {last_error or '未找到摘要'}"
                print(f"失败 ({paper['abstract']})", file=sys.stderr)
                fail_count += 1

                time.sleep(0.5)  # 短暂等待，避免请求过快

            except Exception as e:
                print(f"错误: {e}", file=sys.stderr)
                paper["abstract"] = f"获取失败: {str(e)}"
                fail_count += 1

        print(f"\n摘要获取完成: 成功 {success_count} 篇，失败 {fail_count} 篇，跳过 {skip_count} 篇", file=sys.stderr)
        return papers

    def _extract_detail(self, page: Page) -> dict:
        """
        从详情页提取元数据
        """
        detail = {
            "abstract": "",
            "publish_date": ""
        }

        try:
            # 摘要 - 尝试多种选择器
            abstract_selectors = [
                '.summary.list .text-overflow span span',
                '.summary.list .text-overflow',
                '.summary.list',
                'div.abstract',
                'div.summary',
            ]
            
            for selector in abstract_selectors:
                elem = page.query_selector(selector)
                if elem:
                    text = elem.inner_text().strip()
                    if text:
                        # 清理 "摘要：" 标签
                        if text.startswith("摘要：") or text.startswith("摘要:"):
                            text = text[3:].strip()
                        detail["abstract"] = text
                        break
            
            # 发表日期
            date_selectors = [
                '.publish.list .itemUrl',
                '.publish.list',
                '.publish-date',
            ]
            
            for selector in date_selectors:
                elem = page.query_selector(selector)
                if elem:
                    text = elem.inner_text().strip()
                    if text:
                        detail["publish_date"] = text
                        break

        except Exception as e:
            print(f"    解析详情页失败: {e}", file=sys.stderr)

        return detail

    def _safe_goto(self, page: Page, url: str, wait_selector: Optional[str] = None,
                   wait_timeout: int = 10000, retries: int = 1) -> bool:
        """
        更稳健的页面导航逻辑，避免长尾请求导致的 networkidle 阻塞
        """
        last_error = None
        for attempt in range(retries + 1):
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=self.timeout)
                if wait_selector:
                    try:
                        page.wait_for_selector(wait_selector, timeout=wait_timeout)
                    except PlaywrightTimeout:
                        pass
                return True
            except PlaywrightTimeout as e:
                last_error = e
            except Exception as e:
                last_error = e

            if attempt < retries:
                time.sleep(1)

        if last_error:
            print(f"页面加载失败: {url} ({last_error})", file=sys.stderr)
        return False


def main():
    """主函数"""
    parser = argparse.ArgumentParser(
        description="万方数据期刊论文爬虫 - 使用 Playwright",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 爬取中国图书馆学报 (zgtsgxb) 2025 年第 2 期论文列表
  python wanfang_spider.py -j zgtsgxb -y 2025 -i 2

  # 爬取中国图书馆学报 2025 年第 1-3 期论文列表（范围格式）
  python wanfang_spider.py -j zgtsgxb -y 2025 -i "1-3"

  # 爬取并获取论文摘要（默认行为）
  python wanfang_spider.py -j zgtsgxb -y 2025 -i 2 -o -

  # 不获取摘要
  python wanfang_spider.py -j zgtsgxb -y 2025 -i 2 --no-details -o -

  # 非无头模式运行（显示浏览器）
  python wanfang_spider.py -j zgtsgxb -y 2025 -i 2 --no-headless
        """
    )

    parser.add_argument(
        "-j", "--journal-code",
        required=True,
        help="期刊代码 (如: zgtsgxb)"
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
             "  - 单期: 2\n"
             "  - 范围: 1-3 (表示 1,2,3 期)\n"
             "  - 离散: 1,5,7 (表示 1,5,7 期)\n"
             "  - 混合: 1-3,5,7-9"
    )

    parser.add_argument(
        "-d", "--details",
        action="store_true",
        default=True,
        help="获取论文摘要等详细信息 (默认: 获取)"
    )

    parser.add_argument(
        "--no-details",
        action="store_true",
        help="不获取论文摘要等详细信息"
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
        issues = WanfangSpider.parse_issue_string(args.issue)
        print(f"解析期号: {args.issue} -> {issues}", file=sys.stderr)
    except ValueError as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)

    # 创建爬虫
    spider = WanfangSpider(
        journal_code=args.journal_code,
        year=args.year,
        issues=issues,
        get_details=args.details and not args.no_details,
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
