# 开发者文档

本文档面向开发者，介绍 RSS Literature Tracker 的架构设计、技术细节和开发指南。

---

## 目录

- [架构概览](#架构概览)
- [数据模型](#数据模型)
- [核心模块](#核心模块)
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
│   ├── routes.ts          # 路由定义
│   ├── web.ts             # Web 服务器
│   ├── rss-sources.ts     # RSS 源 CRUD
│   ├── articles.ts        # 文章服务
│   ├── article-process.ts # 文章处理服务
│   ├── topic-domains.ts   # 主题领域服务
│   ├── topic-keywords.ts  # 主题词服务
│   └── settings.ts        # 设置服务
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
│   └── login.ejs         # 登录页面
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
├── qmd.ts                # QMD 工具
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
│ username    │     │ name        │     │ title            │
│ password    │     │ url         │     │ url (UNIQUE)     │
│ └───────────┘     │ enabled     │     │ content          │
                   │ ...         │     │ filter_status    │
                   └─────────────┘     │ process_status   │
                                        │ summary          │
┌──────────────────┐                  │ tags             │
│ topic_domains    │                  │ insights         │
├──────────────────┤                  │ rss_source_id    │
│ id               │                  │ ...              │
│ name             │                  └──────────────────┘
│ ...              │                          │
└──────────────────┘                          │
         │                                    ▼
         │                          ┌──────────────────┐
         │                          │article_filter_   │
         │                          │    logs          │
         ▼                          ├──────────────────┤
┌──────────────────┐                  │ id               │
│ topic_keywords   │                  │ article_id       │
├──────────────────┤                  │ domain_id        │
│ id               │                  │ result           │
│ domain_id        │                  │ reason           │
│ keyword          │                  │ ...              │
│ ...              │                  └──────────────────┘
└──────────────────┘
```

### 核心表结构

#### articles (文章表)

```sql
CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rss_source_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT UNIQUE NOT NULL,
  author TEXT,
  published_at TEXT,
  content TEXT,
  raw_content TEXT,
  summary TEXT,           -- AI 生成的中文摘要
  tags TEXT,              -- JSON 数组，AI 提取的标签
  insights TEXT,          -- JSON 数组，研究洞察
  filter_status TEXT,     -- 'passed' | 'rejected' | 'pending'
  filter_reason TEXT,
  filter_domain_id INTEGER,
  process_status TEXT,    -- 'pending' | 'processing' | 'completed' | 'failed'
  process_retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rss_source_id) REFERENCES rss_sources(id)
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

**职责**: 两阶段文章过滤，自动更新文章状态

```typescript
// 两阶段过滤
async function filterArticle(
  input: FilterInput,
  options?: FilterOptions
): Promise<FilterResult>

// 阶段1: 关键词匹配
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
1. 关键词预筛选 (快速拒绝)
2. LLM 精确判断 (JSON Mode)
3. 记录过滤日志
4. **自动更新** `filter_status` 到 `articles` 表

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
Stage 2: Analyze (LLM 分析)
  ↓ 使用 agent.ts
  - 生成中文摘要 (200-300字)
  - 提取标签 (3-5个)
  - 生成研究洞察 (2-4条)
  - 查找相关文章
Stage 3: Export (导出 Markdown)
  ↓ 使用 export.ts
  - 导出到 data/exports/
  - 链接到 QMD 集合
  - 触发 QMD 索引
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
│     ├─ 关键词预筛选                                             │
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
│     ├─ Stage 2: LLM 分析 (agent.ts)                            │
│     │   ├─ 生成中文摘要                                         │
│     │   ├─ 提取研究标签                                         │
│     │   ├─ 生成核心洞察                                         │
│     │   └─ 查找相关文章                                         │
│     └─ Stage 3: 导出 Markdown (export.ts)                      │
│         ├─ 导出到 data/exports/                                 │
│         └─ 链接到 QMD 集合                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. 语义搜索 (search.ts + qmd.ts)                               │
│     └─ 支持自然语言查询相关文章                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4. LLM 分析引擎 (agent.ts)

**职责**: 文章智能分析

```typescript
// 分析文章
async function analyzeArticle(
  article: Article,
  searchFn: (query: string) => Promise<Article[]>
): Promise<ArticleAnalysis>

// 生成摘要
async function generateSummary(content: string): Promise<string>

// 提取标签
async function extractTags(content: string): Promise<string[]>

// 生成洞察
async function generateInsights(
  content: string,
  summary: string
): Promise<string[]>
```

**提示词模板**: 存储在 `system_prompts` 表

### 5. 搜索服务 (search.ts)

**职责**: 文章搜索，支持 QMD 语义搜索

```typescript
// 语义搜索
async function searchArticlesWithQMD(
  query: string,
  limit?: number
): Promise<SearchResult[]>

// 关键词搜索 (降级方案)
async function searchArticlesWithKeyword(
  query: string,
  limit?: number
): Promise<SearchResult[]>
```

**QMD 集成**:
- `qmdVsearchWithRetry()`: 带重试的向量搜索
- 优雅降级: QMD 失败时回退到 SQLite LIKE

### 6. QMD 工具 (qmd.ts)

**职责**: QMD 向量搜索集成

```typescript
// 初始化 QMD 集合
async function initQmdCollection(): Promise<void>

// 链接文件到 QMD 集合
async function linkFileToQmdCollection(
  srcPath: string,
  destName: string
): Promise<void>

// 检查 QMD 是否可用
async function checkQmdAvailable(): Promise<boolean>
```

**索引队列** (export.ts):
- `QmdIndexQueue`: 请求合并 + 序列化
- 防止并发索引冲突

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
GET    /api/search?q={query}&mode=semantic  # 语义搜索
GET    /api/search?q={query}&mode=keyword   # 关键词搜索
```

### 调度器

```
GET    /api/scheduler/status    # 调度器状态
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

在 `search.ts` 中实现新的搜索函数，注册到 `searchArticles`。

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
