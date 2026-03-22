#!/bin/bash
# Telegram Bot 启动脚本

cd "$(dirname "$0")"

if [ ! -f .env ]; then
    echo "错误: .env 文件不存在"
    exit 1
fi

source .env

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
    echo "错误: TELEGRAM_BOT_TOKEN 未设置"
    exit 1
fi

echo "启动 Telegram Bot..."
nohup python -m telegram_bot.main > logs/telegram_bot.log 2>&1 &
echo "Bot 已启动 (PID: $!)"