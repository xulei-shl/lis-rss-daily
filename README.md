# LIS-RSS Literature Tracker

智能 RSS 文献追踪系统 - 自动抓取、过滤、翻译和检索学术文献

## 📋 目录

- [项目简介](#项目简介)
- [核心功能](#核心功能)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [使用指南](#使用指南)
- [API 接口](#api-接口)
- [项目结构](#项目结构)
- [常见问题](#常见问题)

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
| 📊 **统计分析** | 过滤统计、通过率分析、领域分布 |
| 👥 **多用户支持** | 用户认证系统，支持多用户独立管理 |
| ⚙️ **可配置** | 灵活的主题词、关注领域配置 |

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

# 启动服务 (默认端口 8000)
chromadb run --host 127.0.0.1 --port 8000
```

### 4. 初始化数据库

```bash
# 执行数据库迁移
pnpm run db:migrate

# 种子数据 (可选，创建测试数据)
pnpm run db:seed
```

### 5. 启动应用

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

### 6. 访问应用

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
BASE_URL=http://localhost:3000      # 基础URL

# ============ 数据库配置 ============
DATABASE_PATH=data/rss-tracker.db  # SQLite 数据库路径

# ============ JWT 认证 ============
JWT_SECRET=your-secret-key-change  # JWT 密钥 (生产环境必改)
JWT_EXPIRES_IN=7d                 # Token 过期时间

# ============ LLM 配置 ============
LLM_PROVIDER=openai               # LLM 提供商 (openai | gemini)

# OpenAI 配置
OPENAI_API_KEY=sk-xxx             # OpenAI API Key
OPENAI_BASE_URL=                  # OpenAI 代理地址 (可选)
OPENAI_DEFAULT_MODEL=gpt-4o-mini # 默认模型

# Gemini 配置
GEMINI_API_KEY=                  # Gemini API Key
GEMINI_MODEL=gemini-1.5-flash    # Gemini 模型

# LLM 加密密钥 (用于加密 API Key)
LLM_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000

# ============ RSS 抓取配置 ============
RSS_FETCH_SCHEDULE=0 9 * * *      # 抓取调度 (每天早上9点)
RSS_FETCH_ENABLED=true           # 是否启用自动抓取
RSS_MAX_CONCURRENT=5            # 并发抓取数量
RSS_FETCH_TIMEOUT=30000          # 抓取超时 (毫秒)
RSS_FIRST_RUN_MAX_ARTICLES=50   # 首次抓取最大文章数

# ============ 日志配置 ============
LOG_LEVEL=info                    # 日志级别
LOG_FILE=                         # 日志文件路径 (可选)
LLM_LOG_FILE=                     # LLM 调用日志 (可选)
LLM_LOG_FULL_PROMPT=false        # 是否记录完整 Prompt
LLM_LOG_FULL_SAMPLE_RATE=20      # 完整日志采样率

# ============ LLM 速率限制 ============
LLM_RATE_LIMIT_ENABLED=true      # 是否启用速率限制
LLM_RATE_LIMIT_REQUESTS_PER_MINUTE=60  # 每分钟请求数
LLM_RATE_LIMIT_BURST_CAPACITY=10       # 突发容量
LLM_RATE_LIMIT_QUEUE_TIMEOUT=30000     # 队列超时 (毫秒)
```

### ChromaDB 配置

确保 ChromaDB 正在运行，默认连接配置:
- 主机: `127.0.0.1`
- 端口: `8000`

如需修改，在设置页面或环境变量中配置:
```
CHROMA_HOST=127.0.0.1
CHROMA_PORT=8000
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

### 7. 查看统计

进入「统计」页面查看:
- 总文章数、通过率
- 各领域过滤统计
- 过滤趋势图

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
│   │   ├── rss-sources.ts   # RSS 源接口
│   │   └── ...
│   │
│   ├── pipeline.ts           # 处理流水线 (翻译+索引)
│   ├── filter.ts             # LLM 文章过滤
│   ├── scraper.ts            # 网页抓取
│   ├── rss-parser.ts         # RSS 解析
│   ├── rss-scheduler.ts      # 定时抓取调度
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

### Q6: 如何重置数据库

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
