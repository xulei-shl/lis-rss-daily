#!/usr/bin/env python3
"""
企业微信消息格式化工具

功能：
1. 根据文章信息生成 Markdown 格式的推送消息
2. 统一消息格式
3. 长消息由 WeChatClient.send_markdown() 自动拆分
"""

from typing import Dict, Optional


class MessageFormatter:
    """消息格式化器"""

    @staticmethod
    def format_paper_summary(
        title: str,
        summary: str,
        article_id: Optional[int] = None,
        source_name: Optional[str] = None
    ) -> str:
        """
        格式化论文摘要推送消息

        Args:
            title: 论文标题
            summary: 摘要内容
            article_id: 文章ID（可选）
            source_name: 来源名称（可选）

        Returns:
            Markdown 格式消息（完整内容，超长由 WeChatClient.send_markdown() 自动拆分）
        """
        # 构建消息头部
        header_lines = ["## 论文摘要推送", ""]

        if article_id:
            header_lines.append(f"**ID**: {article_id}")

        if source_name:
            header_lines.append(f"**来源**: {source_name}")

        header_lines.append("")

        # 截断标题（避免过长）
        if len(title) > 100:
            title_display = title[:97] + "..."
        else:
            title_display = title

        header_lines.append(f"### {title_display}")
        header_lines.append("")

        header = "\n".join(header_lines)

        # 直接使用完整摘要，由 WeChatClient.send_markdown() 处理超长拆分
        message = f"{header}{summary}\n\n---\n\n由论文PDF摘要工作流自动推送"

        return message

    @staticmethod
    def format_success_notification(
        title: str,
        article_id: int,
        source_name: Optional[str] = None
    ) -> str:
        """
        格式化成功通知消息（不带摘要）

        Args:
            title: 论文标题
            article_id: 文章ID
            source_name: 来源名称（可选）

        Returns:
            Markdown 格式消息
        """
        # 截断标题
        if len(title) > 80:
            title_display = title[:77] + "..."
        else:
            title_display = title

        lines = [
            "## 论文处理成功",
            "",
            f"**ID**: {article_id}",
        ]

        if source_name:
            lines.append(f"**来源**: {source_name}")

        lines.extend([
            "",
            f"**标题**: {title_display}",
            "",
            "论文PDF摘要已生成并上传到各个子系统。",
            "",
            "---",
            "",
            "由论文PDF摘要工作流自动推送"
        ])

        return "\n".join(lines)
