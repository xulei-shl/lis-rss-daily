#!/usr/bin/env python3
"""
LIS-RSS 文章 AI 总结更新脚本

用法:
    python update_summary.py --id 123 --file /path/to/summary.md
    python update_summary.py --id 123 --text "总结内容..."
    python update_summary.py -i 123 -f summary.md
"""

import argparse
import os
import sys
import json
import time
from pathlib import Path
from typing import Optional

try:
    import requests
except ImportError:
    print("[ERROR] 需要安装 requests 库")
    print("        安装命令: pip install requests")
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    print("[ERROR] 需要安装 python-dotenv 库")
    print("        安装命令: pip install python-dotenv")
    sys.exit(1)

# 配置文件路径（从根目录加载）
from pathlib import Path
ENV_FILE = Path(__file__).parent.parent / ".env"

# 配置项映射: 环境变量名 -> 配置键名
CONFIG_KEY_MAP = {
    'LIS_RSS_API_URL': 'api_url',
    'BASE_URL': 'api_url',
    'LIS_RSS_USERNAME': 'username',
    'LIS_RSS_PASSWORD': 'password',
}


def load_config() -> dict:
    """从 .env 配置文件加载配置"""
    # 尝试加载 .env 文件
    if os.path.exists(ENV_FILE):
        load_dotenv(ENV_FILE, override=True)
    else:
        print("[WARN] 未找到 .env 配置文件，将使用环境变量或命令行参数")
    
    # 从环境变量读取配置
    config = {}
    for env_key, config_key in CONFIG_KEY_MAP.items():
        value = os.getenv(env_key)
        if value:
            config[config_key] = value
    
    return config


def read_file_content(file_path: str) -> str:
    """读取文件内容"""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"文件不存在: {file_path}")
    return path.read_text(encoding='utf-8')


def create_session(api_url: str, username: str, password: str) -> requests.Session:
    """登录并创建会话"""
    login_url = f"{api_url}/login"
    payload = {
        "username": username,
        "password": password
    }

    print(f"[INFO] 登录中: {username}")

    session = requests.Session()
    try:
        response = session.post(login_url, json=payload, timeout=10)
        response.raise_for_status()
        print(f"[INFO] 登录成功")
        return session
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"登录失败: {e}")


def update_ai_summary(session: requests.Session, api_url: str, article_id: int, ai_summary: str, retries: int = 3) -> bool:
    """更新文章 AI 总结"""
    url = f"{api_url}/api/articles/{article_id}/ai-summary"
    headers = {"Content-Type": "application/json"}
    payload = {"ai_summary": ai_summary}

    print(f"[INFO] 更新文章 {article_id} 的 AI 总结...")

    for attempt in range(retries):
        try:
            response = session.patch(url, json=payload, headers=headers, timeout=30)
            response.raise_for_status()
            data = response.json()

            if data.get('success'):
                print(f"[SUCCESS] 总结已更新！")
                return True
            else:
                print(f"[ERROR] 更新失败: {data}")
                return False

        except requests.exceptions.HTTPError as e:
            status_code = e.response.status_code if e.response is not None else 0

            if status_code == 401:
                print("[WARN] Token 失效，尝试重新登录...")
                return False  # 需要重新登录
            elif status_code == 403:
                print("[ERROR] 权限不足（guest 用户无写权限）")
                return False
            elif status_code == 404:
                print(f"[ERROR] 文章不存在: ID={article_id}")
                return False
            elif status_code == 400:
                print(f"[ERROR] 参数错误: {e.response.text if e.response else ''}")
                return False
            else:
                if attempt < retries - 1:
                    wait_time = (attempt + 1) * 2
                    print(f"[WARN] 请求失败，{wait_time}秒后重试... ({attempt + 1}/{retries})")
                    time.sleep(wait_time)
                else:
                    print(f"[ERROR] 请求失败: {e}")
                    return False

        except requests.exceptions.RequestException as e:
            if attempt < retries - 1:
                wait_time = (attempt + 1) * 2
                print(f"[WARN] 网络错误，{wait_time}秒后重试... ({attempt + 1}/{retries})")
                time.sleep(wait_time)
            else:
                print(f"[ERROR] 网络错误: {e}")
                return False

    return False


def main():
    parser = argparse.ArgumentParser(
        description="更新 LIS-RSS 文章 AI 总结",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  %(prog)s --id 123 --file summary.md
  %(prog)s -i 123 -t "这是一篇关于深度学习的论文..."
  %(prog)s --id 123 --stdin
        """
    )

    parser.add_argument('-i', '--id', type=int, required=True,
                        help='文章 ID（必备参数）')
    parser.add_argument('-f', '--file', type=str,
                        help='总结内容文件路径')
    parser.add_argument('-t', '--text', type=str,
                        help='直接传入总结文本')
    parser.add_argument('--stdin', action='store_true',
                        help='从标准输入读取内容')
    parser.add_argument('-a', '--api-url', type=str,
                        help='API 地址（从 .env 文件 LIS_RSS_API_URL 读取或使用 -a 指定）')
    parser.add_argument('-u', '--username', type=str,
                        help='用户名（从 .env 文件 LIS_RSS_USERNAME 读取或使用 -u 指定）')
    parser.add_argument('-p', '--password', type=str,
                        help='密码（从 .env 文件 LIS_RSS_PASSWORD 读取或使用 -p 指定）')
    parser.add_argument('-v', '--verbose', action='store_true',
                        help='显示详细输出')

    args = parser.parse_args()

    # 加载配置
    config = load_config()

    # 确定最终配置值（优先级：命令行 > 配置文件/环境变量）
    if not config.get('api_url'):
        raise ValueError("未配置 API 地址，请在 .env 文件中设置 LIS_RSS_API_URL 或使用 -a 参数")
    if not config.get('username'):
        raise ValueError("未配置用户名，请 在 .env 文件中设置 LIS_RSS_USERNAME 或使用 -u 参数")
    if not config.get('password'):
        raise ValueError("未配置密码，请在 .env 文件中设置 LIS_RSS_PASSWORD 或使用 -p 参数")

    api_url = args.api_url or config.get('api_url')
    username = args.username or config.get('username')
    password = args.password or config.get('password')

    # 获取总结内容
    ai_summary = None

    if args.text:
        # 直接使用文本
        ai_summary = args.text
        if args.verbose:
            print(f"[INFO] 使用直接传入的文本 ({len(ai_summary)} 字符)")

    elif args.file:
        # 从文件读取
        try:
            ai_summary = read_file_content(args.file)
            print(f"[INFO] 读取文件: {args.file}")
        except FileNotFoundError as e:
            print(f"[ERROR] {e}")
            return 1
        except Exception as e:
            print(f"[ERROR] 读取文件失败: {e}")
            return 1

    elif args.stdin:
        # 从标准输入读取
        ai_summary = sys.stdin.read()
        if args.verbose:
            print(f"[INFO] 从标准输入读取 ({len(ai_summary)} 字符)")

    else:
        # 交互式输入
        print("[INFO] 未指定内容来源，请输入总结内容（Ctrl+D 结束输入）:")
        try:
            lines = []
            for line in sys.stdin:
                lines.append(line)
            ai_summary = ''.join(lines)
        except KeyboardInterrupt:
            print("\n[INFO] 输入已取消")
            return 0

    # 验证内容
    if not ai_summary or not ai_summary.strip():
        print("[ERROR] 总结内容不能为空")
        return 1

    # 显示摘要
    if args.verbose:
        preview = ai_summary[:100] + "..." if len(ai_summary) > 100 else ai_summary
        print(f"[INFO] 总结内容预览: {preview}")

    # 登录
    try:
        session = create_session(api_url, username, password)
    except Exception as e:
        print(f"[ERROR] {e}")
        return 1

    # 更新总结
    try:
        success = update_ai_summary(session, api_url, args.id, ai_summary)
        if success:
            return 0
        else:
            return 1
    except Exception as e:
        print(f"[ERROR] 更新失败: {e}")
        return 1
    finally:
        session.close()


if __name__ == '__main__':
    sys.exit(main())
