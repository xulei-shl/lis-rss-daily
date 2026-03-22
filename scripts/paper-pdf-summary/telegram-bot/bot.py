#!/usr/bin/env python3
"""
Telegram Bot for Paper PDF Summary API
Handles /start, /help, and /papers commands
"""

import asyncio
import logging
import os
import re
import sys
from pathlib import Path
from typing import Optional, Tuple

import httpx
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)


class PaperTelegramBot:
    def __init__(self):
        self.bot_token = os.environ.get('TELEGRAM_BOT_TOKEN')
        if not self.bot_token:
            raise ValueError("环境变量 TELEGRAM_BOT_TOKEN 未设置")

        self.allowed_user_id = os.environ.get('TELEGRAM_USER_ID')
        self.api_base_url = os.environ.get('TELEGRAM_API_URL', 'http://localhost:8081')
        self.api_timeout = int(os.environ.get('TELEGRAM_API_TIMEOUT', '300'))
        self.proxy = os.environ.get('HTTP_PROXY') or os.environ.get('HTTPS_PROXY') or os.environ.get('http_proxy') or os.environ.get('https_proxy')

        self._is_processing = False

    def _check_user(self, update: Update) -> bool:
        if not self.allowed_user_id:
            return True
        return str(update.effective_user.id) == self.allowed_user_id

    async def start_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not self._check_user(update):
            await update.message.reply_text("❌ 无权限访问")
            return

        await update.message.reply_text(
            "📚 论文PDF摘要机器人\n\n"
            "欢迎使用！发送 /help 查看使用方法"
        )

    async def help_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not self._check_user(update):
            await update.message.reply_text("❌ 无权限访问")
            return

        await update.message.reply_text(
            "📖 使用帮助\n\n"
            "命令：/papers <标题> [@ID]\n\n"
            "示例：\n"
            "• /papers Attention Is All You Need\n"
            "• /papers Attention Is All You Need @123\n\n"
            "说明：\n"
            "• <标题> - 论文标题（必填）\n"
            "• @ID - LIS-RSS系统ID（可选）\n"
            "• 同时只能处理一个任务"
        )

    async def papers_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not self._check_user(update):
            await update.message.reply_text("❌ 无权限访问")
            return

        if self._is_processing:
            await update.message.reply_text("⏳ 正在处理上一个任务，请稍后再试")
            return

        args = context.args
        if not args:
            await update.message.reply_text(
                "请提供论文标题\n"
                "示例：/papers Attention Is All You Need"
            )
            return

        full_text = " ".join(args)
        title, article_id = self._parse_command(full_text)

        if not title:
            await update.message.reply_text(
                "无法解析标题，请检查格式\n"
                "示例：/papers Attention Is All You Need"
            )
            return

        self._is_processing = True

        try:
            await update.message.reply_text(f"📥 开始处理: {title}\n⏳ 等待结果中...")

            result = await self._call_api(title, article_id)

            response_text = self._format_response(title, result)
            await update.message.reply_text(response_text, parse_mode='Markdown')

        except Exception as e:
            logger.error(f"处理异常: {e}")
            await update.message.reply_text(f"❌ 处理异常: {e}")

        finally:
            self._is_processing = False

    def _parse_command(self, text: str) -> Tuple[Optional[str], Optional[int]]:
        text = text.strip()

        if '@' in text:
            parts = text.rsplit('@', 1)
            title = parts[0].strip()
            try:
                article_id = int(parts[1].strip())
            except ValueError:
                article_id = None
        else:
            title = text
            article_id = None

        return title if title else None, article_id

    async def _call_api(self, title: str, article_id: Optional[int]) -> dict:
        payload = {"title": title}
        if article_id:
            payload["id"] = article_id

        proxies = {"http://": self.proxy, "https://": self.proxy} if self.proxy else None
        async with httpx.AsyncClient(proxies=proxies, timeout=self.api_timeout) as client:
            response = await client.post(
                f"{self.api_base_url}/process",
                json=payload
            )
            response.raise_for_status()
            return response.json()

    def _format_response(self, title: str, result: dict) -> str:
        success = result.get('success', False)
        stages = result.get('stages', {})
        reason = result.get('reason')
        md_path = result.get('md_path')

        lines = []
        lines.append("📄 论文处理结果\n")
        lines.append(f"标题: {title}\n")

        if success:
            lines.append("\n✅ 成功\n")

            pdf_download = stages.get('pdf_download', '❓')
            pdf_validate = stages.get('pdf_validate', '❓')
            pdf_summary = stages.get('pdf_summary', '❓')

            lines.append(f"📥 PDF下载: {'✅' if pdf_download == 'success' else '❌'}")
            lines.append(f"📋 PDF验证: {'✅' if pdf_validate == 'success' else '❌'}")
            lines.append(f"📝 摘要生成: {'✅' if pdf_summary == 'success' else '❌'}")

            upload = stages.get('upload', {})
            if upload:
                lines.append("\n📤 上传:")
                lines.append(f"   • HiAgent RAG: {'✅' if upload.get('hiagent_rag') else '❌'}")
                lines.append(f"   • LIS-RSS: {'✅' if upload.get('lis_rss') else '❌'}")
                lines.append(f"   • Memos: {'✅' if upload.get('memos') else '❌'}")
                lines.append(f"   • 企业微信: {'✅' if upload.get('wechat') else '❌'}")

            if md_path:
                lines.append(f"\n📁 摘要文件: `{md_path}`")
        else:
            lines.append("\n❌ 失败\n")
            if reason:
                lines.append(reason)

        return "\n".join(lines)

    async def error_handler(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        logger.error(f"错误: {context.error}")
        if update and update.effective_message:
            await update.effective_message.reply_text("❌ 发生错误，请稍后重试")

    def run(self):
        application = Application.builder().token(self.bot_token).build()

        application.add_handler(CommandHandler("start", self.start_command))
        application.add_handler(CommandHandler("help", self.help_command))
        application.add_handler(CommandHandler("papers", self.papers_command))
        application.add_handler(CommandHandler("help", self.help_command))

        application.add_error_handler(self.error_handler)

        logger.info("启动 Telegram Bot...")
        application.run_polling(allowed_updates=Update.ALL_TYPES)


def main():
    import argparse

    parser = argparse.ArgumentParser(description='论文PDF摘要 Telegram Bot')
    parser.add_argument('-c', '--config', default=None, help='配置文件路径')

    args = parser.parse_args()

    bot = PaperTelegramBot(config_path=args.config)
    bot.run()


if __name__ == '__main__':
    main()