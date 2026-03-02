"""浏览器管理模块

基于 Camoufox 的浏览器管理，仅支持纯净模式（每次全新浏览器）。
"""

import logging
import subprocess
import time
import os
from pathlib import Path
from typing import Optional

from playwright.sync_api import sync_playwright, Page
from camoufox.sync_api import NewBrowser

from config import ScholarWebSearchConfig
from exceptions import BrowserError

logger = logging.getLogger("scholar_web_search")


class BrowserManager:
    """浏览器管理器

    负责创建和管理 camoufox 浏览器实例，使用纯净模式。
    """

    def __init__(self, config: ScholarWebSearchConfig):
        """初始化浏览器管理器

        Args:
            config: 配置实例
        """
        self.config = config
        self._playwright = None
        self._context = None
        self._page: Optional[Page] = None

    @property
    def page(self) -> Optional[Page]:
        """获取当前页面"""
        return self._page

    def start(self) -> Page:
        """启动浏览器并返回页面

        使用纯净模式（每次全新浏览器），避免被 Google Scholar 标记。

        Returns:
            Playwright Page 实例

        Raises:
            BrowserError: 启动失败时
        """
        logger.info("正在启动浏览器...")

        try:
            # 清理可能的 asyncio 事件循环（避免与 Playwright Sync API 冲突）
            try:
                import asyncio
                loop = asyncio.get_event_loop()
                if loop and not loop.is_closed():
                    loop.close()
                asyncio.set_event_loop(None)
            except RuntimeError:
                # 没有事件循环，这是正常的
                pass

            # 确保数据目录存在
            self.config.ensure_data_dir()

            # 启动 Playwright
            self._playwright = sync_playwright().start()

            # 判断 headless 模式
            actual_headless = ScholarWebSearchConfig.get_headless_mode(self.config.headless)
            headless_display = "启用" if actual_headless is True else (
                "虚拟显示 (Xvfb)" if actual_headless == "virtual" else "禁用"
            )
            logger.info(f"无头模式: {headless_display}")

            # 清理可能残留的 Xvfb 进程
            self._cleanup_xvfb()

            # 转换代理格式
            proxy_dict = {"server": self.config.proxy} if self.config.proxy else None

            # 创建非持久化浏览器
            browser = NewBrowser(
                self._playwright,
                headless=actual_headless,
                geoip=self.config.geoip,
                proxy=proxy_dict,
            )

            # 创建 context
            self._context = browser.new_context(
                proxy=proxy_dict,
                locale="zh-CN",
            )
            self._context.set_default_timeout(self.config.page_timeout * 1000)

            # 创建页面
            self._page = self._context.new_page()

            logger.info("浏览器启动成功（纯净模式）")
            return self._page

        except Exception as e:
            logger.error(f"浏览器启动失败: {e}")
            raise BrowserError(f"浏览器启动失败: {e}") from e

    def _cleanup_xvfb(self) -> None:
        """清理 Xvfb 虚拟显示进程、锁文件和环境变量

        当使用 headless="virtual" 模式时，Camoufox 会启动 Xvfb 进程并设置 DISPLAY 环境变量。
        正常情况下浏览器关闭时会自动清理，但有时进程会残留导致下次启动失败。
        此方法主动清理可能残留的 Xvfb 进程、锁文件和环境变量。

        必须在启动新浏览器之前调用，以确保显示端口可用。
        """
        cleaned_count = 0

        # 1. 清理 Xvfb 进程
        try:
            # 查找所有 Xvfb 进程
            result = subprocess.run(
                ["pgrep", "-f", "Xvfb"],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0 and result.stdout.strip():
                pids = result.stdout.strip().split('\n')
                for pid in pids:
                    try:
                        subprocess.run(["kill", "-9", pid], capture_output=True, timeout=5)
                        cleaned_count += 1
                        logger.debug(f"已终止 Xvfb 进程: {pid}")
                    except Exception:
                        pass
        except FileNotFoundError:
            # pgrep 不可用，尝试使用 ps
            try:
                result = subprocess.run(
                    ["ps", "aux"],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                for line in result.stdout.split('\n'):
                    if 'Xvfb' in line and 'defunct' not in line:
                        parts = line.split()
                        if len(parts) >= 2:
                            pid = parts[1]
                            try:
                                subprocess.run(["kill", "-9", pid], capture_output=True, timeout=5)
                                cleaned_count += 1
                                logger.debug(f"已终止 Xvfb 进程: {pid}")
                            except Exception:
                                pass
            except Exception:
                pass
        except Exception:
            pass

        # 2. 清理 Xvfb 锁文件（可能阻止新 Xvfb 启动）
        try:
            # Camoufox 默认使用 :99 显示端口
            for display_num in range(99, 110):
                lock_file = f"/tmp/.X{display_num}-lock"
                try:
                    if Path(lock_file).exists():
                        Path(lock_file).unlink()
                        cleaned_count += 1
                        logger.debug(f"已删除锁文件: {lock_file}")
                except Exception:
                    pass
        except Exception:
            pass

        # 3. 清理可能残留的 DISPLAY 环境变量
        # Camoufox 在使用虚拟显示时会设置此变量（如 :99），但关闭后可能残留
        # 如果残留了 DISPLAY，会导致 get_headless_mode() 误判，不再使用虚拟显示
        display_value = os.environ.get("DISPLAY", "")
        if display_value and display_value.startswith(":"):
            display_num = display_value[1:].split(".")[0]
            # 只清理虚拟显示常用的端口范围（:99-:109），避免误清理真实显示
            try:
                num = int(display_num)
                if 90 <= num <= 109:  # Camoufox 虚拟显示常用范围
                    del os.environ["DISPLAY"]
                    cleaned_count += 1
                    logger.debug(f"已清理残留的 DISPLAY 环境变量: {display_value}")
            except ValueError:
                pass

        if cleaned_count > 0:
            logger.info(f"已清理 {cleaned_count} 个残留的 Xvfb 资源")

        # 等待资源完全释放
        time.sleep(0.5)

    def close(self) -> None:
        """关闭浏览器

        注意：Xvfb 进程的清理已在 start() 方法启动新浏览器前处理，
        这里只需关闭浏览器资源即可。
        """
        if self._page:
            try:
                self._page.close()
            except Exception:
                pass
            self._page = None

        if self._context:
            try:
                self._context.close()
            except Exception:
                pass
            self._context = None

        if self._playwright:
            try:
                self._playwright.stop()
            except Exception:
                pass
            self._playwright = None

        # 清理可能的 asyncio 事件循环（避免与 Playwright Sync API 冲突）
        try:
            import asyncio
            # 尝试获取并关闭运行中的循环
            loop = asyncio.get_running_loop()
            # 不能直接关闭运行中的循环，只能停止
            asyncio.set_event_loop(None)
        except RuntimeError:
            # 没有运行中的循环，这是正常的
            pass

        logger.info("浏览器已关闭")

    def __enter__(self) -> "BrowserManager":
        """上下文管理器入口"""
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """上下文管理器出口"""
        self.close()
