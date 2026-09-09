#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Playwright 登录状态管理脚本
使用 storage_state 机制导出/导入登录状态，天然跨平台
"""

import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path


# 默认的 storage_state 文件路径
DEFAULT_STORAGE_STATE = Path(__file__).parent / "playwright_storage_state.json"


def get_storage_state_path(custom_path: str = None) -> Path:
    """获取 storage_state 文件路径"""
    if custom_path:
        return Path(custom_path)
    return DEFAULT_STORAGE_STATE


def export_session(output_path: str = None):
    """
    导出登录状态到 JSON 文件（供外部脚本调用）

    该函数需要在一个已经打开的 Playwright 上下文中使用，
    通常由 upload_knowledge.py 在上传完成后调用。
    此处仅作为占位，实际导出逻辑在 upload_knowledge.py 中。
    """
    print("提示：storage_state 导出已集成到 upload_knowledge.py 中")
    print("上传成功后会自动刷新 storage_state")


def import_session(archive_path: str, output_path: str = None):
    """
    从 JSON 文件导入登录状态

    Args:
        archive_path: storage_state JSON 文件路径
        output_path: 目标路径，默认为 playwright_storage_state.json
    """
    archive_path = Path(archive_path)

    if not archive_path.exists():
        raise FileNotFoundError(f"storage_state 文件不存在: {archive_path}")

    # 验证 JSON 格式
    try:
        with open(archive_path, 'r', encoding='utf-8') as f:
            state = json.load(f)
        if 'cookies' not in state:
            raise ValueError("无效的 storage_state 文件：缺少 cookies 字段")
    except json.JSONDecodeError as e:
        raise ValueError(f"无效的 JSON 文件: {e}")

    target = get_storage_state_path(output_path)

    # 备份现有文件
    if target.exists():
        backup = target.parent / f"playwright_storage_state_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        shutil.copy2(str(target), str(backup))
        print(f"已备份旧文件到: {backup}")

    shutil.copy2(str(archive_path), str(target))

    cookies_count = len(state.get('cookies', []))
    origins_count = len(state.get('origins', []))
    print(f"✅ 导入成功!")
    print(f"   文件: {target}")
    print(f"   包含 {cookies_count} 个 cookies, {origins_count} 个 origin 数据")


def login(url: str = None, output: str = None):
    """
    交互式登录：打开浏览器让用户手动登录，确认后保存 storage_state

    Args:
        url: 要打开的登录页面 URL
        output: 输出 JSON 文件路径
    """
    from playwright.sync_api import sync_playwright

    output_path = get_storage_state_path(output)

    if not url:
        url = "https://hiagent.library.sh.cn"

    print("=" * 60)
    print("  交互式登录模式")
    print("=" * 60)
    print(f"输出文件: {output_path}")
    print(f"目标 URL: {url}")
    print()
    print("即将打开浏览器，请在浏览器中手动完成登录。")
    print("登录完成后，请回到命令行按 Enter 键保存登录状态。")
    print()

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=['--disable-blink-features=AutomationControlled']
        )
        context = browser.new_context()

        page = context.pages[0] if context.pages else context.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=60000)

        input("按 Enter 键继续（确保已登录完成）...")

        print("正在保存登录状态...")
        context.storage_state(path=str(output_path))
        browser.close()

    print()
    print("✅ 登录状态已保存！")
    print(f"   文件: {output_path}")
    print("后续运行 upload_knowledge.py 将自动复用此登录状态。")
    print("跨平台使用：将此 JSON 文件拷贝到其他机器即可，无需 zip。")


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(
        description='Playwright 登录状态管理工具 - 基于 storage_state，天然跨平台'
    )

    subparsers = parser.add_subparsers(dest='command', help='可用命令')

    import_parser = subparsers.add_parser('import', help='导入登录状态 JSON 文件')
    import_parser.add_argument('archive', type=str, help='要导入的 storage_state JSON 文件路径')
    import_parser.add_argument(
        '-o', '--output', type=str, default=None,
        help='目标文件路径，默认使用 playwright_storage_state.json'
    )

    login_parser = subparsers.add_parser('login', help='交互式登录：打开浏览器手动登录后保存登录态')
    login_parser.add_argument(
        '-u', '--url', type=str, default=None,
        help='要打开的登录页面 URL，默认 https://hiagent.library.sh.cn'
    )
    login_parser.add_argument(
        '-o', '--output', type=str, default=None,
        help='输出 JSON 文件路径，默认使用 playwright_storage_state.json'
    )

    return parser.parse_args()


def main():
    """主函数"""
    args = parse_args()

    if not args.command:
        parser = argparse.ArgumentParser(
            description='Playwright 登录状态管理工具'
        )
        parser.print_help()
        print("\n示例:")
        print("  python session_manager.py login                         # 交互式登录（打开浏览器手动登录）")
        print("  python session_manager.py login -u https://example.com   # 登录指定页面")
        print("  python session_manager.py import state.json              # 导入登录状态")
        return

    try:
        if args.command == 'import':
            import_session(args.archive, args.output)

        elif args.command == 'login':
            login(args.url, args.output)

    except Exception as e:
        print(f"\n❌ 错误: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
