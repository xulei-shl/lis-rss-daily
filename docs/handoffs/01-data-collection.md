# 01 · 数据采集子系统 Handoff

> 覆盖 RSS / 期刊 / 关键词 / Gmail 四类数据源的采集、Python 爬虫集成、标题去重、`domain_id` 绑定与向过滤阶段的流转。
> 关键源文件：`src/rss-scheduler.ts`、`src/journal-scheduler.ts`、`src/keyword-scheduler.ts`（+ `src/api/keywords.ts`）、`src/gmail-scheduler.ts`、`src/gmail/`、`src/spiders/`、`src/api/rss-sources.ts` `journals.ts` `keywords.ts` `gmail-sources.ts`、`src/utils/title.ts`、`src/constants/source-types.ts`。

## 1. 通用架构

四个源各有一个**单例调度器**，均在 `src/index.ts` 启动：`initRSSScheduler()`(L74)、`initJournalScheduler()`(L97)、`initKeywordScheduler()`(L108)、`initGmailScheduler()`(L137)。全部 node-cron 且 `timezone: 'Asia/Shanghai'`。

共同点：

- 都写入**同一张 `articles` 表**，用不同 `source_origin` 区分：`'rss'`、`'journal'`、`'keyword'`、`'email'`。
- 都在保存后调用 `filterArticle(FilterInput)`（`src/filter.ts:26`），过滤通过再调 `processArticle(id, userId)`（`src/pipeline.ts`）。
- 都用 `generateNormalizedTitle`（`src/utils/title.ts:58`）做标题去重。
- 每个源都携带 `domain_id`，作为 `FilterInput.sourceDomainId` 传给过滤器（见 §6）。

差异点一览：

| 维度 | RSS | 期刊 Journal | 关键词 Keyword | Gmail |
|------|-----|-------------|---------------|-------|
| 默认 cron | `0 2 * * *` | `15 2 * * 6`（周六 02:15） | `15 3 * * 6`（周六 03:15） | `0 4 * * *`（且启动即跑一次） |
| 并发 | `Promise.race` + 信号量，`maxConcurrent=5` | 单线程串行 + 随机间隔 | 单线程串行 + 随机间隔 | 逐源串行 |
| 外部进程 | 无（HTTP/XML） | Python 子进程 | Python 子进程 | 无（IMAP + LLM） |
| 过滤触发 | 随机延迟 0–30 分钟后 | 立即 | 立即 | `process.nextTick` |

## 2. RSS 源（`src/rss-scheduler.ts` + `src/rss-parser.ts`）

- 类 `RSSScheduler`（`rss-scheduler.ts:109`），`initRSSScheduler()`（`:790`）读取默认：`schedule=RSS_FETCH_SCHEDULE||'0 2 * * *'`、`maxConcurrent=RSS_MAX_CONCURRENT||5`、`fetchTimeout=30000`、`maxRetries=3`、`retryDelay=5000`、`retryBackoffMultiplier=2`、`forceOnSchedule=RSS_FETCH_FORCE_ON_SCHEDULE==='true'`。
- 主流程：`runScheduledFetch`（`:246`）→ `getActiveRSSSourcesForFetch`（`api/rss-sources.ts:345`）→ 非强制时按 `last_fetched_at + fetch_interval` 过滤（`filterSourcesByFetchInterval`, `:331`）→ `executeFetchTasks`（`:382`）用 `Promise.race` 控制并发，每任务独立超时（`:429`），失败递归指数退避重试（`:479-492`）。
- 抓取：`RSSParserImpl.parseFeed(url)`（`rss-parser.ts:121`）基于 `rss-parser` 库 + undici `fetch`，支持 `HTTP_PROXY` 的 `ProxyAgent`。`validateSource(url)`（`:198`）供校验接口用。
- 落库：`doFetch(task, isFirstFetch)`（`:524`）首次/手动最多取 `config.rssFirstRunMaxArticles`(=50)；先 `checkArticlesExistByTitle(rssSourceId, titles)`（`api/articles.ts:290`，按 `rss_source_id + title` 预查），再 `saveArticles`（`api/articles.ts:153`）；`saveArticles` 内再查 `title_normalized` 并依赖 `url` UNIQUE 约束兜底（`SQLITE_CONSTRAINT_UNIQUE` 捕获，`:227`）。
- 触发过滤：`triggerAutoFilter(userId, articleIds, items)`（`:594`）先做**随机错峰延迟**（`config.staggerDelayMaxMinutes`=30，`:603`）以分散 LLM 调用，再逐篇构造 `FilterInput`：`sourceType=article.source_type`、`sourceDomainId=article.domain_id`（JOIN `rss_sources.domain_id`，`:632`）、`description=contentSnippet||description`、`content=markdown_content||content`。
- 日志：每任务写 `rss_fetch_logs`（`:457` 成功 / `:504` 失败）。
- 手动触发：`fetchAllNow`（`:718`）、`fetchSourceNow(id,userId)`（`:755`）。
- API：`api/routes/rss-sources.routes.ts` — `GET/POST /api/rss-sources`、`GET/PUT/DELETE /:id`、`POST /:id/fetch`、`POST /validate`；写操作 admin 限制，接受 `domainId`。

## 3. 期刊源（`src/journal-scheduler.ts` + Python 爬虫）

- 类 `JournalScheduler`（`:54`），`initJournalScheduler()`（`:683`）：`schedule=JOURNAL_CRAWL_SCHEDULE||'15 2 * * 6'`、`timeout=SPIDER_TIMEOUT||300000`。
- **单线程顺序**爬取，每本期刊间随机延迟（`getRandomDelay`, `:599`）；`crawlJournal` 用 `activeCrawls++/--`（try/finally）互斥。
- 主流程：`runScheduledCrawl` → `getActiveJournals(1)`（`api/journals.ts:96`）→ `calculateIssuesToCrawl`（`api/journals.ts:525`，按 `publication_cycle`/`last_year`/`last_issue`/`volume_offset` 计算目标期号）→ 每期 `crawlJournal`。
- `crawlJournal(journal, year, issue, volume?)`（`:274`）：调 `pythonSpiderRunner.runSpider(source_type, {...})`（`:289`）→ 本地 `saveArticles`（`:419`，`source_origin='journal'`，写 `published_year/issue/volume`，`content=abstract`）→ 仅当 `newCount>0 && 更新更近` 时 `updateJournalCrawlStatus`（`:339`）→ 始终 `createCrawlLog`（`:360`）。
- 触发过滤：`triggerAutoFilter(journalId)`（`:520`）选出 pending 文章并 JOIN `journals.domain_id`（`:529`），`FilterInput` 用 `sourceType:'journal'`、`sourceDomainId`、`description:content`。
- API：`api/routes/journals.routes.ts` — CRUD、`POST /:id/crawl`、`GET /scheduler/status`；`source_type ∈ cnki|rdfybk|lis|wanfang`。

### Python 爬虫桥接（`src/spiders/python-spider-runner.ts`、`types.ts`）

- `PythonSpiderRunner.runSpider(spiderType, params)`（`:89`）：`spawn(pythonPath, [script, ...args], {cwd:scriptsDir, env})`。`pythonPath` 由 `resolvePythonPath`（`:41`）从 `PYTHON_PATH` + 候选解析；`scriptsDir` 来自 `SPIDER_SCRIPTS_DIR` 或 `<cwd>/src/spiders`。
- `scriptMap`（`:94`）：`cnki→cnki_spider.py`、`rdfybk→rdfybk_spider.py`、`lis→lis_spider.py`、`wanfang→wanfang_spider.py`。输出用 `-o -`（stdout），透传 `HTTP_PROXY`。
- `parseOutput`（`:259`）用括号匹配、字符串感知地从 stdout 抽取 JSON 数组，映射为 `CrawledArticle[]`（要求 `title` + `url|abstract_url`）。超时 `SPIDER_TIMEOUT||300000` 后 kill 进程；stderr 作为 debug 进度日志。解析失败返回 `{success:false, error}` 而非抛出。
- ⚠️ 类型名 `CrawledArticle`（`spiders/types.ts:31`），全代码库一致使用，勿随意改名。

## 4. 关键词源（`src/keyword-scheduler.ts` + `src/api/keywords.ts` + Google Scholar 爬虫）

- 类 `KeywordScheduler`（`:43`），`initKeywordScheduler()`（`:327`）：`schedule=KEYWORD_CRAWL_SCHEDULE||'15 3 * * 6'`、`timeout=SPIDER_TIMEOUT||430000`。
- **单线程顺序**，每关键词 `sleep(keywordInterval + random)`；`isRunning` 防重入。手动：`crawlKeywordNow(id)`（`:260`）。
- `crawlKeyword(keywordId)`（`api/keywords.ts:287`）：`googleScholarSpider.search({keyword,yearStart,yearEnd,numResults})`（`:320`）→ `saveArticles`（`:407`）→ `updateKeywordCrawlStatus`（`:335`）→ `createKeywordCrawlLog`（`:339`）。
- `saveArticles`（`:407`）：**先按 URL 去重**（`articles.url`），再查 `title_normalized`；`source_origin='keyword'`、`markdown_content=abstract`、`content=null`；随后 `triggerArticleProcessing(articleId)`（`:498`）。
- `triggerArticleProcessing`：LEFT JOIN `keyword_subscriptions` 取 `domain_id`，`FilterInput` 带 `sourceDomainId`，但**未设置 `sourceType`**（与其他源不同，接手时留意过滤器需能自行解析来源类型）。
- Google Scholar 爬虫（`src/spiders/google-scholar-spider.ts`）：`search()`（`:65`）`spawn('python3', ['scripts/cli.py', ...], {cwd:'/opt/lis-rss-daily/src/spiders/google_scholar'})`（**硬编码路径**）。输出不是内联 JSON，而是从 stdout 抽取 `/tmp/*.json` 文件路径再读取。
- ⚠️ `spider_type='cnki'` 会入库校验通过，但代码始终走 Google Scholar，CNKI 关键词路径未实现。
- API：`api/routes/keywords.routes.ts` — CRUD、`POST /:id/crawl`、status/logs；关键词文本创建后不可改。

## 5. Gmail 源（`src/gmail-scheduler.ts` + `src/gmail/`）

- 类 `GmailScheduler`（`:10`），**无独立 config 对象**，直接读 `config.gmailFetchEnabled`、`config.gmailFetchSchedule||'0 4 * * *'`。`start()` 会**立即先跑一次**再排程（`:55`）。
- `runScheduledFetch`（`:73`）选 `email_sources WHERE status='active'`，映射为 `EmailSourceConfig`（含 `domainId`），逐源串行 `processEmailSource`。
- `processEmailSource(source)`（`gmail/email-processor.ts:114`）：`fetchEmails(...)` → 每封邮件 `parseEmailContent`（LLM 拆分） → 每篇文章 `title_normalized` 去重 → 插入（`source_origin='email'`、`email_source_id`、`published_at=email.date`） → `process.nextTick` 触发 `filterArticle`（`sourceType:'email'`、`sourceDomainId:source.domainId`、`description:summary||content`） → 处理完的 UID `markAndDelete` → 更新 `email_sources.last_fetched_at/last_error` + 写 `email_fetch_logs`。
- `parseEmailContent(email, userId)`（`:52`）：`getUserLLMProvider(userId,'email_parse')` + `email_parse` 系统提示词，JSON 模式抽取 `{articles:[{title,summary,content,url,author}]}`；**失败/无提示词时回退为「用邮件主题当单篇文章」**（`:72`,`:106`）。一封通讯可拆成多篇。
- IMAP（`gmail/imap-client.ts`）：`fetchEmails(...)`（`:75`）用 `ImapFlow` 连 `imap.gmail.com:993` TLS，`buildSearchQuery` 按 `targetSenders` 过滤；`withRetry`（`MAX_RETRIES=2`，延迟 60–180s）+ `withProxyFallback`（代理 TLS 出错则直连重试）。
- 密码：`decryptAPIKey(source.imapPasswordEncrypted, config.llmEncryptionKey)`（`email-processor.ts:48`）— ⚠️ 复用了 LLM 加密密钥。
- API：`api/routes/gmail-sources.routes.ts` — CRUD、`POST /test`、`POST /:id/fetch`、`POST /fetch-now`。

## 6. `domain_id` 绑定（2026-07-13 变更，核心机制）

四张源表均有 `domain_id INTEGER NOT NULL REFERENCES topic_domains(id)`（`sql/001_init.sql:38,63,395,439`）。

- **创建时缺省回填**：未传 `domainId` 时统一取用户「优先级最高的活跃领域」（`topic_domains WHERE is_active=1 ORDER BY priority DESC`）：RSS `api/rss-sources.ts:86`、期刊 `api/journals.ts:194`、关键词 `api/keywords.ts:167`、Gmail `api/gmail-sources.ts:55`。
- **存量数据迁移**：`sql/037_add_domain_id_to_sources.sql` 为老行回填并建索引。
- **抓取时读取来源**：RSS/期刊/关键词都在触发过滤时 JOIN 各自源表拿 `domain_id`；Gmail 直接用 `source.domainId`。
- 过滤器用它做**单领域评估**（详见文档 02）。若过滤时未显式传 `sourceDomainId`，`llmFilter` 会用 `getArticleSourceDomainId(articleId)`（`api/topic-domains.ts:360`）根据 `source_origin`+外键反查。

## 7. 标题去重（`src/utils/title.ts`）

- `normalizeTitle(title)`（`:18`）：小写 → 去标点/特殊符号（保留 `\w`、空白、CJK `\u4e00-\u9fff`/`\u3400-\u4dbf`）→ 压缩空白 → trim → 空则返回 `null`。
- `generateNormalizedTitle(title)`（`:58`）：包一层并截断到 **500 字符**，对应 `articles.title_normalized` 的部分唯一索引 `idx_articles_title_normalized WHERE title_normalized IS NOT NULL`。
- 各源去重策略：RSS = 按源 `title` 预查 + 全局 `title_normalized` + `url` UNIQUE 兜底；期刊/Gmail = `title_normalized` + UNIQUE 兜底；关键词 = `url` 预查 + `title_normalized`。

## 8. 相关数据库表

`rss_sources`、`journals`、`keyword_subscriptions`、`email_sources`（各含 `domain_id`、`user_id`、`status/is_active`、`last_*`）；`articles`（`source_origin`、四外键、`title`、`title_normalized`、`url UNIQUE`、`content`、`markdown_content`、`published_at/year/issue/volume`）；日志表 `rss_fetch_logs`、`journal_crawl_logs`、`keyword_crawl_logs`、`email_fetch_logs`。表定义见 `sql/001_init.sql`，TS 类型见 `src/db.ts`。

## 9. 与旧报告（2026-05）的差异

1. **新增 Gmail 邮件源**（`source_origin='email'`）——旧报告有提及但作为「新增」，现已是一等来源，含 IMAP + LLM 拆分完整链路。
2. **四源全部绑定 `domain_id`**（NOT NULL），过滤从「多领域遍历」改为「单领域评估」。
3. **关键词源固定走 Google Scholar**，`cnki` 未实现；Google Scholar 爬虫路径硬编码、输出经 `/tmp` 文件中转（与期刊 stdout 方式不同）。
4. RSS 调度实际用 `config.rssFetchSchedule`（`0 2 * * *`），DB `settings.rss_fetch_schedule`（`0 9 * * *`）未被消费。
5. 类型名为 `CrawledArticle`（既有拼写），四本期刊来源类型现含 `wanfang`。
