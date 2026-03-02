"""Google Scholar Web Search 配置模块

合并原 common/config.py 和 web_search/config.py，简化为 Web Search 专用配置。
"""

import platform
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class ScholarWebSearchConfig:
    """Google Scholar Web 检索配置类

    专为 Web Search 设计，使用纯净模式（每次全新浏览器）。
    """

    # 浏览器配置
    headless: bool = False
    data_dir: str = "./data"

    # 超时设置
    page_timeout: int = 60
    navigation_timeout: int = 30

    # GeoIP 和代理
    geoip: bool = True
    proxy: Optional[str] = None

    # 检索参数
    base_url: str = "https://scholar.google.com/scholar"
    language: str = "zh-CN"  # hl 参数
    search_type: str = "0,5"  # as_sdt 参数

    # 结果设置
    results_per_page: int = 10
    max_results: int = 100  # 最大获取结果数

    # 输出设置
    output_dir: Optional[Path] = None
    save_results: bool = True
    json_only: bool = False

    def ensure_data_dir(self) -> Path:
        """确保数据目录存在

        Returns:
            数据目录路径
        """
        data_path = Path(self.data_dir)
        data_path.mkdir(parents=True, exist_ok=True)
        return data_path

    @classmethod
    def get_headless_mode(cls, headless: bool) -> bool | str:
        """智能判断 headless 模式

        - Linux 无 DISPLAY 环境变量时自动使用虚拟显示
        - 有 DISPLAY 或用户明确指定时使用用户设置

        Args:
            headless: 用户指定的 headless 参数

        Returns:
            True, False, 或 "virtual"（使用 Xvfb 虚拟显示）
        """
        if headless is True:
            return True

        if platform.system() == "Linux":
            import os

            if not os.environ.get("DISPLAY"):
                xvfb_available = shutil.which("Xvfb") is not None
                if xvfb_available:
                    return "virtual"
                else:
                    # 无 Xvfb 时使用标准 headless
                    return True

        return headless

    def build_search_url(
        self,
        query: str,
        year_start: Optional[int] = None,
        year_end: Optional[int] = None,
        start: int = 0,
    ) -> str:
        """构造检索 URL

        Args:
            query: 检索词
            year_start: 起始年份（as_ylo 参数）
            year_end: 结束年份（as_yhi 参数）
            start: 结果偏移量（翻页用，0, 10, 20...）

        Returns:
            完整的检索 URL
        """
        from urllib.parse import urlencode

        params = {
            "q": query,
            "hl": self.language,
            "as_sdt": self.search_type,
            "start": start,
        }

        if year_start is not None:
            params["as_ylo"] = year_start
        if year_end is not None:
            params["as_yhi"] = year_end

        param_str = urlencode(params)
        return f"{self.base_url}?{param_str}"
