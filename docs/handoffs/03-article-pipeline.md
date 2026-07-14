# 03 · 文章处理流水线 Handoff

> 过滤通过后的 4 阶段渐进式处理：Markdown → 翻译 → 向量索引 → 相关文章。具幂等性与（仅翻译阶段的）重试能力。
> 关键源文件：`src/pipeline.ts`、`src/agent.ts`、`src/api/article-process.ts`、`src/api/articles-refresh.ts`、`src/related-scheduler.ts`、`src/scraper.ts`、`src/export.ts`、`src/api/articles.ts`、`src/utils/markdown.ts`，路由 `article-process.routes.ts`、`articles.routes.ts`。

## 1. `processArticle(articleId, userId, options?)`（`src/pipeline.ts:180`）

流程：

1. `getArticleById`（`articles.ts:336`）；找不到 → `{status:'failed', error:'Article not found'}`（`:189-197`）。
2. **前置门槛**：仅当 `article.filter_status === 'passed'` 才继续；否则写 `skipped` 处理日志（`stage:'pipeline_complete'`）并返回 `{status:'skipped', reason}`（`:200-221`）。**未通过过滤的文章永不处理**。
3. `updateArticleProcessStatus(articleId,'processing')`（`:224`）。
4. 委派内部 `runPipeline(...)`（`:379`）。

### 四阶段（`runPipeline`, `:379-584`）

> **近期重构（2026-07-14）**：`runPipeline` 不再把 4 个阶段的内联代码写在一个 ~205 行函数里，而是仅做编排，每个阶段拆为私有方法：`runStageMarkdown` / `runStageTranslate` / `runStageVector` / `runStageRelated`（均在 `pipeline.ts`）。`runStageTranslate` 返回 `{ success, translationChanged, ... }`，`runStageVector` 据此决定是否因翻译变化而重索引。行为语义与重构前完全一致。

| 阶段 | 键名 | 条件 | 动作 | 失败策略 |
|------|------|------|------|----------|
| 1 | `markdown` | `markdown_content` 空且 `content` 存在 | `toSimpleMarkdown(content)`（`markdown.ts:9`）→ 存 `markdown_content` | 无内容 → 整体 `failed`（`stage:'prepare'`）|
| 2 | `translate` | `stages.translate !== 'completed'` | `runStageTranslate` 内 `translateArticleIfNeeded(...)` 包在 `executeWithRetry` | 记 `translationChanged`/`translationSucceeded`，非致命 |
| 3 | `vector` | `vector!=='completed'` 或翻译变化 `needReindex` | `runStageVector` → `indexArticle(articleId,userId,cb)` | **非致命**（warn 后继续）|
| 4 | `related` | `related!=='completed'` | `runStageRelated` → `refreshRelatedArticles(articleId,userId,5)` | **非致命**（warn 后继续）|

成功后 `updateArticleProcessStatus(articleId,'completed')`（`:550`）。

### 状态模型

- `process_stages` JSON 键（`:44-49`，`parseProcessStages` 解析）：`{ markdown, translate, vector, related }`，默认全 `'pending'`。
- `StageStatus`（`:34`）：`'pending' | 'processing' | 'completed' | 'failed' | 'skipped'`。
- `process_status` 列：`'pending' | 'processing' | 'completed' | 'failed'`（`updateArticleProcessStatus`, `articles.ts:890`）。

### 批量与并发

- `processBatchArticles(articleIds, userId, options?)`（`:287`）按 `maxConcurrent ?? MAX_CONCURRENT` 分批；`MAX_CONCURRENT=parseInt(ARTICLE_PROCESS_MAX_CONCURRENT||'3')`（`:161`）。
- `retryFailedArticle(articleId, userId)`（`:347`）重置为 processing 后重跑。
- `getPendingArticleIds(userId, limit=50)` / `getFailedArticleIds(...)`（`:655` / `:703`）现为 **`@deprecated` 别名**，统一转发到 `getArticleIdsByStatus(status: 'pending'|'failed', userId, limit)`（`pipeline.ts`，2026-07-14 合并去重）。`sortField` 按状态区分：`failed` 用 `updated_at`、`pending` 用 `created_at`。调用方建议直接使用 `getArticleIdsByStatus`。
- `sleep(ms)` 已统一提取到 `src/utils/sleep.ts`，各模块（含 `pipeline.ts`、`rss-scheduler.ts`、`keyword-scheduler.ts`）均 import 使用，不再各自定义。

## 2. 语言检测与条件翻译（`src/agent.ts`）

- `translateArticleIfNeeded(title?, content?, userId?)`（`:27`）返回 `TranslationResult | null`。
- `detectLanguage(...)`（`:90`）：空 → `'unknown'`；含 CJK `/[\u4e00-\u9fff]/` → `'zh'`；否则字母数 ≥ `MIN_ALPHA_COUNT`(=10) 且字母占非空白比 > `MIN_ALPHA_RATIO`(=0.6) → `'en'`，否则 `'unknown'`。两个阈值已提取为常量（2026-07-14，原 `#8.1` Magic Number 修复）。
- **翻译条件**（`:34-39`）：仅当标题或内容为 `'en'` 才翻译；否则返回 `null`（中文文章完全跳过 LLM）。
- 内容截断常量 `MAX_TRANSLATION_CONTENT=3000`（`:22`）。提示词经 `buildPromptVariables({type:'translation'})` + `resolveSystemPrompt(userId,'translation',...)`；LLM 经 `getUserLLMProvider(userId,'translation')` 或 `getLLM()`。
- LLM 抛错 → 返回 `{summaryZh:undefined, sourceLang:'en', usedFallback:true}`（不抛）。
- `TranslationResult`（`:14`）：`{ titleZh?, summaryZh?, sourceLang:'zh'|'en'|'unknown', usedFallback }`。`titleZh` 字段**已于 2026-07-14 正式声明**（此前为潜在 bug）。
- 流水线 `runStageTranslate` 现在会落 `title_zh = translationResult.titleZh ?? null`（不再恒为 `null`），同时落 `summary_zh` + `source_lang`。仅在标题实际被翻译（`shouldTranslateTitle`）时 `titleZh` 才非空。

## 3. 重试机制

- **仅 `translate` 阶段重试**（`pipeline.ts:445-454`）：`executeWithRetry(fn, DEFAULT_RETRY_CONFIG, {articleId, stage:'translate'})`。其他阶段不重试。
- `executeWithRetry`（`:597`）：循环 `0..maxRetries`（共 `maxRetries+1` 次），失败 `sleep(min(baseDelay*multiplier^attempt, maxDelay))`，耗尽后重抛。
- `DEFAULT_RETRY_CONFIG`（`:154-159`，均可环境变量覆盖）：`maxRetries=3`(`ARTICLE_RETRY_MAX_RETRIES`)、`baseDelay=5000`、`backoffMultiplier=2`、`maxDelay=60000` → 延迟约 5s/10s/20s。

## 4. 翻译存储 `article_translations`

- `upsertArticleTranslation(articleId, userId, translation)`（`articles.ts:499-531`）：`INSERT ... ON CONFLICT(article_id) DO UPDATE`，按 `article_id` upsert。
- `ArticleTranslation`（`articles.ts:102`）：`{ title_zh:string|null; summary_zh:string|null; source_lang:string|null }`。
- 读取：`getArticleTranslation`（`:474`）；`getArticleById`/`getUserArticles` 会 JOIN 出 `summary_zh`。

## 5. 完成后的 Fire-and-Forget

`runPipeline` 置 `completed` 后（`:552-581`，均不 await、失败仅记 `(non-fatal)`）：

1. **Telegram 新文章推送**：动态 import `getTelegramNotifier().sendNewArticle(userId, finalArticle)`（`finalArticle` 重新查以带翻译）。
2. **相关文章增量刷新**：`incrementalRefreshRelated(articleId, userId, {topN:10, minScore:0.5})`。

API 处理器本身也是 fire-and-forget：`triggerProcess`/`triggerBatchProcess`/`retryArticle` 不 await 直接返回 `{success:true}`（`article-process.ts:54,110,160`）。

## 6. 相关文章刷新（`src/api/articles-refresh.ts`）

- `incrementalRefreshRelated(newArticleId, userId, {topN=10, minScore=0.5})`（`:56`）：`findMostSimilarToArticle(newArticleId, userId, {limit:topN*2, minScore})` 找出与新文章相似的**老文章**，对每篇调 `refreshRelatedArticles(articleId, userId, 5)` 重算，使新文章出现在老文章的相关列表中。并发 `CONCURRENT_LIMIT=3`。
- `findMostSimilarToArticle(...)`（`:128`）：`getEmbedding(buildVectorText(article))` → `queryVector(userId, embedding, limit)` → 过滤 `hit.articleId!==articleId && score>=minScore`。
- `refreshRelatedArticles(articleId, userId, limit=5)`（`articles.ts:991`）：`search({mode:RELATED, useCache:false, refreshCache:true})`，重算并写 `article_related` 缓存。
- 周期刷新：`getArticlesNeedingRefresh(userId, {limit?, staleBefore?})`（`:182`，默认 7 天陈旧）、`batchRefreshRelated(userId, {limit?})`（`:228`，并发 3，每篇 limit 5）、`getRefreshStats(userId)`（`:286`，返回 `{total,fresh,stale,missing}`）。

## 7. 相关文章调度器（`src/related-scheduler.ts`）

- 类 `RelatedArticlesScheduler`（`:61`），单例 `initRelatedScheduler`（`:287`），node-cron，`timezone:'Asia/Shanghai'`。
- `runScheduledRefresh()`（`:180`）**硬编码 `userId=1`**（`:186`，多租户未实现），算 `staleBefore=now-staleDays*24h` → `getArticlesNeedingRefresh({limit:1})` 检查 → `batchRefreshRelated({limit:batchSize, staleBefore})`。
- `refreshNow(userId=1)`（`:239`）、`getStatus(userId=1)`（`:267`）。
- 配置（`config.ts:152-155`，`index.ts:83` 注入）：`enabled=RELATED_REFRESH_ENABLED`(默认 true)、`schedule='0 2 * * *'`、`batchSize=100`、`staleDays=7`。

## 8. 全文抓取与导出（存在但未接线）

- `scraper.ts`：`scrapeUrl(url)`（`:29`）用 **Playwright**（`chromium.launch`）+ **Defuddle** 提取正文，`toSimpleMarkdown` 转换。⚠️ 全代码库仅在 `scraper.ts` 内部被引用，**未被流水线调用**（流水线 markdown 阶段用 `toSimpleMarkdown(article.content)`，不抓全文）。
- `export.ts`：`exportArticleMarkdown`（`:143`）/`deleteArticleExport`（`:164`）/`exportBatchArticles`（`:196`，仅导出 `process_status==='completed'`）。写到 `ARTICLE_EXPORT_DIR||data/exports`，YAML front matter + 分节 Markdown。⚠️ 流水线**不调用**导出。

## 9. API 端点

`src/api/routes/article-process.routes.ts`（挂 `/api`，均 `requireAuth`，写操作 `requireWriteAccess`）：

| Method | Path | Handler |
|--------|------|---------|
| POST | `/api/articles/:id/process` | `triggerProcess` |
| POST | `/api/articles/process-batch` | `triggerBatchProcess`（默认 limit=10）|
| POST | `/api/articles/:id/retry` | `retryArticle` |
| GET | `/api/articles/process-stats` | `getProcessStats` |
| GET | `/api/articles/pending` | `getPendingArticles`（默认 limit=20）|
| GET | `/api/articles/failed` | `getFailedArticles`（默认 limit=20）|
| POST | `/api/articles/filter-and-process-batch` | `filterAndProcessBatch` |

`src/api/routes/articles.routes.ts`（列表/详情/交互）：`GET /api/articles`（分页多筛选）、`/stats`、`/vector-check`、`/sources`、`GET/DELETE /:id`、`GET /:id/related`（缓存优先，limit 5）、`PATCH /:id/read`、`/filter-status`、`POST /batch-read`、`/mark-all-read`、`PATCH /:id/rating`、`/ai-summary`（含 DELETE）。

## 10. 与旧报告（2026-05）的差异

1. 阶段模型（markdown/translate/vector/related）正确，但 `pipeline.ts` **文件头注释已过时**（漏 markdown/related，且写的是「阶段3：导出」而非向量化）。
2. **重试仅作用于 translate 阶段**，配置默认 `maxRetries=3, baseDelay=5000, multiplier=2, maxDelay=60000`（可环境变量覆盖）。
3. `article_translations` 是按 `article_id` 的**真 upsert**；流水线只落 `summary_zh`+`source_lang`（`title_zh` 恒 null）。
4. 相关刷新有两条路径：实时 `incrementalRefreshRelated(topN:10, minScore:0.5)` 与每日 cron（`0 2 * * *`，batch 100，stale 7d，硬编码 `userId=1`）。
5. `scraper.ts`（Playwright+Defuddle）与 `export.ts` **存在但未被流水线接线**（已加 `@deprecated` 注释标明死代码）。

## 11. 近期重构差异（2026-07-14，基于代码审查实施计划）

- **`runPipeline` 拆分**：4 阶段内联逻辑拆为 `runStageMarkdown` / `runStageTranslate` / `runStageVector` / `runStageRelated`，`runPipeline` 仅编排（见 §1）。语义不变。
- **`getArticleIdsByStatus` 统一**：`getPendingArticleIds` / `getFailedArticleIds` 合并为参数化 `getArticleIdsByStatus(status, userId, limit)`，旧函数保留为 `@deprecated` 别名（见 §1）。
- **`sleep()` 统一**：提取到 `src/utils/sleep.ts`，各调度器 / pipeline 复用（见 §1）。
- **`agent.ts` 语言检测阈值命名**：`MIN_ALPHA_COUNT=10` / `MIN_ALPHA_RATIO=0.6` 常量化（见 §2）。
- **`titleZh` 修复**：`TranslationResult.titleZh` 正式声明，流水线 `runStageTranslate` 落 `title_zh` 不再恒为 `null`（见 §2）。
