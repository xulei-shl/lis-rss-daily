"""
Telegram API Client

HTTP 客户端封装 Telegram Bot API，支持代理、重试和超时。
"""

import os
import json
import time
from typing import Optional, Dict, Any, List
from dataclasses import dataclass


TELEGRAM_API_BASE = "https://api.telegram.org"
DEFAULT_TIMEOUT = 30
MAX_RETRIES = 3
MAX_MESSAGE_LENGTH = 4096


@dataclass
class TelegramMessage:
    """Telegram 消息"""
    message_id: int
    chat_id: int
    text: str
    date: int


@dataclass
class Update:
    """Telegram 更新"""
    update_id: int
    message: Optional[TelegramMessage] = None
    callback_query: Optional[Dict] = None


class TelegramClient:
    """Telegram Bot API 客户端"""

    def __init__(self, bot_token: str):
        self.bot_token = bot_token
        self.base_url = f"{TELEGRAM_API_BASE}/bot{bot_token}"
        self._session = None

    def _get_proxy(self) -> Optional[str]:
        """获取代理配置"""
        return os.getenv("HTTP_PROXY") or os.getenv("http_proxy")

    def _get_proxy_dict(self) -> Optional[Dict[str, str]]:
        """获取代理字典配置"""
        proxy = self._get_proxy()
        if proxy:
            if proxy.startswith("http://"):
                return {"http": proxy, "https": proxy}
            elif proxy.startswith("socks5://"):
                return {"http": proxy, "https": proxy}
        return None

    def _request(
        self,
        method: str,
        data: Optional[Dict[str, Any]] = None,
        files: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        发送 API 请求

        Args:
            method: API 方法名
            data: 请求参数
            files: 上传文件

        Returns:
            API 响应字典
        """
        url = f"{self.base_url}/{method}"
        proxies = self._get_proxy_dict()

        for attempt in range(MAX_RETRIES):
            try:
                import requests

                kwargs: Dict[str, Any] = {
                    "timeout": DEFAULT_TIMEOUT,
                }
                if proxies:
                    kwargs["proxies"] = proxies

                if files:
                    kwargs["files"] = files
                    if data:
                        kwargs["data"] = data
                else:
                    kwargs["json"] = data

                response = requests.post(url, **kwargs)
                result = response.json()

                if not result.get("ok"):
                    error_code = result.get("error_code")
                    description = result.get("description", "")

                    if error_code == 429:
                        retry_after = result.get("parameters", {}).get("retry_after", 5)
                        print(f"[Telegram] Rate limited, retry after {retry_after}s")
                        time.sleep(retry_after)
                        continue

                    if error_code == 400 and "message is not modified" in description:
                        return result

                    if attempt < MAX_RETRIES - 1:
                        delay = 0.5 * (2 ** attempt)
                        print(f"[Telegram] Error: {description}, retry in {delay}s")
                        time.sleep(delay)
                        continue

                    raise Exception(f"Telegram API error: {description}")

                return result

            except requests.exceptions.Timeout:
                if attempt < MAX_RETRIES - 1:
                    delay = 0.5 * (2 ** attempt)
                    print(f"[Telegram] Timeout, retry in {delay}s")
                    time.sleep(delay)
                    continue
                raise Exception("Telegram API timeout after retries")

            except requests.exceptions.RequestException as e:
                if attempt < MAX_RETRIES - 1:
                    delay = 0.5 * (2 ** attempt)
                    print(f"[Telegram] Network error: {e}, retry in {delay}s")
                    time.sleep(delay)
                    continue
                raise Exception(f"Telegram API request failed: {e}")

        raise Exception("Telegram API request failed after retries")

    def send_message(
        self,
        chat_id: int,
        text: str,
        parse_mode: Optional[str] = None,
        reply_markup: Optional[Dict] = None,
        reply_to_message_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        发送文本消息

        Args:
            chat_id: 聊天 ID
            text: 消息文本
            parse_mode: 解析模式 (Markdown/HTML)
            reply_markup: 内联键盘
            reply_to_message_id: 回复的消息 ID

        Returns:
            发送的消息
        """
        data: Dict[str, Any] = {
            "chat_id": chat_id,
            "text": text,
        }

        if parse_mode:
            data["parse_mode"] = parse_mode

        if reply_markup:
            data["reply_markup"] = reply_markup

        if reply_to_message_id:
            data["reply_to_message_id"] = reply_to_message_id

        return self._request("sendMessage", data)

    def send_document(
        self,
        chat_id: int,
        document_path: str,
        caption: Optional[str] = None,
        parse_mode: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        发送文件

        Args:
            chat_id: 聊天 ID
            document_path: 文件路径
            caption: 文件说明
            parse_mode: 解析模式

        Returns:
            发送的消息
        """
        data: Dict[str, Any] = {"chat_id": chat_id}

        if caption:
            data["caption"] = caption

        if parse_mode:
            data["parse_mode"] = parse_mode

        with open(document_path, "rb") as f:
            files = {"document": f}
            return self._request("sendDocument", data, files)

    def edit_message_reply_markup(
        self,
        chat_id: int,
        message_id: int,
        reply_markup: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        编辑消息的内联键盘

        Args:
            chat_id: 聊天 ID
            message_id: 消息 ID
            reply_markup: 新的内联键盘

        Returns:
            API 响应
        """
        data: Dict[str, Any] = {
            "chat_id": chat_id,
            "message_id": message_id,
        }

        if reply_markup is not None:
            data["reply_markup"] = reply_markup
        else:
            data["reply_markup"] = {"inline_keyboard": []}

        return self._request("editMessageReplyMarkup", data)

    def answer_callback_query(
        self,
        callback_query_id: str,
        text: Optional[str] = None,
        show_alert: bool = False
    ) -> Dict[str, Any]:
        """
        回答回调查询

        Args:
            callback_query_id: 回调查询 ID
            text: 通知文本
            show_alert: 是否显示为弹窗

        Returns:
            API 响应
        """
        data: Dict[str, Any] = {
            "callback_query_id": callback_query_id,
        }

        if text:
            data["text"] = text
            data["show_alert"] = show_alert

        return self._request("answerCallbackQuery", data)

    def get_updates(
        self,
        offset: Optional[int] = None,
        limit: int = 100,
        timeout: int = 30
    ) -> Dict[str, Any]:
        """
        获取更新（长轮询）

        Args:
            offset: 偏移量
            limit: 限制数量
            timeout: 超时秒数

        Returns:
            更新列表响应
        """
        data: Dict[str, Any] = {
            "limit": min(limit, 100),
            "timeout": max(timeout, 0),
        }

        if offset is not None:
            data["offset"] = offset

        return self._request("getUpdates", data)

    def get_me(self) -> Dict[str, Any]:
        """获取机器人信息"""
        return self._request("getMe")

    def split_message(self, text: str, max_length: int = MAX_MESSAGE_LENGTH) -> List[str]:
        """
        分割长消息

        Args:
            text: 原始文本
            max_length: 最大长度

        Returns:
            分割后的消息列表
        """
        if len(text) <= max_length:
            return [text]

        parts = []
        lines = text.split("\n")
        current = ""
        current_length = 0

        for line in lines:
            line_length = len(line) + 1

            if current_length + line_length > max_length:
                if current:
                    parts.append(current)
                current = line + "\n"
                current_length = line_length
            else:
                current += line + "\n"
                current_length += line_length

        if current:
            parts.append(current)

        return parts

    def send_long_message(
        self,
        chat_id: int,
        text: str,
        parse_mode: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        发送长消息（自动分割）

        Args:
            chat_id: 聊天 ID
            text: 消息文本
            parse_mode: 解析模式

        Returns:
            发送的消息列表
        """
        parts = self.split_message(text)
        results = []

        for i, part in enumerate(parts):
            if len(parts) > 1:
                part = f"[{i+1}/{len(parts)}]\n\n{part}"

            result = self.send_message(chat_id, part, parse_mode)
            results.append(result)

            if i < len(parts) - 1:
                time.sleep(0.5)

        return results
