# RSS Literature Tracker

<div align="center">

**智能 RSS 文献追踪系统**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E=18.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

一个基于 LLM 的智能 RSS 文献追踪系统，自动抓取、过滤、分析学术文献，帮助研究者高效获取领域前沿动态。

[功能特性](#功能特性) • [快速开始](#快速开始) • [文档](#文档) • [部署](#部署)

</div>

---

## 项目简介

RSS Literature Tracker 是一个面向学术研究者的智能文献追踪系统。通过订阅学术期刊、预印本平台的 RSS 源，系统可以：

- 自动抓取最新文献
- 基于主题词的智能过滤
- LLM 驱动的文章分析（摘要、标签、洞察）
- 语义搜索快速定位相关文章
- Markdown 导出与知识库集成

适用于计算机科学、生物学、物理学等需要持续跟踪前沿文献的研究领域。

---

## 功能特性

### 核心

- **RSS 源管理**: 支持多个 RSS 源的订阅、验证、调度
- **智能过滤**: 两阶段过滤机制（关键词预筛选 + LLM 精确过滤），**新文章自动触发过滤**
- **定时抓取**: 基于 Cron 的定时任务，支持并发控制和重试
- **文章分析**: LLM 自动生成中文摘要、研究标签、核心洞察
- **语义搜索**: 在线向量模型 + 本地 Chroma 语义检索
- **知识库集成**: 自动导出 Markdown，方便外部知识库使用

### 自动化工作流

```
RSS 抓取 → 自动过滤 → LLM 分析 → Markdown 导出
   ↓           ↓          ↓           ↓
 定时任务    更新状态    生成洞察    知识库集成
```

### 界面

- **学术风格设计**: Academic Brutalist 设计系统
- **响应式布局**: 支持桌面端和移动端
- **暗色模式**: 内置暗色主题支持
- **完整页面**: 登录、首页、文章列表、搜索、设置、主题管理等 9 个页面

---

## 技术栈

| 类别 | 技术选型 |
|------|----------|
| 运行时 | Node.js 18+ |
| 语言 | TypeScript 5.9 |
| 数据库 | SQLite + Kysely ORM |
| Web 框架 | Express 5 + EJS |
| 认证 | JWT |
| RSS 解析 | rss-parser |
| 定时任务 | node-cron |
| 网页抓取 | Playwright + Defuddle |
| LLM | OpenAI API (兼容 Gemini) |
| 向量搜索 | Chroma (本地) |
| 日志 | Pino |

---

## 快速开始

### 前置要求

- Node.js >= 18.0.0
- pnpm >= 8.0.0

### 安装

```bash
# 克隆仓库
git clone https://github.com/yourusername/lis-rss-daily.git
cd lis-rss-daily

# 安装依赖
pnpm install

# 复制环境变量配置
cp .env.example .env

# 编辑 .env 文件，添加 LLM API Key
# 必需: OPENAI_API_KEY 或 Gemini API 配置
```

### 初始化

```bash
# 运行数据库迁移
pnpm run db:migrate

# （可选）填充示例数据
pnpm run db:seed
```

### 启动

```bash
# 开发模式
pnpm dev

# 服务将在 http://localhost:3000 启动
# 默认用户: admin / admin123
```

---

## 环境变量配置

```bash
# 基础配置
PORT=3000                    # 服务端口
NODE_ENV=development          # 运行环境

# 文章处理配置
ARTICLE_PROCESS_ENABLED=true
ARTICLE_PROCESS_BATCH_SIZE=10
ARTICLE_PROCESS_MAX_CONCURRENT=3

# Chroma 配置（可选，默认值如下）
# 建议通过设置页进行配置
CHROMA_HOST=127.0.0.1
CHROMA_PORT=8000
CHROMA_COLLECTION=articles
CHROMA_DISTANCE_METRIC=cosine
```

完整配置请参考 [.env.example](.env.example)。

---

## 使用指南

### 1. 添加 RSS 源

进入「设置」页面，添加学术期刊的 RSS 源：

```
https://arxiv.org/rss/cs.AI     # arXiv AI
https://www.nature.com/nai/rss   # Nature AI
https://dl.acm.org/rss/dl.xml    # ACM Digital Library
```

### 2. 配置主题词

进入「主题管理」页面，创建主题领域并添加关键词：

- 领域: 机器学习
- 关键词: deep learning, neural network, transformer, GPT

### 3. 启动自动抓取

系统将按 Cron 表达式定时抓取，也可手动点击「立即抓取」。

### 4. 查看分析结果

- **首页**: 查看每日新增文章统计和时间线
- **文章列表**: 筛选、搜索、批量处理文章
- **文章详情**: 查看 AI 摘要、研究洞察、相关文章
- **搜索页面**: 语义搜索相关文章

---

## 文档

- [部署文档](docs/deployment.md) - 生产环境部署指南
- [用户手册](docs/user-guide.md) - 详细使用说明
- [开发者文档](docs/developer-guide.md) - 架构设计与开发指南
- [开发进度](docs/开发进度.md) - 项目开发进度记录

---

## 项目结构

```
lis-rss-daily/
├── src/                      # 源代码
│   ├── api/                  # API 服务层
│   ├── middleware/           # 中间件
│   ├── views/                # EJS 视图模板
│   ├── vector/               # 向量检索模块
│   │   ├── embedding-client.ts  # Embedding 客户端
│   │   ├── vector-store.ts      # Chroma 向量存储
│   │   ├── reranker.ts          # Rerank 重排序
│   │   ├── indexer.ts           # 向量索引队列
│   │   ├── search.ts            # 语义检索入口
│   │   └── text-builder.ts      # 向量化文本构建
│   ├── index.ts              # 应用入口
│   ├── config.ts             # 配置管理
│   ├── logger.ts             # 日志模块
│   ├── llm.ts                # LLM 抽象层
│   ├── scraper.ts            # 网页抓取
│   ├── rss-parser.ts         # RSS 解析器
│   ├── rss-scheduler.ts      # RSS 调度器
│   ├── filter.ts             # 两阶段过滤
│   ├── agent.ts              # LLM 分析引擎
│   ├── search.ts             # 文章搜索
│   ├── export.ts             # Markdown 导出
│   ├── pipeline.ts           # 文章处理流水线
├── sql/                      # 数据库脚本
├── scripts/                  # 工具脚本
├── data/                     # 数据目录
│   ├── exports/              # Markdown 导出
├── docs/                     # 文档
└── logs/                     # 日志文件
```

---

## 开发

### 运行开发服务器

```bash
pnpm dev
```

### 类型检查

```bash
pnpm typecheck
```

### 数据库操作

```bash
# 运行迁移
pnpm run db:migrate

# 填充示例数据
pnpm run db:seed
```

---

## 部署

### Docker 部署

```bash
# 构建镜像
docker build -t lis-rss-daily .

# 运行容器
docker run -p 3000:3000 --env-file .env lis-rss-daily
```

### Docker Compose 部署

```bash
docker-compose up -d
```

详细部署指南请参考 [部署文档](docs/deployment.md)。

---

## 路线图

- [x] 阶段 0: 项目初始化
- [x] 阶段 1: 数据库层
- [x] 阶段 2: 核心模块复用
- [x] 阶段 3: RSS 源管理
- [x] 阶段 4: 主题词过滤
- [x] 阶段 5: RSS 调度器
- [x] 阶段 6: 文章处理流程
- [x] 阶段 7: 前端页面开发
- [x] 阶段 8: 向量检索与语义搜索
- [ ] 阶段 9: 测试与优化
- [ ] 阶段 10: 部署与文档

---

## 参考资源

本项目参考了以下开源项目：

- [linkmind](https://github.com/singular-gerald/linkmind) - 核心模块复用来源
- [Chroma](https://github.com/chroma-core/chroma) - 向量数据库

---

## 许可证

[MIT](LICENSE)

---

## 贡献

欢迎提交 Issue 和 Pull Request！

---

<div align="center">

**Built with ❤️ for researchers**

</div>
