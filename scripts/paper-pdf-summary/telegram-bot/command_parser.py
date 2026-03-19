"""
命令解析器

解析 /papers 命令参数。
"""

import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class PapersCommand:
    """解析后的命令对象"""
    title: str
    article_id: Optional[int] = None
    is_help: bool = False
    is_invalid: bool = False
    error_message: Optional[str] = None


def parse_papers_command(text: str) -> PapersCommand:
    """
    解析 /papers 命令

    支持格式:
    - /papers help
    - /papers <题名>
    - /papers <题名> @<id>
    - /papers <题名>@<id>  (无空格版本)

    Args:
        text: 命令文本

    Returns:
        PapersCommand 对象
    """
    if not text:
        return PapersCommand(
            title="",
            is_invalid=True,
            error_message="命令格式错误"
        )

    text = text.strip()

    if text.lower() == "help":
        return PapersCommand(
            title="",
            is_help=True
        )

    title = text
    article_id = None

    patterns = [
        r"^(.+?)\s+@(\d+)$",
        r"^(.+?)@(\d+)$",
    ]

    for pattern in patterns:
        match = re.match(pattern, text)
        if match:
            title = match.group(1).strip()
            article_id = int(match.group(2))
            break

    if not title:
        return PapersCommand(
            title="",
            is_invalid=True,
            error_message="题名不能为空"
        )

    if len(title) < 3:
        return PapersCommand(
            title=title,
            is_invalid=True,
            error_message="题名太短（至少3个字符）"
        )

    return PapersCommand(
        title=title,
        article_id=article_id
    )


def format_help_text() -> str:
    """
    获取帮助文本

    Returns:
        帮助信息
    """
    return """📚 **论文 PDF 摘要生成命令**

**命令格式:**
```
/papers <论文题名>
/papers <论文题名> @<文章ID>
```

**示例:**
```
/papers 知识图谱研究综述
/papers 基于深度学习的推荐系统 @12345
```

**说明:**
- 直接发送题名：将处理论文，但跳过 LIS-RSS 上传
- 同时指定题名和ID：处理完成后会同步更新到 LIS-RSS 系统
- 处理时间约 5-10 分钟，请耐心等待
- 处理完成后会自动发送摘要内容

**状态查询:**
- 正在处理时发送命令会收到提示
- 可查看日志了解处理进度
"""


def escape_markdown(text: str) -> str:
    """
    转义 Markdown 特殊字符

    Args:
        text: 原始文本

    Returns:
        转义后的文本
    """
    escape_chars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!']
    result = text
    for char in escape_chars:
        result = result.replace(char, f'\\{char}')
    return result
