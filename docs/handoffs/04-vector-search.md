# 04 · 向量检索子系统 Handoff

> ChromaDB 连接、embedding、索引队列、rerank，以及语义 / 关键词 / 混合 / 相关四种检索模式与分数融合。
> 关键源文件（`src/vector/`）：`chroma-client.ts`、`vector-store.ts`、`embedding-client.ts`、`indexer.ts`、`reranker.ts`、`text-builder.ts`、`search.ts`（桶文件）、`search-service.ts`（真正实现），路由 `src/api/routes/search.routes.ts` `external-search.routes.ts`。

## 1. 模块划分

| 文件 | 职责 |
|------|------|
| `chroma-client.ts` | 按 userId 缓存 Chroma client 与 collection |
| `vector-store.ts` | Chroma CRUD 薄封装（`upsert`/`query`/`remove`）|
| `embedding-client.ts` | embedding HTTP 客户端（OpenAI 兼容 `/embeddings`）|
| `indexer.ts` | `VectorIndexQueue` + `indexArticle(s)`/`deleteArticle` |
| `reranker.ts` | rerank HTTP 客户端（OpenAI 兼容 `/rerank`）|
| `text-builder.ts` | `buildVectorText` |
| `search.ts` | 仅 `export { search, SearchMode }` 桶文件 |
| `search-service.ts` | 全部检索逻辑（4 模式）|

## 2. ChromaDB 连接（`chroma-client.ts`）

- **无连接池**，而是按 `userId` 的**单例缓存** `clientCache: Map<number, ClientCache>`（`:34`）。`getClient(userId)`（`:39`）用 `baseUrl=http://${host}:${port}` 构造 `new ChromaClient({path:baseUrl})`；baseUrl 变化则重建。
- ⚠️ **Collection 命名**：来自 `getChromaSettings().collection`，**默认字面量 `'articles'`**（`api/settings.ts:273`），可经 `chroma_collection` 设置改。**没有 `${userId}` 后缀**（旧报告的 `articles_{userId}` 是错的）。
- `getCollection(userId)`（`:68`）：缓存键 `${collection}:${distanceMetric}`；`getOrCreateCollection({name, metadata:{'hnsw:space':distanceMetric}})`。连接错误包成 `ChromaConnectionError`。
- **租户隔离不靠分 collection**，而靠：① Chroma 查询恒带 `where:{user_id:userId}`（`vector-store.ts:47`），upsert 写 `metadata:{article_id, user_id}`（`indexer.ts:173`）；② SQL 层所有查询 JOIN 源表并过滤 `user_id`。
- chroma host/port 来自 `settings` 表（`chroma_host` 默认 127.0.0.1、`chroma_port` 默认 8000），**且 2026-07-14 起也支持 `config.ts`**（`chromaHost` / `chromaPort`，对应环境变量 `CHROMA_HOST` / `CHROMA_PORT`）。`getChromaSettings(userId)`（`api/settings.ts:269`）取值优先级：**`settings` 表 → `config.chromaHost`/`config.chromaPort`**。**不在 `config.ts` 旧描述已过时**。

## 3. Embedding 客户端（`embedding-client.ts`）

- ⚠️ **无 provider 分支**，只讲 **OpenAI 兼容 `/embeddings` HTTP 协议**；「provider」由配置的 `base_url` 决定。
- 配置：`getActiveConfigByType(userId,'embedding')`（`loadEmbeddingConfig`, `:31`），`config_type='embedding'`，缺失抛 `EmbeddingConfigError`。`apiKey` 经 `decryptAPIKey(..., config.llmEncryptionKey)`（`:39`）。默认 `timeout=180000`、`maxRetries=3`。
- 请求（`requestEmbeddings`, `:50`）：`POST ${baseUrl}/embeddings`，body `{model, input}`，`Authorization: Bearer`。`status>=500||429` 时重试，sleep `500ms*(attempt+1)`；返回向量数 ≠ 输入数则抛。
- `getEmbedding(text, userId)`（`:108`）单条；`getEmbeddingsBatch(texts, userId)`（`:114`）**不内部再分批**，整数组一次请求（分批 32 在 indexer 侧）。

## 4. 索引器（`indexer.ts`）

- `VectorIndexQueue`（`:20`）：**串行 async 链**（非 worker 池），`running = running.then(task).catch(log)`，FIFO 严格逐个执行。
- `BATCH_SIZE=32`（`:9`）。`indexArticle`/`indexArticles`（`:234`/`:248`）入共享队列。
- `doIndexArticles`（`:113`）：`loadArticles`（`:41`）LEFT JOIN `rss_sources`/`article_translations`，按来源解析 `user_id`（RSS>keyword>journal 优先级）；按 user 分组；每行 `buildVectorText`，`id=buildVectorId(articleId, userId)=${userId}:${articleId}`（`vector-store.ts:15`），metadata `{article_id, user_id}`；切 32 批 → `getEmbeddingsBatch` → `upsert`。
- `deleteArticle(articleId, userId?)`（`:259`）解析 user 后 `remove(userId, [buildVectorId(...)])`。

## 5. 向量文本构建（`text-builder.ts`）

`buildVectorText(input)`（`:1-28`）字段优先级：

1. **TITLE** = `title_zh?.trim() || title?.trim()`
2. **SUMMARY** = `summary_zh?.trim()` **仅此**（⚠️ 无回退到原 `summary`/`content`；空则省略该段）
3. **CONTENT** = `markdown_content || content`（trim）

按 `\n` 连接。

## 6. Rerank（`reranker.ts`）

- `rerank(query, documents, userId, topN?)`（`:13`）：`getActiveConfigByType(userId,'rerank')`；无配置或 `enabled!==1` → 返回 `null`。
- HTTP：`POST ${baseUrl}/rerank`，body `{model, query, documents, top_n: topN??documents.length}`，`AbortSignal.timeout(timeout??180000)`。
- 响应映射 `results[].index` + `relevance_score||score`；任何失败 → `null`（优雅降级不抛）。`RerankResult={index, score}`。无 provider 分支。

## 7. 四种检索模式（`search-service.ts`）

- `SearchMode` 枚举（`:30`）：`SEMANTIC='semantic'`、`KEYWORD='keyword'`、`HYBRID='hybrid'`、`RELATED='related'`。
- 统一入口 `search(request)`（`:105`）按 mode 分派：
  - SEMANTIC → `semanticSearchOnly`（`:204`）
  - KEYWORD → `keywordSearchOnly`（`:241`）
  - HYBRID → `hybridSearch`（`:336`，含 `fallback` 标志）
  - RELATED → `searchRelated`（`:424`）→ `computeRelated`（`:465`）/`getRelatedFromCache`（`:589`）
- 常量（`:95-98`）：`DEFAULT_LIMIT=50`、`MAX_RESULTS=100`、`DEFAULT_SEMANTIC_WEIGHT=0.7`、`DEFAULT_KEYWORD_WEIGHT=0.3`。

### 语义检索流程

`getEmbedding(query)` → `queryVector(userId, embedding, MAX_RESULTS=100, {user_id})`（`:210`）→ `score=1-distance`（cosine）→ 可选 `rerank`（topN=`min(100, candidates.length)`, `:229`）→ `enrichWithMetadata` → 按 score 降序。

### 关键词检索（`keywordSearchOnly`, `:241`）

- JOIN `articles` 与三源表，OR 过滤 `user_id`。`includeRejected` 默认 **true**（返回全部 filter_status；仅 false 时加 `filter_status='passed'`）。
- ⚠️ 多字段匹配：每个空格切分词 `eb.or([title LIKE %term%, markdown_content LIKE %term%])`，各词 AND 组合（`:281-293`）。**只搜 `title` 和 `markdown_content`**，不搜 `summary`/`content`/`title_zh`。
- ⚠️ **近期重构（2026-07-14）**：原 `keywordSearchOnly` / `computeRelated` / `getRelatedFromCache` / `enrichWithMetadata` 四处各自重复「JOIN 三源表 + OR 过滤 user_id」模式（Shotgun Surgery 坏味），现统一提取为 `createArticlesQuery(userId)` 查询构建器（`search-service.ts:100` 附近），四处均调用它，新增来源类型只需改一处。
- `calcRelevance`（`:251`）：完整包含 `+0.7`，前缀 `+0.3`，上限 1；作为 score 与 keywordScore。`LIMIT 100`。

### 混合融合（`hybridSearch`, `:388-400`）

```ts
// normalizeScores=true（搜索页）
normalizedSem = semScore / max(maxSemScore, 0.01);
finalScore = normalizedSem * semanticWeight + kwScore * keywordWeight;
// normalizeScores=false（相关文章）
finalScore = semScore * semanticWeight + kwScore * keywordWeight;
```
默认权重 0.7 / 0.3。语义失败且 `fallbackEnabled` → 返回纯关键词并置 `fallback:true`（`:360`）。

### 相关文章阈值（`computeRelated`, `:519-526`）

```ts
highScore = semanticResults.filter(r => r.finalScore > 0.6);
effectiveLimit = highScore.length >= 3 ? min(limit,5) : min(limit,3);
topResults = highScore.length >= effectiveLimit ? highScore.slice(0,effectiveLimit) : semanticResults.slice(0,effectiveLimit);
```
- `queryVector` topK = `max(limit*3, limit)`（`:502`）。排除源文章，`published_at` 降序破平。相关详情查询额外要求 `filter_status='passed' && process_status='completed'`。

## 8. 元数据补全 `enrichWithMetadata`（`:671-728`）

- 输入 `{articleId, score}[]`；JOIN 三源表，OR 过滤 `user_id`，AND `filter_status='passed'`，`where id in (ids)`。
- 选列：`id, title, url, published_at, source_origin, rss_source_name, journal_name, keyword_name`。
- ⚠️ 检索路径返回的 `summary` **恒为 null**（从不 SELECT）。
- 相关缓存：`saveRelatedToCache`（`:645`）事务内删+插 `article_related(article_id, related_article_id, score, ...)`；`getRelatedFromCache`（`:589`）读缓存 JOIN articles，按 `ar.score` 降序。

## 9. 检索 API

1. `GET /api/search`（`search.routes.ts:22`，`optionalAuth`）：`q`(必填)、`mode=semantic|keyword|mixed`(默认 mixed→HYBRID)、`page`、`limit`。`normalizeScores:true`。
2. `POST /api/search/summary`（`:80`，`requireSearchSummaryAccess`）：`{articleIds}`(≤50) → `generateSearchSummary`。
3. `GET /api/articles/:id/related`（`articles.routes.ts:434`）→ `search({mode:RELATED, articleId, limit:5, normalizeScores:false, useCache:true})`。
4. `POST /api/external/search`（`external-search.routes.ts`，`requireCliAuth`）：完整 `SearchRequest`，支持四模式，RELATED 需 `articleId`。

## 10. 与旧报告（2026-05）的差异

| 旧报告 | 实际代码 |
|--------|---------|
| collection 名 `articles_{userId}`（按用户） | 单一可配 collection，默认 `'articles'`，无后缀 |
| 靠分 collection 隔离租户 | 靠 Chroma `where:{user_id}` + SQL `user_id` JOIN |
| embedding 硬编码 OpenAI/Gemini 分支 | 无分支，OpenAI 兼容 `/embeddings`，provider 由 base_url 定 |
| 向量文本 `summary_zh`/`summary` 回退 | SUMMARY **只用 `summary_zh`**，无回退 |
| 关键词搜多字段含 summary | 只搜 `title` + `markdown_content`，各词 AND |
| 检索元数据含 summary | 检索元数据 `summary` 恒 null |
| 方法名如 `hybridSearchOnly` | 实为 `semanticSearchOnly`/`keywordSearchOnly`/`hybridSearch`/`computeRelated`/`searchRelated` |

## 11. 近期重构差异（2026-07-14，基于代码审查实施计划）

- **Shotgun Surgery 消除**：`keywordSearchOnly` / `computeRelated` / `getRelatedFromCache` / `enrichWithMetadata` 原先各重复「LEFT JOIN 三源表 + OR 过滤 user_id」SQL 构建，现统一为 `createArticlesQuery(userId)` 构建器（见 §7）。新增来源类型只改一处。
- **Chroma host/port 配置化**：`config.ts` 新增 `chromaHost` / `chromaPort`（`CHROMA_HOST` / `CHROMA_PORT`），`getChromaSettings` 取 settings 表优先、回退 config（见 §2）。
