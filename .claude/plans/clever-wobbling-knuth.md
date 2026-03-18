# 在 paper-pdf-summary 脚本中添加企业微信推送功能

## Context

用户希望在 `/opt/lis-rss-daily/scripts/paper-pdf-summary` 脚本中添加企业微信推送功能。上级目录已有完整的企业微信推送实现（TypeScript），需要将其移植为 Python 版本，并在 PDF 总结成功生成后与三个上传子系统并行执行推送任务。

**需求要点：**
- 新建 `wechat/` 子文件夹存储推送代码
- 在 `config/config.yaml` 添加是否启用和 webhook URL 配置
- MD 文件成功生成后，异步执行 4 个任务：hiagent_rag、lis_rss、memos、wechat
- 不修改上级目录代码，可复制参考或新建

## Implementation Plan

### 1. 创建企业微信推送模块

**新建文件：** `scripts/paper-pdf-summary/wechat/__init__.py`

```python
"""企业微信推送模块"""
from .client import WeChatClient

__all__ = ['WeChatClient']
```

**新建文件：** `scripts/paper-pdf-summary/wechat/client.py`

- 实现 `WeChatClient` 类（参考上级目录 TypeScript 版本）
- 核心方法：
  - `send_markdown(content: str)`: 发送 Markdown 消息，自动拆分超长消息
  - `send_text(content: str)`: 发送文本消息
  - `test_connection()`: 测试连接
- 功能特性：
  - 最大消息长度：4096 字节（UTF-8）
  - 超长消息自动拆分，添加 `[X/Y]` 序号标记
  - 智能截断：在换行、标点处截断，避免破坏 Markdown 格式
  - 超时：30 秒，重试 2 次，指数退避
  - 使用 `aiohttp` 异步 HTTP 客户端

**新建文件：** `scripts/paper-pdf-summary/wechat/message_formatter.py`

- 实现 `MessageFormatter` 类
- 方法：
  - `format_paper_summary()`: 格式化论文摘要推送消息
  - `format_success_notification()`: 格式化成功通知消息（不带摘要）
- 消息格式：
  ```markdown
  ## 论文摘要推送

  **ID**: 1234
  **来源**: 图书情报知识

  ### 论文标题

  论文摘要内容...

  ---
  由论文PDF摘要工作流自动推送
  ```

### 2. 修改配置文件

**文件：** `scripts/paper-pdf-summary/config/config.yaml`

在 `summary_upload` 部分添加 `wechat` 配置：

```yaml
summary_upload:
  hiagent_rag:
    enabled: true
    script: "summary-update/hiagent-rag-upload/upload_knowledge.py"
    delete_md: true
  lis_rss:
    enabled: true
    script: "summary-update/lis-rss-summary-update/update_summary.py"
  memos:
    enabled: true
    script: "summary-update/memos/memos_client.py"
  wechat:
    enabled: true
    webhook_url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=61fecfdc-0702-47a2-9004-696b7e8e16fa"
    timeout: 30
    max_retries: 2
```

**Webhook URL 来源：** 从上级目录 `/opt/lis-rss-daily/config/wechat.yaml` 复制

### 3. 修改 summary_uploader.py

**文件：** `scripts/paper-pdf-summary/utils/summary_uploader.py`

**修改点：**
- 导入新模块：
  ```python
  from wechat.client import WeChatClient
  from wechat.message_formatter import MessageFormatter
  ```

- 新增 `upload_to_wechat()` 异步函数：
  ```python
  async def upload_to_wechat(
      md_content: str,
      article_id: int,
      article_title: str,
      source_name: Optional[str],
      config: Dict
  ) -> bool:
  ```

- 修改 `upload_all()` 函数：
  - 添加 `source_name` 参数
  - 添加第 4 个任务：`upload_to_wechat(...)`
  - 结果字典中新增 `'wechat'` 键
  - 更新汇总显示为 4 个子系统

### 4. 修改 main.py

**文件：** `scripts/paper-pdf-summary/main.py`

**修改点：** 在 `process_article()` 函数中，调用 `parallel_upload()` 时传递 `source_name` 参数：

```python
source_name = article.get('source_name')
upload_results = asyncio.run(parallel_upload(
    md_path=md_path,
    article_id=article_id,
    article_title=title,
    source_name=source_name,
    config=config
))
```

### 5. 安装依赖

```bash
pip install aiohttp
```

## Critical Files

- `/opt/lis-rss-daily/scripts/paper-pdf-summary/wechat/__init__.py` - 新建
- `/opt/lis-rss-daily/scripts/paper-pdf-summary/wechat/client.py` - 新建
- `/opt/lis-rss-daily/scripts/paper-pdf-summary/wechat/message_formatter.py` - 新建
- `/opt/lis-rss-daily/scripts/paper-pdf-summary/config/config.yaml` - 修改（添加 wechat 配置）
- `/opt/lis-rss-daily/scripts/paper-pdf-summary/utils/summary_uploader.py` - 修改（添加 wechat 任务）
- `/opt/lis-rss-daily/scripts/paper-pdf-summary/main.py` - 修改（传递 source_name 参数）

## Verification

1. **测试 WeChat 连接**：运行测试脚本验证 webhook URL 有效
2. **测试长消息拆分**：发送超长摘要验证自动拆分功能
3. **测试完整流程**：运行 `main.py` 验证 4 个子系统并行执行
4. **错误处理测试**：
   - 测试禁用 wechat 时的行为
   - 测试 wechat 失败不影响其他子系统
   - 测试 webhook URL 未配置时的错误处理
