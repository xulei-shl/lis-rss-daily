"""
Telegram Bot 主模块

处理消息、命令解析、工作流执行。
"""

import os
import sys
import asyncio
import time
import threading
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime

bot_dir = Path(__file__).parent
project_root = bot_dir.parent
sys.path.insert(0, str(project_root))
sys.path.insert(0, str(bot_dir))

from client import TelegramClient
from state import StateManager, ProcessingLock
from command_parser import parse_papers_command, format_help_text
from workflow import Workflow, load_config, WorkflowResult, WorkflowProgress


class TelegramBot:
    """Telegram Bot"""

    POLL_TIMEOUT = 30
    POLL_LIMIT = 100
    IDLE_INTERVAL = 10
    ACTIVE_INTERVAL = 1
    IDLE_THRESHOLD = 300
    MESSAGE_INTERVAL = 1.0
    PROGRESS_INTERVAL = 45

    def __init__(
        self,
        bot_token: str,
        user_id: int,
        chat_id: int,
        config_path: str = "config/config.yaml"
    ):
        self.client = TelegramClient(bot_token)
        self.user_id = user_id
        self.chat_id = chat_id
        self.state_manager = StateManager(user_id)
        self.processing_lock = ProcessingLock()

        self.config = load_config(config_path)
        self.workflow = Workflow(self.config)

        self.is_running = False
        self.latest_update_id = 0
        self.last_activity_time = time.time()
        self.poll_thread: Optional[threading.Thread] = None
        self._last_message_time = 0.0

    def _verify_bot(self) -> bool:
        """验证 Bot Token"""
        try:
            result = self.client.get_me()
            if result.get("ok"):
                bot_info = result.get("result", {})
                print(f"[Bot] Logged in as @{bot_info.get('username')}")
                return True
            return False
        except Exception as e:
            print(f"[Bot] Failed to verify bot: {e}")
            return False

    def _send_typing(self):
        """发送正在输入状态"""
        try:
            pass
        except Exception:
            pass

    async def handle_command(self, text: str) -> bool:
        """
        处理命令

        Args:
            text: 命令文本

        Returns:
            是否处理成功
        """
        if not text.startswith("/"):
            return False

        parts = text.strip().split(None, 1)
        command = parts[0].lower()
        args = parts[1] if len(parts) > 1 else ""

        if command == "/papers":
            await self.handle_papers_command(args)
            return True

        if command == "/start":
            await self._send_message(
                "🤖 论文 PDF 摘要生成 Bot\n\n"
                "使用 /papers help 查看帮助"
            )
            return True

        return False

    async def handle_papers_command(self, args: str):
        """处理 /papers 命令"""
        parsed = parse_papers_command(args)

        if parsed.is_help:
            await self._send_message(format_help_text())
            return

        if parsed.is_invalid:
            await self._send_message(
                f"❌ {parsed.error_message}\n\n"
                f"使用 /papers help 查看帮助"
            )
            return

        if self.processing_lock.is_locked():
            lock_info = self.processing_lock.get_lock_info()
            locked_at = lock_info.get("locked_at", "") if lock_info else ""
            await self._send_message(
                "⏳ 正在处理中，请稍候...\n\n"
                f"上一次处理开始时间: {locked_at}"
            )
            return

        if not self.processing_lock.acquire():
            await self._send_message("❌ 无法获取处理锁，请稍后重试")
            return

        try:
            title = parsed.title
            article_id = parsed.article_id

            status_text = "📥 收到处理请求\n\n"
            status_text += f"**标题**: {title}\n"
            status_text += f"**文章ID**: {article_id if article_id else '未指定（跳过LIS-RSS上传）'}\n\n"
            status_text += "⏳ 正在开始处理...\n\n"
            status_text += "_此过程约需 5-10 分钟_\n"
            status_text += "_PDF下载、验证、摘要生成，进度会实时通知_"

            await self._send_message(status_text)

            result = await self._run_workflow_with_progress(title, article_id)

            if result.success:
                await self._handle_success(result)
            else:
                await self._handle_error(result, title)

        finally:
            self.processing_lock.release()

    async def _run_workflow_with_progress(self, title: str, article_id: Optional[int]) -> WorkflowResult:
        """运行工作流并发送进度通知"""
        last_progress_message = ""
        last_progress_time = time.time()

        def progress_callback(progress: WorkflowProgress):
            nonlocal last_progress_message, last_progress_time
            current_time = time.time()

            if progress.message != last_progress_message and current_time - last_progress_time >= self.PROGRESS_INTERVAL:
                last_progress_message = progress.message
                last_progress_time = current_time
                asyncio.create_task(self._send_progress_message(progress.stage, progress.message))

        result = await self.workflow.run(title, article_id, skip_wechat=True, progress_callback=progress_callback)
        return result

    async def _send_progress_message(self, stage: str, message: str):
        """发送进度消息"""
        try:
            self.client.send_message(self.chat_id, f"⏳ **{stage}**: {message}", "Markdown")
            self.last_activity_time = time.time()
        except Exception as e:
            print(f"[Bot] Failed to send progress message: {e}")

    async def _handle_success(self, result: WorkflowResult):
        """处理成功"""
        if result.md_content:
            await self._send_message("✅ 处理完成！正在发送摘要...")

            max_length = 4000
            if len(result.md_content) > max_length:
                await self._send_long_message(result.md_content)
            else:
                header = f"📄 **摘要内容**\n\n"
                await self._send_message(header + result.md_content)

            await self._send_message(
                f"✅ **处理完成**\n\n"
                f"_摘要已生成并发送_"
            )
        else:
            await self._send_message("✅ 处理完成，但未生成摘要内容")

    async def _handle_error(self, result: WorkflowResult, title: str):
        """处理错误"""
        error_msg = result.error or "未知错误"

        log_error = self.workflow.get_error_from_log(title)
        if log_error:
            error_msg = log_error

        error_text = (
            f"❌ **处理失败**\n\n"
            f"**错误信息**: {error_msg}\n\n"
            f"_请检查日志获取详细信息_"
        )

        await self._send_message(error_text)

    async def _send_message(self, text: str, parse_mode: str = "Markdown"):
        """发送消息"""
        try:
            current_time = time.time()
            time_since_last = current_time - self._last_message_time
            if time_since_last < self.MESSAGE_INTERVAL:
                await asyncio.sleep(self.MESSAGE_INTERVAL - time_since_last)

            self.client.send_message(self.chat_id, text, parse_mode)
            self._last_message_time = time.time()
            self.last_activity_time = time.time()
        except Exception as e:
            print(f"[Bot] Failed to send message: {e}")

    async def _send_long_message(self, text: str, parse_mode: str = "Markdown"):
        """发送长消息（自动分割）"""
        try:
            parts = self.client.split_message(text)
            current_time = time.time()

            for i, part in enumerate(parts):
                time_since_last = current_time - self._last_message_time
                if time_since_last < self.MESSAGE_INTERVAL:
                    await asyncio.sleep(self.MESSAGE_INTERVAL - time_since_last)

                if len(parts) > 1:
                    part = f"[{i+1}/{len(parts)}]\n\n{part}"

                self.client.send_message(self.chat_id, part, parse_mode)
                self._last_message_time = time.time()
                current_time = self._last_message_time
                self.last_activity_time = time.time()

        except Exception as e:
            print(f"[Bot] Failed to send long message: {e}")

    def _poll(self):
        """轮询循环（在线程中运行）"""
        asyncio.run(self._poll_async())

    async def _poll_async(self):
        """异步轮询"""
        offset = self.state_manager.get_latest_update_id()

        while self.is_running:
            try:
                response = self.client.get_updates(
                    offset=offset if offset > 0 else None,
                    limit=self.POLL_LIMIT,
                    timeout=self.POLL_TIMEOUT
                )

                if not response.get("ok"):
                    await asyncio.sleep(self.IDLE_INTERVAL)
                    continue

                updates = response.get("result", [])

                if updates:
                    for update in updates:
                        update_id = update.get("update_id", 0)
                        message = update.get("message")

                        if message:
                            chat_id = message.get("chat", {}).get("id")
                            text = message.get("text", "")

                        if chat_id == self.chat_id:
                            await self.handle_command(text)

                        offset = update_id + 1

                    self.state_manager.set_latest_update_id(offset)

                time_since_activity = time.time() - self.last_activity_time
                interval = (
                    self.IDLE_INTERVAL if time_since_activity > self.IDLE_THRESHOLD
                    else self.ACTIVE_INTERVAL
                )

                await asyncio.sleep(interval)

            except Exception as e:
                print(f"[Bot] Poll error: {e}")
                await asyncio.sleep(5)

    def start(self) -> bool:
        """启动 Bot"""
        if self.is_running:
            print("[Bot] Already running")
            return False

        if not self._verify_bot():
            print("[Bot] Bot verification failed")
            return False

        self.is_running = True
        self.last_activity_time = time.time()

        self.poll_thread = threading.Thread(target=self._poll, daemon=True)
        self.poll_thread.start()

        print(f"[Bot] Started, polling for updates...")
        return True

    def stop(self):
        """停止 Bot"""
        if not self.is_running:
            return

        self.is_running = False

        if self.poll_thread:
            self.poll_thread.join(timeout=5)

        print("[Bot] Stopped")

    def run(self):
        """运行 Bot（阻塞）"""
        if not self.start():
            return

        print("[Bot] Press Ctrl+C to stop")

        try:
            while self.is_running:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n[Bot] Shutting down...")
            self.stop()
