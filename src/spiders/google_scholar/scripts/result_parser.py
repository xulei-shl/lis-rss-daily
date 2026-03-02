"""Web 检索结果解析器"""

import logging
import re
from typing import List, Dict, Optional

from playwright.sync_api import Page

from exceptions import NoResultsError, CaptchaError, RateLimitError

logger = logging.getLogger("web_search")


class ResultParser:
    """传统 Google Scholar 结果解析器

    从页面提取搜索结果，检测错误和异常情况。
    """

    # CSS 选择器
    SELECTORS = {
        "result_container": "div[data-rp]",
        "title": "h3 a",
        "meta": ".gs_a",
        "abstract": ".gs_rs",
        "cited_link": ".gs_fl a[href*='cites=']",
        "pdf_link": "a[href*='.pdf']",
        "next_page": ".gs_ico_nav_next, a[aria-label*='Next']",
        # 错误检测
        "captcha_form": "form[action*='recaptcha']",
        "no_results": "text=/No results found/i",
    }

    # 验证码指示文本
    CAPTCHA_TEXTS = [
        "请证明您不是机器人",
        "Please show you're not a robot",
        "prove you are not a robot",
        "请输入验证码",
        "enter the characters",
    ]

    # 速率限制指示文本
    RATE_LIMIT_TEXTS = [
        "您已达到今天的查询上限",
        "Daily limit reached",
        "unusual traffic",
        "blocked",
        "请稍后再试",
    ]

    def __init__(self, page: Page):
        """初始化解析器

        Args:
            page: Playwright Page 实例
        """
        self.page = page

    def check_errors(self) -> None:
        """检测页面是否有错误（验证码或限额）

        Raises:
            CaptchaError: 检测到验证码
            RateLimitError: 达到速率限制
        """
        # 检测验证码表单
        captcha_form = self.page.query_selector(self.SELECTORS["captcha_form"])
        if captcha_form:
            raise CaptchaError("检测到验证码表单")

        # 获取页面文本进行检测
        page_text = self.page.inner_text("body").lower()

        # 检测验证码文本
        for captcha_text in self.CAPTCHA_TEXTS:
            if captcha_text.lower() in page_text:
                raise CaptchaError(f"检测到验证码提示: '{captcha_text}'")

        # 检测速率限制文本
        for limit_text in self.RATE_LIMIT_TEXTS:
            if limit_text.lower() in page_text:
                raise RateLimitError(f"达到速率限制: '{limit_text}'")

    def check_no_results(self) -> bool:
        """检测页面是否显示无结果

        Returns:
            是否无结果
        """
        no_results_el = self.page.query_selector(self.SELECTORS["no_results"])
        if no_results_el:
            try:
                return no_results_el.is_visible()
            except Exception:
                pass
        return False

    def parse_results(self) -> List[Dict]:
        """解析当前页所有结果

        Returns:
            结果列表

        Raises:
            CaptchaError: 检测到验证码
            RateLimitError: 达到速率限制
            NoResultsError: 无搜索结果
        """
        self.check_errors()

        if self.check_no_results():
            raise NoResultsError("此检索没有返回结果")

        results = []
        result_divs = self.page.query_selector_all(self.SELECTORS["result_container"])

        logger.debug(f"发现 {len(result_divs)} 个结果容器")

        for div in result_divs:
            result = self._parse_single_result(div)
            if result:
                results.append(result)

        return results

    def _parse_single_result(self, container) -> Optional[Dict]:
        """解析单个搜索结果

        Args:
            container: 结果容器元素

        Returns:
            解析后的结果字典，如果解析失败返回 None
        """
        # 标题和链接
        title_link = container.query_selector(self.SELECTORS["title"])
        if not title_link:
            return None

        title = title_link.inner_text().strip()
        url = title_link.get_attribute("href") or ""

        # 元信息（作者、来源、年份）
        meta_el = container.query_selector(self.SELECTORS["meta"])
        meta_info = meta_el.inner_text().strip() if meta_el else ""

        # 摘要
        abstract_el = container.query_selector(self.SELECTORS["abstract"])
        abstract = abstract_el.inner_text().strip() if abstract_el else ""

        # 被引次数
        cited_by = 0
        cited_link_el = container.query_selector(self.SELECTORS["cited_link"])
        if cited_link_el:
            cited_text = cited_link_el.inner_text()
            match = re.search(r"Cited by (\d+)", cited_text)
            if match:
                cited_by = int(match.group(1))

        # PDF 链接
        pdf_link = ""
        pdf_els = container.query_selector_all("a")
        for el in pdf_els:
            href = el.get_attribute("href") or ""
            if ".pdf" in href.lower() or (el.inner_text() and "pdf" in el.inner_text().lower()):
                pdf_link = href
                break

        return {
            "title": title,
            "url": url,
            "meta": meta_info,
            "abstract": abstract,
            "cited_by": cited_by,
            "pdf_link": pdf_link,
        }

    def has_next_page(self) -> bool:
        """检测是否有下一页

        Returns:
            是否有下一页
        """
        next_link = self.page.query_selector(self.SELECTORS["next_page"])
        if next_link:
            try:
                return next_link.is_visible()
            except Exception:
                pass
        return False
