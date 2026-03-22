# 论文 PDF 摘要工作流

自动化论文 PDF 下载、AI 总结和多系统分发的完整工作流系统。

## 功能特性

- **多 PDF 源下载**：支持智社科、万方、CNKI 等多个数据库
- **智能 PDF 验证**：自动验证下载的 PDF 文件名与文章标题匹配
- **AI 摘要生成**：通过 HiAgent 自动生成论文摘要（Markdown 格式）
- **多系统并行上传**：同时上传到摘要到 HiAgent RAG、LIS-RSS、Memos
- **企业微信推送**：自动推送论文摘要到企业微信群
- **每日处理报告**：生成详细的每日处理结果报告
- **断点恢复机制**：支持中断后恢复处理

## 项目结构

```
paper-pdf-summary/
├── config/                    # 配置文件目录
│   ├── config.yaml           # 主配置文件
│   └── journals_list.yaml    # 期刊白名单
├── pdf-download/               # PDF 下载脚本
│   ├── zhesheke_pdf_download.py
│   ├── wanfang_pdf_download.py
│   └── cnki_pdf_download.py
├── pdf-summary/              # PDF 总结脚本
│   └── hiagent_upload.py
├── summary-update/            # 上传脚本
│   ├── hiagent-rag-upload/
│   ├── lis-rss-summary-update/
│   └── memos/
├── wechat/                   # 企业微信推送模块
│   ├── client.py             # WeChat 客户端
│   └── message_formatter.py   # 消息格式化器
├── telegram-bot/           # Telegram Bot 模块 (Node.js)
│   ├── index.ts            # Bot 核心逻辑
│   ├── logger.ts           # 日志模块
│   ├── package.json        # 依赖配置
│   └── tsconfig.json       # TypeScript 配置
├── utils/                    # 工具模块
│   ├── database.py          # 数据库操作
│   ├── pdf_downloader.py     # PDF 下载器
│   ├── pdf_validator.py     # PDF 验证器
│   ├── pdf_summarizer.py   # PDF 总结器
│   ├── summary_uploader.py  # 并行上传器
│   └── logger.py           # 日志记录器
├── download/                  # 下载文件存储目录
├── logs/                     # 每日日志目录
├── docs/
├── deploy/                   # 部署配置文件
│   └── paper-pdf-summary-telegram.service  # systemd 服务配置
├── main.py                   # 主入口脚本
├── start_telegram_bot.sh     # Telegram Bot 启动脚本
├── .env.example              # 环境变量模板
└── README.md                 # 本文档
```

## 安装

### 1. 克隆项目

```bash
cd /opt/lis-rss-daily/scripts/paper-pdf-summary
```

### 2. 配置环境变量

复制环境变量模板并填写实际值：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置以下以下服务：

#### Memos 配置
```env
MEMOS_BASE_URL=https://your-memos-instance.com
MEMOS_ACCESS_TOKEN=memos_pat_your_token_here
```

#### LIS-RSS 配置
```env
LIS_RSS_API_URL=https://your-lis-rss.com
LIS_RSS_USERNAME=your_username
LIS_RSS_PASSWORD=your_password
```

#### HiAgent RAG 知识库配置
```env
WorkspaceType=personal
WorkspaceID=your_workspace_id
DatasetID=your_knowledge_id
```

#### HiAgent PDF 总结配置
```env
HIAGENT_PDF_URL=https://your-hiagent-pdf-url.com
```

#### 企业微信推送配置
```env
WECHAT_WEBHOOK_KEY=your_wechat_webhook_key_here
```

### 3. 配置虚拟环境

```bash
# 使用已有的虚拟环境
export PYTHONPATH=/home/xulei/.pyenvs/env_camoufox/bin/python
```

### 4. 安装依赖

```bash
# 安装 Camoufox（如需要需要的）
pip install camoufox[geoip]

# 安装 Playwright 浏览器
playwright install chromium

# 安装企业微信推送依赖
pip install aiohttp
```

## 配置说明

### config.yaml

主配置文件包含以下部分：

#### 数据库配置
```yaml
database:
  path: "/opt/lis-rss-daily/data/rss-tracker.db"
```

#### 处理限制
```yaml
daily_process_limit: 1  # 每日最多处理的文章数量
```

#### PDF 下载配置
```yaml
pdf_download:
  priority_scripts:          # 下载脚本优先级
    - "pdf-download/zhesheke_pdf_download.py"
    - "pdf-download/wanfang_pdf_download.py"
    - "pdf-download/cnki_pdf_download.py"
  max_retries: 1            # 每个脚本最大重试次数
  match_threshold: 0          # PDF 文件名匹配阈值（0=完全匹配）
```

#### PDF 总结配置
```yaml
pdf_summary:
  script: "pdf-summary/hiagent_upload.py"
  delete_pdf: true            # 总结后是否删除原 PDF
```

#### 上传配置
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
    # webhook_url 通过环境变量 WECHAT_WEBHOOK_KEY 自动组装
    timeout: 30
    max_retries: 2
```

##### 企业微信推送配置说明
- `enabled`: 是否启用企业微信推送
- `webhook_url`: 通过 `.env` 文件中的 `WECHAT_WEBHOOK_KEY` 环境变量自动组装
- `timeout`: 请求超时时间（秒）
- `max_retries`: 失败重试次数

**环境变量配置**：在 `.env` 文件中添加：
```env
WECHAT_WEBHOOK_KEY=your_wechat_webhook_key_here
```

**消息格式**：自动生成 Markdown 格式的推送消息，包含论文 ID、来源、标题和摘要内容。超长消息会自动拆分为多条发送。

## 使用方法

### 完整工作流（数据库模式）

```bash
# 使用 xulei 用户运行（推荐）
sudo -u xulei bash -c "cd /opt/lis-rss-daily/scripts/paper-pdf-summary && /home/xulei/.pyenvs/env_camoufox/bin/python main.py"
```

### 直接处理指定论文

跳过数据库查询，直接处理指定的论文。

```bash
# 带文章ID：包含 LIS-RSS API 调用
sudo -u xulei bash -c "cd /opt/lis-rss-daily/scripts/paper-pdf-summary && /home/xulei/.pyenvs/env_camoufox/bin/python main.py --title '论文题名' --id 1984"

# 不带文章ID：跳过 LIS-RSS API 调用
sudo -u xulei bash -c "cd /opt/lis-rss-daily/scripts/paper-pdf-summary && /home/xulei/.pyenvs/env_camoufox/bin/python main.py --title '论文题名'"
```

```bash
# ssh远程使用时
# 带文章ID：包含 LIS-RSS API 调用
sudo -u xulei bash -c "cd /opt/lis-rss-daily/scripts/paper-pdf-summary && xvfb-run -a /home/xulei/.pyenvs/env_camoufox/bin/python main.py --title '论文题名' --id 1984"

# 不带文章ID：跳过 LIS-RSS API 调用
sudo -u xulei bash -c "cd /opt/lis-rss-daily/scripts/paper-pdf-summary && xvfb-run -a /home/xulei/.pyenvs/env_camoufox/bin/python main.py --title '论文题名'"
```

**参数说明**：
- `--title`：论文题名（PDF 下载检索词，必需）
- `--id`：文章 ID（可选）
  - 提供 ID：执行完整流程，包含 LIS-RSS API 调用
  - 不提供 ID：跳过 LIS-RSS API 调用，只执行 HiAgent RAG、Memos、微信推送
- `--skip-wechat`：跳过企业微信推送（默认 false）

### 定时任务配置

系统已配置为每天早上 7:00 自动执行脚本，使用 xulei 用户的 crontab。

**当前配置：**
- 执行时间：每天早上 7:00
- 执行用户：xulei
- 虚拟环境：`/home/xulei/.pyenvs/env_camoufox/bin/python`
- 脚本：`main.py`
- 日志：`/opt/lis-rss-daily/scripts/paper-pdf-summary/logs/cron.log`

**Crontab 条目：**
```cron
0 7 * * * cd /opt/lis-rss-daily/scripts/paper-pdf-summary && /home/xulei/.pyenvs/env_camoufox/bin/python main.py >> /opt/lis-rss-daily/scripts/paper-pdf-summary/logs/cron.log 2>&1
```

**常用操作：**
```bash
# 查定时任务
sudo -u xulei crontab -l

# 编辑定时任务
sudo -u xulei crontab -e

# 删除定时任务（小心！）
sudo -u xulei crontab -r

# 查看执行日志
tail -f /opt/lis-rss-daily/scripts/paper-pdf-summary/logs/cron.log
```

### 处理流程

工作流自动执行以下步骤：

1. **获取待处理数据**：从数据库查询符合期刊白名单的待处理文章
2. **PDF 下载**：按优先级尝试多个下载源
3. **PDF 验证**：验证文件名与文章标题匹配
4. **AI 总结**：调用 HiAgent 生成 Markdown 格式摘要
5. **并行上传**：同时上传到四个子系统
   - HiAgent RAG 知识库
   - LIS-RSS 系统（更新 ai_summary 字段）
   - Memos（创建论文笔记）
   - 企业微信（推送论文摘要）
6. **生成报告**：生成每日处理报告

### 运行模式对比

| 模式 | 触发方式 | 步骤1-3 | 步骤4上传 | WeChat推送 | 适用场景 |
|------|---------|--------|-----------|-----------|---------|
| **数据库模式** | cron定时任务 | ✅ | ✅ 完整 | ✅ | 每日自动处理 |
| **命令行模式** | 直接运行 `main.py --title xxx` | ✅ | ✅ 完整 | ✅ | 手动单篇处理 |

**说明**：
- 步骤1-3：PDF下载 → PDF验证 → AI总结
- 步骤4：上传到 HiAgent RAG、LIS-RSS、Memos、WeChat

## 日志和报告

### 每日日志

日志文件保存在 `logs/` 目录，按日期命名：

```
logs/2026-03-18.md
```

### 处理报告

每日报告包含：
- 处理概览（成功/失败统计）
- 成功记录列表
- 失败记录列表（含失败原因）

## Telegram Bot

通过 Telegram Bot 远程触发论文处理，支持 `/start`、`/help`、`/papers` 命令。

### 环境配置

在 `.env` 文件中添加：

```bash
# Telegram Bot 配置
# 从 @BotFather 获取 Bot Token
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
# 可选：允许的用户ID，不设置则不限制
TELEGRAM_USER_ID=your_telegram_user_id

# API 地址（默认 http://localhost:8081）
TELEGRAM_API_URL=http://localhost:8081
TELEGRAM_API_TIMEOUT=300

# HTTP 代理（必须，用于访问 Telegram API）
HTTP_PROXY=http://127.0.0.1:7890
```

### 启动方式

#### systemd 服务（推荐，开机自启）

```bash
# 安装服务
sudo cp deploy/paper-pdf-summary-telegram.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable paper-pdf-summary-telegram

# 启动服务
sudo systemctl start paper-pdf-summary-telegram

# 常用命令
sudo systemctl status paper-pdf-summary-telegram  # 查看状态
sudo systemctl restart paper-pdf-summary-telegram  # 重启
sudo systemctl stop paper-pdf-summary-telegram     # 停止
```

#### 手动运行

```bash
cd /opt/lis-rss-daily/scripts/paper-pdf-summary/telegram-bot
npx tsx index.ts
```

### 命令说明

| 命令 | 说明 |
|------|------|
| `/start` | 欢迎信息 |
| `/help` | 使用帮助 |
| `/papers <标题> [@ID]` | 触发论文处理 |

### 使用示例

```
/papers Attention Is All You Need
/papers Attention Is All You Need @123
```

- `<标题>`：论文标题（必填）
- `@ID`：LIS-RSS系统ID（可选，不传则跳过LIS-RSS上传）

### 日志

Bot 日志保存在 `logs/telegram-node.log`

### 注意事项

- 同一时间只能处理一个任务
- Bot 使用 Node.js + undici ProxyAgent 连接 Telegram

## 故障排查

### PDF 下载失败

检查：
1. 网络连接是否正常
2. 下载源网站是否可访问
3. PDF 下载脚本配置是否正确

### PDF 验证失败

检查：
1. 下载的 PDF 文件名是否正确
2. 文件名匹配阈值配置（`match_threshold`）
3. 查看日志中的详细匹配原因

### PDF 总结超时

系统支持自动恢复机制：
- 即使脚本超时，只要 MD 文件已生成，会继续处理
- 检查 `download/` 目录下的 MD 文件是否有效

### 上传失败

检查：
1. 对应服务的环境变量是否正确配置
2. 服务是否可访问
3. 查看各子系统的详细错误日志

## 技术栈

- **Python 3.12+**：PDF 下载、总结和上传核心逻辑
- **Node.js**：Telegram Bot（undici ProxyAgent）
- **Playwright**：浏览器自动化
- **Camoufox**：反检测浏览器
- **PyYAML**：配置文件解析
- **Asyncio**：异步并行处理

## 开发

### 添加新的 PDF 下载源

1. 在 `pdf-download/` 目录创建新的下载脚本
2. 在 `config/config.yaml` 中添加到 `priority_scripts`

### 添加新的上传子系统

1. 在 `summary-update/` 创建新的上传模块
2. 在 `utils/summary_uploader.py` 添加新的上传函数
3. 在 `config/config.yaml` 中配置启用


## 维护

### 常见任务

**清理旧日志**：
```bash
find logs/ -name "*.md" -mtime +30 -delete
```

**清理下载文件**：
```bash
find download/ -type f -mtime +7 -delete
```

**备份配置**：
```bash
tar -czf config-backup-$(date +%Y%m%d).tar.gz config/
```
