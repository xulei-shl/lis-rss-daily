"""Google Scholar Web Search CLI

传统 Google Scholar Web 检索的命令行界面。
"""

import argparse
import logging
import sys
from pathlib import Path
from typing import Optional

# 使用绝对导入，支持直接作为脚本运行
from browser import BrowserManager
from exceptions import ScholarError
from config import ScholarWebSearchConfig
from interactor import WebSearchInteractor
from utils import save_results, print_results

logger = logging.getLogger("scholar_web_search")


def parse_year(year_str: str) -> tuple[int, int]:
    """解析年份参数

    Args:
        year_str: 年份字符串（"2024" 或 "2020-2024"）

    Returns:
        (起始年份, 结束年份) 元组

    Raises:
        ValueError: 年份格式无效
    """
    if "-" in year_str:
        parts = year_str.split("-")
        if len(parts) != 2:
            raise ValueError(f"无效的年份范围: {year_str}")
        try:
            year_start, year_end = int(parts[0]), int(parts[1])
            if year_start > year_end:
                raise ValueError(f"起始年份不能大于结束年份: {year_str}")
            return year_start, year_end
        except ValueError as e:
            raise ValueError(f"无效的年份格式: {year_str}") from e
    else:
        try:
            year = int(year_str)
            return year, year
        except ValueError as e:
            raise ValueError(f"无效的年份格式: {year_str}") from e


class WebSearchCLI:
    """传统 Google Scholar Web 检索 CLI 应用"""

    DEFAULT_OUTPUT_DIR = Path("./temps/google-scholar-search")

    def __init__(self, config: ScholarWebSearchConfig):
        """初始化 CLI

        Args:
            config: Web 检索配置
        """
        self.config = config
        self.browser_manager: Optional[BrowserManager] = None
        self.interactor: Optional[WebSearchInteractor] = None

    def initialize(self) -> bool:
        """初始化浏览器

        Returns:
            是否成功
        """
        try:
            self.browser_manager = BrowserManager(self.config)
            page = self.browser_manager.start()
            self.interactor = WebSearchInteractor(page, self.config)
            return True
        except Exception as e:
            logger.error(f"初始化失败: {e}")
            return False

    def search(
        self,
        query: str,
        year_start: Optional[int] = None,
        year_end: Optional[int] = None,
        num_results: Optional[int] = None,
    ) -> Optional[dict]:
        """执行检索

        Args:
            query: 检索词
            year_start: 起始年份
            year_end: 结束年份
            num_results: 结果数量

        Returns:
            检索结果字典
        """
        if not self.interactor:
            logger.error("未初始化")
            return None

        return self.interactor.search(query, year_start, year_end, num_results)

    def cleanup(self) -> None:
        """清理资源"""
        if self.browser_manager:
            self.browser_manager.close()


def create_parser() -> argparse.ArgumentParser:
    """创建 CLI 参数解析器

    Returns:
        ArgumentParser 实例
    """
    parser = argparse.ArgumentParser(
        prog="scholar-web-search",
        description="Google Scholar Web 检索工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  scholar-web-search "machine learning"              # 基础检索
  scholar-web-search "deep learning" -y 2024         # 年份筛选
  scholar-web-search "neural networks" -n 50         # 获取 50 条结果
  scholar-web-search "attention" -y 2023 -n 20 -o ./results
        """,
    )

    # 位置参数
    parser.add_argument("query", help="检索词")

    # 可选参数
    parser.add_argument(
        "-y",
        "--year",
        type=str,
        help="筛选年份（格式: 2024 或 2020-2024）",
    )

    parser.add_argument(
        "-n",
        "--num-results",
        type=int,
        default=10,
        help="获取结果数量（默认: 10，最大: 100）",
    )

    parser.add_argument("-o", "--output-dir", type=Path, help="输出目录")

    parser.add_argument("--headless", action="store_true", help="无头模式运行")

    parser.add_argument("--no-geoip", action="store_true", help="禁用 GeoIP")

    parser.add_argument(
        "--proxy", type=str, help="代理地址（如: http://127.0.0.1:7890）"
    )

    parser.add_argument(
        "--no-proxy", action="store_true", help="禁用默认代理"
    )

    parser.add_argument(
        "--language", type=str, default="zh-CN", help="界面语言（默认: zh-CN）"
    )

    parser.add_argument("--no-save", action="store_true", help="不保存结果文件")

    parser.add_argument("--json-only", action="store_true", help="仅输出 JSON 格式")

    parser.add_argument("--debug", action="store_true", help="启用调试日志")

    parser.add_argument(
        "--version",
        "-V",
        action="version",
        version="%(prog)s 0.1.0",
    )

    return parser


def setup_logging(level: str = "INFO") -> None:
    """设置日志

    Args:
        level: 日志级别
    """
    logging.basicConfig(
        level=getattr(logging, level.upper()),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def main() -> int:
    """主入口函数

    Returns:
        退出码
    """
    parser = create_parser()
    args = parser.parse_args()

    # 设置日志
    log_level = "DEBUG" if args.debug else "INFO"
    setup_logging(log_level)

    # 创建配置（默认使用代理）
    # 优先级: --proxy > --no-proxy > 默认代理
    if args.proxy is not None:
        # 用户明确指定代理
        proxy = args.proxy
    elif args.no_proxy:
        # 用户禁用代理
        proxy = None
    else:
        # 使用默认代理
        proxy = "http://127.0.0.1:7890"

    config = ScholarWebSearchConfig(
        headless=args.headless,
        geoip=not args.no_geoip,
        proxy=proxy,
        language=args.language,
        output_dir=args.output_dir,
        save_results=not args.no_save,
        json_only=args.json_only,
    )

    # 解析年份参数
    year_start, year_end = None, None
    if args.year:
        try:
            year_start, year_end = parse_year(args.year)
        except ValueError as e:
            print(f"错误: {e}")
            return 1

    # 创建 CLI 应用
    app = WebSearchCLI(config)

    try:
        # 初始化
        logger.info("正在启动 Google Scholar Web Search...")
        if not app.initialize():
            print("初始化失败")
            return 1

        # 执行检索
        result = app.search(args.query, year_start, year_end, args.num_results)

        if result is None:
            print("检索失败")
            return 1

        # 处理错误
        if "error" in result:
            error_msg = result.get("error_message", "未知错误")
            error_type = result.get("error", "unknown")

            if error_type == "captcha":
                print(f"\n错误: 检测到验证码")
                print("建议：请稍后重试或更换 IP 地址")
            elif error_type == "rate_limit":
                print(f"\n错误: 达到速率限制")
                print("建议：请等待一段时间后重试")
            elif error_type == "no_results":
                print(f"\n提示: 没有找到匹配的结果")
            else:
                print(f"\n错误: {error_msg}")

            return 1

        # 打印结果
        results = result.get("results", [])
        print_results(results)

        # 保存结果
        if config.save_results:
            output_dir = config.output_dir or WebSearchCLI.DEFAULT_OUTPUT_DIR
            output_dir.mkdir(parents=True, exist_ok=True)
            json_path, md_path = save_results(result, output_dir)
            print(f"\nJSON: {json_path}")
            print(f"Markdown: {md_path}")

        print(f"\n共找到 {result['total_results']} 条结果")
        return 0

    except KeyboardInterrupt:
        print("\n用户中断")
        return 130
    except Exception as e:
        logger.error(f"运行时错误: {e}")
        import traceback

        traceback.print_exc()
        return 1
    finally:
        app.cleanup()


if __name__ == "__main__":
    sys.exit(main())
