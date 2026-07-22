# 01 · 数据采集子系统 Handoff

> 覆盖 RSS / 期刊 / 关键词 / Gmail / Web 爬虫 五类数据源的采集、Python/JS 爬虫集成、标题去重、`domain_id` 绑定与向过滤阶段的流转。
> 关键源文件：`src/rss-scheduler.ts`、`src/journal-scheduler.ts`、`src/keyword-scheduler.ts`（+ `src/api/keywords.ts`）、`src/gmail-scheduler.ts`、`src/gmail/`、`src/web-scheduler.ts`、`src/spiders/`、`src/spiders/web-scraper-runner.ts`、`src/spiders/web-scrapers/`、`src/api/rss-sources.ts` `journals.ts` `keywords.ts` `gmail-sources.ts` `web-sources.ts`、`src/utils/title.ts`、`src/constants/source-types.ts`。

## 1. 通用架构

五个源各有一个**单例调度器**，均在 `src/index.ts` 启动：`initRSSScheduler()`(L74)、`initJournalScheduler()`(L97)、`initKeywordScheduler()`(L108)、`initWebScheduler()`(L125)、`initGmailScheduler()`(L137)。全部 node-cron 且 `timezone: 'Asia/Shanghai'`。

> **近期重构（2026-07-14）**：上述 5 个源调度器（连同每日总结 / 洞察 / 相关文章 / 拒绝清理共 9 个调度器）已全部继承 `src/utils/base-scheduler.ts` 的 `BaseScheduler` 抽象类，统一了 `start()` / `stop()` / cron 表达式校验 / `timezone`（默认 `Asia/Shanghai`）/ `pollWhile()` 在途任务等待逻辑。子类只需实现 `schedulerName` / `cronSchedule` / `isEnabled()` / `run()`，并可选重写 `waitForCompletion()`。单例工厂函数（`initXxxScheduler`）仍保留在各子类中（见 §9 差异）。

共同点：

- 都写入**同一张 `articles` 表**，用不同 `source_origin` 区分：`'rss'`、`'journal'`、`'keyword'`、`'email'`、`'web'`。
- 都在保存后调用 `filterArticle(FilterInput)`（`src/filter.ts:26`），过滤通过再调 `processArticle(id, userId)`（`src/pipeline.ts`）。
- 都用 `generateNormalizedTitle`（`src/utils/title.ts:58`）做标题去重。
- 每个源都携带 `domain_id`，作为 `FilterInput.sourceDomainId` 传给过滤器（见 §6）。

差异点一览：

| 维度 | RSS | 期刊 Journal | 关键词 Keyword | Web 爬虫 | Gmail |
|------|-----|-------------|---------------|----------|-------|
| 默认 cron | `0 2 * * *` | `15 2 * * 6`（周六 02:15） | `15 3 * * 6`（周六 03:15） | `0 3 * * *` | `0 4 * * *`（且启动即跑一次） |
| 并发 | `Promise.race` + 信号量，`maxConcurrent=5` | 单线程串行 + 随机间隔 | 单线程串行 + 随机间隔 | 单线程串行 + 随机间隔 | 逐源串行 |
| 外部进程 | 无（HTTP/XML） | Python 子进程 | Python 子进程 | Python/JS 子进程（Playwright CDP） | 无（IMAP + LLM） |
| 过滤触发 | 随机延迟 0–30 分钟后 | 立即 | 立即 | 立即（fire-and-forget） | `process.nextTick` |

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
- Google Scholar 爬虫（`src/spiders/google-scholar-spider.ts`）：`search()`（`:65`）`spawn('python3', ['scripts/cli.py', ...], {cwd: scriptsDir})`，其中 `scriptsDir = path.join(__dirname, 'google_scholar')`（**2026-07-14 修复**：原硬编码 `/opt/lis-rss-daily/src/spiders/google_scholar`，见 §9 差异）。输出不是内联 JSON，而是从 stdout 抽取 `/tmp/*.json` 文件路径再读取。
- ⚠️ `spider_type='cnki'` 会入库校验通过，但代码始终走 Google Scholar，CNKI 关键词路径未实现。
- API：`api/routes/keywords.routes.ts` — CRUD、`POST /:id/crawl`、status/logs；关键词文本创建后不可改。

## 5. Web 爬虫源（`src/web-scheduler.ts` + `src/spiders/web-scraper-runner.ts` + `src/spiders/web-scrapers/`）

- 类 `WebScheduler`（`web-scheduler.ts`），单例 `initWebScheduler()`。继承 `BaseScheduler`，读取 `config.webFetchSchedule`（默认 `'0 3 * * *'`，每天 3:00）、`config.webFetchEnabled`。
- **单线程顺序**爬取，每源间随机延迟 5–15 秒（`:99`）避免对目标网站造成压力。`activeFetches++/--`（try/finally）互斥。
- 主流程：`run()` → `getActiveWebSources(1)`（`api/web-sources.ts:getActiveWebSources`）→ 逐源 `fetchSource(source)`。
- `fetchSource(source)`（`:122`）：
  1. `runWebScraper(source.scraper_type, source.url)` 运行爬虫脚本
  2. `saveArticles(source, articles)` 保存文章到 `articles` 表（`source_origin='web'`，`web_source_id` 绑定）
  3. `updateWebSourceLastFetched(source.id)` 更新抓取时间
  4. `createWebFetchLog(...)` 写抓取日志
- 去重策略：`title_normalized` 查 `articles` 表 → 查 `rejected_articles` 归档 → `url` 查 `articles` 表 → `SQLITE_CONSTRAINT_UNIQUE` 兜底（`:238-280`）。与期刊/Gmail 同模式。
- 触发过滤：`triggerAutoFilter(source)`（`:288`）选中该源 `filter_status='pending'` 的文章，逐篇构造 `FilterInput`：`sourceType=source.source_type`（来源于 `source_type` 字段：journal/blog/news）、`sourceDomainId=source.domain_id`、`description=content`、`content=markdown_content||content`。过滤通过后 `processArticle(id, userId)` fire-and-forget。
- 日志：每次抓取写 `web_fetch_logs`（status=success/failed/partial）。
- 手动触发：`fetchAllNow()`（`:111`）、`fetchSourceNow(sourceId)`（`:118`）。
- API：`api/routes/web-sources.routes.ts` — `GET/POST /api/web-sources`、`GET/PUT/DELETE /:id`、`POST /:id/fetch`、`GET /web-sources/scraper-types`；写操作 admin 限制。

### Web 爬虫运行器（`src/spiders/web-scraper-runner.ts`、`types.ts`）

- `runWebScraper(scraperType, targetUrl)`（`:82`）：`spawn(pythonPath|nodePath, [script, ...args], {cwd:scriptDir, env})`。
- 与期刊 `PythonSpiderRunner` 不同：Web 爬虫运行器是**通用型**，支持 Python 与 JavaScript 两类脚本；期刊运行器仅 Python。
- **环境变量**：`TARGET_URL`（必选，来源 URL）、`BROWSER_ADDRESS`（Playwright CDP WebSocket 地址，默认 `ws://127.0.0.1:9222`）、`HTTP_PROXY`。
- 超时：`WEB_SCRAPER_TIMEOUT||120000`（2 分钟），超时后 `proc.kill()`。
- 输出格式：stdout 输出 **JSON 数组**，每项 `{ title, link, summary?, date? }`。不强制 `abstract_url` 等期刊特有字段。
  - 脚本也可输出 `{ success: false, error: ... }` 对象表示失败。
  - `parseScrapedDate(dateStr)`（`:187`）将 `DD-MM`、`YYYY-MM-DD`、`YYYY-MM` 等格式统一为 ISO 日期。
- 解析失败返回 `{success:false, error}` 而非抛出。

### 爬虫配置（`src/spiders/web-scrapers/config.ts`）

- `SCRAPER_MAP` 映射表，每条记录定义：`scraperType`（类型代码）、`label`（中文名称）、`script`（脚本文件名）、`scriptType`（`'python'` | `'javascript'`）。
- 当前默认脚本：
  - `lsc` → `lsc-scraper.py`（Python）—— 中图学会（中国图书馆学会）
- 导出的函数：`getScraperTypeCodes()`、`getScraperConfig(code)`、`getAllScraperConfigs()`、`getScraperScriptPath(code)`。
- 新增爬虫脚本只需在映射表中添加条目，并在 `web-scrapers/` 目录下放置脚本文件。

### 默认脚本：中图学会（`src/spiders/web-scrapers/lsc-scraper.py`）

- Playwright `chromium.connect_over_cdp(browser_address)` 连接已运行的浏览器，不自行启动。
- 抓取目标页的 `.otherLi` 列表，每项取：
  - `.rightTitle` → `title` + `href`（相对路径拼接为完整 URL）→ `link`
  - `.rightMsg` → `summary`
  - `.liDay` + `.liMonth` → `date`（`DD-MM` 格式）
- 输出 JSON 数组到 stdout。
- ⚠️ 依赖外部 Playwright 浏览器进程（如 `lightpanda` 或 Chrome CDP），`BROWSER_ADDRESS` 环境变量配置连接地址。

## 6. Gmail 源（`src/gmail-scheduler.ts` + `src/gmail/`）

- 类 `GmailScheduler`（`:10`），**无独立 config 对象**，直接读 `config.gmailFetchEnabled`、`config.gmailFetchSchedule||'0 4 * * *'`。`start()` 会**立即先跑一次**再排程（`:55`）。
- `runScheduledFetch`（`:73`）选 `email_sources WHERE status='active'`，映射为 `EmailSourceConfig`（含 `domainId`），逐源串行 `processEmailSource`。行→对象的映射已提取为 `rowToEmailSourceConfig(row)`（`gmail-scheduler.ts`），两处调用点（批量列表 / 单源）共用，消除重复映射代码（见 §9 差异）。
- `processEmailSource(source)`（`gmail/email-processor.ts:114`）：`fetchEmails(...)` → 每封邮件 `parseEmailContent`（LLM 拆分） → 每篇文章 `title_normalized` 去重 → 插入（`source_origin='email'`、`email_source_id`、`published_at=email.date`） → `process.nextTick` 触发 `filterArticle`（`sourceType:'email'`、`sourceDomainId:source.domainId`、`description:summary||content`） → 处理完的 UID `markAndDelete` → 更新 `email_sources.last_fetched_at/last_error` + 写 `email_fetch_logs`。
- `parseEmailContent(email, userId)`（`:52`）：`getUserLLMProvider(userId,'email_parse')` + `email_parse` 系统提示词，JSON 模式抽取 `{articles:[{title,summary,content,url,author}]}`；**失败/无提示词时回退为「用邮件主题当单篇文章」**（`:72`,`:106`）。一封通讯可拆成多篇。
- IMAP（`gmail/imap-client.ts`）：`fetchEmails(...)`（`:75`）用 `ImapFlow` 连 `imap.gmail.com:993` TLS，`buildSearchQuery` 按 `targetSenders` 过滤；`withRetry`（`MAX_RETRIES=2`，延迟 60–180s）+ `withProxyFallback`（代理 TLS 出错则直连重试）。
- 密码：`decryptAPIKey(source.imapPasswordEncrypted, config.llmEncryptionKey)`（`email-processor.ts:48`）— ⚠️ 复用了 LLM 加密密钥。
- API：`api/routes/gmail-sources.routes.ts` — CRUD、`POST /test`、`POST /:id/fetch`、`POST /fetch-now`。

## 7. `domain_id` 绑定（2026-07-13 变更，核心机制）

五张源表均有 `domain_id INTEGER NOT NULL REFERENCES topic_domains(id)`（`sql/001_init.sql`）。

- **创建时缺省回填**：未传 `domainId` 时统一取用户「优先级最高的活跃领域」（`topic_domains WHERE is_active=1 ORDER BY priority DESC`）：RSS `api/rss-sources.ts:86`、期刊 `api/journals.ts:194`、关键词 `api/keywords.ts:167`、Web `api/web-sources.ts:createWebSource`、Gmail `api/gmail-sources.ts:55`。
- **存量数据迁移**：`sql/037_add_domain_id_to_sources.sql` 为老行回填并建索引（仅 rss/journals/keyword/email）；Web 源为新表，建表时即有 `domain_id`。
- **抓取时读取来源**：RSS/期刊/关键词都在触发过滤时 JOIN 各自源表拿 `domain_id`；Web 直接用 `source.domain_id`（`web-scheduler.ts:triggerAutoFilter`）；Gmail 直接用 `source.domainId`。
- 过滤器用它做**单领域评估**（详见文档 02）。若过滤时未显式传 `sourceDomainId`，`llmFilter` 会用 `getArticleSourceDomainId(articleId)`（`api/topic-domains.ts:360`）根据 `source_origin`+外键反查（已支持 `'web'` + `web_source_id`）。

## 8. 标题去重（`src/utils/title.ts`）

- `normalizeTitle(title)`（`:18`）：小写 → 去标点/特殊符号（保留 `\w`、空白、CJK `\u4e00-\u9fff`/`\u3400-\u4dbf`）→ 压缩空白 → trim → 空则返回 `null`。
- `generateNormalizedTitle(title)`（`:58`）：包一层并截断到 **500 字符**，对应 `articles.title_normalized` 的部分唯一索引 `idx_articles_title_normalized WHERE title_normalized IS NOT NULL`。
- 各源去重策略：
  - **RSS**：按源 `title` 预查 + 全局 `title_normalized` + `url` UNIQUE 兜底
  - **期刊/Gmail**：`title_normalized` + UNIQUE 兜底
  - **关键词**：`url` 预查 + `title_normalized`
  - **Web 爬虫**：`title_normalized` 预查（`articles` + `rejected_articles` 双表） → `url` 预查 → `SQLITE_CONSTRAINT_UNIQUE` 兜底

## 9. 相关数据库表

`rss_sources`、`journals`、`keyword_subscriptions`、`web_sources`、`email_sources`（各含 `domain_id`、`user_id`、`status/is_active`、`last_*`）；`articles`（`source_origin`、五外键 `rss_source_id`/`journal_id`/`keyword_id`/`web_source_id`/`email_source_id`、`title`、`title_normalized`、`url UNIQUE`、`content`、`markdown_content`、`published_at/year/issue/volume`）；日志表 `rss_fetch_logs`、`journal_crawl_logs`、`keyword_crawl_logs`、`web_fetch_logs`、`email_fetch_logs`。表定义见 `sql/041_add_web_sources.sql`（新版亦已滚入 `001_init.sql`），TS 类型见 `src/db.ts`。

## 10. 与旧报告（2026-05）的差异

1. **新增 Gmail 邮件源**（`source_origin='email'`）——旧报告有提及但作为「新增」，现已是一等来源，含 IMAP + LLM 拆分完整链路。
2. **新增 Web 爬虫源**（`source_origin='web'`）——通用网络爬虫，支持 Python/JS 脚本，通过 Playwright CDP 抓取，输出 JSON 标准化字段。
3. **五源全部绑定 `domain_id`**（NOT NULL），过滤从「多领域遍历」改为「单领域评估」。
4. **关键词源固定走 Google Scholar**，`cnki` 未实现；Google Scholar 爬虫路径硬编码、输出经 `/tmp` 文件中转（与期刊 stdout 方式不同）。
5. RSS 调度实际用 `config.rssFetchSchedule`（`0 2 * * *`），DB `settings.rss_fetch_schedule`（`0 9 * * *`）未被消费。
6. 类型名为 `CrawledArticle`（既有拼写），四本期刊来源类型现含 `wanfang`。

## 11. 近期重构差异（2026-07-14，基于代码审查实施计划）

- **调度器基类化**：RSS / 期刊 / 关键词 / Web 爬虫 / Gmail（及每日总结 / 洞察 / 相关文章 / 拒绝清理）9 个调度器全部继承 `src/utils/base-scheduler.ts` 的 `BaseScheduler`，统一生命周期与 cron 校验（见 §1）。
- **Google Scholar 爬虫路径**：`cwd` 由硬编码 `/opt/lis-rss-daily/src/spiders/google_scholar` 改为 `path.join(__dirname, 'google_scholar')`（见 §4）。⚠️ `python-spider-runner.ts:55` 的解释器候选路径 `/home/xulei/.pyenvs/...` 仍硬编码，未纳入本次修复。
- **EmailSourceConfig 映射**：提取 `rowToEmailSourceConfig(row)`，两处调用共用（见 §5）。
- **期刊 `triggerAutoFilter` 多租户修复**：原硬编码 `userId=1`，现从该期刊下 pending 文章查询中读取真实 `journals.user_id`，并补充 `content: markdown_content || content` 回退链、`rejectedCount` 日志（见 `journal-scheduler.ts`）。
- **RSS N+1 优化**：`filterSourcesByFetchInterval` / 强制模式原先在循环内逐源 `SELECT last_fetched_at`，现改为 `getLastFetchedMap(ids)` 一次 `WHERE id IN (...)` 批量查询（见 `rss-scheduler.ts`）。

### 5.1 数据库变更（迁移 `sql/041_add_web_sources.sql`）

- **新源表 `web_sources`**：`name` / `url`（UNIQUE(user_id,url)）/ `source_type`（journal|blog|news，用于每日总结分类）/ `scraper_type`（映射脚本）/ `domain_id` / `fetch_interval`（默认 3600s）/ `auto_cleanup_rejected` / `status`。
- **新日志表 `web_fetch_logs`**：与 `rss_fetch_logs` 同模式，status=success|failed|partial。
- **`articles` 表新增 `web_source_id`**：第 5 个外键，`ON DELETE CASCADE`。`source_origin` CHECK 约束现包含 `'web'`：`'rss' | 'journal' | 'keyword' | 'email' | 'web'`。
- **`rejected_articles` 表**新增 `web_source_id` 列及索引。
- **新类型 `WebScraperType`**（`spiders/types.ts`）：`'lsc'`（中图学会）。
- **配置项**（`config.ts`）：`webFetchEnabled`（`WEB_FETCH_ENABLED`，默认 true）、`webFetchSchedule`（`WEB_FETCH_SCHEDULE`，默认 `'0 3 * * *'`）。

## 12. 新增数据源检查清单（2026-07 经验总结）

> 以下清单基于 Web 爬虫源（`source_origin='web'`）集成过程中发现的遗漏归纳而来。
> **每次新增数据源类型时，对照此清单逐项检查，否则极易遗漏某处导致数据可见性/统计/筛选/处理等功能不完整。**

假设新增源类型代号 `foo`、外键字段 `foo_source_id`、源表 `foo_sources`、`source_origin='foo'`。

### 12.1 数据模型层

- [ ] **`src/constants/source-types.ts`**：注册新 `source_origin` 值
- [ ] **SQL 迁移**：建 `foo_sources` 表 + `articles.foo_source_id` 外键 + 更新 `source_origin` CHECK 约束 + `rejected_articles.foo_source_id`
- [ ] **`src/db.ts`**：TypeScript 表类型定义
- [ ] **`src/config.ts`**（如需）：新增调度相关配置项

### 12.2 `src/api/articles.ts` 核心服务

**接口定义：**
- [ ] `ArticleWithSource`：添加 `foo_source_id: number | null` + `foo_source_name?: string` + 更新 `source_origin` 联合类型

**CRUD/查询函数逐一检查：**
- [ ] `getArticleById()` — LEFT JOIN + 权限条件（`foo_sources.user_id`）+ 选择 `foo_source_name` + 合并到 `source_name`
- [ ] `getArticleFilterMatches()` — LEFT JOIN + 权限条件
- [ ] `getUserArticles()` — LEFT JOIN + 权限条件 + 来源筛选参数 + `hasSourceFilter` + 筛选条件（两处：count 查询 + 数据查询）
- [ ] `deleteArticle()` — 权限条件
- [ ] `updateArticleReadStatus()` — 权限条件
- [ ] `updateArticleFilterStatus()` — 权限条件
- [ ] `batchUpdateArticleReadStatus()` — 权限条件
- [ ] `updateArticleRating()` — 权限条件
- [ ] `updateArticleAiSummary()` — 权限条件
- [ ] `markAllAsRead()` — 选项类型 + 参数构建 + 来源筛选条件
- [ ] `getUnreadCount()` — LEFT JOIN + 权限条件
- [ ] `getMergedSources()` — 查询 `foo_sources` + 添加到 `sourceMap`（注意合并逻辑）

> ⚠️ 经验教训：`updateArticleRating` 和 `updateArticleAiSummary` 曾在 Web 爬虫集成时被遗漏，因为它们的权限条件写死在函数体内而非共用 `buildUserArticlePermissionCondition`。
> ⚠️ **2026-07-22 新增**：`getUserArticles()` 的**数据查询分支**（分页数据查询，`articlesQuery`）在处理 `webSourceIds` 时遗漏了 `web_source_id IN (...)` 条件，导致计数查询正确返回 6 条，但数据查询因 `conditions` 数组为空而生成 `1 = 0`（永远为假），返回 0 行。**筛选条件必须同时在计数查询和数据查询两处添加**，否则会出现分页显示有文章但列表为空的现象。

### 12.3 路由层 `src/api/routes/articles.routes.ts`

- [ ] `buildUserArticlePermissionCondition()` — 添加 `foo_source_id` 条件
- [ ] `GET /api/articles/stats` — 所有 7 个 COUNT 查询各添加一个 `leftJoin('foo_sources', ...)`

> ⚠️ 经验教训：统计查询的 LEFT JOIN 和权限条件是**同步的**——只要改了权限条件忘了加 JOIN，查询会因缺少表引用而报错；但加了 JOIN 忘了改权限条件，查询不会报错但会漏数。两者要一起检查。
> ⚠️ **2026-07-22 新增**：`GET /api/articles` 路由处理器中，`webSourceIds` 既未从 `req.query` 提取（遗漏 `normalizeQueryIds` 调用），也未传递给 `getUserArticles()` 的 options 参数。**两处需同时检查**：`const fooSourceIds = normalizeQueryIds(...)` 提取 + 在 options 对象中添加 `fooSourceIds` 字段。`markAllAsRead` 路由同理。

### 12.4 流水线 `src/pipeline.ts`

- [ ] `getArticleIdsByStatus()` — 添加 `foo_sources` 的内连接查询 + 合并到 `allArticles` 数组

### 12.5 批量处理 `src/api/article-process.ts`

- [ ] `filterAndProcessBatch()` — 添加获取待筛选文章的查询步骤 + 对应的过滤循环步骤

> ⚠️ 经验教训：该函数硬编码了 3 个来源的查询（RSS/期刊/关键词）和过滤逻辑，新增源需要添加对应的查询和过滤步骤。

### 12.6 每日总结

**`src/api/daily-summary-repository.ts`：**
- [ ] `getDailyPassedArticles()` — `buildBaseQuery` 中：LEFT JOIN + 权限条件 + `coalesce` 纳入 `foo_sources.name`
- [ ] `getDailyPassedArticles()` — `executeQuery` 映射中：处理 `source_origin === 'foo'` 时的名称与类型
- [ ] `getDailyPassedArticles()` — 分类查询（`type === 'blog_news'` / `type === 'all'`）：根据需要将 `foo` 加入 `OR` 条件
- [ ] `getInsightsArticles()` — LEFT JOIN + 权限条件 + `coalesce` 纳入 `foo_sources.name`

**`src/api/daily-summary-generator.ts`：**
- [ ] `generateSearchSummary()` — LEFT JOIN + 权限条件 + `coalesce` + 映射处理
- [ ] `buildArticlesListText()` — 如需新增分类，添加对应 `addSection` 调用
- [ ] `DailySummaryResult.articlesByType` — 如需新增分类，扩展类型定义

> ⚠️ **2026-07-22 新增 — `source_type` COALESCE 漏洞**：`executeQuery()`、`generateSearchSummary()`、`getInsightsArticles()` 三处的
> `SELECT` 中均使用 `COALESCE(rss_sources.source_type, 'journal') AS source_type` 确定文章的分类类型。
> 这导致**非 RSS、非期刊/关键词的源（如 `source_origin='web'`）一律被默认归类为 `'journal'`**，
> 出现在「期刊精选」而非「资讯动态」或「博客推荐」中。
>
> **修复方式**：将 `COALESCE` 扩展为 `COALESCE(rss_sources.source_type, foo_sources.source_type, 'journal')`，
> 让查询层直接从新源的源表 `foo_sources` 获取 `source_type`。如果新源没有 `source_type` 列（如 email 源），
> 则需要在**JS 映射层**显式覆盖：`if (row.source_origin === 'foo') { sourceType = 'foo'; }`。
>
> **所有涉及 `source_type` 的查询和映射都要一同检查**：
> | 位置 | 函数 | 修复项 |
> |------|------|--------|
> | `daily-summary-repository.ts` | `executeQuery()` | COALESCE + JS 映射 |
> | `daily-summary-repository.ts` | `getInsightsArticles()` | LEFT JOIN + COALESCE + JS 映射（该函数还曾遗漏 `email_sources` 的 LEFT JOIN） |
> | `daily-summary-generator.ts` | `generateSearchSummary()` | COALESCE + JS 映射 |
>
> ⚠️ **`getInsightsArticles` 额外注意**：该函数在 Web 集成时不仅遗漏了 `foo_sources` 的 LEFT JOIN，
> 也遗漏了已存在的 `email_sources` 的 LEFT JOIN（早在 Web 集成之前就已存在 email 源）。
> **新增源时需同步检查所有类似函数是否遗漏了已有源的 JOIN——即使不是本次新增的源。**
>
> **⚠️ `getInsightsArticles` 白名单设计说明（2026-07-22 确认）**：该函数额外使用期刊白名单过滤
> (`config/journals_list.yaml`，19 本图情学期刊名称)，过滤条件为：
> ```typescript
> .where((eb) => eb.or([
>   eb('rss_sources.name', 'in', whitelist),
>   eb('journals.name', 'in', whitelist),
> ]))
> ```
> 这意味着只有 `rss_sources.name` 或 `journals.name` 在白名单中的文章才能进入洞察报告。
> 由于 `source_origin='web'`、`'email'`、`'keyword'` 的文章通过 LEFT JOIN 后对应字段为 `NULL`，
> 它们**不会通过**白名单过滤，因此无法进入洞察报告。
>
> **这是有意为之的设计**——洞察报告聚焦图书情报学核心期刊的研究趋势分析，不包含网站爬虫资讯、
> 邮件订阅或关键词检索结果。如果后续需要放宽此限制，需按以下方式修改：
> ```typescript
> .where((eb) => eb.or([
>   eb.and([eb('articles.source_origin', '=', 'rss'), eb('rss_sources.name', 'in', whitelist)]),
>   eb.and([eb('articles.source_origin', '=', 'journal'), eb('journals.name', 'in', whitelist)]),
>   eb('articles.source_origin', 'in', ['email', 'web']),
> ]))
> ```
> 同时需在 `getInsightsArticles` 的 JS 映射中添加对应 `source_origin` 的 `sourceType` 覆盖。

### 12.7 前端

**`src/views/articles.ejs`：**
- [ ] `loadArticles()` — 来源 ID 解析：添加 `hasFooIds` 和 `appendIdList` 调用，添加 `type === 'foo'` 回退处理
- [ ] `loadArticles()` — URL 参数命名：前端用 `webSourceIds`，后端 `getUserArticles` 接收 `webSourceIds`，需一致
- [ ] `markAllAsRead()` — 来源 ID 解析：添加 `fooSourceIds` 的获取和参数构建

> ⚠️ 经验教训：Web 源前端 `loadArticles()` 中缺少 `web:{id}` 解析，导致选择了 Web 源后筛选参数未正确传递到后端。

### 12.8 领域反查 `src/api/topic-domains.ts`

- [ ] `getArticleSourceDomainId()` — 添加 `source_origin === 'foo'` 的分支反查 `foo_sources.domain_id`

### 12.9 验证清单

完成上述修改后，执行以下验证：

- [ ] **TypeScript 编译**：`npx tsc --noEmit` 无错误
- [ ] **单元测试**：相关测试通过
- [ ] **手动验证**：
  - 首页统计（今日新增/待处理/已完成/通过率/未读）是否正确计入新来源文章
  - 文章列表能否按新来源筛选
  - 文章详情页正确显示来源名称
  - 批量处理能处理新来源的待筛选/待处理文章
  - 每日总结正确包含新来源文章