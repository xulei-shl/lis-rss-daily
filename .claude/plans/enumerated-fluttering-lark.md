# 优化微信推送长消息处理

## 背景

当前论文PDF摘要工作流的微信推送功能存在以下问题：

- `wechat/client.py` 已经实现了完整的长消息自动拆分功能（`send_markdown()` 方法支持超过 4096 字节时自动分多条发送）
- 但 `wechat/message_formatter.py` 中的 `format_paper_summary()` 方法在发送前就简单截断摘要到 3500 字节
- 这导致拆分功能无法发挥作用，长摘要只能保留部分内容

## 优化方案

修改 `wechat/message_formatter.py` 的 `format_paper_summary()` 方法，移除截断逻辑，返回完整内容，让 `client.send_markdown()` 来处理超长消息的拆分。

### 修改文件

**文件**: `scripts/paper-pdf-summary/wechat/message_formatter.py`

**修改内容**：
- 移除 `max_length` 参数（不再需要）
- 移除摘要截断相关代码（第 60-74 行）
- 直接使用完整的摘要内容构建消息

### 修改前后对比

**修改前**：
```python
def format_paper_summary(
    title: str,
    summary: str,
    article_id: Optional[int] = None,
    source_name: Optional[str] = None,
    max_length: int = 3500  # 预留空间给标题和其他内容
) -> str:
    # ... 省略头部构建代码 ...

    # 计算可用空间
    header_bytes = len(header.encode('utf-8'))
    available_bytes = max_length - header_bytes

    # 截断摘要以适应字节限制
    summary_bytes = len(summary.encode('utf-8'))

    if summary_bytes <= available_bytes:
        summary_display = summary
    else:
        # 按比例截断
        ratio = available_bytes / summary_bytes
        truncate_chars = int(len(summary) * ratio * 0.95)
        summary_display = summary[:truncate_chars] + "\n\n... (内容过长已截断)"

    message = f"{header}{summary_display}\n\n---\n\n由论文PDF摘要工作流自动推送"
    return message
```

**修改后**：
```python
def format_paper_summary(
    title: str,
    summary: str,
    article_id: Optional[int] = None,
    source_name: Optional[str] = None
) -> str:
    # ... 省略头部构建代码 ...

    # 直接使用完整摘要，由 WeChatClient.send_markdown() 处理超长拆分
    message = f"{header}{summary}\n\n---\n\n由论文PDF摘要工作流自动推送"
    return message
```

## 验证方法

1. 运行论文PDF摘要工作流，生成一个摘要内容较长的论文
2. 查看企业微信推送消息，确认：
   - 短摘要仍然正常发送（单条消息）
   - 长摘要自动拆分成多条发送，每条消息前面有 `[1/2]`, `[2/2]` 等序号标记
   - 内容完整，没有被截断

## 关键依赖

- `wechat/client.py` 的 `send_markdown()` 方法已正确实现自动拆分功能
- 拆分功能会在每条消息前添加 `**[X/Y]**` 标记
- 拆分时使用 `smart_truncate()` 确保在合适位置截断（换行、标点符号处）
