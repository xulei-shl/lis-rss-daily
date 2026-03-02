"""Web 检索交互器

与传统 Google Scholar 页面交互，执行检索并获取结果。
"""

import logging
import time
from typing import List, Dict, Optional

from playwright.sync_api import Page

from config import ScholarWebSearchConfig
from result_parser import ResultParser
from exceptions import ScholarError

logger = logging.getLogger("web_search")


class WebSearchInteractor:
    """传统 Google Scholar Web 检索交互器

    负责与页面交互，执行检索并收集结果。
    """

    def __init__(self, page: Page, config: ScholarWebSearchConfig):
        """初始化交互器

        Args:
            page: Playwright Page 实例
            config: Web 检索配置
        """
        self.page = page
        self.config = config
        self.parser = ResultParser(page)

    def search(
        self,
        query: str,
        year_start: Optional[int] = None,
        year_end: Optional[int] = None,
        num_results: Optional[int] = None,
    ) -> Dict:
        """执行检索

        Args:
            query: 检索词
            year_start: 起始年份
            year_end: 结束年份
            num_results: 获取结果数量（None 则使用配置的 max_results）

        Returns:
            包含结果和元数据的字典
        """
        num_results = num_results or self.config.max_results
        all_results = []

        try:
            page_num = 0
            start = 0

            while len(all_results) < num_results:
                # 构造 URL
                url = self.config.build_search_url(query, year_start, year_end, start)

                logger.info(f"正在获取第 {page_num + 1} 页 (start={start})")
                logger.debug(f"URL: {url}")

                # 导航到页面
                self.page.goto(url, timeout=self.config.page_timeout * 1000)
                time.sleep(2)  # 等待页面稳定

                # 解析结果
                results = self.parser.parse_results()
                all_results.extend(results)

                logger.info(f"第 {page_num + 1} 页: {len(results)} 条结果")

                # 检查是否需要更多结果
                if len(all_results) >= num_results:
                    break

                # 检查是否有下一页
                if not self.parser.has_next_page():
                    logger.info("没有更多页面")
                    break

                # 翻页
                start += self.config.results_per_page
                page_num += 1

                # 礼貌延迟
                time.sleep(1)

            # 截取到请求的数量
            all_results = all_results[:num_results]

            return {
                "query": query,
                "year_start": year_start,
                "year_end": year_end,
                "total_results": len(all_results),
                "results": all_results,
                "url": self.config.build_search_url(query, year_start, year_end, 0),
                "timestamp": time.time(),
            }

        except Exception as e:
            error_type = type(e).__name__
            error_msg = str(e)

            # 根据异常类型返回相应的错误信息
            if error_type == "CaptchaError":
                error_code = "captcha"
            elif error_type == "RateLimitError":
                error_code = "rate_limit"
            elif error_type == "NoResultsError":
                error_code = "no_results"
            else:
                error_code = "unknown"

            logger.error(f"检索错误: {error_type}: {error_msg}")

            return {
                "query": query,
                "year_start": year_start,
                "year_end": year_end,
                "error": error_code,
                "error_message": error_msg,
                "timestamp": time.time(),
            }
