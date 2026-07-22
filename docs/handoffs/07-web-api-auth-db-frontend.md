# 07 · Web/API、认证、数据库与前端 Handoff

> Express 5 应用装配、路由表、JWT/角色鉴权、Kysely+SQLite 数据层与表结构、统一日志、DeepSearch/外部检索、EJS 前端。
> 关键源文件：`src/api/web.ts`、`src/api/routes.ts`、`src/middleware/auth.ts`、`src/api/settings.ts`（+ 路由）、`src/config/types-config.ts`、`src/api/timezone.ts`、`src/api/unified-logs.ts`、`src/api/deepsearch.executor.ts`、`src/db.ts`、`sql/001_init.sql`、`src/views/`、`src/public/`。

## 1. 应用装配（`src/api/web.ts`）

- Express 5（`express@^5.1.0`）。`createApp()`（`:26`）。中间件顺序（`:30-60`）：`express.json` → `urlencoded` → `cookieParser` → 自定义请求日志（`res 'finish'` 记 method/path/status/耗时）→ `express.static(../public)` → `/templates` 静态 → `app.use('/api', apiRoutes)`。
- ⚠️ **无显式 `app.set('view engine','ejs')`**；依赖 EJS 默认解析，视图目录 `src/views/`（默认）。`src/index.ts` 里另有 `app.set('views', ...)` 与 `view engine ejs`（`index.ts:64-68`）。
- 页面路由（`web.ts` 内，多用 `optionalAuth` + 手动角色判定）：`GET/POST /login`（登录 handler 动态 import）、`POST /logout`、`GET /settings`(admin)、`/topics`(admin)、`/filter-logs`、`/filter-stats`(admin)、`/`(首页/每日总结)、`/articles`、`/articles/:id`、`/search`(**公开**)、`/deepsearch`、`/history`。
- 错误处理（`:226`）：`/api/*` 返回 JSON `{error:'Internal server error'}`，否则渲染 `error` 视图；404（`:240`）同理。
- 启动 `startServer`（`:258`）：`app.listen(config.port, config.host)`，`host=HOST||'0.0.0.0'`、`port=PORT||3000`。

## 2. 路由聚合（`src/api/routes.ts`，挂 `/api`）

多数子路由用 `router.use(x)` 挂根，内部路径自带完整 `/…`；仅 `/search`、`/deepsearch` 用显式前缀。

| 路由模块 | 有效基路径 |
|----------|-----------|
| pingRoutes | `/api/ping` |
| authRoutes | `/api/logout`（登录在 web.ts 的 `POST /login`，不在此）|
| rssSourceRoutes | `/api/rss-sources…` |
| topicDomainRoutes / topicKeywordsRoutes | `/api/topic-domains…` `/api/topic-keywords…` |
| llmConfigRoutes | `/api/llm-configs…` |
| filterRoutes | `/api/filter…` |
| schedulerRoutes | `/api/scheduler…` |
| articleProcessRoutes / articleRoutes | `/api/articles…`（process 先挂）|
| searchRoutes | `/api/search`（显式前缀）|
| settingsRoutes | `/api/settings/*` |
| systemPromptRoutes | `/api/system-prompts…` |
| dailySummaryRoutes | `/api/daily-summary…` |
| typesRoutes | `/api/types` |
| journalsRoutes / keywordsRoutes | `/api/journals…` `/api/keywords…` |
| logsRoutes | `/api/logs/*`（+ 别名）|
| blacklistRoutes | `/api/blacklist…` |
| telegramChatsRoutes / wechatRoutes | `/api/telegram-chats…` `/api/wechat…` |
| pdfSummaryRoutes | pdf 摘要 |
| deepsearchRoutes | `/api/deepsearch`（显式前缀）|
| externalSearchRoutes | `/api/external/search` |
| webSourceRoutes | `/api/web-sources…`（scraper-types、CRUD、fetch）|
| gmailSourceRoutes | `/api/gmail-sources…`（email）|

## 3. 认证与 JWT（`auth.routes.ts` + `middleware/auth.ts`）

- `auth.routes.ts` 极简：仅 `POST /api/logout`（+ 一个 debug 路由）。**登录在 `web.ts` 的 `POST /login`** → `handleLogin(username, password, res)`（`auth.ts:255`）。
- 登录：按 username 查用户；role=`user.role||'admin'`；`verifyPassword`（`:224`）支持 **bcrypt**（`$2a$`/`$2b$`）或 **SHA256** hex 回退（种子用户为 SHA256）；成功 → `createToken` + `setSessionCookie`。
- JWT：`createToken`（`:54`）`jwt.sign({userId,username,role}, config.jwtSecret, {expiresIn:config.jwtExpiresIn})`；secret 默认占位并告警，expiry 默认 `7d`。
- Cookie：名 `rss_session`，`httpOnly`、生产 `secure`、`sameSite:'lax'`、maxAge 7 天。
- `middleware/` 仅一文件 `auth.ts`，导出：`requireAuth`（`:95`，无 cookie 401，设 `req.userId/req.user/req.effectiveUserId`，guest→1）、`optionalAuth`（`:119`）、`requireAdmin`（`:146`）、`requireWriteAccess`（`:164`，guest 只读）、`requireSearchSummaryAccess`（`:183`，视 `config.searchAiSummaryGuestEnabled`）、`requireCliAuth`（`:300`，`user_id`+`api_key`/`x-api-key` 对 `CLI_API_KEY`）。角色层级 `admin:2, guest:1`。

## 4. 设置 / types-config / 时区

- `api/settings.ts`：`settings` 表键值存储（`UNIQUE(user_id,key)`）。CRUD `getUserSetting`/`setUserSetting`/… 及类型化取值：调度（`rss_fetch_schedule` 默认 `0 9 * * *`）、Chroma（`chroma_host`127.0.0.1、`chroma_port`8000、`chroma_collection`articles、`chroma_distance_metric`cosine）、Telegram（`telegram_enabled`/`telegram_bot_token` 等）。
- 路由 `settings.routes.ts`：`GET/PUT /api/settings/chroma`(写 admin)、`GET/PUT /api/settings/telegram`(写 admin，token 脱敏)、`POST /api/settings/telegram/test`。chat 级配置走 `/api/telegram-chats`。
- `config/types-config.ts`：`config/types.yaml` 单一事实源，提供 `task_types` 与 `source_types`（code/label/priority/enabled/…）。`getTaskTypeCodes`/`getSourceTypeCodes` 等，供 `GET /api/types` 与前端 `settings.js` 使用。
- `api/timezone.ts`：`getUserTimezone`（读 `settings.timezone`，回退 `config.defaultTimezone`）、`getUserLocalDate`、`buildUtcRangeFromLocalDate`（用 `Intl.DateTimeFormat` 算本地日 UTC 边界）。

## 5. 统一日志（`api/unified-logs.ts` + `logs.routes.ts`）

- `getUnifiedLogs()` 合并 6 类日志：`UnifiedLogType='filter'|'rss_fetch'|'email_fetch'|'journal_crawl'|'process'|'keyword_crawl'`。⚠️ `web_fetch_logs` 未纳入统一日志，Web 爬虫抓取日志需直接查询 `web_fetch_logs` 表。映射为 `UnifiedLogEntry{id:'type:id', type, created_at, status, data}`，按时间降序分页，返回 `totalsByType`。
- 路由（均 `requireAuth`，用 `effectiveUserId`，默认 30 天窗口）：`GET /api/logs/filter`(别名 `/api/filter/logs`)、`/logs/crawl`、`/logs/journals/:id`、`/logs/rss-fetch`、`/logs/email-fetch`、`/logs/process`、`/logs/keyword-crawl`、`/logs/keywords/:id`、`/logs/unified`。前端类型别名归一：`rss→rss_fetch`、`crawl→journal_crawl`、`keyword→keyword_crawl`。

## 6. DeepSearch 与外部检索

- **DeepSearch**：对文章语料做 LLM 深度研究的后台任务。路由 `deepsearch.routes.ts`（挂 `/api/deepsearch`，`requireAuth`，按 `user_id` 隔离）：`GET /tasks`、`POST /tasks`（建 `deepsearch_tasks` 行、`external_task_id=randomUUID()`、启 `startDeepSearchTask`）、`GET /tasks/:id`（合并 DB + 运行时态）、`GET /tasks/:id/download`（zip 报告 + articles）、`DELETE /tasks/:id`。参数：`task_name`/`input_md`/`rounds`(1)/`semantic_limit`(5)/`score_threshold`(0.65)/`max_final_articles`(10)/`skip_pdf_summary`。
- 执行器 `deepsearch.executor.ts`：内存 `runtimeTasks: Map`（`:51`），`startDeepSearchTask`（`:93`）建 `output/deepsearch/<taskId>` 目录，调 **`scripts/deepsearch/deepsearch.js` 的 `runDeepSearch()`**（`onProgress`/`onLog` 回调），完成/失败落库；日志截末 500 行。
- **外部检索** `external-search.routes.ts`：`POST /api/external/search`——`injectUserIdFromBody` + `requireCliAuth`（API Key），构 `SearchRequest` 调 `search()`，支持 `semantic|keyword|mixed|related`，related 需 `articleId`。

## 7. 数据库层（`src/db.ts` + `sql/001_init.sql`）

- 引擎：`better-sqlite3` + Kysely `SqliteDialect`；DB 路径 `config.databasePath`。Pragma（`initDb`, `:401`）：`journal_mode=WAL`、`synchronous=NORMAL`、`cache_size=-64000`(64MB)、`foreign_keys=ON`。单例 `initDb/getDb/closeDb`。
- `DatabaseTable`（`:29-52`）表清单：`users, rss_sources, articles, topic_domains, topic_keywords, article_filter_logs, article_process_logs, article_related, article_translations, llm_configs, settings, system_prompts, daily_summaries, journals, journal_crawl_logs, rss_fetch_logs, keyword_subscriptions, keyword_crawl_logs, web_sources, web_fetch_logs, telegram_chats, deepsearch_tasks, email_sources, email_fetch_logs`。`Generated<T>` 区分 insert/select 类型。

### 关键表要点（`sql/001_init.sql`，已把新列滚入 init）

| 表 | 要点 |
|----|------|
| `users` | `role DEFAULT 'admin' CHECK(admin\|guest)` |
| `rss_sources` | `source_type ∈ journal\|blog\|news`、`domain_id NOT NULL`、`UNIQUE(user_id,url)` |
| `email_sources` | `email_address`、`imap_password_encrypted`、`target_senders`(JSON)、`domain_id NOT NULL` |
| `articles` | `url UNIQUE`、`source_origin ∈ rss\|journal\|keyword\|web\|email`、五外键（含 `web_source_id`）、`title_normalized` 部分唯一索引 |
| `article_filter_logs` | `domain_id` 可空 FK SET NULL |
| `article_process_logs` | `stage ∈ markdown\|translate\|vector\|related\|pipeline_complete` |
| `article_related` / `article_translations` | 相关缓存 / 翻译（按 article_id）|
| `llm_configs` | `config_type`/`task_type`/`priority`/`timeout`/…/加密 key |
| `daily_summaries` | `summary_type ∈ journal\|blog_news\|all\|search\|journal_all\|insights`、`UNIQUE(user_id,summary_date,summary_type)` |
| `journals` | init 为 `cnki\|rdfybk\|lis`（`wanfang` 由迁移 014/TS 类型补）、`domain_id NOT NULL` |
| `keyword_subscriptions` | `spider_type ∈ google_scholar\|cnki`、`domain_id NOT NULL` |
| `telegram_chats` | 拆分推送开关列、`UNIQUE(user_id,chat_id)` |
| `deepsearch_tasks` | `search_stats_json`/`execution_logs_json`（`skip_pdf_summary` 由迁移 032）|

- 种子：admin(id=1, SHA256 `admin123`)、guest(id=2, SHA256 `cc@7007`, role guest)、两用户默认设置、默认 filter/analysis 系统提示词、约 19 本默认期刊。
- 迁移：`scripts/migrate.ts`（`pnpm run db:migrate`）自动备份、按 `sql/*.sql` 数字序应用，含幂等 `hasColumn`/`hasTable` 处理；许多旧迁移已折入 `001_init.sql`。**037** 为存量库补 `domain_id` 并按最高优先级活跃领域回填。迁移 017 需另跑 `db:backfill-title-normalized`。

## 8. 前端（EJS 多页，非 SPA 框架）

- `views/layout.ejs` 主模板：`<head>` 加载字体，CSS **生产 → `/css/main.bundle.min.css`，开发 → `/css/main.css`**；注入 `window.userRole`/`window.guestSummaryEnabled`；header 导航按角色显隐；`<%- body %>` 注入；末尾加载 `confirm-dialog.js`/`toast.js`/`keyboard-shortcuts.js`。
- 页面两种模式：小包装（`settings.ejs` include `settings/body`）与内联 body 字符串（`search.ejs` 把标记+页面 JS 作为反引号字符串传给 layout）。
- 设置页 `views/settings/body.ejs`：tab 栏（rss/journals/gmail/keywords/llm/prompts/blacklist/telegram/wechat/chroma）+ `panel-*.ejs` + `modals.ejs`；加载 `settings.js`/`wechat-settings.js`，内联脚本从 `/api/topic-domains` 填充领域下拉。
- 导航是普通多页锚点跳转；页面级动态在各自 JS：`settings.js`（~2473 行，tab 切换 + 全设置 CRUD，从 `/api/types` 取类型）、`search.ejs` 内联 JS（防抖搜索、URL 同步、分页、AI 总结弹窗 `POST /api/search/summary`）。
- 静态 JS（`public/js/`）：全局 `time-utils.js`/`toast.js`/`confirm-dialog.js`/`keyboard-shortcuts.js` + 页面控制器 `settings.js`/`wechat-settings.js`/`home.js`/`history.js`/`article-detail.js`/`daily-summary.js`/`rating.js`。
- CSS 分层（`public/css/`）：`base/` `design-system/` `components/` `pages/`；`main.css` 为开发入口。
- 构建：`src/scripts/build-css.js`（`pnpm run build:css`）拼接固定 `CSS_IMPORTS`（**不含 `pages/*`**）为 `main.bundle.css`/`main.bundle.min.css`；`NODE_ENV=production` 或 `--minify` 时压缩。
- `layout.ejs` 引用层：生产态 `<link href="/css/main.bundle.min.css">`、开发态 `<link href="/css/main.bundle.css">`——**2026-07-14 已修复命名对齐**（原开发态误引用 `/css/main.css`）。`build-css.js` 产物（`main.bundle.css` / `main.bundle.min.css`）与 `layout.ejs` 引用现已一致。

## 9. 与旧报告（2026-05）的差异

1. **`email` 是一等来源**（articles/源表/email_fetch_logs/gmail 路由/统一日志），约迁移 034 加入。
2. **`web` 是第五类来源**（`source_origin='web'`），迁移 041 加入。`web_sources` 表含 `source_type`、`scraper_type`、`fetch_interval` 等专属字段。
3. **五张源表都有 `domain_id`**（NOT NULL），迁移 037 回填。
4. **DeepSearch** 有持久化 `deepsearch_tasks` 表 + 内存执行器（调 `scripts/deepsearch/deepsearch.js`），支持 zip 下载与 `skip_pdf_summary`。
5. **统一日志覆盖 6 类**（含 `email_fetch`、`keyword_crawl`）。
6. 登录在 `web.ts` 的 `POST /login`，`auth.routes.ts` 只有 `/api/logout`。
7. 密码支持 **bcrypt + SHA256**，种子用户为 SHA256。
8. Express **5**；`web.ts` 内无显式 view-engine 注册（在 `index.ts` 设置）。
9. **CSS 命名已对齐（2026-07-14）**：`layout.ejs` 开发/生产分别引用 `/css/main.bundle.css` / `/css/main.bundle.min.css`，与 `build-css.js` 产物一致（旧报告差异第 7 条描述的不一致已消除，见 §8）。
