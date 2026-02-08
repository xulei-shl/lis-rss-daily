# 开发者文档

本文档面向开发者，介绍 LIS-RSS Literature Tracker 的架构设计、技术细节和开发指南。

---

## 目录

- [架构概览](#架构概览)
- [数据模型](#数据模型)
- [核心模块](#核心模块)
- [向量检索模块](#向量检索模块)
- [API 接口](#api-接口)
- [开发环境](#开发环境)
- [代码规范](#代码规范)
- [测试指南](#测试指南)
- [贡献指南](#贡献指南)

---

## 架构概览

### 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                         前端层 (EJS)                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ 首页     │ │ 文章列表 │ │ 搜索     │ │ 设置/主题管理    │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      API 路由层 (Express)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ 认证中间件│ │ 路由定义 │ │ 参数验证 │ │ 响应格式化       │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       业务逻辑层                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ RSS 调度器│ │ 文章处理 │ │ 过滤引擎 │ │ 搜索服务         │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       数据访问层                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Kysely   │ │ 数据库   │ │ LLM 客户 │ │ 外部 API          │ │
│  │ ORM      │ │ SQLite   │ │ OpenAI   │ │ RSS/Scraper      │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 目录结构

```
src/
├── api/                    # API 服务层
│   ├── routes.ts          # 路由聚合入口
│   ├── routes/            # 路由模块拆分
│   │   ├── auth.routes.ts
│   │   ├── rss-sources.routes.ts
│   │   ├── topic-domains.routes.ts
│   │   ├── topic-keywords.routes.ts
│   │   ├── llm-configs.routes.ts
│   │   ├── articles.routes.ts
│   │   ├── article-process.routes.ts
│   │   ├── filter.routes.ts
│   │   ├── search.routes.ts
│   │   ├── scheduler.routes.ts
│   │   └── settings.routes.ts
│   ├── web.ts             # Web 服务器
│   ├── rss-sources.ts     # RSS 源 CRUD
│   ├── articles.ts        # 文章服务
│   ├── article-process.ts # 文章处理服务
│   ├── topic-domains.ts   # 主题领域服务
│   ├── topic-keywords.ts  # 主题词服务
│   ├── keywords.ts        # 文章关键词服务
│   ├── translations.ts    # 文章翻译服务
│   ├── settings.ts        # 设置服务
│   └── filter.ts          # 过滤服务
├── middleware/            # 中间件
│   └── auth.ts           # JWT 认证
├── views/                # EJS 模板
│   ├── layout.ejs        # 主布局
│   ├── index.ejs         # 首页
│   ├── articles.ejs      # 文章列表
│   ├── article-detail.ejs# 文章详情
│   ├── search.ejs        # 搜索页面
│   ├── settings.ejs      # 设置页面
│   ├── topics.ejs        # 主题管理
│   ├── filter-logs.ejs   # 过滤日志
│   ├── filter-stats.ejs  # 过滤统计
│   ├── error.ejs         # 错误页面
│   └── login.ejs         # 登录页面
├── public/               # 静态资源
│   └── css/              # 样式文件
│       ├── base/         # 基础样式
│       │   ├── reset.css
│       │   └── typography.css
│       ├── design-system/# 设计系统
│       │   ├── tokens.css
│       │   ├── buttons.css
│       │   ├── forms.css
│       │   ├── cards.css
│       │   ├── badges.css
│       │   └── animations.css
│       ├── components/   # 组件样式
│       │   ├── page-header.css
│       │   ├── empty-state.css
│       │   ├── pagination.css
│       │   ├── loading.css
│       │   ├── filters.css
│       │   ├── tables.css
│       │   ├── status-badge.css
│       │   └── modal.css
│       ├── pages/        # 页面样式
│       └── main.css      # 主样式入口
├── scripts/              # 构建脚本
│   └── build-css.js      # CSS 构建脚本
├── utils/                # 工具函数
│   ├── crypto.ts         # 加密工具
│   └── markdown.ts       # Markdown 工具
├── vector/               # 向量检索模块
│   ├── chroma-client.ts      # Chroma 客户端单例
│   ├── embedding-client.ts  # Embedding 客户端
│   ├── vector-store.ts      # Chroma 向量存储
│   ├── reranker.ts          # Rerank 重排序
│   ├── indexer.ts           # 向量索引队列
│   ├── search-service.ts    # 统一检索服务
│   ├── search.ts            # 接口导出
│   └── text-builder.ts      # 向量化文本构建
├── config.ts             # 配置管理
├── logger.ts             # 日志模块
├── llm.ts                # LLM 抽象层
├── scraper.ts            # 网页抓取
├── rss-parser.ts         # RSS 解析
├── rss-scheduler.ts      # RSS 调度器
├── filter.ts             # 过滤引擎
├── agent.ts              # LLM 分析引擎
├── search.ts             # 搜索服务
├── export.ts             # 导出服务
├── pipeline.ts           # 文章处理流水线
├── db.ts                 # 数据库操作
└── index.ts              # 应用入口
```

---

## 数据模型

### 数据库表关系

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│   users     │     │ rss_sources │     │     articles     │
├─────────────┤     ├─────────────┤     ├──────────────────┤
│ id          │     │ id          │◄────│ id               │
│ username    │     │ user_id     │     │ title            │
│ password_hash│    │ name        │     │ url (UNIQUE)     │
│ created_at  │     │ url (UNIQUE)│     │ summary          │
│ updated_at  │     │ status      │     │ content          │
└─────────────┘     │ last_fetched│     │ markdown_content │
                    │ fetch_interval│    │ filter_status    │
                    │ ...         │     │ process_status   │
                    └─────────────┘     │ ...              │
                                         └──────────────────┘
                                               │
                                               ▼
┌──────────────────┐                  ┌──────────────────┐
│ topic_domains    │                  │article_filter_   │
├──────────────────┤                  │    logs          │
│ id               │                  ├──────────────────┤
│ user_id          │                  │ id               │
│ name             │                  │ article_id       │
│ description      │                  │ domain_id        │
│ is_active        │                  │ is_passed        │
│ priority         │                  │ relevance_score  │
│ ...              │                  │ matched_keywords │
└──────────────────┘                  │ filter_reason    │
          │                            │ llm_response     │
          ▼                            │ ...              │
┌──────────────────┐                  └──────────────────┘
│ topic_keywords   │
├──────────────────┤
│ id               │
│ domain_id        │
│ keyword          │
│ description      │
│ weight           │
│ is_active        │
│ ...              │
└──────────────────┘
          │
          │          ┌──────────────────┐
          └─────────►│ article_keywords │◄────────┐
                     ├──────────────────┤         │
                     │ article_id       │         │
                     │ keyword_id       │         │
                     │ ...              │         │
                     └──────────────────┘         │
                                ▲               │
                                │               │
                          ┌──────────────────┐  │
                          │ keywords         │  │
                          ├──────────────────┤  │
                          │ id               │  │
                          │ keyword (UNIQUE) │  │
                          │ ...              │  │
                          └──────────────────┘  │
                                                │
                          ┌───────────────────────┐
                          │ article_translations  │
                          ├───────────────────────┤
                          │ article_id (PK)       │
                          │ title_zh              │
                          │ summary_zh            │
                          │ source_lang           │
                          │ ...                   │
                          └───────────────────────┘

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   llm_configs    │  │     settings     │  │  system_prompts   │
├──────────────────┤  ├──────────────────┤  ├──────────────────┤
│ id               │  │ id               │  │ id               │
│ user_id          │  │ user_id          │  │ user_id          │
│ provider         │  │ key              │  │ type             │
│ base_url         │  │ value            │  │ name             │
│ api_key_encrypted│  │ updated_at       │  │ template         │
│ model            │  │ ...              │  │ variables        │
│ config_type      │  └──────────────────┘  │ is_active        │
│ enabled          │                       │ ...              │
│ is_default       │                       └──────────────────┘
│ timeout          │
│ max_retries      │
│ max_concurrent   │
│ ...              │
└──────────────────┘
```

### 核心表结构

#### users (用户表)

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### rss_sources (RSS 源表)

```sql
CREATE TABLE rss_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  last_fetched_at DATETIME,
  fetch_interval INTEGER DEFAULT 3600,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### articles (文章表)

```sql
CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rss_source_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  summary TEXT,
  content TEXT,
  markdown_content TEXT,
  filter_status TEXT DEFAULT 'pending' CHECK(filter_status IN ('pending', 'passed', 'rejected')),
  filter_score REAL,
  filtered_at DATETIME,
  process_status TEXT DEFAULT 'pending' CHECK(process_status IN ('pending', 'processing', 'completed', 'failed')),
  processed_at DATETIME,
  published_at DATETIME,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rss_source_id) REFERENCES rss_sources(id) ON DELETE CASCADE
);
```

#### topic_domains (主题领域表)

```sql
CREATE TABLE topic_domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, name)
);
```

#### topic_keywords (主题关键词表)

```sql
CREATE TABLE topic_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id INTEGER NOT NULL,
  keyword TEXT NOT NULL,
  description TEXT,
  weight REAL DEFAULT 1.0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (domain_id) REFERENCES topic_domains(id) ON DELETE CASCADE,
  UNIQUE(domain_id, keyword)
);
```

#### article_filter_logs (文章过滤日志表)

```sql
CREATE TABLE article_filter_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  domain_id INTEGER,
  is_passed INTEGER NOT NULL,
  relevance_score REAL,
  matched_keywords TEXT,
  filter_reason TEXT,
  llm_response TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (domain_id) REFERENCES topic_domains(id) ON DELETE SET NULL
);
```

#### keywords (关键词表)

```sql
CREATE TABLE keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at_TIMESTAMP
);
```

 DATETIME DEFAULT CURRENT#### article_keywords (文章-关键词关联表)

```sql
CREATE TABLE article_keywords (
  article_id INTEGER NOT NULL,
  keyword_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (article_id, keyword_id),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
);
```

#### article_translations (文章翻译表)

```sql
CREATE TABLE article_translations (
  article_id PRIMARY KEY,
  title_zh TEXT,
  summary_zh TEXT,
  source_lang TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);
```

#### llm_configs (LLM 配置表)

```sql
CREATE TABLE llm_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  model TEXT NOT NULL,
  config_type TEXT NOT NULL DEFAULT 'llm' CHECK(config_type IN ('llm', 'embedding', 'rerank')),
  enabled INTEGER DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  timeout INTEGER DEFAULT 30000,
  max_retries INTEGER DEFAULT 3,
  max_concurrent INTEGER DEFAULT 5,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**字段说明**:
- `config_type`: 配置类型，取值为 `llm`（LLM 模型）、`embedding`（向量化模型）、`rerank`（重排序模型）
- `enabled`: 是否启用（主要用于 rerank 配置）

#### settings (设置表)

```sql
CREATE TABLE settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, key)
);
```

**常用配置键**:
- `chroma_host`: Chroma 服务器地址（默认 `127.0.0.1`）
- `chroma_port`: Chroma 服务器端口（默认 `8000`）
- `chroma_collection`: Chroma 集合名称（默认 `articles`）
- `chroma_distance_metric`: 距离度量（默认 `cosine`）

#### system_prompts (系统提示词表)

```sql
CREATE TABLE system_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  variables TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

---

## 核心模块

### 1. RSS 调度器 (rss-scheduler.ts)

**职责**: 定时抓取 RSS 源，自动触发过滤

```typescript
class RSSScheduler {
  // 单例模式
  static getInstance(): RSSScheduler

  // 启动调度器
  start(): void

  // 停止调度器
  async stop(): Promise<void>

  // 立即抓取所有源
  async fetchAllNow(): Promise<void>

  // 立即抓取单个源
  async fetchSourceNow(sourceId: number): Promise<void>

  // 获取调度器状态
  getStatus(): SchedulerStatus

  // 内部方法：自动触发过滤
  private async triggerAutoFilter(
    userId: number,
    articleIds: number[],
    items: RSSFeedItem[]
  ): Promise<void>
}
```

**工作流程**:
```
RSS 抓取 → 保存文章 → 自动触发过滤 → 更新 filter_status
```

**特点**:
- 基于 node-cron v3 的定时调度
- 并发控制 (maxConcurrent)
- 指数退避重试机制
- 优雅关闭支持
- **自动过滤**: 新文章保存后自动触发过滤流程（非阻塞）

### 2. 过滤引擎 (filter.ts)

**职责**: 文章过滤（可选关键词预筛 + LLM 精确判断），自动更新文章状态

```typescript
// 两阶段过滤
async function filterArticle(
  input: FilterInput,
  options?: FilterOptions
): Promise<FilterResult>

// 阶段1: 关键词预筛（可选）
function keywordPreFilter(
  input: FilterInput
): Promise<KeywordMatchResult>

// 阶段2: LLM 判断
async function llmFilter(
  input: FilterInput,
  matchedDomains: Map<number, KeywordMatchData>
): Promise<LLMFilterResult>

// 自动更新文章状态
async function updateArticleFilterStatus(
  articleId: number,
  status: 'passed' | 'rejected',
  score: number
): Promise<void>
```

**流程**:
1. 关键词预筛选（可选，默认关闭）
2. LLM 精确判断 (JSON Mode)
3. 记录过滤日志
4. **自动更新** `filter_status` 到 `articles` 表

**配置说明**:
- `FilterOptions.useKeywordPrefilter` 控制是否启用关键词预筛（默认不启用）。
- 预筛关闭时：LLM 会对所有活跃领域进行评估。

**提示词要点**:
- 系统提示词为中文，包含 Role / Context & Constraints / Input Data Structure / Workflow。
- 关注领域配置包含主题词、权重与描述（含同义词），用于语义匹配。
- 输出格式保持 JSON 结构（`evaluations` 数组），用于后续处理。

### 3. 文章处理流水线 (pipeline.ts)

**职责**: 三阶段文章处理

```typescript
class ArticlePipeline {
  // 处理单篇文章
  async processArticle(articleId: number): Promise<void>

  // 批量处理待处理文章
  async processPendingArticles(): Promise<ProcessStats>

  // 重试失败的文章
  async retryFailedArticles(): Promise<void>
}
```

**三阶段处理**:

```
Stage 1: Scrape (抓取全文)
  ↓ 使用 scraper.ts
  ↓ 当前自动流程已暂停此阶段（skipScrape=true），仅保留手动触发时的抓取
  ↓ 抓取结果写入 markdown_content 前会进行质量保护（反爬/验证码/过短内容会被拒绝）
Stage 2: Analyze (LLM 关键词 + 翻译)
  ↓ 使用 agent.ts
  - 生成关键词（3-8 个）
  - 英文内容翻译为中文（题名/摘要）
Stage 3: Export (导出 Markdown)
  ↓ 使用 export.ts
  - 导出到 data/exports/
  - 触发向量索引（非阻塞）
```

**处理条件**: 只处理 `filter_status='passed'` 的文章

---

## 端到端工作流

### 文章生命周期

```
┌─────────────────────────────────────────────────────────────────┐
│  1. RSS 抓取 (rss-scheduler.ts)                                 │
│     ├─ 定时任务触发                                             │
│     ├─ 解析 RSS Feed                                           │
│     └─ 保存新文章 (filter_status='pending')                    │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. 自动过滤 (filter.ts)                                        │
│     ├─ 关键词预筛选（可选，默认关闭）                           │
│     ├─ LLM 精确判断                                             │
│     ├─ 记录过滤日志                                             │
│     └─ 更新 filter_status (passed/rejected)                    │
└─────────────────────────────────────────────────────────────────┘
                               │
                     ┌─────────┴─────────┐
                     ▼                   ▼
             filter_status=      filter_status=
               'passed'            'rejected'
                     │                   │
                     ▼                   (停止)
┌─────────────────────────────────────────────────────────────────┐
│  3. 文章处理 (pipeline.ts)                                      │
│     ├─ Stage 1: 抓取全文 (scraper.ts)                          │
│     ├─ Stage 2: LLM 关键词 + 翻译 (agent.ts)                   │
│     │   ├─ 生成关键词                                           │
│     │   └─ 英文翻译为中文                                       │
│     └─ Stage 3: 导出 Markdown (export.ts)                      │
│         ├─ 导出到 data/exports/                                 │
│         └─ 触发向量索引（非阻塞）                                │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. 语义搜索 (vector/search.ts)                                 │
│     ├─ 向量检索（Chroma + Embedding）                           │
│     ├─ 关键词搜索（SQLite LIKE，AND+OR 组合）                     │
│     ├─ 混合检索（向量 + 关键词融合）                             │
│     └─ Rerank 重排序（可选）                                    │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. 向量索引 (vector/indexer.ts)                                │
│     ├─ 文章导出后自动触发索引                                    │
│     ├─ 串行化写入避免并发冲突                                    │
│     └─ 按 user_id 分组写入                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## RSS 内容处理增强（最新）

为保证 `content` 与 `summary` 的语义正确并提升可用性，近期对 RSS 入库与处理流程做了以下增强：

### 1. 摘要字段策略

- `summary` 保存 RSS 原始摘要（description/contentSnippet），不再由 LLM 写入。

### 2. RSS 正文择优与 Markdown 化

- 从 RSS 原始字段中择优选择正文来源：`content` → `description` → `contentSnippet`。
- 选择策略采用"信息量评分"（正文长度 + 轻量权重），优先更丰富的内容。
- 入库时统一转换为 Markdown，写入 `content` 与 `markdown_content`（允许相同）。
- `content` 始终代表 RSS 正文；`markdown_content` 可能在手动抓取后被覆盖。

### 3. HTML 清洗与去噪

- 轻量清洗 HTML，移除 `script/style/nav/footer/aside/form` 等常见噪声区块。
- 删除常见广告/订阅/分享等页面块（基于 class/id 关键字）。
- 清理多余空行、短行与常见噪声文本。

### 4. 图片链接处理

- 转换过程中不保留图片链接，`<img>` 直接移除。
- Markdown 中的 `![](...)` 语法会被统一清除。

### 5. 过滤与后续处理

- 过滤阶段使用 RSS 的 `contentSnippet/description` 作为 `description` 输入，避免占用 `summary` 字段。
- 通过过滤后自动触发后续流程，但默认跳过"抓取全文"，仅执行：
  - LLM 关键词
  - 英文翻译（题名/摘要）

### 6. 页面展示策略

- 详情页始终显示 `content`（RSS 正文）。
- 当 `markdown_content` 存在且与 `content` 不同时，额外显示"抓取全文"区块。
- 抓取内容包含验证码/反爬提示或明显过短时不会覆盖 `markdown_content`。

### 7. LLM 分析引擎 (agent.ts)

**职责**: 关键词生成与英文翻译（不生成摘要）

```typescript
// 分析文章
async function analyzeArticle(
  input: KeywordInput,
  userId?: number,
  fallbackKeywords?: string[]
): Promise<AnalysisResult>

// 生成关键词
async function generateKeywords(
  input: KeywordInput,
  userId?: number,
  fallbackKeywords?: string[]
): Promise<KeywordResult>

// 英文翻译为中文（题名/摘要）
async function translateIfNeeded(
  title?: string,
  summary?: string,
  userId?: number
): Promise<TranslationResult | null>
```

**提示词模板**: 存储在 `system_prompts` 表

### 8. 搜索服务 (search.ts)

**职责**: 文章搜索，支持向量检索和关键词搜索

```typescript
// 历史文章搜索（SQLite LIKE）
async function searchHistoricalArticles(
  query: string,
  limit?: number,
  userId?: number
): Promise<SearchResult[]>

// 向量检索入口
async function searchWithVector(
  query: string,
  limit?: number,
  userId?: number
): Promise<SearchResult[]>

// 混合检索
async function searchMixed(
  query: string,
  limit?: number,
  userId?: number
): Promise<SearchResult[]>

// 查找相关文章
async function findRelatedArticles(
  articleId: number,
  limit?: number,
  userId?: number
): Promise<SearchResult[]>
```

**搜索逻辑**:

关键词搜索采用 **AND + OR 组合**策略：
- 将查询字符串按空格拆分为多个词
- **每个词都必须出现**（AND 逻辑）
- 每个词可以在标题、摘要或正文任一字段中出现（OR 逻辑）

示例：查询 `"machine learning python"`
- 拆分为：`["machine", "learning", "python"]`
- 匹配条件：`machine` AND `learning` AND `python`
- 每个词可在 `title`、`summary` 或 `markdown_content` 中出现

---

## 向量检索模块

### 1. chroma-client.ts

**职责**: Chroma 客户端单例管理，自动管理连接避免连接问题

```typescript
// 获取用户对应的 Chroma 客户端实例（单例）
async function getChromaClient(userId: number): Promise<Client>

// 关闭客户端连接
async function closeClient(userId: number): Promise<void>

// 清空所有客户端缓存
async function clearAllClients(): Promise<void>
```

**特点**:
- 每个用户一个缓存的客户端实例
- 自动管理连接生命周期
- 避免重复创建连接导致的资源浪费

### 2. embedding-client.ts

**职责**: OpenAI 兼容 Embedding 调用（硅基流动）

```typescript
// 获取单条文本的向量
async function getEmbedding(text: string): Promise<number[]>

// 批量获取向量
async function getEmbeddingsBatch(texts: string[]): Promise<number[][]>

// 配置获取
async function getEmbeddingConfig(): Promise<EmbeddingConfig>
```

**特点**:
- 支持超时/重试/批量处理
- 通过 `llm_configs` 获取 `embedding` 配置
- 硅基流动兼容 OpenAI API 格式

### 3. vector-store.ts

**职责**: Chroma 本地存储管理

```typescript
// 获取或创建 collection
async function getOrCreateCollection(): Promise<Collection>

// 写入向量
async function upsert(
  ids: string[],
  embeddings: number[][],
  metadatas: object[],
  documents: string[]
): Promise<void>

// 查询向量
async function query(
  embedding: number[],
  topK: number,
  filter?: object
): Promise<VectorHit[]>

// 删除向量
async function delete(ids: string[]): Promise<void>

// 清空 collection
async function clear(): Promise<void>
```

**配置**:
- `chroma_host`: 默认 `127.0.0.1`
- `chroma_port`: 默认 `8000`
- `chroma_collection`: 默认 `articles`
- `chroma_distance_metric`: 默认 `cosine`

### 4. reranker.ts

**职责**: 硅基流动 rerank 接口封装

```typescript
// 重排序
async function rerank(
  query: string,
  documents: string[],
  topN?: number
): Promise<Array<{ index: number; score: number }>>

// 检查 rerank 是否启用
async function isRerankEnabled(): Promise<boolean>
```

**触发条件**:
- `rerank` 配置存在且 `enabled=true`
- 仅对候选文档进行重排序，不改变候选集合

### 5. indexer.ts

**职责**: 向量索引队列，串行化写入避免并发冲突

```typescript
// 索引单篇文章
async function indexArticle(articleId: number): Promise<void>

// 批量索引
async function indexArticles(articleIds: number[]): Promise<void>

// 删除向量
async function deleteArticle(articleId: number): Promise<void>

// 清空用户索引
async function clearUserIndex(userId: number): Promise<void>
```

**特点**:
- 按 `user_id` 分组写入
- 支持防抖和请求合并
- 非阻塞索引

### 6. search-service.ts

**职责**: 统一检索入口，支持四种检索模式

```typescript
import { search, SearchMode } from './search.js';

// 统一检索入口
async function search(request: SearchRequest): Promise<SearchResponse>

// SearchMode 枚举
enum SearchMode {
  SEMANTIC = 'semantic',   // 纯语义检索（向量相似度）
  KEYWORD = 'keyword',     // 纯关键词检索（SQL LIKE）
  HYBRID = 'hybrid',       // 混合检索（语义 + 关键词）
  RELATED = 'related',     // 相关文章检索
}
```

**SearchRequest 接口**:
```typescript
interface SearchRequest {
  mode: SearchMode;        // 检索模式
  userId: number;          // 用户 ID
  query?: string;          // 文本查询（SEMANTIC/KEYWORD/HYBRID）
  articleId?: number;      // 文章 ID（RELATED）
  limit?: number;          // 返回数量（默认 10）
  offset?: number;         // 分页偏移（默认 0）
  semanticWeight?: number; // 语义权重（默认 0.7）
  keywordWeight?: number;  // 关键词权重（默认 0.3）
  normalizeScores?: boolean; // 是否归一化语义分数（默认 true）
  useCache?: boolean;      // 是否使用缓存（RELATED，默认 true）
  refreshCache?: boolean;  // 强制刷新缓存（默认 false）
  fallbackEnabled?: boolean; // 是否启用回退（HYBRID，默认 true）
}
```

**SearchResponse 接口**:
```typescript
interface SearchResponse {
  results: SearchResult[]; // 检索结果
  mode: SearchMode;        // 实际使用的模式
  query?: string;          // 查询文本
  total: number;           // 结果总数
  page?: number;           // 当前页码
  limit?: number;          // 每页数量
  cached: boolean;         // 是否来自缓存
  fallback?: boolean;      // 是否使用了回退机制
}
```

**SearchResult 接口**:
```typescript
interface SearchResult {
  articleId: number;       // 文章 ID
  score: number;           // 最终融合分数
  semanticScore?: number;  // 语义分数（调试用）
  keywordScore?: number;   // 关键词分数（调试用）
  metadata?: {
    title: string;
    url: string;
    summary: string | null;
    published_at: string | null;
    rss_source_name?: string;
  };
}
```

### 7. text-builder.ts

**职责**: 向量化文本构建

```typescript
// 构建单篇文章的向量文档
async function buildDocument(articleId: number): Promise<{
  id: string;
  document: string;
  metadata: {
    articleId: number;
    userId: number;
    title: string;
    publishedAt: string;
  };
}>

// 批量构建
async function buildBatch(
  articleIds: number[]
): Promise<Array<{
  id: string;
  document: string;
  metadata: object;
}>>

// 构建向量化文本
function buildVectorText(article: Article): string
```

**向量化内容格式**:
```
TITLE: {title}
SUMMARY: {summary}
CONTENT: {content}
```

**规则**:
- `summary` 为空则忽略
- 统一在索引时构建，避免重复逻辑

---

## API 接口

### 认证相关

```
POST   /login          # 用户登录
POST   /logout         # 用户登出
```

### RSS 源管理

```
GET    /api/rss-sources          # 获取 RSS 源列表
GET    /api/rss-sources/:id      # 获取单个 RSS 源
POST   /api/rss-sources          # 创建 RSS 源
PUT    /api/rss-sources/:id      # 更新 RSS 源
DELETE /api/rss-sources/:id      # 删除 RSS 源
POST   /api/rss-sources/:id/fetch    # 立即抓取
POST   /api/rss-sources/fetch-all    # 抓取全部
POST   /api/rss-sources/validate     # 验证 URL
```

### 文章管理

```
GET    /api/articles             # 文章列表
GET    /api/articles/:id         # 文章详情
DELETE /api/articles/:id         # 删除文章
GET    /api/articles/stats       # 统计数据
GET    /api/articles/:id/related # 相关文章
```

### 文章处理

```
POST   /api/articles/:id/process        # 触发处理
POST   /api/articles/process-batch      # 批量处理
POST   /api/articles/:id/retry          # 重试失败
GET    /api/articles/process-stats      # 处理统计
GET    /api/articles/pending            # 待处理列表
GET    /api/articles/failed             # 失败列表
```

### 主题管理

```
GET    /api/topic-domains                    # 领域列表
GET    /api/topic-domains/:id                # 领域详情
POST   /api/topic-domains                    # 创建领域
PUT    /api/topic-domains/:id                # 更新领域
DELETE /api/topic-domains/:id                # 删除领域
GET    /api/topic-domains/with-keyword-count # 带关键词数
```

```
GET    /api/topic-domains/:domainId/keywords # 关键词列表
GET    /api/topic-keywords/all               # 所有关键词
POST   /api/topic-keywords                   # 创建关键词
PUT    /api/topic-keywords/:id               # 更新关键词
DELETE /api/topic-keywords/:id               # 删除关键词
```

### 过滤

```
POST   /api/filter/article       # 过滤单篇文章
GET    /api/filter/logs          # 过滤日志
GET    /api/filter/stats         # 过滤统计
```

### 搜索

```
GET    /api/search?q={query}&mode={mode}  # 统一搜索接口
```

**搜索模式（mode 参数）**:
| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `semantic` | 纯语义检索（向量相似度） | 自然语言理解查询 |
| `keyword` | 纯关键词检索（SQL LIKE） | 精确匹配，性能最好 |
| `hybrid` | 混合检索（语义 + 关键词，默认） | 平衡准确性和召回率 |
| `related` | 相关文章检索 | 文章推荐 |

**URL 参数**:
| 参数 | 必填 | 说明 |
|------|------|------|
| `q` | 是 | 搜索查询词（related 模式不需要） |
| `mode` | 否 | 搜索模式，默认 `hybrid` |
| `page` | 否 | 页码，默认 1 |
| `limit` | 否 | 每页数量，默认 10 |

**响应格式**:
```json
{
  "results": [{"id": 1, "title": "...", "relevance": 0.85}],
  "total": 100,
  "page": 1,
  "fallback": false
}
```

**搜索模式说明**:
- `semantic`: 使用向量检索（Chroma + Embedding），支持自然语言查询
- `keyword`: 使用 SQLite LIKE 搜索，采用 AND+OR 组合逻辑
  - 查询按空格拆分为多个词
  - 每个词都必须出现（AND 逻辑）
  - 每个词可在标题、摘要或正文中出现（OR 逻辑）
- `hybrid`: 向量检索与关键词搜索融合
  - 语义分数与关键词相关度线性融合
  - 默认权重：语义 0.7 / 关键词 0.3
  - 支持回退机制：语义检索失败时自动回退到关键词检索
- `related`: 基于文章 ID 推荐相关文章
  - 支持缓存，首次计算后保存到数据库

### 调度器

```
GET    /api/scheduler/status    # 调度器状态
```

### 设置

```
GET    /api/settings            # 获取设置
PUT    /api/settings            # 更新设置
GET    /api/settings/chroma    # 获取 Chroma 配置
PUT    /api/settings/chroma    # 更新 Chroma 配置
```

### LLM 配置

```
GET    /api/llm-configs              # 获取配置列表
GET    /api/llm-configs/:id          # 获取单个配置
POST   /api/llm-configs              # 创建配置
PUT    /api/llm-configs/:id          # 更新配置
DELETE /api/llm-configs/:id          # 删除配置
GET    /api/llm-configs/type/:type   # 按类型获取配置
```

---

## 开发环境

### 环境要求

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- TypeScript 5.9

### 本地开发

```bash
# 克隆项目
git clone https://github.com/yourusername/lis-rss-daily.git
cd lis-rss-daily

# 安装依赖
pnpm install

# 复制环境变量
cp .env.example .env

# 编辑 .env，添加 API Key
nano .env

# 初始化数据库
pnpm run db:migrate
pnpm run db:seed  # 可选

# 启动开发服务器
pnpm dev
```

### Chroma 向量数据库

系统使用 Chroma 作为向量数据库，需要单独启动：

```bash
# 使用 Docker 启动 Chroma
docker run -d -p 8000:8000 chromadb/chroma

# 或使用本地安装
pip install chromadb
chromadb run --host 127.0.0.1 --port 8000
```

### 开发工具

```bash
# 类型检查
pnpm typecheck

# 运行迁移
pnpm run db:migrate

# 填充示例数据
pnpm run db:seed
```

### VS Code 配置

推荐扩展：
- TypeScript
- EJS Language Support
- SQLite Viewer

---

## 代码规范

### TypeScript 规范

```typescript
// 使用 const 断言定义常量
const FILTER_STATUS = {
  PASSED: 'passed',
  REJECTED: 'rejected',
  PENDING: 'pending'
} as const;

// 函数参数类型明确
async function filterArticle(
  article: Article,
  domains: TopicDomain[]
): Promise<FilterResult> {
  // ...
}

// 错误处理
try {
  await riskyOperation();
} catch (error) {
  logger.error('Operation failed', { error });
  throw new AppError('Operation failed', 500);
}
```

### 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `rss-scheduler.ts` |
| 类名 | PascalCase | `RSSScheduler` |
| 函数名 | camelCase | `filterArticle` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRIES` |
| 接口 | PascalCase, I 前缀 | `FilterResult` |
| 类型 | PascalCase | `Article` |

### 日志规范

```typescript
import logger from './logger.js';

logger.info('Article fetched', { articleId, sourceId });
logger.warn('RSS source unavailable', { url, error });
logger.error('LLM call failed', { error, retryCount });
```

---

## 测试指南

### 测试结构

```
tests/
├── unit/           # 单元测试
│   ├── filter.test.ts
│   ├── agent.test.ts
│   └── search.test.ts
├── integration/    # 集成测试
│   ├── api.test.ts
│   └── pipeline.test.ts
└── e2e/           # 端到端测试
    └── flow.test.ts
```

### 运行测试

```bash
# 运行所有测试
pnpm test

# 单元测试
pnpm test:unit

# 集成测试
pnpm test:integration

# 覆盖率报告
pnpm test:coverage
```

---

## 扩展开发

### 添加新的 RSS 源类型

继承 `RSSParser` 类并实现 `parse()` 方法。

### 自定义 LLM 提示词

在 `system_prompts` 表中添加新模板，或在 `agent.ts` 中修改。

### 添加新的搜索后端

在 `vector/search.ts` 中实现新的搜索函数。

### 添加新的 Embedding 提供商

在 `vector/embedding-client.ts` 中实现新的 Provider。

---

## 性能优化

### 数据库

- 为常用查询字段添加索引
- 使用 Kysely 的 `executeTakeFirst()` 优化单条查询

### LLM 调用

- 使用 JSON Mode 减少重试
- 批量处理时控制并发数
- 实现简单的结果缓存

### RSS 抓取

- 并发控制防止过载
- 增量抓取避免重复
- 指数退避处理失败

### 向量检索

- 批量 Embedding 提高效率
- 合理设置 topK 参数
- Rerank 可选，节省 API 调用

---

## 故障排查

### 调试模式

```bash
# 启用调试日志
DEBUG=* pnpm dev

# 仅查看特定模块
DEBUG=rss-scheduler:* pnpm dev
```

### 常见问题

1. **数据库锁定**: 检查是否有其他进程占用
2. **LLM 超时**: 调整 `LLM_TIMEOUT` 环境变量
3. **Playwright 失败**: 运行 `npx playwright install chromium`
4. **Chroma 连接失败**: 检查 Chroma 服务是否启动，默认端口 8000
5. **向量检索无结果**: 检查 Embedding 配置是否正确
6. **Rerank 不生效**: 检查 `rerank` 配置是否存在且 `enabled=1`

---

## 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

### Pull Request 模板

```markdown
## 描述
简要描述此 PR 的目的

## 更改类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 重构
- [ ] 文档更新

## 测试
- [ ] 单元测试通过
- [ ] 集成测试通过

## 检查清单
- [ ] 代码符合规范
- [ ] 文档已更新
- [ ] 无破坏性更改
```

---

## 许可证

MIT License - 详见 [LICENSE](../LICENSE)

---

**欢迎贡献！**
