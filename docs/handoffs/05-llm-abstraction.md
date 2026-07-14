# 05 · LLM 抽象层与工具库 Handoff

> AI 编排核心：多提供商抽象、优先级链与故障转移、限流、加密、健壮 JSON 解析，以及全局配置与共享工具。
> 关键源文件：`src/llm.ts`、`src/llm-logger.ts`、`src/api/llm-configs.ts`（+ 路由）、`src/utils/`（`crypto.ts` `llm-json-parser.ts` `rate-limiter.ts` `markdown.ts` `datetime.ts` `title.ts` `message-splitter.ts`）、`src/config.ts`、`src/config/system-prompt-variables.ts`。

## 1. `LLMProvider` 抽象（`src/llm.ts`）

```ts
export interface LLMProvider {                 // :34
  name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}
```

- `ChatMessage`（`:21`）：`{role:'system'|'user'|'assistant', content:string}`。
- `ChatOptions`（`:26`）：`maxTokens?`、`temperature?`、`jsonMode?`、`label?`（日志标签）。
- `LLMConfigOptions`（`:39`）：`provider:'openai'|'gemini'|'custom'`、`baseURL`、`apiKey`、`model`、`timeout?`、`maxRetries?`、`source?`。

### 提供商实现

- `createOpenAIProvider`（`:114`）：`openai` SDK（`timeout??300000`, `maxRetries??1`）；`jsonMode` 加 `response_format:{type:'json_object'}`；`max_tokens` 仅在传入时设置；返回 `choices[0].message.content||''`。
- `createGeminiProvider`（`:191`）：直连 REST `${apiUrl}/models/${model}:generateContent?key=`；system 消息转 `systemInstruction`，`assistant`→`model`；`jsonMode` 加 `responseMimeType:'application/json'`；`temperature` 缺省 0.3；默认 base `GEMINI_API_BASE`（`:189`）。
- 工厂 `createLLMProvider`（`:491`）：`gemini`→Gemini，其余→OpenAI 兼容。
- 环境回退：`createProviderFromEnv`（`:304`）读 `LLM_PROVIDER`（默认 openai）等；`getLLM()`（`:336`）缓存 env provider。

## 2. 优先级链 `getUserLLMProvider(userId, taskType?)`（`:352-481`）

1. 查 DB：`getActiveConfigListByTypeAndTask(userId,'llm',taskType)` 或 `...ByType`。
2. 有 `taskType` 时拆分：**exact task 配置**（`task_type===taskType`，matchType `'task'`）在前，**default 配置**（`task_type===null`，matchType `'default'`）在后。
3. 无 `taskType` → 全部 `'general'`。
4. **无任何 DB 配置**：无 taskType → **抛错**（`:381`）；有 taskType 且为空 → **回退 `getLLM()`（env）**（`:388`，故过滤/翻译等任务不会因缺 DB 配置硬失败）。
5. 单条 → 直接返回；多条 → `createFailoverProvider(entries)`（`:479`）。

有效链：**任务专属 DB 配置 → 默认（task_type null）DB 配置 →（仅 taskType 存在且都没有时）env 配置**；failover 链末端亦兜底 env。

## 3. 故障转移（`createFailoverProvider`, `:524-601`）

- `FailoverEntry`（`:49`）：`{configId, provider, matchType, taskType?}`。
- `chat()` 顺序尝试，返回首个**非空**结果（`text.trim().length>0`）；空响应视为失败（记 `'空响应'`），推进下一个并告警。
- 全部失败 → 回退 `getLLM().chat(...)`（env）。整个链再被 `withRateLimit` 包一层。

### 连接测试 `testLLMConnection(id, userId)`（`api/llm-configs.ts:464-571`）

按 `config_type`/`provider` 分别打 `/embeddings`（15s）、`/rerank`（15s）、`/chat/completions`（`max_tokens:10`, 15s）、Gemini `:generateContent`（`maxOutputTokens:1`, 10s）；`AbortError`→`'Connection timeout'`。经 `POST /api/llm-configs/:id/test` 暴露。

## 4. LLM 日志（`src/llm-logger.ts`）

- `LLMLogger.start(context)`/`LLMLogger.log(context, params, fn)`/`logRateLimitStats(stats)`。`LLMCallContext`（`:180`）：provider/model/apiKey/baseUrl/label/userId/configId 等。
- **无显式 sessionId**——由 context 字段标识。日志出口：设了 `config.llmLogFile` → pino multistream（stdout + **按日期轮转文件** `${base}.${YYYY-MM-DD}${ext}`，每小时清理超 `LLM_LOG_RETENTION_DAYS`（默认 7）的旧文件）；否则 `logger.child({module:'llm-call'})`。
- 完整 prompt dump：`shouldLogFullPrompt()`（`:145`）——`config.llmLogFullPrompt` 为真则全量，否则按 `llmLogFullSampleRate`（默认 20）采样；未启用时 prompt **截断 500 字**。
- 脱敏：`maskApiKey`（首 4 末 4）、`maskBaseUrl`（遮 `?key=`）。

## 5. `llm_configs` CRUD（`src/api/llm-configs.ts` + 路由）

- `config_type ∈ 'llm'|'embedding'|'rerank'`。`SafeLLMConfigRecord` 剔除 `api_key_encrypted`、加 `has_api_key`（**密钥永不回传前端**）。
- CRUD：`createLLMConfig`（`:244`）/`updateLLMConfig`（`:305`）/`deleteLLMConfig`/`setDefaultLLMConfig`/`getDecryptedAPIKey`/`getActiveConfigByType`/`getActiveConfigListByType`/`getActiveConfigByTypeAndTask`（`:629`）。
- **加密落库**：`encryptAPIKey(apiKey, config.llmEncryptionKey)` 存 `api_key_encrypted`；更新传 `apiKey` 时重新加密。
- **约束**：`task_type` 与 `is_default` 互斥（非空 task_type 不能设默认）；设默认会取消同 `config_type` 其他默认。默认值：`enabled=false`、`timeout=30000`、`max_retries=3`、`max_concurrent=5`、`priority=100`。
- 活跃排序（`getActiveConfigListByTypeAndTask`）：精确 task_type > task_type IS NULL，再 `is_default desc`、`priority asc`、`created_at asc`。
- 路由（`llm-configs.routes.ts`，挂 `/api/llm-configs`）：`GET /`、`GET /default`、`GET /:id`、`POST /`(admin)、`PUT /:id`(admin)、`DELETE /:id`(admin)、`POST /:id/set-default`(admin)、`POST /:id/test`(auth)。校验 provider/URL/timeout/priority 等。

## 6. 加密（`src/utils/crypto.ts`）

- 算法 **AES-256-GCM**（`:13`）；`KEY_LENGTH=32`、`IV_LENGTH=16`、`TAG_LENGTH=16`。
- `encryptAPIKey(text, keyHex)`（`:25`）：key 为 **hex**（须 64 hex 字符/32 字节）；随机 IV + GCM tag。**落盘格式：`base64(IV[16] + AuthTag[16] + Ciphertext)`**。
- `decryptAPIKey`（`:57`）：`iv=[0:16]`、`tag=[16:32]`、`enc=[32:]`。
- `generateEncryptionKey()`（64 hex）、`isValidEncryptionKey(key)`。密钥源 `config.llmEncryptionKey`（`LLM_ENCRYPTION_KEY`）。

## 7. LLM JSON 解析（`src/utils/llm-json-parser.ts`）

- `parseLLMJSON<T>(response, options?)`（`:71`）返回 `ParseResult<T>`（`success/data/error/rawResponse/cleanedJson/usedPartialParse`）。
- 代码围栏处理 `extractJSON`（`:183`）：剥离 ` ```json ``` ` 包裹，或取首 `{` 到末 `}` 子串。
- 部分/容错：`allowPartial`（默认 false）时 `tryPartialParse`（`:214`）自动补齐未闭合 `{}`/`[]`、去尾逗号后再解析。
- `validateJSONStructure(data, requiredFields)`（`:264`）、`safeParseLLMJSON(response, default, options?)`（`:290`）。`maxResponseLength`（默认 2048）仅触发告警，不硬截断。

## 8. 限流（`src/utils/rate-limiter.ts`）

- 令牌桶 `RateLimiter`（`:136`）+ 队列，节流 LLM 调用。`RateLimiterConfig`：`requestsPerMinute`/`burstCapacity`/`queueTimeout`。
- `waitForToken(label?)`（`:168`）：可立即消费或入队；超时 reject `Rate limit queue timeout after {ms}ms`。
- 全局单例 `getGlobalRateLimiter`/`initGlobalRateLimiter`/`resetGlobalRateLimiter`。`llm.ts` 的 `withRateLimit`（`:76`）包裹每个 provider；`config.llmRateLimitEnabled=false` 时不包裹；队列超时也**仍放行**（`:96`）。

## 9. 其他小工具

- `datetime.ts`：`normalizeTimestamp`/`normalizeDateFields`——SQLite `YYYY-MM-DD HH:MM:SS` → ISO8601 UTC(`...Z`)。
- `title.ts`：`normalizeTitle`/`generateNormalizedTitle`——文章去重规范化（详见文档 01）。
- `markdown.ts`：`toSimpleMarkdown`——无依赖 HTML→Markdown（清噪声块）。
- `message-splitter.ts`：`splitMessage(content, maxBytes)`/`smartTruncate`——`DEFAULT_MAX_LENGTH=4096`，字节感知按换行/标点切分（Telegram/微信共用）。

## 10. `config.ts` 关键字段（`getConfig()`, `:107-216`）

| 类别 | 字段（默认） |
|------|-------------|
| 服务 | `host`(0.0.0.0)、`port`(3000，.env.example 覆盖为 8007)、`baseUrl` |
| DB | `databasePath`(data/rss-tracker.db) |
| JWT | `jwtSecret`（默认占位并告警）、`jwtExpiresIn`(7d) |
| 加密 | `llmEncryptionKey`（默认 64 个 0，告警） |
| LLM env | `llmProvider`/`openaiApiKey`/`openaiBaseUrl`/`openaiDefaultModel`(gpt-4o-mini)/`geminiApiKey`/`geminiModel`(gemini-1.5-flash) |
| RSS | `rssFetchSchedule`(0 2 * * *)、`rssMaxConcurrent`(5)、`rssFetchTimeout`(30000)、`rssFirstRunMaxArticles`(50) |
| 相关刷新 | `relatedRefreshEnabled`、`relatedRefreshSchedule`(0 2 * * *)、`relatedRefreshBatchSize`(100)、`relatedRefreshStaleDays`(7) |
| 每日总结 | `dailySummaryEnabled`、`dailySummarySchedule`(0 7 * * *)、`dailySummaryTypes`(journal,blog_news,journal_all) |
| 洞察 | `insightsEnabled`、`insightsSchedule`(15 7 * * *)、`insightsIntervalDays`(10)、`insightsDays`(10)、`insightsUserId`(1) |
| 日志 | `logLevel`(info)、`logFile?`、`llmLogFile?`、`llmLogFullPrompt`(false)、`llmLogFullSampleRate`(20) |
| 限流 | `llmRateLimitEnabled`(true)、`...RequestsPerMinute`(60)、`...BurstCapacity`(10)、`...QueueTimeout`(30000) |
| 其他 | `staggerDelayMaxMinutes`(30)、`defaultTimezone`(Asia/Shanghai)、`httpProxy?` |
| 爬虫/邮件 | `journalCrawl*`、`keywordCrawl*`、`gmailFetch*` |
| DeepSearch | `deepSearchApiUrl`(http://localhost:8082) |
| Chroma | `chromaHost`(`CHROMA_HOST`,默认 127.0.0.1)、`chromaPort`(`CHROMA_PORT`,默认 8000) — 2026-07-14 新增，`settings` 表优先、回退此值（见文档 04 §2）|

⚠️ `config.ts` **不含** chroma host/port（走 `settings` 表）与检索权重（在 `search-service.ts` 常量）。

## 11. 任务类型（`config/system-prompt-variables.ts:257`）

`'filter' | 'summary' | 'keywords' | 'translation' | 'daily_summary' | 'analysis' | 'insights' | 'email_parse'`——即 `llm_configs.task_type` 合法值，由 `getTaskTypeCodes()`（从 `config/types.yaml`）动态加载并在路由校验。

## 12. 与旧报告（2026-05）的差异

1. LLM 日志**无 sessionId**，由 context 字段标识。
2. **Gemini 是一等提供商**（直连 REST），非仅 OpenAI 兼容。
3. **故障转移多级**：task 专属 → 默认 → env，空响应视为失败，末端 env 兜底。⚠️ 仅当多条配置组成 failover 链时才有 env 兜底；单条配置直接返回，失败不重试 env。
4. **限流**是令牌桶 + 队列 + 超时，包裹每个 provider。
5. `config_type` 扩展到 `embedding`/`rerank`；`task_type`/`is_default` 互斥；embedding provider 由 DB 驱动（config.ts 无 chroma 字段）。
6. 加密算法确认为 **AES-256-GCM**，落盘 `base64(IV+Tag+Cipher)`，密钥为 hex。

## 13. 近期重构差异（2026-07-14，基于代码审查实施计划）

- **Chroma host/port 配置化**：`config.ts` 新增 `chromaHost` / `chromaPort` 字段，`getChromaSettings` 支持 settings 表优先、config 兜底（见 §10、文档 04 §2）。
- **`agent.ts` 语言检测阈值命名**：`MIN_ALPHA_COUNT` / `MIN_ALPHA_RATIO` 常量化（详见文档 03 §2）。
- **`titleZh` 修复**：`TranslationResult.titleZh` 正式声明，流水线 `runStageTranslate` 落 `title_zh`（详见文档 03 §2）。
