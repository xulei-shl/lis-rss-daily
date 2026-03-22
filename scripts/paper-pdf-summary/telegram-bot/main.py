#!/usr/bin/env python3
"""
Telegram Bot 启动入口

通过 systemd 服务或直接运行此脚本启动 Bot。
"""

import os
import sys
import signal
from pathlib import Path

bot_dir = Path(__file__).parent
project_root = bot_dir.parent
sys.path.insert(0, str(bot_dir))
sys.path.insert(0, str(project_root))

from client import TelegramClient
from state import StateManager, ProcessingLock
from command_parser import parse_papers_command, format_help_text
from workflow import Workflow, load_config
from bot import TelegramBot as BotClass


CONFIG_PATH = os.getenv("CONFIG_PATH", "config/config.yaml")


def load_telegram_config() -> dict:
    """加载 Telegram 配置"""
    config = load_config(CONFIG_PATH)
    telegram_config = config.get("telegram", {})

    if not telegram_config.get("enabled", False):
        print("[Main] Telegram bot is not enabled in config")
        sys.exit(0)

    bot_token = telegram_config.get("bot_token")
    if not bot_token:
        print("[Main] Telegram bot_token is required")
        sys.exit(1)

    user_id = telegram_config.get("user_id")
    if not user_id:
        print("[Main] Telegram user_id is required")
        sys.exit(1)

    chat_id = telegram_config.get("chat_id", user_id)

    return {
        "bot_token": bot_token,
        "user_id": int(user_id),
        "chat_id": int(chat_id),
    }


def main():
    """主函数"""
    print("=" * 60)
    print("  Paper PDF Summary Telegram Bot")
    print("=" * 60)

    config_path = project_root / CONFIG_PATH
    print(f"[Config] Loading: {config_path}")

    telegram_config = load_telegram_config()
    print(f"[Config] Bot configured for user_id: {telegram_config['user_id']}")
    print(f"[Config] Chat ID: {telegram_config['chat_id']}")

    bot = BotClass(
        bot_token=telegram_config["bot_token"],
        user_id=telegram_config["user_id"],
        chat_id=telegram_config["chat_id"],
        config_path=str(config_path)
    )

    # 全局变量用于信号处理器
    _bot_instance = bot

    def signal_handler(signum, frame):
        print(f"\n[Signal] Received signal {signum}, is_running={_bot_instance.is_running}")
        _bot_instance.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    print("[Main] Starting bot...")
    bot.run()


if __name__ == "__main__":
    main()
