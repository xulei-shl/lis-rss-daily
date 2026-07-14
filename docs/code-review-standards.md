# 代码规范审查报告 — Standards 轴

> 审查日期：2026-07-14
> 审查方式：全面静态分析（非 diff），对照项目编码标准（AGENTS.md）与 Fowler 12 种代码坏味
> 相关文档：`docs/handoffs/`（模块级交接文档）、`AGENTS.md`（编码原则）

## 审查结果概览

| 类别 | 数量 | 严重程度 |
|------|------|---------|
| DRY 违反（硬违规） | 7 | ⚠️⚠️⚠️ 高 |
| 单一职责违反（硬违规） | 5 | ⚠️⚠️⚠️ 高 |
| 可移植性（硬违规） | 2 | ⚠️⚠️ 中 |
| Duplicated Code（坏味） | 2 | ⚠️⚠️ 中 |
| Long Method（坏味） | 3 | ⚠️ 低 |
| Shotgun Surgery（坏味） | 1 | ⚠️⚠️ 中 |
| N+1 Query（坏味） | 1 | ⚠️ 低 |
| Magic Number（坏味） | 1 | ⚠️ 低 |
| **合计** | **22** | |

---

## 1. DRY 违反（硬违规）

### 1.1 `sleep()` 三处重复定义

| 位置 | 定义 |
|------|------|
| `src/rss-scheduler.ts:31` | `const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));` |
| `src/keyword-scheduler.ts:320` | 同上 |
| `src/pipeline.ts:642` | 同上（另有 `const sleep = util.promisify(setTimeout);` 在 `:647`） |

**建议**：提取到 `src/utils/sleep.ts` 统一导出，各模块 import 使用。

### 1.2 `getPendingArticleIds` 与 `getFailedArticleIds` 结构完全一致

`src/pipeline.ts:655-694` vs `src/pipeline.ts:703-742`

两个函数执行相同的 3 次 JOIN 查询 + 合并 + 排序 + 切片，仅 `process_status` 过滤值和排序字段不同。

**建议**：参数化为 `getArticleIdsByStatus(status: ProcessStatus, ...)`。

### 1.3 `EmailSourceConfig` 映射重复

`src/gmail-scheduler.ts:87-98` vs `:132-143`

同样的 `{ id, emailAddress, ... }` 映射代码完整出现两次。

**建议**：提取 `rowToEmailSourceConfig(row): EmailSourceConfig`。

### 1.4 Telegram `send*` 方法 90% 代码重复

`src/telegram/index.ts:118-322`

`sendDailySummary`、`sendJournalAllSummary`、`sendInsightsSummary` 三个方法共享相同的结构：
1. 加载配置 → 2. 缓存检查 → 3. 客户端创建 → 4. chat 遍历 → 5. 分批发送 → 6. 错误隔离 → 7. 日志

**建议**：抽取为单个 `sendToChats(getChatsFn, formatterFn)` 方法。

### 1.5 Telegram bot 文章命令处理三重重复

`src/telegram/bot.ts:737-1036`

`handleGetArticlesByDate`、`handleGetArticlesBySource`、`handleGetArticlesBySearch` 在文章摘要提取、消息格式化、键盘创建、分批发送、延迟限流、错误处理、日志方面完全相同的代码块。

**建议**：提取为共享的 `sendArticleBatch(articles, chatId, options)` 辅助方法。

### 1.6 企业微信 `send*` 方法 85% 结构重复

`src/wechat/index.ts:65-382`

`sendDailySummary`、`sendJournalAllSummary`、`sendInsightsSummary`、`sendNewArticle`、`sendPdfSummary` 五个方法共享相同的 webhook 迭代/错误处理结构。

**建议**：与 Telegram 相同，抽取为通用方法。

### 1.7 `serializeError` 两份完全相同的定义

`src/telegram/client.ts:33-55` 与 `src/telegram/bot.ts:40-62`

**建议**：提取到公共工具函数。

---

## 2. 单一职责违反（硬违规）

### 2.1 `triggerAutoFilter` — 84 行混含 5 种职责

`src/rss-scheduler.ts:594`

- 错峰延迟计算
- DB 查询（JOIN 源表取 domain_id）
- itemMap 构建
- 逐篇构造 FilterInput + 调用过滤
- 触发 processArticle + 日志

**建议**：拆分为延迟等待和过滤处理两个方法。

### 2.2 `runPipeline` — 205 行 4 阶段混在一个函数

`src/pipeline.ts:379`

4 个阶段（markdown/translate/vector/related）各有独立的错误处理、日志、状态更新，全部写在一个函数体里。

**建议**：每个阶段拆为私有方法 `runStageMarkdown`、`runStageTranslate` 等，`runPipeline` 仅编排调用。

### 2.3 `filterArticle` — 124 行混含 4 种职责

`src/filter.ts:372`

- Stage 0 黑名单检查
- Stage 1 LLM 过滤
- 结果合并与通过判断
- 更新文章状态 + 记录日志

**建议**：拆为 `runBlacklistCheck`、`runLLMFilter`、`recordFilterResults`。

### 2.4 `api/daily-summary.ts` — 1091 行的巨型文件

`src/api/daily-summary.ts:87-947`

文件混杂了四种职责：
- 数据查询（`getDailyPassedArticles` 等）
- LLM 生成（`generateDailySummary`、`generateInsightsSummary` 等）
- 通知推送（在生成函数内嵌 `getTelegramNotifier().sendDailySummary`）
- 数据库持久化（`saveDailySummary`）

推送作为副作用嵌入在生成函数中，导致生成函数不能纯函数式使用。

**建议**：分离为 `daily-summary-generator.ts`（LLM 生成）、`daily-summary-repository.ts`（DB 操作）、推送逻辑移至调度器层。

### 2.5 `telegram/bot.ts` — 1048 行的巨型文件

`src/telegram/bot.ts:64-1037`

`TelegramBot` 类混含职责：
- 长轮询（poll/start/stop）
- 回调处理（callback_query）
- 命令处理（handleMessage + 三个 sub-handler）
- 状态持久化
- HTML 转义
- 来源匹配

**建议**：按职责拆分——轮询、命令处理器、回调处理器各为独立模块。

---

## 3. 可移植性（硬违规）

### 3.1 Google Scholar 爬虫硬编码路径

`src/spiders/google-scholar-spider.ts:59`

```
cwd: '/opt/lis-rss-daily/src/spiders/google_scholar'
```

仅在部署路径固定时可用，无法在其他环境运行。

**建议**：使用 `path.join(__dirname, ...)` 或配置项。

### 3.2 Python 爬虫运行器硬编码路径

`src/spiders/python-spider-runner.ts:55-56`

包含 `/home/xulei/...` 的绝对路径。

**建议**：全部改为相对路径/配置驱动。

---

## 4. Duplicated Code（坏味）

### 4.1 四个调度器类骨架重复

`src/rss-scheduler.ts`、`src/journal-scheduler.ts`、`src/keyword-scheduler.ts`、`src/gmail-scheduler.ts`

四个调度器共享约 80% 相同的骨架模式：
- 单例模式（类 + initXxxScheduler 工厂函数）
- `start()` / `stop()` 生命周期
- `updateConfig()` 配置更新
- cron 验证 + 调度

**建议**：提取 `BaseScheduler` 基类，各调度器继承并重写 `run()` 方法即可。

### 4.2 两个调度器 `stop()` 方法重复

`src/daily-summary-scheduler.ts:125-150` 与 `src/insights-scheduler.ts:203-228`

几乎相同的等待执行完成的逻辑。

**建议**：基类化后统一到 `BaseScheduler.stop()`。

---

## 5. Long Method（坏味）

| 文件 | 函数名 | 行数 | 说明 |
|------|--------|------|------|
| `src/journal-scheduler.ts:274` | `crawlJournal` | ~140 | 单线程爬取 + DB 保存 + 状态更新 + 日志 |
| `src/spiders/python-spider-runner.ts:89` | `runSpider` | ~98 | 子进程管理 + 输出解析 + 错误处理 |
| `src/filter.ts:103` | `llmFilter` | ~150 | 提示词构建 + LLM 调用 + 响应解析 + 回退逻辑 |

---

## 6. Shotgun Surgery（坏味）

### 6.1 四来源表 JOIN 模式散布四处

`src/vector/search-service.ts`
- `keywordSearchOnly`（`:241`）— JOIN 三源表 + OR user_id
- `computeRelated`（`:465`）— 同上模式
- `getRelatedFromCache`（`:589`）— 同上
- `enrichWithMetadata`（`:671`）— 同上

若新增来源类型（如 `email`），需修改全部 4 个函数。

**建议**：提取 `getArticlesForUser(userId)` 作为标准化的 SQL 构建器，或在 DB 层建立 `v_user_articles` 视图。

---

## 7. N+1 Query（坏味）

### 7.1 RSS 调度循环逐源查询

`src/rss-scheduler.ts:350-374`

在循环中逐源查询 `last_fetched_at`，N 个源导致 N+1 次查询。

**建议**：使用 `SELECT ... WHERE id IN (...) GROUP BY` 一次获取所有源的状态。

---

## 8. Magic Number（坏味）

### 8.1 语言检测阈值未命名

`src/agent.ts:93-95`

```ts
if (alphaCount >= 10 && alphaRatio > 0.6) return 'en';
```

`10` 和 `0.6` 的含义不直观，且与 `filter.ts` 的 `minRelevanceScore=0.6` 值相同但语义完全不同。

**建议**：定义为常量 `MIN_ALPHA_COUNT = 10`、`MIN_ALPHA_RATIO = 0.6`。

---

## 附录：已知遗留问题（来自 handoff 文档，可供重构参考）

除上述规范审查发现外，以下 handoff 文档已记录的已知问题也应纳入优化范围：

| 问题 | 来源 | 影响 |
|------|------|------|
| `settings.rss_fetch_schedule` 未被调度器消费 | handoff-01 | 配置无效 |
| 关键词 `spider_type='cnki'` 未实现 | handoff-01 | 功能缺失 |
| `scraper.ts` + `export.ts` 存在但未接线 | handoff-03 | 死代码 |
| `agent.ts:80` `titleZh` 引用接口未声明字段 | handoff-03 | 潜在小 bug |
| Chroma host/port 不在 `config.ts` | handoff-04 | 配置分散 |
| `build-css.js` 输出名与 `layout.ejs` 引用名不对应 | handoff-07 | 开发态 CSS 可能不生效 |