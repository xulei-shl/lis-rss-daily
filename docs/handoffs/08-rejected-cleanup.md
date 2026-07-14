# 08 · 自动清理拒绝文章子系统 Handoff（规划文档）

> 本文档是**规划方案**，描述「自动清理被 LLM 过滤拒绝的文章」功能的完整设计。
> 待实现完成后，修订为正式交接文档。

---

## 1. 背景与目标

**现状**：系统有 4 类来源（RSS/期刊/关键词/Gmail），大量文章被 LLM 过滤拒绝（`filter_status='rejected'`），但**永久保留在 `articles` 表中**。随着时间推移，`articles` 表膨胀，查询性能下降，而 rejected 文章在前端默认已被排除（`excludeRejected: true`），保留在正式表中仅有数据冗余的负面效果。

**目标**：
1. 为每个源新增 `auto_cleanup_rejected` 开关字段，默认关闭（opt-in）
2. 定时调度器将标记源下的 rejected 文章**从 `articles` 表迁移到 `rejected_articles` 归档表**，附带关联数据（过滤日志、翻译、处理日志、相关文章）
3. 保持 `articles` 表轻量，保障查询性能
4. 被拒数据不丢失，可后续在归档表中查询

---

## 2. 数据流

```
[源表 auto_cleanup_rejected = 1]
    │
    ▼
[rejected-cleanup-scheduler]  ← cron 每天 5:00
    │
    │  对每个开启的源：
    │  1. SELECT articles WHERE filter_status='rejected' AND source_id = ?
    │  2. 收集关联数据：filter_logs / translations / process_logs / related
    │  3. BEGIN TRANSACTION
    │  4. INSERT INTO rejected_articles (含 JSON 打包的关联数据)
    │  5. DELETE FROM articles WHERE id = ?  (级联删除关联表数据)
    │  6. COMMIT
    ▼
[rejected_articles]  ← 归档表，保留全部字段 + 关联数据 JSON
```

---

## 3. 数据库变更

### 3.1 四张源表各新增 `auto_cleanup_rejected` 字段

```sql
ALTER TABLE rss_sources ADD COLUMN auto_cleanup_rejected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE journals ADD COLUMN auto_cleanup_rejected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE keyword_subscriptions ADD COLUMN auto_cleanup_rejected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_sources ADD COLUMN auto_cleanup_rejected INTEGER NOT NULL DEFAULT 0;
```

- 类型：`INTEGER NOT NULL DEFAULT 0`
- 取值：`0` = 关闭（默认），`1` = 开启自动清理
- 索引：每张表加 `idx_<table>_auto_cleanup` 索引

### 3.2 新增 `rejected_articles` 归档表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK | 原 articles.id（非自增，保持原 ID） |
| _(articles 全部字段)_ | — | 与 articles 表一一对应 |
| `filter_logs_data` | TEXT | `article_filter_logs` 关联行 JSON 数组 |
| `translation_data` | TEXT | `article_translations` 关联行 JSON 对象 |
| `process_logs_data` | TEXT | `article_process_logs` 关联行 JSON 数组 |
| `related_data` | TEXT | `article_related` 关联行 JSON 数组 |
| `source_name` | TEXT | 来源名称（RSS 源名称/期刊名/关键词） |
| `moved_at` | TEXT | 迁移时间戳，默认 `datetime('now','localtime')` |

### 3.3 文件清单

| 文件 | 状态 | 说明 |
|------|------|------|
| `sql/001_init.sql` | ✅ **已更新** | 4 源表加字段 + `rejected_articles` 建表 |
| `sql/038_add_auto_cleanup_rejected.sql` | ✅ **已创建** | 迁移脚本 |
| `scripts/migrate.ts` | ⏳ 待实现 | 添加 038 迁移处理分支 |

---

## 4. 配置变更

### 4.1 `src/config.ts`

新增配置项：

```typescript
// 接口
rejectedCleanupEnabled: boolean;   // 是否启用清理调度器
rejectedCleanupSchedule: string;   // cron 表达式

// 默认值
rejectedCleanupEnabled: process.env.REJECTED_CLEANUP_ENABLED !== 'false',
rejectedCleanupSchedule: process.env.REJECTED_CLEANUP_SCHEDULE || '0 5 * * *',  // 每天 5:00
```

---

## 5. 新增调度器 `src/rejected-cleanup-scheduler.ts`

### 5.1 类结构（沿用 Singleton + node-cron 模式）

```typescript
export class RejectedCleanupScheduler {
  private static instance: RejectedCleanupScheduler | null = null;
  private scheduledTask: cron.ScheduledTask | null = null;
  private isRunning = false;

  static getInstance(): RejectedCleanupScheduler;
  start(): void;
  stop(): Promise<void>;
  cleanupNow(): Promise<CleanupResult>;  // 手动触发
}
```

### 5.2 核心逻辑 `cleanupSources()`

```
1. 收集所有开启了 auto_cleanup_rejected=1 的源（4 类 UNION ALL）：
   - 类型 + 源 ID + 源名称 + 用户 ID

2. 对每个源：
   a. 查询该源关联的 filter_status='rejected' 的文章列表
   b. 对每篇文章：
      - 收集 filter_logs → JSON 序列化
      - 收集 translation → JSON 序列化
      - 收集 process_logs → JSON 序列化
      - 收集 related → JSON 序列化
      - BEGIN TRANSACTION
      - INSERT INTO rejected_articles (含全部字段 + JSON 数据 + source_name)
      - DELETE FROM articles WHERE id = ?  (级联删除关联表)
      - COMMIT
   c. 记录统计日志

3. 返回清理结果汇总
```

### 5.3 注册到 `src/index.ts`

```typescript
import { initRejectedCleanupScheduler } from './rejected-cleanup-scheduler.js';

// 在 main() 中，放在所有采集调度器之后：
const rejectedCleanupScheduler = initRejectedCleanupScheduler();
if (config.rejectedCleanupEnabled) {
  rejectedCleanupScheduler.start();
  log.info(`🗑️ Rejected article cleanup scheduler started (schedule: ${config.rejectedCleanupSchedule})`);
}

// 在 shutdown() 中：
await rejectedCleanupScheduler.stop();
```

---

## 6. 类型定义变更 `src/db.ts`

### 6.1 四张源表接口各加一个字段

```typescript
// RssSourcesTable
export interface RssSourcesTable {
  // ... 现有字段
  auto_cleanup_rejected: number;
}

// JournalsTable, KeywordSubscriptionsTable, EmailSourcesTable 同理
```

### 6.2 新增 `RejectedArticlesTable` 接口

```typescript
export interface RejectedArticlesTable {
  id: number;
  rss_source_id: number | null;
  journal_id: number | null;
  keyword_id: number | null;
  email_source_id: number | null;
  title: string;
  title_normalized: string | null;
  url: string;
  summary: string | null;
  content: string | null;
  markdown_content: string | null;
  filter_status: string | null;
  filter_score: number | null;
  filtered_at: string | null;
  process_status: string | null;
  process_stages: string | null;
  processed_at: string | null;
  published_at: string | null;
  published_year: number | null;
  published_issue: number | null;
  published_volume: number | null;
  error_message: string | null;
  is_read: number | null;
  source_origin: string | null;
  rating: number | null;
  ai_summary: string | null;
  created_at: string | null;
  updated_at: string | null;
  filter_logs_data: string | null;
  translation_data: string | null;
  process_logs_data: string | null;
  related_data: string | null;
  source_name: string | null;
  moved_at: string | null;
}
```

### 6.3 注册到 `DatabaseTable`

```typescript
export interface DatabaseTable {
  // ... 现有表
  rejected_articles: RejectedArticlesTable;
}
```

---

## 7. API 层变更

四类源的创建/编辑/获取 API 需支持 `auto_cleanup_rejected` 字段的读写。

### 受影响的路由文件

| 路由文件 | 变更 |
|----------|------|
| `src/api/routes/rss-sources.routes.ts` | POST/PUT 支持 `auto_cleanup_rejected`，GET 返回该字段 |
| `src/api/routes/journals.routes.ts` | 同上 |
| `src/api/routes/keyword-subscriptions.routes.ts` | 同上 |
| `src/api/routes/gmail-sources.routes.ts` | 同上 |

### 数据结构变更

每类源的创建/更新请求体中增加可选字段：

```typescript
{
  // ... 现有字段
  auto_cleanup_rejected?: boolean;  // 前端传 boolean，后端转 integer
}
```

响应体中原有字段序列化时增加 `auto_cleanup_rejected`。

---

## 8. 迁移脚本集成 `scripts/migrate.ts`

在 `migrate.ts` 中添加 038 迁移处理分支：

```typescript
// ============================================================
// 038: 添加自动清理拒绝文章的字段和归档表
// ============================================================
if (file === '038_add_auto_cleanup_rejected.sql') {
  const hasAutoCleanup = hasColumn(db, 'rss_sources', 'auto_cleanup_rejected');
  if (!hasAutoCleanup) {
    const sql = fs.readFileSync(fullPath, 'utf-8');
    db.exec(sql);
    console.log('      → Added auto_cleanup_rejected to rss_sources, journals, keyword_subscriptions, email_sources');
    console.log('      → Created rejected_articles archive table');
  } else {
    console.log('      → Skipped (auto_cleanup_rejected already exists)');
  }
  continue;
}
```

---

## 9. 验证要点

| 验证项 | 方法 |
|--------|------|
| 新表创建 | `npm run db:migrate` 后确认 `rejected_articles` 表存在 |
| 字段添加 | 确认 4 张源表均有 `auto_cleanup_rejected` 列，默认值 0 |
| 调度器启动 | 启动日志显示 `🗑️ Rejected article cleanup scheduler started` |
| 手动触发 | 调用 `cleanupNow()` 确认文章从 articles 移到 rejected_articles |
| 关联数据完整性 | 检查 rejected_articles 的 JSON 字段包含正确的 filter_logs/translations 等 |
| 级联删除 | 确认迁移后原 articles 行及其关联数据已删除 |
| 前端查询性能 | 对比迁移前后 `getUserArticles` 查询时间 |
| 归档数据可查 | 直接查询 `SELECT * FROM rejected_articles WHERE source_name = ?` |

---

## 10. 涉及文件汇总

| 文件 | 操作 | 说明 |
|------|------|------|
| `sql/001_init.sql` | ✅ 已更新 | 4 源表加字段 + `rejected_articles` 建表 |
| `sql/038_add_auto_cleanup_rejected.sql` | ✅ 已创建 | 迁移脚本 |
| `src/db.ts` | ⏳ 待实现 | 类型定义 |
| `src/config.ts` | ⏳ 待实现 | 新增配置项 |
| `src/rejected-cleanup-scheduler.ts` | ⏳ 待实现 | 独立调度器 |
| `src/index.ts` | ⏳ 待实现 | 注册调度器 |
| `scripts/migrate.ts` | ⏳ 待实现 | 添加 038 迁移分支 |
| `src/api/routes/rss-sources.routes.ts` | ⏳ 待实现 | API 支持新字段 |
| `src/api/routes/journals.routes.ts` | ⏳ 待实现 | API 支持新字段 |
| `src/api/routes/keyword-subscriptions.routes.ts` | ⏳ 待实现 | API 支持新字段 |
| `src/api/routes/gmail-sources.routes.ts` | ⏳ 待实现 | API 支持新字段 |
| (Web UI 表单页面) | ⏳ 待实现 | 前端开关 |

---

## 11. 与旧报告的差异

- 本功能为新功能，此前的 handoff 文档中不存在。
- 过滤逻辑（`src/filter.ts`）完全不变，仅新增清理环节。