#!/usr/bin/env python3
"""
Telegram Bot 启动脚本
"""

import sys
from pathlib import Path

project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from telegram_bot.bot import PaperTelegramBot


def main():
    try:
        bot = PaperTelegramBot()
        bot.run()
    except ValueError as e:
        print(f"错误: {e}")
        print("\n请确保环境变量已设置:")
        print("  TELEGRAM_BOT_TOKEN")
        print("  TELEGRAM_USER_ID (可选)")
        print("  TELEGRAM_API_URL (可选，默认 http://localhost:8081)")
        print("\n可在 .env 文件中配置（已被 .gitignore 忽略）")
        sys.exit(1)


if __name__ == '__main__':
    main()