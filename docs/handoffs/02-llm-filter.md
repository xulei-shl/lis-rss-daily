# 02 · LLM 智能过滤子系统 Handoff

> 决定哪些文章值得保留的核心智能环节。两道关卡：**Stage 0 黑名单预过滤（YAML 子串匹配）** + **Stage 1 LLM 单领域相关性评估**。
> 关键源文件：`src/filter.ts`、`src/config/blacklist-filter.ts` `blacklist-config.ts`、`src/api/topic-domains.ts` `topic-keywords.ts`、`src/api/prompt-variable-builder.ts`、`src/config/system-prompt-variables.ts`、`src/api/system-prompts.ts`、`src/api/filter-logs.ts`，路由 `src/api/routes/filter.routes.ts`、`logs.routes.ts`、`topic-domains.routes.ts`、`topic-keywords.routes.ts`、`system-prompts.routes.ts`、`blacklist.routes.ts`。

## 1. 入口与总流程 `filterArticle`

`filterArticle(input: FilterInput, options?)`（`src/filter.ts:372-496`）：

1. `minScore = options.minRelevanceScore ?? 0.6`（`:376`）。
2. **Stage 0 黑名单**（`:383-409`）：`checkTitleBlacklist(input.title)`。命中 → `updateArticleFilterStatus(...,'rejected',0)` + 写一条 `domain_id=null` 的日志（reason `"标题包含黑名单关键词: ..."`），返回 `{passed:false}`；异常也拒绝并记 `usedFallback:true`。
3. **Stage 1 LLM**（`:412`）：`llmFilter(input)`。`llmResult.error` → 拒绝并记 `"LLM failed: ..."`；`results.size===0` → 拒绝并记 `"LLM 未返回有效评估结果"`。
4. 组装 `domainMatches`（`:453`），算通过与否，更新文章状态，`recordFilterResults`。

> 注意：`filter.ts` 文件头注释写「单阶段」，但实际是「黑名单 + LLM」两道关卡。`checkTitleBlacklist`（`config/blacklist-filter.ts:23-47`）是**子串包含匹配**（`lowerTitle.includes(keyword.toLowerCase())`），**不是正则**。关键词来自 YAML（`config/blacklist.yaml`），由 `getTitleBlacklistKeywords`（`config/blacklist-config.ts:51`）加载，支持中英逗号分隔与 `enabled` 开关。

## 2. LLM 单领域评估 `llmFilter`（核心变更）

`llmFilter(input)`（`src/filter.ts:103-253`）动态 import 避免循环依赖（`:112`）：

- **确定唯一领域 id**（`:114-123`）：优先 `input.sourceDomainId`；否则 `getArticleSourceDomainId(input.articleId)`。
- `getArticleSourceDomainId(articleId)`（`api/topic-domains.ts:360-396`）：读 `source_origin` + 对应外键（`rss_source_id`/`journal_id`/`keyword_id`/`email_source_id`），从对应源表查 `domain_id`；查不到则抛错。
- `getTopicDomainById(domainId, userId)`（`api/topic-domains.ts:203`）取领域，缺失 → 错误 `"领域 ${domainId} 不存在或无权访问"`。
- `buildPromptVariables({type:'filter', article})`（`api/prompt-variable-builder.ts:211`）生成变量 → `resolveSystemPrompt(userId,'filter','',variables)`（`api/system-prompts.ts:129`）渲染 DB 提示词模板。无非空模板 → 错误（`:149-155`）。
- 组装 `userPrompt`（系统提示词 + 标题/摘要 + `truncatePreview(content, 2000)` 清洗截取的内容预览——自动去除 HTTP 链接、只计中英文+数字不计符号）并调用 LLM：`jsonMode:true, temperature:0.3, label:'article-filter'`（`:172-178`）。

**单领域**：`buildDomainsInfo(userId, domainId?)`（`api/prompt-variable-builder.ts:79-135`）传入 `domainId` 时只返回**该单个领域**的 `## 领域ID: <id> - <name>` 块及其活跃关键词。原多领域分支仍在但过滤路径不再使用。**过滤器不再遍历所有活跃领域**。

## 3. `FilterInput` 类型（`src/filter.ts:26-36`）

```ts
export interface FilterInput {
  articleId: number;        // 必填
  userId: number;           // 必填
  title: string;            // 必填
  url?: string;
  description: string;      // 必填
  content?: string;
  sourceType?: SourceType;  // 来自 src/constants/source-types.ts
  sourceDomainId?: number;  // 源绑定的领域 id（单领域评估的关键）
}
```

相关结果类型：`FilterResult`（`:41`，含 `passed`/`relevanceScore?`/`domainMatches[]`/`filterReason?`/`usedFallback`）、`DomainMatchResult`（`:52`）、`FilterOptions`（`:63`，`minRelevanceScore?` 默认 0.6）。

## 4. LLM 响应格式（兼容两种）

`parseLLMJSON<...>(response, {allowPartial:true, maxResponseLength:2048, errorPrefix:'Filter evaluation'})`（`:181`）。支持两种形状：

**标准格式**（`LLMResponse`，`:69`）：
```json
{ "evaluations": [ { "domain_id": 1, "is_relevant": true, "relevance_score": 0.85, "reasoning": "..." } ] }
```
检测：`'evaluations' in parsed && Array.isArray(...)`（`:199`）；每条 `domain_id` 必须等于解析出的那个单领域，未知 id 跳过并告警（`:203-209`）。

**兼容旧版格式**（`AlternativeLLMResponse`，`:83`）：
```json
{ "decision": "通过", "reasoning": "...", "matched_domains": [ { "domain_id":1, "relevance_score":0.85, "reasoning":"..." } ] }
```
检测：`'matched_domains' in parsed`（`:217`）；`decision` 归一化：布尔 true 或 `'通过'`/`'pass'` 即通过；`relevance_score` 缺省通过取 `0.8`、否则 `0`。

其他格式 → 告警 `"未知的 LLM 响应格式"` + 错误（`:237`）。

## 5. 决策逻辑与阈值（`:452-494`）

```ts
const passedMatches = domainMatches.filter(m => m.passed && (m.relevanceScore ?? 0) >= minScore);
const passed = passedMatches.length > 0;
const relevanceScore = passed ? Math.max(...passedMatches.map(m => m.relevanceScore ?? 0)) : 0;
```

- 通过条件：**至少一个领域 `passed===true` 且 `relevance_score >= minRelevanceScore`（默认 0.6）**；总分取合格项的**最大值**。
- `updateArticleFilterStatus(articleId, passed?'passed':'rejected', relevanceScore)`（`:471`）：写 `filter_status`/`filter_score`/`filtered_at`；rejected 还会置 `process_status='completed'`（`:504-529`）。更新受 `where filter_status='pending'` 守护（幂等）。
- `filterReason`：`'Passed LLM evaluation'` / `'Failed LLM relevance threshold'`。

## 6. 过滤日志 `article_filter_logs`

- `recordFilterLog(articleId, domainId, isPassed, relevanceScore, filterReason, llmResponse?, matchedKeywords?)`（`:260-322`）：校验文章（及非空领域）存在后插入；列 `article_id`/`domain_id`(可空)/`is_passed`/`relevance_score`/`matched_keywords`/`filter_reason`/`llm_response`。失败只 catch 不抛。
- `recordFilterResults(input, domainMatches, {...})`（`:327-362`）：**每个领域匹配一行**（reason=match.reasoning，llm_response=null）；`domainMatches` 为空时写**一条 `domain_id=null` 的兜底行**（reason=fallbackReason，保留 llmResponse）。
- 黑名单路径：`domain_id=null` + reason `"标题包含黑名单关键词: ..."` + `matched_keywords`。
- 查询层 `api/filter-logs.ts:74-89` 用 `domain_id IS NULL && filter_reason LIKE '%黑名单%'` 区分黑名单 vs LLM 日志。
- 统计：`getFilterStats(userId)`（`:556-623`）聚合整体与按领域通过率。

## 7. 主题领域 / 关键词 / 系统提示词 / 黑名单管理

- **主题领域**（DB）：`api/topic-domains.ts` — `createTopicDomain`/`getUserTopicDomains`/`getTopicDomainById`/`updateTopicDomain`/`deleteTopicDomain`/`getActiveTopicDomains`/`getArticleSourceDomainId`。路由 `topic-domains.routes.ts`（写 admin）。
- **主题关键词**（DB）：`api/topic-keywords.ts` — `getActiveKeywordsForDomain`（`:324`）/`getDomainKeywords`/CRUD/`deleteDomainKeywords`（级联）。路由 `topic-keywords.routes.ts`。
- **系统提示词**（DB `system_prompts` 表，全 CRUD）：`api/system-prompts.ts` — `resolveSystemPrompt`（`:129`，过滤用）、`getActiveSystemPromptByType`（`:114`）、`ensureDefaultSystemPrompts`（`:144`，从 `src/config/default-prompts/<type>.md` 引导，如 `filter.md`）、`listSystemPrompts`/`createSystemPrompt`/`updateSystemPrompt`/`deleteSystemPrompt`。模板用 `{{ var }}` 替换（`renderSystemPrompt`, `:86`）。路由 `system-prompts.routes.ts`：`GET /api/system-prompts`、`POST /bootstrap`(admin)、`GET /variables`、`GET/POST/PUT/DELETE /:id`。
- **黑名单**（YAML 文件，非 DB）：`config/blacklist-config.ts` — `getTitleBlacklistKeywords`/`getBlacklistConfig`/`reloadBlacklistConfig`（单例缓存，源文件 `config/blacklist.yaml`）。检查器 `blacklist-filter.ts:checkTitleBlacklist`。路由 `blacklist.routes.ts`：`GET /api/blacklist`（公开读）、`PUT /api/blacklist`（admin，整体覆盖 YAML 并 reload），无 DELETE。

## 8. 过滤任务的 LLM 选择

`filter.ts` 调 `getUserLLMProvider(input.userId, 'filter')`（`:173`）。解析逻辑（`llm.ts:352-481`，详见文档 05）：任务专属配置（`task_type='filter'`）→ 默认配置（`task_type=null`）→ **有 taskType 且无 DB 配置时回退环境变量 `getLLM()`**（不硬失败）；多条时组成 failover 链。

## 9. 过滤日志路由位置

- 过滤自身路由：`src/api/routes/filter.routes.ts`。
- 过滤**日志**路由在 `src/api/routes/logs.routes.ts`（挂 `/api/logs/filter`，别名 `/api/filter/logs`），支持 `domainId`/`isPassed`/`filterType(blacklist|llm)`。不存在 `filter-logs.routes.ts` 文件。

## 10. 与旧报告（2026-05）的差异

1. **单领域评估**：不再遍历所有活跃领域，只评估源绑定的那个领域（`sourceDomainId`→反查→`buildDomainsInfo(domainId)`）。
2. 黑名单是 **YAML 子串匹配**（Stage 0），非正则模块，且关键词可经 `PUT /api/blacklist` 动态维护。
3. LLM 响应解析支持**两种形状**并对 `domain_id` 做校验。
4. 默认阈值常量 `minRelevanceScore=0.6`（`filter.ts:376`）。
5. 过滤日志路由在 `logs.routes.ts` 而非独立文件。
