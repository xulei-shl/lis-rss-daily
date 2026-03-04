# LIS-RSS Literature Tracker

智能 RSS 文献追踪系统 - 自动抓取、过滤、翻译和检索学术文献

## 📋 目录

- [项目简介](#项目简介)
- [核心功能](#核心功能)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [使用指南](#使用指南)
- [Telegram 通知](#telegram-通知)
- [API 接口](#api-接口)
- [项目结构](#项目结构)
- [常见问题](#常见问题)
  - [多进程导致数据库锁定](#q6-多进程导致数据库锁定-sqlite_error)

---

## 项目简介

LIS-RSS Literature Tracker 是一个智能文献追踪系统，自动从 RSS 订阅源抓取文章，使用 LLM 进行智能过滤和翻译，并提供语义搜索功能，帮助您高效追踪和检索感兴趣的学术文献。

### 核心流程

```
RSS 订阅源 → 自动抓取 → LLM 智能过滤 → 通过的文章 → 翻译 + 向量化 → 语义搜索
```

---

## 核心功能

| 功能 | 描述 |
|------|------|
| 📡 **RSS 订阅管理** | 添加、编辑、删除 RSS 订阅源，支持定时自动抓取 |
| 🤖 **智能过滤** | 使用 LLM 根据主题配置智能过滤无关内容 |
| 🌐 **自动翻译** | 自动将英文文献翻译为中文 |
| 🔍 **语义搜索** | 基于向量的语义检索，找到相关文献 |
| 🔗 **相关文章推荐** | 基于向量相似度自动关联相关文献，增量刷新机制 |
| 📊 **统计分析** | 过滤统计、通过率分析、领域分布 |
| 👥 **多用户支持** | 用户认证系统，支持多用户独立管理 |
| ⚙️ **可配置** | 灵活的主题词、关注领域、系统提示词配置 |
| 📢 **Telegram 通知** | 支持每日总结和新文章推送，多接收者管理，频道支持 |

---

## 技术栈

| 类别 | 技术 |
|------|------|
| **运行时** | Node.js 20+ (TypeScript) |
| **Web 框架** | Express 5.x |
| **模板引擎** | EJS |
| **数据库** | SQLite + Kysely ORM |
| **向量数据库** | ChromaDB |
| **LLM 集成** | OpenAI / Gemini |
| **RSS 解析** | rss-parser |
| **网页抓取** | Playwright + defuddle |
| **认证** | JWT + bcryptjs |
| **定时任务** | node-cron |
| **日志** | pino |

---

## Python 环境

项目使用两个独立的 Python 虚拟环境：

| 虚拟环境 | 路径 | 用途 |
|---------|------|------|
| `venv` | `/opt/lis-rss-daily/venv` | 期刊爬虫 (cnki/lis/rdfybk/wanfang) |
| `lis-rss` | `/opt/lis-rss-daily/lis-rss` | ChromaDB 向量数据库 |

**为什么分离？**
- 职责隔离：爬虫和向量数据库是独立的子系统
- 轻量化：爬虫无需 70+ 个 AI/ML 依赖
- 版本隔离：避免共同依赖（如 numpy、requests）的版本冲突

---

## 快速开始

### 环境要求

- Node.js 20.x 或更高版本
- pnpm (推荐) 或 npm
- ChromaDB (用于向量检索)

### 1. 安装依赖

```bash
# 使用 pnpm (推荐)
pnpm install

# 或使用 npm
npm install
```

### 2. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑配置文件
vim .env
```

### 3. 启动 ChromaDB

ChromaDB 用于向量存储和语义搜索。

**Windows (使用脚本):**
```bash
# 双击运行或命令行执行
scripts\start-chroma.bat
```

**手动启动:**
```bash
# 安装 ChromaDB
pip install chromadb

# 创建向量数据目录
mkdir -p data/vector/chroma

# 启动服务 (默认端口 8000，指定数据存储路径)
chroma run --host 127.0.0.1 --port 8000 --path ./data/vector/chroma
```

### 4. 创建必要目录

```bash
# 创建数据和日志目录
mkdir -p data/exports logs data/vector/chroma
```

### 5. 初始化数据库

```bash
# 执行数据库迁移
pnpm run db:migrate
```

迁移会自动创建：
- 默认 admin 用户（密码：admin123）
- 必要的数据库表和索引
- 默认系统设置

### 6. 启动应用

**开发模式:**
```bash
pnpm run dev
```

**生产模式:**
```bash
# 构建 CSS
pnpm run build:css

# 启动应用
pnpm start
```

或使用启动脚本:
```bash
# Windows
scripts\start.bat

# Linux/macOS
bash scripts/start.sh
```

### 7. 访问应用

打开浏览器访问: **http://localhost:3000**

默认登录账号:
- 用户名: `admin`
- 密码: `admin123`

---

## 配置说明

### 环境变量配置

创建 `.env` 文件:

```env
# ============ 服务配置 ============
PORT=3000                          # 应用端口
BASE_URL=http://localhost:3000     # 基础URL

# ============ 数据库配置 ============
DATABASE_PATH=data/rss-tracker.db  # SQLite 数据库路径

# ============ JWT 认证 ============
# 用于签发用户登录 Token，生产环境必须使用强随机字符串！
# 生成方法：openssl rand -hex 32 (Linux/macOS) 或 openssl rand -hex 32 (Windows Git Bash)
JWT_SECRET=your-secret-key-change  # JWT 密钥 (生产环境必改)
JWT_EXPIRES_IN=7d                   # Token 过期时间

# ============ LLM 配置 ============
# LLM 配置请在 Web 界面中设置（设置 → LLM 配置）

# LLM 加密密钥（用于加密数据库中存储的 LLM API Key，必须是 64 位十六进制字符）
# 生成方法：openssl rand -hex 32 (Linux/macOS) 或 openssl rand -hex 32 (Windows Git Bash)
LLM_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000

# ============ RSS 抓取配置 ============
RSS_FETCH_SCHEDULE=0 2 * * *      # 抓取调度 (默认每天凌晨2点)
RSS_FETCH_ENABLED=true            # 是否启用自动抓取
RSS_MAX_CONCURRENT=5               # 并发抓取数量
RSS_FETCH_TIMEOUT=30000            # 抓取超时 (毫秒)
RSS_FIRST_RUN_MAX_ARTICLES=50     # 首次抓取最大文章数

# ============ 相关文章刷新配置 ============
RELATED_REFRESH_ENABLED=true       # 是否启用相关文章定期刷新
RELATED_REFRESH_SCHEDULE=0 3 * * * # 刷新时间 (默认每天凌晨3点)
RELATED_REFRESH_BATCH_SIZE=100    # 每批处理数量
RELATED_REFRESH_STALE_DAYS=7       # 刷新过期天数

# ============ CLI API 密钥（用于每日总结 CLI）=============
CLI_API_KEY=your-cli-api-key-here

# ============ 日志配置 ============
LOG_LEVEL=info                     # 日志级别
LOG_FILE=                          # 日志文件路径 (可选)
LLM_LOG_FILE=                      # LLM 调用日志 (可选)
LLM_LOG_FULL_PROMPT=false          # 是否记录完整 Prompt
LLM_LOG_FULL_SAMPLE_RATE=20        # 完整日志采样率

# ============ LLM 速率限制 ============
LLM_RATE_LIMIT_ENABLED=true        # 是否启用速率限制
LLM_RATE_LIMIT_REQUESTS_PER_MINUTE=60  # 每分钟请求数
LLM_RATE_LIMIT_BURST_CAPACITY=10        # 突发容量
LLM_RATE_LIMIT_QUEUE_TIMEOUT=30000      # 队列超时 (毫秒)
```

### ChromaDB 配置

确保 ChromaDB 正在运行，默认连接配置:
- 主机: `127.0.0.1`
- 端口: `8000`
- 数据路径: `./data/vector/chroma`

如需修改，在设置页面或环境变量中配置:
```
CHROMA_HOST=127.0.0.1
CHROMA_PORT=8000
CHROMA_PATH=./data/vector/chroma
```

---

## 使用指南

### 1. 登录与初始化

1. 使用默认账号 `admin` / `admin123` 登录
2. **立即修改密码** (设置 → 修改密码)

### 2. 配置关注领域

在「设置」→「关注领域」中配置您感兴趣的主题:

```
示例: 机器学习领域
- 名称: 机器学习
- 描述: 机器学习、深度学习、人工智能相关研究
- 主题词: neural networks, deep learning, transformer, etc.
```

### 3. 添加 RSS 订阅源

在「RSS 源」页面添加订阅:

| 字段 | 说明 |
|------|------|
| 名称 | 便于识别的名称 |
| URL | RSS 订阅地址 |
| 抓取间隔 | 抓取频率 (秒)，建议 3600 (1小时) |
| 状态 | 启用/禁用 |

**常用学术 RSS 源:**
- arXiv: `http://export.arxiv.org/api/query?search_query=cat:cs.*`
- Google Scholar: 需使用第三方服务
- Nature: `https://www.nature.com/subjects/artificial-intelligence/rss`
- ScienceDirect: 需使用期刊特定 RSS

### 4. 手动触发抓取

系统会在定时任务中自动抓取，也支持手动触发:

1. 进入「RSS 源」页面
2. 点击源右侧的「刷新」按钮
3. 或在「设置」→「调度器」中触发全部抓取

### 5. 查看与处理文章

1. 进入「文章」页面查看已过滤的文章
2. 点击文章标题查看详情
3. 文章状态说明:
   - `待处理`: 已通过过滤，等待翻译和向量化
   - `处理中`: 正在翻译/索引
   - `已完成`: 已完成全部处理，可搜索
   - `已拒绝`: 未通过 LLM 过滤

### 6. 搜索文献

系统提供两种搜索方式:

**关键词搜索:**
- 在首页搜索框输入关键词
- 支持标题、摘要、内容匹配

**语义搜索:**
- 进入「搜索」页面
- 输入自然语言查询
- 系统会找到语义最相关的文献

### 7. 查看相关文章

每篇文章会自动推荐语义最相关的文献：

1. 点击文章进入详情页
2. 在「相关文章」区域查看推荐列表
3. 相关度基于向量相似度计算
4. 新文章处理完成后会自动刷新相关文章列表

### 8. 查看统计

进入「统计」页面查看:
- 总文章数、通过率
- 各领域过滤统计
- 过滤趋势图

---

## Telegram 通知

系统支持通过 Telegram Bot 接收每日总结和新文章推送。

### 功能概览

| 功能 | 用户私聊/群组 | 频道 |
|------|--------------|------|
| 接收推送（每日总结、新文章） | ✅ | ✅ |
| `/getarticles` 命令 | ✅ | ❌ |
| 内联按钮（标记已读、评分） | ✅ | ❌ |

> **注意**：频道是单向广播，用户不能在频道中发送命令或点击按钮。

### 权限角色

| 角色 | 描述 | 权限 |
|------|------|------|
| **Admin** | 管理员 | 接收推送 + 使用命令 + 标记已读 + 评分 |
| **Viewer** | 观察者 | 接收推送 + 使用命令（只读） |

### 配置步骤

#### 1. 创建 Telegram Bot

1. 在 Telegram 中搜索并打开 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot` 命令
3. 按提示设置 Bot 名称和用户名
4. 保存生成的 **Bot Token**（格式：`123456789:ABCdefGHI...`）

#### 2. 获取 Chat ID

**获取私聊 ID：**
1. 在 Telegram 中搜索并打开 [@userinfobot](https://t.me/userinfobot)
2. 发送任意消息
3. 记录返回的数字 ID

**获取群组/频道 ID：**
1. 将 Bot 添加到群组/频道并设为管理员
2. 在群组/频道中发送消息
3. 访问 `https://api.telegram.org/bot<你的TOKEN>/getUpdates`
4. 在返回结果中找到 `chat.id`（频道可能是 `@channelname` 格式）

#### 3. 配置系统

1. 进入「设置」→「Telegram 通知」
2. 勾选「启用 Telegram 通知」
3. 填写 Bot Token 并保存
4. 点击「+ 添加接收者」：
   - **Chat ID**: 私聊填数字 ID，频道填 `@channelname`
   - **显示名称**: 自定义名称（如「我的手机」）
   - **权限角色**: 选择 Admin 或 Viewer
   - 勾选需要接收的内容类型

#### 4. 测试连接

点击「测试连接」按钮，系统会发送测试消息到所有启用的接收者。

### 推送内容

**每日总结：**
- 每天定时推送
- 包含通过过滤的文章总数
- 按类型分类的文章列表

**新文章通知：**
- 文章通过过滤后立即推送
- 包含标题、摘要、来源链接
- Admin 可直接操作（标记已读、评分）

### Telegram 命令

**`/getarticles YYYY-MM-DD`** 或 **`/getarticles YYYYMMDD`**

获取指定日期的未读文章（最多 5 篇）。

```
示例：
/getarticles 2026-03-01
/getarticles 20260301
```

### 频道配置

将推送发送到 Telegram 频道：

1. 在「接收者列表」中添加频道
2. Chat ID 填写频道用户名（如 `@lisrsstracker`）
3. 角色选择 `Viewer` 即可（频道不支持交互）

> 频道只能接收推送，如需交互功能请使用私聊或群组。

---

## API 接口

### 认证接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 用户登录 |
| POST | `/api/auth/logout` | 用户登出 |

### RSS 源管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/rss-sources` | 获取所有 RSS 源 |
| POST | `/api/rss-sources` | 添加 RSS 源 |
| GET | `/api/rss-sources/:id` | 获取单个 RSS 源 |
| PUT | `/api/rss-sources/:id` | 更新 RSS 源 |
| DELETE | `/api/rss-sources/:id` | 删除 RSS 源 |
| POST | `/api/rss-sources/:id/fetch` | 手动触发抓取 |

### 文章管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/articles` | 获取文章列表 |
| GET | `/api/articles/:id` | 获取文章详情 |
| POST | `/api/articles/:id/process` | 处理单篇文章 |
| POST | `/api/articles/batch/process` | 批量处理文章 |
| POST | `/api/articles/:id/retry` | 重试失败文章 |
| GET | `/api/articles/:id/related` | 获取相关文章列表 |
| POST | `/api/articles/:id/related/refresh` | 手动刷新相关文章 |
| PATCH | `/api/articles/:id/ai-summary` | 更新文章 AI 总结 |

#### AI 总结接口说明

**`PATCH /api/articles/:id/ai-summary`**

更新指定文章的 AI 总结内容。

**权限要求：** 需要登录 + 写权限（非 guest 用户）

**请求体：**
```json
{
  "ai_summary": "这是 AI 生成的文章总结..."
}
```

**响应：**
```json
{
  "success": true,
  "ai_summary": "这是 AI 生成的文章总结..."
}
```

**错误响应：**
- `400` - 参数错误（文章 ID 无效或 ai_summary 不是字符串）
- `401` - 未登录
- `403` - 权限不足（guest 用户）
- `404` - 文章不存在

**调用示例：**
```bash
# 获取登录 token
TOKEN=$(curl -s -X POST http://10.40.92.18:8007/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r '.token')

# 更新文章 AI 总结
curl -X PATCH http://10.40.92.18:8007/api/articles/123/ai-summary \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"ai_summary":"本文提出了一种新的深度学习架构..."}'
```

### 过滤配置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/topic-domains` | 获取关注领域 |
| POST | `/api/topic-domains` | 创建关注领域 |
| PUT | `/api/topic-domains/:id` | 更新关注领域 |
| DELETE | `/api/topic-domains/:id` | 删除关注领域 |
| GET | `/api/topic-keywords` | 获取主题词 |
| POST | `/api/topic-keywords` | 创建主题词 |

### 搜索

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/search` | 关键词搜索 |
| GET | `/api/search/semantic` | 语义搜索 |

### 系统设置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/settings` | 获取设置 |
| PUT | `/api/settings` | 更新设置 |
| GET | `/api/system-prompts` | 获取系统提示词 |
| PUT | `/api/system-prompts/:id` | 更新提示词 |
| GET | `/api/filter/stats` | 获取过滤统计 |

---

## 项目结构

```
lis-rss-daily/
├── src/
│   ├── index.ts              # 应用入口
│   ├── config.ts             # 配置管理
│   ├── db.ts                 # 数据库 (SQLite + Kysely)
│   ├── logger.ts             # 日志模块
│   │
│   ├── api/                  # API 路由
│   │   ├── routes/           # 路由定义
│   │   ├── articles.ts       # 文章接口
│   │   ├── articles-refresh.ts  # 相关文章刷新
│   │   ├── rss-sources.ts    # RSS 源接口
│   │   └── ...
│   │
│   ├── pipeline.ts           # 处理流水线 (翻译+索引)
│   ├── filter.ts             # LLM 文章过滤
│   ├── scraper.ts            # 网页抓取
│   ├── rss-parser.ts         # RSS 解析
│   ├── rss-scheduler.ts      # RSS 定时抓取调度
│   ├── related-scheduler.ts  # 相关文章刷新调度
│   │
│   ├── vector/               # 向量检索模块
│   │   ├── indexer.ts        # 向量索引
│   │   ├── vector-store.ts   # ChromaDB 操作
│   │   ├── embedding-client.ts # Embedding 调用
│   │   └── search-service.ts  # 搜索服务
│   │
│   ├── llm.ts                # LLM 集成
│   ├── agent.ts              # 翻译代理
│   ├── search.ts             # 传统搜索
│   └── views/                # EJS 模板
│
├── scripts/                   # 工具脚本
│   ├── start.bat             # Windows 启动脚本
│   ├── start-chroma.bat      # ChromaDB 启动
│   └── migrate.ts            # 数据库迁移
│
├── sql/                      # SQL 迁移文件
│   └── 001_init.sql          # 初始表结构
│
├── docs/                      # 文档
├── public/                    # 静态资源
│   ├── css/
│   └── js/
│
├── package.json
├── .env.example
└── tsconfig.json
```

---

## 常见问题

### Q1: 启动失败，提示端口被占用

```bash
# 查看占用端口的进程
netstat -ano | findstr :3000

# 修改 .env 中的 PORT
PORT=3001
```

### Q2: ChromaDB 连接失败

确保 ChromaDB 已启动:
```bash
# Docker 启动
docker run -d -p 8000:8000 chromadb/chroma

# 验证连接
curl http://127.0.0.1:8000/api/v1
```

### Q3: LLM API 调用失败

1. 检查 API Key 是否正确
2. 确认账户有足够配额
3. 查看日志中的详细错误信息
4. 可尝试切换 LLM 提供商

### Q4: RSS 抓取无数据

1. 检查 RSS URL 是否正确
2. 确认 RSS 源是否支持抓取
3. 查看日志中的抓取错误

### Q5: 文章过滤效果不佳

1. 优化「关注领域」配置
2. 添加更多描述性文字
3. 调整主题词和权重
4. 自定义过滤提示词

### Q6: 多进程导致数据库锁定 (SQLITE_ERROR)

#### 问题描述

当多个应用实例同时运行时，SQLite 数据库可能出现并发访问冲突，导致：

- 向量索引失败 (`SQLITE_ERROR`)
- 文章处理卡在翻译阶段，无法完成
- Telegram 自动推送不工作
- 日志中出现 `{"code":"SQLITE_ERROR"}` 错误

#### 检测方法

**1. 检查是否有多个进程运行：**

```bash
# Linux/macOS
ps aux | grep "tsx src/index" | grep -v grep

# Windows
tasklist | findstr node
```

**2. 查看日志中的错误：**

```bash
# 搜索数据库错误
grep "SQLITE_ERROR" logs/app.*.log

# 搜索向量索引失败
grep "向量索引任务失败" logs/app.*.log
```

**3. 检查数据库文件锁定状态：**

```bash
# Linux/macOS - 查看访问数据库的进程
lsof data/rss-tracker.db

# 检查 WAL 文件是否存在且正在增长
ls -la data/rss-tracker.db*
```

#### 修复方案

**方式一：使用 systemd 服务（推荐生产环境）**

```bash
# 1. 停止所有手动启动的进程
pkill -f "tsx src/index"
pkill -f "node.*src/index"

# 2. 停止服务
sudo systemctl stop lis-rss

# 3. 等待几秒让数据库连接完全释放
sleep 5

# 4. 验证无残留进程
ps aux | grep -E 'tsx src/index|chroma' | grep -v grep

# 5. 启动服务
sudo systemctl start lis-rss

# 6. 验证服务状态
sudo systemctl status lis-rss
```

**方式二：开发环境手动清理**

```bash
# 1. 停止所有相关进程
pkill -f "tsx src/index"  # Linux/macOS
# 或
taskkill /F /IM node.exe  # Windows

# 2. 等待数据库锁释放
sleep 3

# 3. 重新启动应用
pnpm run dev
```

**方式三：彻底重启（当常规方法无效时）**

```bash
# 1. 停止所有服务
sudo systemctl stop lis-rss
sudo systemctl stop chromadb

# 2. 检查并终止残留进程
ps aux | grep -E 'chroma|tsx|node.*src/index' | grep -v grep
# 如有残留，手动 kill

# 3. 等待端口释放
sleep 5

# 4. 验证端口已释放
sudo lsof -i :8000  # ChromaDB 端口
sudo lsof -i :8007  # 应用端口

# 5. 按依赖顺序启动
sudo systemctl start chromadb
sleep 3
sudo systemctl start lis-rss

# 6. 验证服务状态
sudo systemctl status chromadb
sudo systemctl status lis-rss
```

#### 最佳实践

**1. 生产环境：始终使用 systemd 服务管理**

```bash
# 使用服务管理，避免手动启动
sudo systemctl start lis-rss    # 启动
sudo systemctl stop lis-rss     # 停止
sudo systemctl restart lis-rss   # 重启
sudo systemctl status lis-rss    # 查看状态
```

**2. 开发环境：确保只有一个开发服务器运行**

```bash
# 使用 pnpm 的单实例模式
# package.json 中配置：
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "dev:single": "tsx src/index.ts"  # 单次运行
  }
}
```

**3. 重启前检查：**

```bash
# 重启前先检查是否有正在运行的服务
ps aux | grep "tsx src/index" | grep -v grep

# 如果有，先停止再启动新实例
pkill -f "tsx src/index" && pnpm run dev
```

**4. 使用进程管理工具（如 PM2）：**

```bash
# 安装 PM2
npm install -g pm2

# 启动应用
pm2 start dist/index.js --name lis-rss

# 查看状态
pm2 status

# 重启
pm2 restart lis-rss

# 停止
pm2 stop lis-rss
```

**5. 监控脚本：**

创建一个监控脚本来检测多进程问题：

```bash
#!/bin/bash
# check-duplicate-processes.sh

COUNT=$(ps aux | grep "tsx src/index" | grep -v grep | wc -l)
if [ $COUNT -gt 1 ]; then
    echo "警告：发现 $COUNT 个应用实例在运行！"
    ps aux | grep "tsx src/index" | grep -v grep
    echo "建议：保留一个实例，终止其他实例"
fi
```

---

### Q7: 如何重置数据库

```bash
# 删除数据库文件
del data\rss-tracker.db

# 重新执行迁移
pnpm run db:migrate
```

---

## 许可证

MIT License

---

## 贡献

欢迎提交 Issue 和 Pull Request！
