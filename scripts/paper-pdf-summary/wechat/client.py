#!/usr/bin/env python3
"""
企业微信 Webhook Client

功能：
1. 发送 Markdown 消息（自动拆分超长消息）
2. 发送文本消息
3. 测试连接
"""

import asyncio
from typing import Dict, Optional, List

# aiohttp 可能在某些环境中不可用（比如直接运行脚本时）
# 在这种情况下 WeChat 功能将不可用
WECHAT_ENABLED = True
try:
    import aiohttp
except ImportError:
    aiohttp = None
    WECHAT_ENABLED = False


class WeChatClient:
    """企业微信 Webhook 客户端"""

    MAX_MESSAGE_LENGTH = 4096  # 企业微信 Markdown 消息最大字节数（UTF-8）

    def __init__(
        self,
        webhook_url: str,
        timeout: int = 30,
        max_retries: int = 2
    ):
        """
        初始化客户端

        Args:
            webhook_url: 企业微信 Webhook URL
            timeout: 请求超时时间（秒）
            max_retries: 最大重试次数
        """
        if aiohttp is None:
            raise ImportError("aiohttp 未安装，请运行: pip install aiohttp")

        self.webhook_url = webhook_url
        self.timeout = timeout
        self.max_retries = max_retries

    @staticmethod
    def get_byte_length(text: str) -> int:
        """
        计算 UTF-8 字节长度

        Args:
            text: 待计算的字符串

        Returns:
            UTF-8 字节数
        """
        return len(text.encode('utf-8'))

    def smart_truncate(
        self,
        text: str,
        max_bytes: int
    ) -> Dict[str, str]:
        """
        在合适的位置截断字符串（避免在 Markdown 标记中间截断）

        Args:
            text: 原始文本
            max_bytes: 最大字节数

        Returns:
            {'truncated': 截断后的部分, 'remaining': 剩余部分}
        """
        total_bytes = self.get_byte_length(text)

        if total_bytes <= max_bytes:
            return {'truncated': text, 'remaining': ''}

        # 二分查找找到最大安全截断点
        low, high = 0, len(text)
        best_len = 0

        while low <= high:
            mid = (low + high) // 2
            sliced = text[:mid]
            bytes_len = self.get_byte_length(sliced)

            if bytes_len <= max_bytes:
                best_len = mid
                low = mid + 1
            else:
                high = mid - 1

        # 尝试在换行、标点符号或空格处截断
        truncate_len = best_len
        slice_part = text[:best_len]

        # 优先在换行处截断
        last_newline = slice_part.rfind('\n')
        if last_newline > best_len * 0.5:
            truncate_len = last_newline + 1
        else:
            # 其次在句号、感叹号等标点处
            last_punc = max(
                slice_part.rfind('。'),
                slice_part.rfind('！'),
                slice_part.rfind('？'),
                slice_part.rfind('. '),
                slice_part.rfind('! '),
                slice_part.rfind('? ')
            )
            if last_punc > best_len * 0.5:
                truncate_len = last_punc + 1
            else:
                # 最后在空格处
                last_space = slice_part.rfind(' ')
                if last_space > best_len * 0.7:
                    truncate_len = last_space + 1

        return {
            'truncated': text[:truncate_len],
            'remaining': text[truncate_len:]
        }

    def split_message(self, content: str, max_bytes: int) -> List[str]:
        """
        将长消息拆分为多条消息

        Args:
            content: 原始内容
            max_bytes: 每条消息的最大字节数

        Returns:
            消息块列表
        """
        chunks = []
        remaining = content
        loop_count = 0
        max_loops = len(content)

        while remaining and loop_count < max_loops:
            loop_count += 1

            result = self.smart_truncate(remaining, max_bytes)
            truncated = result['truncated']
            new_remaining = result['remaining']

            if truncated.strip():
                chunks.append(truncated)

            if new_remaining == remaining:
                # 无法截断，强制截断
                force_bytes = remaining.encode('utf-8')
                truncate_bytes = 1
                while truncate_bytes < len(force_bytes) and \
                      truncate_bytes < max_bytes:
                    if remaining[:truncate_bytes + 1].encode('utf-8') <= max_bytes:
                        truncate_bytes += 1
                    else:
                        break

                force_chunk = remaining[:truncate_bytes]
                if force_chunk.strip():
                    chunks.append(force_chunk)
                remaining = remaining[truncate_bytes:]
            else:
                remaining = new_remaining

        return chunks

    async def _api_request(
        self,
        message: Dict,
        session: aiohttp.ClientSession
    ) -> Dict:
        """
        发送 HTTP 请求到企业微信

        Args:
            message: 消息字典
            session: aiohttp 会话

        Returns:
            API 响应字典
        """
        for attempt in range(self.max_retries + 1):
            try:
                print(f"[WeChat] 发送请求 (尝试 {attempt + 1}/{self.max_retries + 1})")

                async with session.post(
                    self.webhook_url,
                    json=message,
                    timeout=aiohttp.ClientTimeout(total=self.timeout)
                ) as response:
                    data = await response.json()

                    if data.get('errcode') == 0:
                        print(f"[WeChat] 请求成功")
                        return data

                    # 处理错误
                    is_retryable = attempt < self.max_retries and data.get('errcode') != 40001
                    if not is_retryable:
                        error_msg = data.get('errmsg', '未知错误')
                        errcode = data.get('errcode')
                        raise Exception(f"WeChat API 错误: {error_msg} (errcode: {errcode})")

                    # 指数退避重试
                    delay = 500 * (2 ** attempt)
                    print(f"[WeChat] 重试中 (延迟 {delay}ms)...")
                    await asyncio.sleep(delay / 1000)

            except asyncio.TimeoutError:
                if attempt >= self.max_retries:
                    raise Exception("WeChat API 请求超时")

                delay = 500 * (2 ** attempt)
                print(f"[WeChat] 起时重试 (延迟 {delay}ms)...")
                await asyncio.sleep(delay / 1000)

            except Exception as e:
                if attempt >= self.max_retries:
                    raise e

                delay = 500 * (2 ** attempt)
                print(f"[WeChat] 请求异常重试 (延迟 {delay}ms): {e}")
                await asyncio.sleep(delay / 1000)

        raise Exception("WeChat API 请求失败")

    async def _send_single_markdown(
        self,
        content: str,
        session: aiohttp.ClientSession
    ) -> bool:
        """
        发送单条 Markdown 消息（不自动拆分）

        Args:
            content: Markdown 内容
            session: aiohttp 会话

        Returns:
            是否成功
        """
        try:
            message = {
                'msgtype': 'markdown',
                'markdown': {'content': content}
            }
            await self._api_request(message, session)
            return True
        except Exception as e:
            print(f"[WeChat] 发送 Markdown 消息失败: {e}")
            return False

    async def send_markdown(self, content: str) -> bool:
        """
        发送 Markdown 消息（自动拆分超长消息）

        Args:
            content: Markdown 内容

        Returns:
            是否全部成功
        """
        byte_length = self.get_byte_length(content)

        if byte_length <= self.MAX_MESSAGE_LENGTH:
            async with aiohttp.ClientSession() as session:
                return await self._send_single_markdown(content, session)

        print(f"[WeChat] 消息过长 ({byte_length} 字节)，开始拆分...")

        # 预留标记空间：**[X/Y]**\n\n 最多约 20 字节
        reserved_space = 20
        initial_chunks = self.split_message(
            content,
            self.MAX_MESSAGE_LENGTH - reserved_space
        )
        print(f"[WeChat] 已拆分为 {len(initial_chunks)} 块")

        all_success = True
        async with aiohttp.ClientSession() as session:
            for i, chunk in enumerate(initial_chunks):
                # 添加序号标记
                marker = f"**[{i + 1}/{len(initial_chunks)}]**\n\n"
                marked_chunk = marker + chunk if len(initial_chunks) > 1 else chunk

                # 再次检查：如果添加标记后仍然超长，需要进一步截断
                if self.get_byte_length(marked_chunk) > self.MAX_MESSAGE_LENGTH:
                    print(f"[WeChat] 块 {i + 1} 仍然过长，进一步截断...")
                    marker_bytes = self.get_byte_length(marker)
                    max_content_bytes = self.MAX_MESSAGE_LENGTH - marker_bytes
                    result = self.smart_truncate(chunk, max_content_bytes)
                    final_chunk = marker + result['truncated']
                else:
                    final_chunk = marked_chunk

                success = await self._send_single_markdown(final_chunk, session)
                if not success:
                    all_success = False
                    print(f"[WeChat] 块 {i + 1} 发送失败")

                # 多条消息之间添加短暂延迟
                if i < len(initial_chunks) - 1:
                    await asyncio.sleep(0.3)

        return all_success

    async def send_text(self, content: str) -> bool:
        """
        发送文本消息

        Args:
            content: 文本内容

        Returns:
            是否成功
        """
        try:
            message = {
                'msgtype': 'text',
                'text': {'content': content}
            }
            async with aiohttp.ClientSession() as session:
                await self._api_request(message, session)
            return True
        except Exception as e:
            print(f"[WeChat] 发送文本消息失败: {e}")
            return False

    async def test_connection(self) -> bool:
        """
        测试连接

        Returns:
            是否成功
        """
        try:
            success = await self.send_text("企业微信通知连接测试成功！")
            if success:
                print("[WeChat] 连接测试成功")
            return success
        except Exception as e:
            print(f"[WeChat] 连接测试失败: {e}")
            return False
