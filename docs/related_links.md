# 相关文章/关联内容实现说明

本文记录当前项目与参考项目（linkmind-master）在“相关文章/关联内容”上的实现差异与关键流程，便于后续对齐与演进。

## 当前项目（lis-rss-daily）实现

### 1. 相关文章获取方式（已优化）

- 入口接口：`GET /api/articles/:id/related`
- 位置：`src/api/routes/articles.routes.ts`
- 核心逻辑：缓存优先 + 混合检索
  - 缓存表：`article_related`
  - 命中缓存则直接返回
  - 缓存缺失时，按 “QMD 语义检索 + 关键词共现” 混合计算并写回
  - 返回最多 5 篇

> 结论：当前项目“相关文章”已支持 QMD 语义检索与关键词共现的混合策略，且结果落库缓存。

### 2. 关键词来源

- 入口：`src/pipeline.ts` 的分析阶段调用 `analyzeArticle()`
- 位置：`src/agent.ts`
- 生成方式：标题 + 摘要 + 正文节选（最多 1200 字符）→ LLM 生成 3-8 个关键词
- 失败降级：使用过滤器命中关键词 + 标题/摘要规则抽取关键词

### 3. QMD 向量检索的现状

- QMD 向量检索仅在搜索模块使用：`src/search.ts`
- 方法：`searchArticlesWithQMD(query, limit)`
- 检索词：外部传入 `query`（搜索页或 API 的 `q` 参数）
- 失败处理：QMD vsearch 失败 → 回退 SQLite LIKE（`searchHistoricalArticles`）

> 结论：QMD 语义检索已被用于“相关文章”计算，且仍保留失败回退机制。

### 4. 相关文章落库与更新

- 位置：`src/pipeline.ts`
- 时机：文章处理完成后，计算并写入 `article_related`
- 结构：`article_related (article_id, related_article_id, score, created_at)`
- 目的：避免详情页每次动态计算，提升性能

---

## 参考项目（linkmind-master）实现

### 1. 相关文章/关联内容检索入口

- 入口：`findRelatedAndInsight()`
- 位置：`docs/ref/linkmind-master/src/agent.ts`

核心流程：
1) 组合检索词：`query = title + summary`（以换行拼接）
2) 调用 `searchAll(query, 5)` 查找相关内容
3) 过滤当前文章本身（linkId 相同）
4) 取前 5 条 relatedNotes、relatedLinks
5) 结合相关内容生成 insight

### 2. 向量检索实现

- 位置：`docs/ref/linkmind-master/src/search.ts`
- `searchAll()` 顺序执行 `searchNotes()` 与 `searchHistoricalLinks()`
  - 顺序执行是为了避免并发 qmd 进程争抢 SQLite 锁
- `searchHistoricalLinks()`：
  - 使用 `qmd vsearch` 搜索 `links` 集合
  - 过滤 `qmd://links/` 前缀
  - 从文件名 `{id}-slug.md` 提取 linkId
  - 构建 SearchResult（含 score）

### 3. 失败回退策略

- QMD vsearch 失败 → 回退数据库 LIKE 搜索（`searchLinks`）
- 日志记录警告，但不阻断流程

### 4. 结果落库与展示

- 位置：`docs/ref/linkmind-master/src/pipeline.ts`
- 分析完成后把结果写入：
  - `related_notes`（JSON）
  - `related_links`（JSON）
- 页面展示直接读取并渲染该字段

---

## 对齐建议（可选）

- 如果希望当前项目也实现“基于文章内容的 QMD 相关文章”，可参考参考项目的做法：
  - 以 `title + summary` 作为检索词
  - 调用 QMD vsearch（文章集合）
  - 失败回退 SQLite LIKE
  - 结果可存入独立表或缓存字段，供详情页直接展示

> 本节为建议，不代表当前已实现。
