#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
知识库文档上传脚本
使用 Playwright 自动化上传 Markdown 文件到知识库
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

# 加载 .env 文件（从根目录加载）
load_dotenv(Path(__file__).parent.parent.parent / ".env")

# storage_state 默认路径
STORAGE_STATE_PATH = Path(__file__).parent / "playwright_storage_state.json"


def get_env_var(name: str, default=None):
    """获取环境变量"""
    value = os.environ.get(name.upper(), None)
    if value:
        return value
    return os.environ.get(name, default)


def parse_headless(value):
    """解析 headless 参数"""
    if isinstance(value, bool):
        return value
    return value.lower() in ('true', '1', 'yes', 'on')


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(
        description='知识库文档上传脚本 - 使用 Playwright 自动化上传 Markdown 文件'
    )

    parser.add_argument(
        '--workspace-type',
        type=str,
        default=None,
        help='工作空间类型，可选，没有则从环境变量 WORKSPACE_TYPE 获取'
    )
    parser.add_argument(
        '--workspace-id',
        type=str,
        default=None,
        help='工作空间 ID，可选，没有则从环境变量 WORKSPACE_ID 获取'
    )
    parser.add_argument(
        '--knowledge-id',
        type=str,
        default=None,
        help='知识库 ID，可选，没有则从环境变量 DATASET_ID 获取'
    )
    parser.add_argument(
        '--headless',
        type=parse_headless,
        default=True,
        help='浏览器是否 headless 模式，默认 True，设置 False 打开浏览器窗口'
    )
    parser.add_argument(
        '--auto-export',
        type=parse_headless,
        default=False,
        help='上传成功后是否自动刷新登录状态 JSON，默认 False'
    )
    parser.add_argument(
        '--delete',
        type=parse_headless,
        default=False,
        help='上传成功后删除本地的 md 文件（需要配合此标志）'
    )
    parser.add_argument(
        '--no-delete',
        action='store_true',
        help='上传成功后保留本地的 md 文件（默认行为，此标志优先级高于 --delete）'
    )

    parser.add_argument(
        'file_path',
        type=str,
        help='要上传的 Markdown 文件路径'
    )

    return parser.parse_args()


def build_url(workspace_type: str, workspace_id: str, knowledge_id: str) -> str:
    """构建知识库 URL"""
    return f"https://hiagent.library.sh.cn/product/llm/{workspace_type}/{workspace_id}/knowledge/{knowledge_id}"


def delete_uploaded_file(file_path: str, delete: bool = True):
    """
    删除上传的 Markdown 文档文件
    """
    if not delete:
        print(f"已跳过删除文件: {file_path}")
        return False

    file_path = Path(file_path)

    if not file_path.exists():
        print(f"文件不存在，跳过删除: {file_path}")
        return False

    try:
        file_path.unlink()
        print(f"✅ 文件已删除: {file_path}")
        return True
    except Exception as e:
        print(f"❌ 删除文件失败: {e}")
        return False


def upload_to_knowledge(file_path: str, headless: bool = True, auto_export: bool = False, delete: bool = True):
    """
    上传文件到知识库

    Args:
        file_path: 要上传的文件路径
        headless: 是否使用 headless 模式
        auto_export: 上传成功后是否自动刷新登录状态 JSON
        delete: 上传成功后是否删除本地的 md 文件，默认 True（删除）
    """
    # 获取参数
    workspace_type = args.workspace_type or get_env_var('WorkspaceType', 'personal')
    workspace_id = args.workspace_id or get_env_var('WorkspaceID')
    knowledge_id = args.knowledge_id or get_env_var('DatasetID')

    if not workspace_id:
        raise ValueError("缺少 WorkspaceID 参数，请通过 --workspace-id 指定或设置环境变量 WORKSPACE_ID")
    if not knowledge_id:
        raise ValueError("缺少 knowledge_id 参数，请通过 --knowledge-id 指定或设置环境变量 DATASET_ID")

    url = build_url(workspace_type, workspace_id, knowledge_id)
    print(f"目标 URL: {url}")

    file_path = Path(file_path)
    if not file_path.exists():
        raise FileNotFoundError(f"文件不存在: {file_path}")
    if not file_path.suffix.lower() == '.md':
        raise ValueError("仅支持 Markdown (.md) 格式文件")

    print(f"上传文件: {file_path}")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=headless,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-software-rasterizer'
            ]
        )

        # 加载 storage_state（如果存在）
        if STORAGE_STATE_PATH.exists():
            print(f"加载登录状态: {STORAGE_STATE_PATH}")
            try:
                with open(STORAGE_STATE_PATH, 'r', encoding='utf-8') as f:
                    state = json.load(f)
                context = browser.new_context(storage_state=state)
            except (json.JSONDecodeError, KeyError) as e:
                print(f"⚠️ storage_state 加载失败: {e}，使用无登录态模式")
                context = browser.new_context()
        else:
            print("⚠️ 未找到登录状态文件，请先运行: python session_manager.py login")
            context = browser.new_context()

        page = context.new_page()

        try:
            print("正在打开页面...")
            page.goto(url, wait_until="networkidle", timeout=60000)

            time.sleep(2)

            print("页面已打开，请确保已登录...")

            print("点击'导入文件'按钮...")
            import_button = page.locator('button:has-text("导入文件")').first
            import_button.click()
            time.sleep(1)

            markdown_option = page.locator('.card:has-text("层级文本")').first
            markdown_option.click()
            time.sleep(0.5)

            ok_button = page.locator('button:has-text("确定")').first
            ok_button.click()
            time.sleep(1)

            file_input = page.locator('input[type="file"]').first
            file_input.set_input_files(str(file_path.resolve()))

            page.wait_for_function(
                """() => {
                    const progress = document.querySelector('.FileCountPercent-kjGzH7G');
                    return progress && progress.textContent.includes('100%');
                }""",
                timeout=120000
            )
            time.sleep(1)

            first_switch = page.evaluate('''
                () => {
                    const elements = document.querySelectorAll('*');
                    for (const el of elements) {
                        if (el.textContent === '按照默认标题级别切分') {
                            const parent = el.closest('.arco-space');
                            if (parent) {
                                const switchBtn = parent.querySelector('button.arco-switch');
                                if (switchBtn) {
                                    return {
                                        found: true,
                                        ariaChecked: switchBtn.getAttribute('aria-checked')
                                    };
                                }
                            }
                        }
                    }
                    return { found: false };
                }
            ''')

            if first_switch and first_switch.get('found'):
                if first_switch.get('ariaChecked') != 'true':
                    page.evaluate('''
                        () => {
                            const elements = document.querySelectorAll('*');
                            for (const el of elements) {
                                if (el.textContent === '按照默认标题级别切分') {
                                    const parent = el.closest('.arco-space');
                                    if (parent) {
                                        const switchBtn = parent.querySelector('button.arco-switch');
                                        if (switchBtn) {
                                            switchBtn.click();
                                        }
                                    }
                                }
                            }
                        }
                    ''')
                    time.sleep(0.5)
            else:
                print("未找到按照默认标题级别切分开关")

            for value in ['2', '3', '4', '5']:
                try:
                    label = page.locator(f'label:has(input[type="checkbox"][value="{value}"])').first
                    if label.is_visible():
                        label.click()
                        time.sleep(0.2)
                except Exception as e:
                    print(f"取消勾选级别 {value} 失败: {e}")

            time.sleep(0.5)

            try:
                chunk_size_input = page.locator('input[id*="ProcessRuleChunkSize"]').first
                if chunk_size_input.is_visible():
                    chunk_size_input.fill('1200')
                    time.sleep(0.3)
                    print("分段字符数已设置为: 1200")
            except Exception as e:
                print(f"设置分段字符数失败: {e}")

            try:
                confirm_btn = page.locator('button:has-text("确认")').first
                if confirm_btn.is_visible():
                    confirm_btn.click()
                    time.sleep(0.5)
            except Exception as e:
                print(f"点击确认按钮失败: {e}")

            time.sleep(0.5)

            next_button = page.locator('button:has-text("下一步")').first
            next_button.click()
            time.sleep(2)

            confirm_button = page.locator('button:has-text("确定")').last
            confirm_button.click()

            time.sleep(1)

            print("上传成功完成!")

            delete_uploaded_file(str(file_path), delete)

            # 上传成功后刷新 storage_state（保持登录态有效）
            if auto_export:
                try:
                    print("正在刷新登录状态...")
                    context.storage_state(path=str(STORAGE_STATE_PATH))
                    print(f"✅ 登录状态已更新: {STORAGE_STATE_PATH}")
                except Exception as e:
                    print(f"刷新登录状态失败: {e}")
            else:
                print("提示：如需保持登录态，请运行: python session_manager.py login")

            return True

        except Exception as e:
            print(f"上传过程中出错: {e}")
            screenshot_path = Path(__file__).parent / "error_screenshot.png"
            page.screenshot(path=str(screenshot_path))
            print(f"错误截图已保存: {screenshot_path}")
            raise

        finally:
            context.close()
            browser.close()


if __name__ == "__main__":
    args = parse_args()

    delete = args.delete and not args.no_delete

    try:
        upload_to_knowledge(args.file_path, args.headless, args.auto_export, delete)
        print("\n✅ 任务完成！文件已成功上传到知识库。")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ 任务失败: {e}")
        sys.exit(1)
