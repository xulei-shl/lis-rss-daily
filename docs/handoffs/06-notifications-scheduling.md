# 06 · 通知与调度子系统 Handoff

> Telegram Bot（推送 + 交互命令）、企业微信 Webhook 推送，以及每日总结、定期洞察报告调度。
> 关键源文件：`src/telegram/`（`index.ts` `client.ts` `bot.ts` `bot-manager.ts` `command-parser.ts` `callback-encoder.ts` `formatters.ts`）、`src/api/telegram-chats.ts`、`src/wechat/`（`index.ts` `client.ts` `formatters.ts`）、`src/config/wechat-config.ts`、`src/constants/push-types.ts`、`src/daily-summary-scheduler.ts`、`src/insights-scheduler.ts`、`src/api/daily-summary.ts`、`src/api/article-clustering.ts`，路由 `telegram-chats.routes.ts` `wechat.routes.ts` `daily-summary.routes.ts` `scheduler.routes.ts`。

## 1. Telegram 推送器（`src/telegram/index.ts`）

- 单例 `TelegramNotifier`（`:70`），`getTelegramNotifier()`（`:599`）。
- `loadTelegramConfig(userId)`（`:38`）只读两个用户设置：`telegram_enabled`、`telegram_bot_token`。禁用/缺 token 返回 null。返回对象里的 `chatId`/`dailySummary*`/`newArticles` 字段**已废弃**（`:54-57`），**每个推送类型的启用改由 `telegram_chats` 表决定**（见 §3）。
- 去重缓存：`sentCache: Map`（`:71`），`CACHE_TTL=60000`ms，键 `${userId}:${type}:${date}`。
- **发送方法统一（2026-07-14）**：`sendDailySummary` / `sendJournalAllSummary` / `sendInsightsSummary` / `sendNewArticle` / `sendPdfSummary` 原先各自重复「加载配置 → 缓存检查 → 取 chats → 逐 chat 发送 → 错误隔离 → 日志」结构，现统一为私有方法 `sendToChats(userId, config, chats, message, opts)`（`telegram/index.ts`），各 `send*` 仅负责查 chats + 格式化消息 + 传 `logLabel`/`logContext`/`parseMode`/`keyboard`。逐 chat 错误隔离、`successCount>0` 即成功的语义不变。
  - `sendDailySummary(userId, data)` → `getDailySummaryChatsByType`
  - `sendJournalAllSummary` → `getJournalAllChats`（type=`'journal_all'`）
  - `sendInsightsSummary` → `getInsightsChats`（type=`'insights'`）
  - `sendNewArticle` → `getNewArticlesChats`，带内联键盘 `sendMessageWithKeyboard`；摘要优先级 `summary_zh>summary>markdown_content>content`，预览截 500 字
  - `sendPdfSummary` → `getPdfSummaryChats`
  - `testConnection`（`:330`）、`getMaskedConfig`（`:549`）、`isEnabled`（`:579`）
- **`serializeError` 统一（2026-07-14）**：原先 `telegram/client.ts` 与 `telegram/bot.ts` 各有一份完全相同的 `serializeError` 定义，现提取到 `src/telegram/utils.ts` 公共模块，两处 import 使用。

### 消息分片（4096）与 Bot API 调用（`client.ts`）

- `TELEGRAM_MAX_LENGTH=4096`（`:22`），`CHUNK_SEND_DELAY_MS=1000`。超限用 `splitMessage(text, 4096-20)`，分片加 `[i/n]` 标记，片间 1s 延迟。
- `TelegramClient`（`:60`）：`TELEGRAM_API_BASE='https://api.telegram.org'`，构造时按 `HTTP_PROXY` 建 undici `ProxyAgent`（**每请求** dispatcher）。
- `apiRequest(method, params)`（`:80`）：`fetch(${base}/bot${token}/${method}, POST JSON)`；`MAX_RETRIES=3`、`DEFAULT_TIMEOUT=30000`；5xx/429（含 `retry_after`）重试；**sendMessage 的超时中止不重试**（防重复发送）；`400 "message is not modified"` 吞掉。
- 方法：`sendMessage`/`sendMessageWithKeyboard`/`editMessageReplyMarkup`/`answerCallbackQuery`/`getUpdates`/`testConnection`/`abort`。

## 2. Bot 管理 / 轮询 / 命令

- `TelegramBotManager`（`bot-manager.ts:22`），`initTelegramBotManager()`（`:148`）启动，无启用用户返回 null。`getEnabledUserConfigs()`（`:95`）**仅处理 userId=1**（硬编码，多用户 TODO）。
- `TelegramBot`（`bot.ts`）**轮询非 webhook**：`start()`（`:237`）加载持久化状态（`STATE_DIR` 默认 `/tmp/lis-rss-daily/telegram`）后 `poll()`。动态轮询：空闲 10s、活跃 1s（近 5 分钟有活动）；`POLL_TIMEOUT=30s`、`POLL_LIMIT=100`；用 `client.getUpdates` 长轮询。`latestUpdateId` 持久化，offset=+1。`pendingCallbacks:Set` 防重复处理。
  - **文件拆分（2026-07-14）**：`bot.ts` 从 ~1048 行巨型文件拆分为 `bot.ts`（**门面**：轮询 `poll()` / `start()` / `stop()` / 状态持久化 / 授权判定）+ `bot-callbacks.ts`（回调查询处理：标已读、评分、显示评分键盘）+ `bot-commands.ts`（命令解析与处理，含 `/getarticles` 的三条取文路径）。三个子处理器共享 `bot.ts` 暴露的 `client` / `pendingCallbacks` / `latestUpdateId` / `STATE_DIR` 等状态。原 `handleGetArticlesByDate` / `handleGetArticlesBySource` / `handleGetArticlesBySearch` 中重复的「文章摘要提取 + 消息格式化 + 键盘创建 + 分批发送 + 延迟限流 + 错误处理」已提取为共享 `sendArticleBatch(articles, chatId, options)` 辅助方法（见 §10 差异）。
- 授权：`isAuthorizedChat`（chat 须在配置列表）、`isAdminChat`（role=admin）；viewer 只能看评分键盘不能操作。
- 命令：`handleMessage`（`:675`）只处理 `/` 前缀；**当前唯一命令 `/getarticles`**（`:697`）→ 按日期/来源/搜索取文章，逐条带键盘发送。`command-parser.ts` 的 `parseGetArticlesCommand`（`:30`）支持 `@all` 后缀、多种日期格式，否则当来源名。
- `callback-encoder.ts`：把内联键盘 `callback_data` 压成 `action:articleId[:value]`（≤64 字符）。`CallbackAction`：`MARK_READ='mr'`、`RATE='rt'`、`SHOW_RATING='sr'`、`CANCEL='cl'`。`encodeCallback`/`decodeCallback`。

## 3. `telegram_chats` 表（`src/api/telegram-chats.ts`）

- `TelegramChatConfig`（`:15`）列：`chatId`、`chatName`、`role('admin'|'viewer')`、及**每种推送的布尔开关** `dailySummaryJournal`/`dailySummaryBlogNews`/`journalAll`/`insights`/`newArticles`/`pdfSummary`、`isActive`。
- 按推送类型取 chats（均过滤 `is_active=1`）：`getDailySummaryJournalChats`（`:327`）、`getDailySummaryBlogNewsChats`（`:345`）、`getNewArticlesChats`（`:363`）、`getJournalAllChats`（`:381`）、`getInsightsChats`（`:399`）、`getPdfSummaryChats`（`:417`）；`getActiveTelegramChats`（`:98`）全部。
- CRUD：`addTelegramChat`（`:147`，开关默认全 1）、`updateTelegramChat`、`deleteTelegramChat`、`isChatAdmin`。
- 路由 `telegram-chats.routes.ts`：`GET`(auth)、`POST`/`PUT /:id`/`DELETE /:id`(admin)；校验 chatId 数字或 `@username`，UNIQUE 冲突 409。

## 4. 企业微信（`src/wechat/`）

**与 Telegram 的根本差异**：Webhook + YAML 配置文件驱动，**非 DB 表、非轮询/Bot**，无 chat/角色，全局共享一组 webhooks。

- `WeChatNotifier`（`index.ts:38`），`getWeChatNotifier()`（`:447`），同样 60s 去重缓存。方法从 `wechat-config.ts` 取 webhooks：`sendDailySummary`（`:65`，只允许 `journal|blog_news|all`）、`sendJournalAllSummary`、`sendInsightsSummary`、`sendNewArticle`、`sendPdfSummary`、`testWebhook`。
  - **发送方法统一（2026-07-14）**：五个 `send*` 方法原先重复「查 webhooks → 缓存检查 → 格式化 → 逐 webhook 发送」结构，现统一为 `sendByPushType(pushType, userId, formatter, data, opts)` + 底层 `sendToWebhooks(webhooks, message, opts)`（`wechat/index.ts`）。各 `send*` 仅声明 `pushType` 与 `formatter` 函数，行为与错误隔离语义不变。
- `WeChatClient`（`client.ts:29`）：单 webhook URL，**无代理**；`MAX_MESSAGE_LENGTH=4096` 字节、`MAX_RETRIES=2`；`apiRequest`（`:40`）POST `{msgtype, markdown/text}`，`errcode===0` 成功；`sendMarkdown` 分片加 `**[X/Y]**`，片间 300ms。
- `wechat-config.ts`：文件 `config/wechat.yaml`，懒加载单例。`WeChatWebhook`：`{id, name, url, enabled, push_types, ...}`；`WeChatPushTypes`：`daily_summary_journal`/`daily_summary_blog_news`/`journal_all`/`new_articles`/`insights`/`pdf_summary`（布尔）。选择器 `getWebhooksForPushType`（`:205`）、`getWebhooksForDailySummaryType`（`:210`，`all` = journal||blog_news）。CRUD + `reloadWeChatConfig` + `isValidWeChatWebhookUrl`（须 `qyapi.weixin.qq.com/cgi-bin/webhook/send`）。
- `constants/push-types.ts`：`PushType` 联合类型 + `PUSH_TYPES`/`PUSH_TYPE_LABELS`/`VALID_PUSH_TYPES`——**仅声明/标签用**，实际路由用上面的选择器函数。
- 路由 `wechat.routes.ts`：`GET/POST/PUT/DELETE /api/wechat/webhooks`、`POST /:id/test`（写 admin）。

### Telegram vs 企业微信

| 维度 | Telegram | 企业微信 |
|------|----------|----------|
| 通道 | Bot API 轮询 + 发送 | Webhook POST(markdown) |
| 配置存储 | `telegram_chats` 表（按用户/chat/推送类型） | `config/wechat.yaml`（全局 webhooks）|
| 角色 | admin/viewer | 无 |
| 交互 | 有（/getarticles、标已读、评分） | 无 |
| 代理 | 支持 `HTTP_PROXY` | 不需要 |
| 格式 | HTML | 微信 Markdown |

## 5. 每日总结调度器（`src/daily-summary-scheduler.ts`）

- `DailySummaryScheduler`（`:45`），`initDailySummaryScheduler()`（`:341`）。cron 默认 **`0 7 * * *`**（`DAILY_SUMMARY_SCHEDULE`），`timezone:'Asia/Shanghai'`。默认启用；types 默认 `journal,blog_news,journal_all`；userId 默认 1。
- `runScheduledPush`（`:174`）遍历 types：`journal_all` → `generateJournalAllSummary`；否则 `generateDailySummary({userId, type})`，`totalArticles>0` 时 `saveDailySummary` 入 `daily_summaries`。
- journal vs blog_news 归类由 `getDailyPassedArticles`（`api/daily-summary.ts:87`）决定：`journal`=期刊/关键词/rss 期刊类（≤50）；`blog_news`=rss blog/news 或 email（≤30）；`all`=40 期刊优先 + 补足 blog/news 至 60。
- ⚠️ **推送逻辑已移出生成函数（2026-07-14）**：原 `daily-summary.ts` 内 `generateDailySummary` / `generateJournalAllSummary` / `generateInsightsSummary` 在生成后直接 fire-and-forget 调用 `getTelegramNotifier().sendDailySummary` + `getWeChatNotifier().sendDailySummary`。现该文件已**拆分**为：
  - `src/api/daily-summary-generator.ts` — 纯 LLM 生成（`generateDailySummary` / `generateJournalAllSummary` / `generateSearchSummary` / `generateInsightsSummary`），**不再触发推送**；
  - `src/api/daily-summary-repository.ts` — DB 查询与持久化（`getDailyPassedArticles` / `saveDailySummary` / `getDailySummaryByDate` 等）；
  - `src/api/daily-summary.ts` — **门面层**（薄封装，转发到 generator/repository，保留原有 import 路径兼容）。
  - **推送改由调度器显式调用**：`daily-summary-scheduler.ts` 在生成后调用 `getTelegramNotifier().sendDailySummary` / `getWeChatNotifier().sendDailySummary`；`insights-scheduler.ts` 在生成后调用 `sendInsightsSummary`（见 §6）。`daily-summary.ts` 不再内嵌推送副作用，生成函数可纯函数式复用。
- `pushNow(types?)`（`:291`）手动触发；`getStatus()`（`:277`）；`stop()` 最多等 300s。

## 6. 洞察调度器（`src/insights-scheduler.ts`）

- `InsightsScheduler`（`:121`），`initInsightsScheduler()`（`:429`）读 `appConfig` 的 insights* 配置。
- **双重触发**：① 间隔闸门——`getScheduledReportIntervalCheck`（`:362`）比较上次成功本地日期与今天，`elapsedDays < intervalDays`（`insightsIntervalDays`）则跳过；首次运行放行。② 调度日——cron `insightsSchedule` 每日触发检查；`nextEligibleLocalDate` 由上次成功 + intervalDays 推算。
- 持久化：设置键 `insights_last_success_at`，**仅调度运行**写入；手动 `generateNow`（`:409`）不写。
- ⚠️ **推送逻辑已移出生成函数（2026-07-14）**：`generateInsightsSummary`（`api/daily-summary-generator.ts`）现只生成并 `saveDailySummary`，推送由 `insights-scheduler.ts` 在生成成功后显式调用 `getTelegramNotifier().sendInsightsSummary` + `getWeChatNotifier().sendInsightsSummary`（见 §5 差异）。
- 报告内容（`generateInsightsSummary`, `api/daily-summary-generator.ts`）：取最近 `days`（默认 **15**）天 `filter_status='passed'`、来源在期刊白名单、含正文（排除 `%<正>%`）的文章（≤60）→ **文章预聚类**（`src/api/article-clustering.ts`）：对 60 篇文章标题两两计算 Jaccard 相似度（阈值 0.18），Union-Find 连通分量形成话题簇，对每个簇计算评分（coverage、diversity，及窗口前后半密度比 → trendLabel）→ 构建含评分元数据的结构化文本（话题簇含文章列表 + 单篇文章）→ 用 `insights` 系统提示词生成「1500–3000 字中文洞察报告」，temp 0.3。生成后由调度器推送并存 `daily_summaries`（`type='insights'`，见 §5 差异）。
- `getStatus()`（`:389`）返回 `{isRunning, lastRunTime, nextRunTime, lastSuccessAt, nextEligibleLocalDate, schedulerTimezone, lastRunResult}`。

## 7. `daily_summaries` 表（`src/api/daily-summary.ts`）

- `saveDailySummary`（`:429`）：列 `user_id/summary_date/summary_type/article_count/summary_content/articles_data(JSON)`；`onConflict(['user_id','summary_date','summary_type']).doUpdateSet` —— **一 (用户,日期,类型) 一行**，upsert。
- `summary_type ∈ journal|blog_news|all|search|journal_all|insights`。
- 读：`getDailySummaryByDate`（`:463`）、`getDailySummaryHistory`（`:485`）、`getTodaySummary`（`:519`）。
- 生成并保存的函数：`generateDailySummary`、`generateJournalAllSummary`、`generateSearchSummary`、`generateInsightsSummary`——推送均在这些函数内部完成。

## 8. `GET /api/scheduler/status`（`scheduler.routes.ts`）

- ⚠️ 该端点返回的是 **RSS 调度器**状态（`:53` → `initRSSScheduler().getStatus()`），**不是**每日总结/洞察调度器。返回 `{isRunning, activeTasks, completedTasks, failedTasks, totalArticlesFetched, lastRunTime?, nextRunTime?}`（`rss-scheduler.ts:700`）。
- 每日总结/洞察调度器有各自 `getStatus()` 方法但**无专属 HTTP 路由**（仅在 `index.ts` 启停）。其他调度器状态：`GET /api/keywords/scheduler/status`、`GET /api/journals/scheduler/status`。

## 9. 推送类型 → 实际调用映射

| 推送类型 | Telegram（telegram_chats 列） | 企业微信 | 发送方法 |
|----------|------------------------------|---------|---------|
| `daily_summary_journal` | `getDailySummaryJournalChats` | `getWebhooksForDailySummaryType('journal')` | `sendDailySummary({type:'journal'})` |
| `daily_summary_blog_news` | `getDailySummaryBlogNewsChats` | `...('blog_news')` | `sendDailySummary({type:'blog_news'})` |
| （type `all`）| `getDailySummaryChatsByType('all')` | `...('all')`=journal\|\|blog | `sendDailySummary({type:'all'})` |
| `journal_all` | `getJournalAllChats` | `getWebhooksForPushType('journal_all')` | `sendJournalAllSummary` |
| `new_articles` | `getNewArticlesChats` | `...('new_articles')` | `sendNewArticle` |
| `insights` | `getInsightsChats` | `...('insights')` | `sendInsightsSummary` |
| `pdf_summary` | `getPdfSummaryChats` | `...('pdf_summary')` | `sendPdfSummary` |

## 10. 与旧报告（2026-05）的差异

1. Telegram 推送配置**改由 `telegram_chats` 表**（多 chat、多角色、多推送开关）驱动，`loadTelegramConfig` 的单 `chatId` 等字段已废弃仅作兼容。
2. 企业微信是 **YAML 全局配置**，无 DB 表、无按用户作用域。
3. `/api/scheduler/status` 是 **RSS 调度器**状态，非总结/洞察。
4. 洞察默认窗口 **15 天**（`days=15`），推送标签「10天周期」实际间隔由 `insightsIntervalDays` 配置驱动。
5. Telegram/微信消息上限均 **4096 字节**，共用 `splitMessage`（留 20 字节标记）。
6. ⚠️ **旧描述（2026-07-14 前）**：推送在 `daily-summary.ts`/insights 生成函数内触发。**现已变更**：生成函数不再内嵌推送，推送改由 `daily-summary-scheduler.ts` / `insights-scheduler.ts` 显式调用（见 §5、§6）。

## 11. 近期重构差异（2026-07-14，基于代码审查实施计划）

- **Telegram `send*` 去重**：`sendDailySummary`/`sendJournalAllSummary`/`sendInsightsSummary`/`sendNewArticle`/`sendPdfSummary` 统一委托给 `sendToChats(userId, config, chats, message, opts)`（见 §1）。
- **Telegram `serializeError` 统一**：提取到 `src/telegram/utils.ts`，`client.ts` 与 `bot.ts` 共用（见 §1）。
- **Telegram Bot 文件拆分**：`bot.ts`（门面）拆出 `bot-commands.ts`（命令处理 + `sendArticleBatch`）+ `bot-callbacks.ts`（回调查询），共享 `client`/`pendingCallbacks`/`latestUpdateId` 状态（见 §2）。
- **企业微信 `send*` 去重**：五个 `send*` 方法统一委托给 `sendByPushType` + `sendToWebhooks`（见 §4）。
- **`daily-summary.ts` 职责分离**：拆为 generator（纯生成）/ repository（DB）/ facade（薄封装）三文件，推送副作用移出（见 §5、§6）。
- **调度器接管推送**：`daily-summary-scheduler.ts`、`insights-scheduler.ts` 显式调用 `getTelegramNotifier()` / `getWeChatNotifier()` 推送（见 §5、§6）。
- **洞察报告预聚类（2026-07-14）**：`generateInsightsSummary` 新增前置文章聚类步骤（`src/api/article-clustering.ts`）。标题 Jaccard 相似度 0.18 → Union-Find 分组 → 话题评分（coverage/diversity/trendLabel）→ 结构化文本注入 `ARTICLES_LIST`。只影响洞察报告，不影响每日总结等其他类型。LLM prompt 模板、API 调用、推送格式均不变（见 §6）。
