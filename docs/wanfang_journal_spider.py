#!/usr/bin/env python3
"""
万方期刊文章爬虫 - 使用 Playwright
爬取期刊杂志页面的文章列表及详情页元数据
"""

import json
import time
import re
from playwright.sync_api import sync_playwright, Page, TimeoutError as PlaywrightTimeout


class WanfangJournalSpider:
    """万方期刊爬虫"""
    
    def __init__(self, headless: bool = False):
        self.headless = headless
        self.playwright = None
        self.browser = None
        self.context = None
        self.articles = []
        
    def __enter__(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=self.headless)
        self.context = self.browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 720}
        )
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.context:
            self.context.close()
        if self.browser:
            self.browser.close()
        if self.playwright:
            self.playwright.stop()
            
    def get_issue_articles(self, page: Page, publish_year: str, issue_num: str, max_pages: int = 5) -> list:
        """获取期刊某一期的文章列表"""
        articles = []
        base_url = f"https://c.wanfangdata.com.cn/magazine/zgtsgxb"
        
        for page_num in range(1, max_pages + 1):
            url = f"{base_url}?publishYear={publish_year}&issueNum={issue_num}&page={page_num}&isSync=0"
            print(f"\n正在爬取第 {page_num} 页: {url}")
            
            try:
                page.goto(url, wait_until="networkidle", timeout=30000)
                time.sleep(3)
                
                page.wait_for_selector(".magazine-paper-box", timeout=10000)
                
                article_boxes = page.query_selector_all(".magazine-paper-box")
                
                if not article_boxes:
                    print(f"第 {page_num} 页没有找到文章")
                    break
                    
                for box in article_boxes:
                    column_elem = box.query_selector(".magazine-paper-column span")
                    column = column_elem.inner_text().strip() if column_elem else ""
                    
                    items = box.query_selector_all(".periodical-list-item")
                    
                    for item in items:
                        try:
                            title_elem = item.query_selector(".title .periotitle")
                            title = title_elem.inner_text().strip() if title_elem else ""
                            
                            author_elem = item.query_selector(".author span")
                            author = author_elem.inner_text().strip() if author_elem else ""
                            
                            page_elem = item.query_selector(".page")
                            page_range = page_elem.inner_text().strip() if page_elem else ""
                            
                            stats = {}
                            stat_elements = item.query_selector_all(".stat .stat-content .stat-item")
                            for stat in stat_elements:
                                text = stat.inner_text().strip()
                                if "文摘阅读" in text:
                                    match = re.search(r"(\d+)", text)
                                    if match:
                                        stats["reads"] = int(match.group(1))
                                elif "下载" in text:
                                    match = re.search(r"(\d+)", text)
                                    if match:
                                        stats["downloads"] = int(match.group(1))
                                elif "导出" in text:
                                    match = re.search(r"(\d+)", text)
                                    if match:
                                        stats["exports"] = int(match.group(1))
                                elif "被引" in text:
                                    match = re.search(r"(\d+)", text)
                                    if match:
                                        stats["citations"] = int(match.group(1))
                            
                            if title:
                                articles.append({
                                    "title": title,
                                    "author": author,
                                    "page_range": page_range,
                                    "column": column,
                                    "stats": stats
                                })
                                print(f"  [{column}] {title[:40]}...")
                                
                        except Exception as e:
                            print(f"  解析文章项失败: {e}")
                            continue
                            
                next_btn = page.query_selector(".next")
                if next_btn and next_btn.is_visible():
                    print("继续下一页...")
                    time.sleep(2)
                else:
                    print("已到达最后一页")
                    break
                    
            except PlaywrightTimeout:
                print(f"第 {page_num} 页加载超时")
                break
            except Exception as e:
                print(f"爬取第 {page_num} 页失败: {e}")
                break
                
        return articles
        
    def get_article_detail(self, page: Page) -> dict:
        """
        从当前页面（详情页）提取元数据
        只提取: title, detail_url, abstract, publish_date
        """
        detail = {
            "title": "",
            "detail_url": page.url,
            "abstract": "",
            "publish_date": ""
        }

        try:
            print(f"    当前URL: {page.url}")
            print(f"    等待详情页元素加载...")

            # 尝试等待详情页特有的元素，最多等待10秒
            try:
                page.wait_for_selector(".detailTitle, .summary.list", timeout=10000)
                print(f"    详情页元素已加载")
            except PlaywrightTimeout:
                print(f"    等待详情页元素超时，尝试继续解析...")

            # 检查关键class是否存在
            has_detail_title = page.query_selector(".detailTitle") is not None
            has_summary = page.query_selector(".summary.list") is not None

            print(f"    detailTitle: {has_detail_title}, summary: {has_summary}")
            
            if has_detail_title or has_summary:
                # 标题
                title_elem = page.query_selector(".detailTitle .detailTitleCN span")
                if title_elem:
                    detail["title"] = title_elem.inner_text().strip()
                    print(f"    题名: {detail['title'][:50]}...")
                
                # 摘要
                abstract_span = page.query_selector(".summary.list .text-overflow span span")
                if abstract_span:
                    detail["abstract"] = abstract_span.inner_text().strip()
                    print(f"    摘要: {detail['abstract'][:50]}...")
                    
                # 发表日期
                publish_elem = page.query_selector(".publish.list .itemUrl")
                if publish_elem:
                    detail["publish_date"] = publish_elem.inner_text().strip()
                    print(f"    发表日期: {detail['publish_date']}")
            else:
                print("    未检测到详情页元素")
                    
        except Exception as e:
            print(f"    解析详情页失败: {e}")
            
        return detail
        
    def extract_article_links(self, page: Page) -> list:
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
                            // 尝试从 onclick 中提取 URL
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
                    
                    // 统计信息
                    const stats = {};
                    const statElems = item.querySelectorAll('.stat .stat-content .stat-item');
                    statElems.forEach(stat => {
                        const text = stat.innerText.trim();
                        const match = text.match(/(\\d+)/);
                        if (match) {
                            if (text.includes('文摘阅读')) stats.reads = parseInt(match[1]);
                            else if (text.includes('下载')) stats.downloads = parseInt(match[1]);
                            else if (text.includes('导出')) stats.exports = parseInt(match[1]);
                            else if (text.includes('被引')) stats.citations = parseInt(match[1]);
                        }
                    });
                    
                    if (title) {
                        articles.push({
                            title,
                            author,
                            pageRange,
                            column,
                            stats,
                            detailUrl
                        });
                    }
                });
            });
            
            return articles;
        }
        """
        return page.evaluate(js_code)
        
    def scrape_issue_with_details(self, publish_year: str, issue_num: str, max_pages: int = 1) -> list:
        """爬取某一期期刊的所有文章（包括详情页）"""
        page = self.context.new_page()
        
        print(f"\n{'='*60}")
        print(f"开始爬取 {publish_year}年第{issue_num}期 (含详情页)")
        print(f"{'='*60}\n")
        
        url = f"https://c.wanfangdata.com.cn/magazine/zgtsgxb?publishYear={publish_year}&issueNum={issue_num}&page=1&isSync=0"
        page.goto(url, wait_until="networkidle", timeout=30000)
        time.sleep(3)
        
        detailed_articles = []
        current_page = 1
        
        while True:
            try:
                page.wait_for_selector(".magazine-paper-box", timeout=10000)
            except:
                print("页面加载失败")
                break
            
            # 使用 JavaScript 提取当前页所有文章信息
            articles_on_page = self.extract_article_links(page)
            
            if not articles_on_page:
                print("没有找到文章")
                break
            
            print(f"当前页找到 {len(articles_on_page)} 篇文章")
        
            # 处理每篇文章的详情页
            for idx, article_info in enumerate(articles_on_page):
                title = article_info["title"]
                print(f"\n[{article_info['column']}] {title[:40]}...")
                
                try:
                    detail = {}
                    
                    if article_info["detailUrl"]:
                        # 直接打开详情链接
                        detail_page = self.context.new_page()
                        try:
                            detail_page.goto(article_info["detailUrl"], wait_until="networkidle", timeout=30000)
                            # 等待详情页元素加载
                            try:
                                detail_page.wait_for_selector(".detailTitle, .summary.list", timeout=10000)
                                print(f"    详情页已加载: {detail_page.url}")
                                detail = self.get_article_detail(detail_page)
                            except PlaywrightTimeout:
                                print(f"    详情页元素加载超时")
                        except Exception as e:
                            print(f"    详情页访问失败: {e}")
                        finally:
                            detail_page.close()
                    else:
                        print(f"    未找到详情链接，尝试点击标题...")
                        # 备用方案：点击标题
                        try:
                            with page.expect_popup(timeout=10000) as popup_info:
                                # 重新获取标题元素并点击
                                title_selector = f".periodical-list-item:has-text('{title[:30]}') .title .periotitle"
                                page.click(title_selector)
                            
                            detail_page = popup_info.value
                            detail_page.wait_for_load_state("networkidle", timeout=15000)
                            print(f"    详情页已打开: {detail_page.url}")
                            detail = self.get_article_detail(detail_page)
                            detail_page.close()
                        except Exception as e:
                            print(f"    点击标题失败: {e}")
                    
                    # 合并数据 - 只保留4个字段
                    article_data = {
                        "title": title,
                        "detail_url": detail.get("detail_url", article_info["detailUrl"]),
                        "abstract": detail.get("abstract", ""),
                        "publish_date": detail.get("publish_date", "")
                    }
                    
                    detailed_articles.append(article_data)
                    time.sleep(1)  # 短暂等待，避免请求过快
                        
                except Exception as e:
                    print(f"  获取详情失败: {e}")
                    detailed_articles.append({
                        "title": title,
                        "detail_url": article_info["detailUrl"],
                        "abstract": "",
                        "publish_date": ""
                    })
            
                if len(detailed_articles) >= max_pages * 20:
                    break
                    
            if len(detailed_articles) >= max_pages * 20:
                break
                
            # 翻页
            next_btn = page.query_selector(".next")
            if next_btn and next_btn.is_visible():
                current_page += 1
                print(f"\n--- 继续第 {current_page} 页 ---")
                url = f"https://c.wanfangdata.com.cn/magazine/zgtsgxb?publishYear={publish_year}&issueNum={issue_num}&page={current_page}&isSync=0"
                page.goto(url, wait_until="networkidle", timeout=30000)
                time.sleep(3)
            else:
                break
        
        page.close()
        self.articles = detailed_articles
        return detailed_articles
        
    def save_to_json(self, filepath: str):
        """保存结果到JSON文件"""
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(self.articles, f, ensure_ascii=False, indent=2)
        print(f"\n已保存到 {filepath}")


def main():
    """主函数"""
    with WanfangJournalSpider(headless=False) as spider:
        # 爬取2025年第4期
        articles = spider.scrape_issue_with_details("2025", "04", max_pages=1)
        
        # 保存结果
        spider.save_to_json("wanfang_articles.json")
        
        # 打印摘要
        print(f"\n{'='*60}")
        print(f"总共爬取 {len(articles)} 篇文章")
        print(f"{'='*60}")
        
        for i, article in enumerate(articles[:3], 1):
            print(f"\n--- 文章 {i} ---")
            print(f"标题: {article.get('title', '')}")
            print(f"详情链接: {article.get('detail_url', '')}")
            print(f"摘要: {article.get('abstract', '')[:100] if article.get('abstract') else ''}...")
            print(f"发表日期: {article.get('publish_date', '')}")


if __name__ == "__main__":
    main()
