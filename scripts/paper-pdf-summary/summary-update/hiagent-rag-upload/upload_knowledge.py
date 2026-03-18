#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
知识库文档上传脚本
使用 Playwright 自动化上传 Markdown 文件到知识库
"""

import argparse
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

# 导入登录状态管理模块
from session_manager import export_session

# 加载 .env 文件（从根目录加载）
from pathlib import Path
load_dotenv(Path(__file__).parent.parent.parent / ".env")


def get_env_var(name: str, default=None):
    """获取环境变量"""
    # 先尝试大写形式（标准环境变量格式）
    value = os.environ.get(name.upper(), None)
    if value:
        return value
    # 再尝试原始形式
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
    
    # 可选参数
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
        help='上传成功后是否自动导出登录状态，默认 False'
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

    # 必备参数
    parser.add_argument(
        'file_path',
        type=str,
        help='要上传的 Markdown 文件路径'
    )

    return parser.parse_args()


def build_url(workspace_type: str, workspace_id: str, knowledge_id: str) -> str:
    """构建知识库 URL"""
    return f"https://hiagent.library.sh.cn/product/llm/{workspace_type}/{workspace_id}/knowledge/{knowledge_id}"


def wait_for_element(page, selector: str, timeout: int = 30000):
    """等待元素出现"""
    return page.wait_for_selector(selector, timeout=timeout)


def delete_uploaded_file(file_path: str, delete: bool = True):
    """
    删除上传的 Markdown 文档文件
    
    Args:
        file_path: 要删除的文件路径
        delete: 是否删除文件，默认为 True（删除）
                传入 False 时不执行删除操作
    
    Returns:
        bool: 是否成功删除文件
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
        auto_export: 上传成功后是否自动导出登录状态
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
    
    # 构建 URL
    url = build_url(workspace_type, workspace_id, knowledge_id)
    print(f"目标 URL: {url}")
    
    # 确保文件存在
    file_path = Path(file_path)
    if not file_path.exists():
        raise FileNotFoundError(f"文件不存在: {file_path}")
    if not file_path.suffix.lower() == '.md':
        raise ValueError("仅支持 Markdown (.md) 格式文件")
    
    print(f"上传文件: {file_path}")
    
    # 使用 Playwright 持久化上下文保存登录状态
    user_data_dir = Path(__file__).parent / "playwright_user_data"
    user_data_dir.mkdir(exist_ok=True)
    
    with sync_playwright() as p:
        # 启动浏览器（使用持久化上下文保存登录状态）
        context = p.chromium.launch_persistent_context(
            user_data_dir,
            headless=headless,
            args=['--disable-blink-features=AutomationControlled']
        )
        
        page = context.pages[0] if context.pages else context.new_page()
        
        try:
            # 打开目标页面
            print("正在打开页面...")
            page.goto(url, wait_until="networkidle", timeout=60000)
            
            # 等待页面加载完成
            time.sleep(2)
            
            print("页面已打开，请确保已登录...")
            
            # 点击"导入文件"按钮
            # 根据 HTML 结构，"导入文件"按钮包含 SVG 图标和文本
            print("点击'导入文件'按钮...")
            import_button = page.locator('button:has-text("导入文件")').first
            import_button.click()
            time.sleep(1)
            
            # 选择"标准导入"
            # print("选择'标准导入'...")
            standard_import = page.locator('text=标准导入').first
            standard_import.click()
            time.sleep(1)
            
            # 选择"Markdown"选项
            # print("选择'Markdown'...")
            markdown_option = page.locator('.card:has-text("Markdown")').first
            markdown_option.click()
            time.sleep(0.5)
            
            # 点击"确定"按钮
            # print("点击'确定'按钮...")
            ok_button = page.locator('button:has-text("确定")').first
            ok_button.click()
            time.sleep(1)
            
            # 上传文件 - 找到文件输入框
            # print("上传文件...")
            # 使用文件输入框上传
            file_input = page.locator('input[type="file"]').first
            file_input.set_input_files(str(file_path.resolve()))
            
            # 等待上传完成（100%）
            # print("等待上传完成...")
            # 等待文件上传进度显示 100%
            page.wait_for_function(
                """() => {
                    const progress = document.querySelector('.FileCountPercent-kjGzH7G');
                    return progress && progress.textContent.includes('100%');
                }""",
                timeout=120000  # 2分钟超时
            )
            # print("文件上传完成!")
            time.sleep(1)
            
            # 配置标题级别切分
            # print("配置标题级别切分...")
            
            # 步骤1: 点击"按照默认标题级别切分"开关（第一个开关）
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
                    # print("开启按照默认标题级别切分开关...")
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
            
            # 配置标题级别复选框
            # 打开开关后，1-6级标题默认全部勾选，只需要取消4-6级勾选
            # 使用点击label的方式取消勾选
            for value in ['2', '3', '4', '5']:
                try:
                    # 找到对应的label元素并点击
                    label = page.locator(f'label:has(input[type="checkbox"][value="{value}"])').first
                    if label.is_visible():
                        label.click()
                        time.sleep(0.2)
                except Exception as e:
                    print(f"取消勾选级别 {value} 失败: {e}")
            
            time.sleep(0.5)
            
            # 配置分段字符数：将默认值1000改为1200
            try:
                chunk_size_input = page.locator('input[id*="ProcessRuleChunkSize"]').first
                if chunk_size_input.is_visible():
                    # 清除当前值并输入新值
                    chunk_size_input.fill('1200')
                    time.sleep(0.3)
                    print("分段字符数已设置为: 1200")
            except Exception as e:
                print(f"设置分段字符数失败: {e}")
            
            # 点击"确认"按钮
            try:
                confirm_btn = page.locator('button:has-text("确认")').first
                if confirm_btn.is_visible():
                    confirm_btn.click()
                    time.sleep(0.5)
            except Exception as e:
                print(f"点击确认按钮失败: {e}")
            
            time.sleep(0.5)
            
            # 点击"下一步"按钮
            # print("点击'下一步'...")
            next_button = page.locator('button:has-text("下一步")').first
            next_button.click()
            time.sleep(2)
            
            # 点击"确定"按钮
            # print("点击'确定'...")
            confirm_button = page.locator('button:has-text("确定")').last
            confirm_button.click()
            
            # 等待1秒
            time.sleep(1)
            
            print("上传成功完成!")
            
            # 上传成功后删除本地文件
            delete_uploaded_file(str(file_path), delete)
            
            # 根据参数决定是否自动导出登录状态
            if auto_export:
                try:
                    print("正在自动导出登录状态...")
                    export_session()
                except Exception as e:
                    print(f"自动导出登录状态失败: {e}")
            else:
                print("提示：如需导出登录状态，请运行: python session_manager.py export")
            
            return True
            
        except Exception as e:
            print(f"上传过程中出错: {e}")
            # 截图保存错误
            screenshot_path = Path(__file__).parent / "error_screenshot.png"
            page.screenshot(path=str(screenshot_path))
            print(f"错误截图已保存: {screenshot_path}")
            raise
            
        finally:
            # 关闭浏览器
            # print("关闭浏览器...")
            context.close()


if __name__ == "__main__":
    args = parse_args()

    # --no-delete 优先级高于 --delete
    delete = args.delete and not args.no_delete

    try:
        upload_to_knowledge(args.file_path, args.headless, args.auto_export, delete)
        print("\n✅ 任务完成！文件已成功上传到知识库。")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ 任务失败: {e}")
        sys.exit(1)
