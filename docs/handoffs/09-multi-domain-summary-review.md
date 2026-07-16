# 09 · 多领域总结系统设计方案 — 代码评审

> 本文件是对 [`09-multi-domain-summary.md`](./09-multi-domain-summary.md) 设计方案的可行性评审。
> 评审方式：逐文件阅读实际源代码后核对方案，所有结论均带 `文件:行号` 或 `文件:符号` 引用。
> 评审时间：2026-07-15（主分支）。行号可能随代码变动偏移，请以符号名为准。

---

## 总体判断

方案的**数据模型方向是合理的**（领域分组 → 独立生成 → 独立推送 → 独立展示），零配置迁移、"无记录 = 默认推送"、回退方案的思路都不错。

但**存在若干会直接导致功能失效的错误和明显遗漏**，其中 4 个为**阻断级**问题（不修会直接坏）。下面按严重程度列出。

| 级别 | 数量 | 说明 |
|------|------|------|
| 🔴 阻断级 | 4 | 不修复会导致功能完全不工作或静默丢数据 |
| 🟠 中等 | 4 | 逻辑漏洞 / 隐性丢数据 / 成本放大 |
| 🟡 次要 | 8 | 文档不准确 / 兼容性范围未覆盖 / 补充遗漏 |

---

## 一、阻断级问题

### 🔴 1. 遗漏 `scripts/migrate.ts` 的迁移注册（致命）

迁移执行器 `scripts/migrate.ts:56-63` 遍历 `^\d+_.*\.sql$` 文件，但**每个迁移文件都必须在循环体内有一个对应的 `if (file === 'XXX_....sql') { ... continue; }` 硬编码处理块**（参见 037/038/039/040 的写法 `migrate.ts:835-893`）。

没有匹配处理块的文件会落到最后的默认分支：

```
// migrate.ts:895-896
// 其他迁移脚本已包含在 001_init.sql 中
console.log('      → Skipped (included in 001_init.sql)');
```

即 **SQL 根本不会被执行**。

设计文档 §10 文件清单只列了 `sql/XXX_add_summary_group.sql` 和 `src/migration/migrate-push-settings.ts`，**没有列出必须修改 `scripts/migrate.ts`**。照此实现，新表 / 新列永远不会建出来。

**修复**：`scripts/migrate.ts` 增加 `if (file === '041_add_summary_group.sql') { ... }` 处理块（含 `hasTable`/`hasColumn` 幂等守卫 + `continue`）。

---

### 🔴 2. Telegram / WeChat 通知去重缓存键冲突（会丢推送）

两个 notifier 都有 60 秒去重缓存，键为 `${userId}:${type}:${date}`：

- Telegram：`telegram/index.ts:74-92`（`getCacheKey` + `checkAndSetCache`），`sendDailySummary` 一进来就 check（`:118-123`）
- WeChat：`wechat/index.ts:43-61`，同样的键（`:66-71`）

设计 §4.3 的调度器要在**同一次运行里对同一 type/date 循环多个 group**。第一个分组推送后写入缓存，**后续所有分组都会命中 "Skipping duplicate" 被静默丢弃**。

设计 §5.2 虽然改成"逐 chat 判断"，但只要仍走 `getTelegramNotifier().sendDailySummary(...)` / `sendInsightsSummary`（如 §4.3 的 `pushToChannels`），就会中招。方案完全没提缓存键需要加 `groupId`。

**修复**：`getCacheKey` 加入 `groupId` 维度。

---

### 🔴 3. 企业微信 webhook 不在数据库、且无 user_id（模型不匹配）

WeChat webhook **存在 YAML 文件 `config/wechat.yaml`**（`config/wechat-config.ts:59-65`），不是数据库表；而且是**全局的、没有 user_id**（`getWebhooksForPushType(pushType)` 不带 userId，`wechat/index.ts:110`）。推送决策目前完全来自 YAML 里的 `push_types`（`wechat-config.ts:205-225`）。

设计的问题：

- `domain_push_filters.channel_target_id` 注释写 "企业微信: `wechat_webhooks.id`"，**根本没有 `wechat_webhooks` 表**，只有 YAML 里的字符串 id（如 `webhook-xxx`）。
- `domain_push_filters` 带 `user_id`，但 webhook 是全局的，多用户下语义冲突（单用户 `userId=1` 才勉强成立）。
- §3.2 迁移伪代码"企业微信同理"、§10 文件清单**只列了 `wechat/index.ts` 和 `formatters.ts`，没有列 `wechat-config.ts` / `wechat.yaml`**。而实际推送分流逻辑（`getWebhooksForPushType` / `getWebhooksForDailySummaryType`）全在 config 层，必须改造。

**修复**：明确企业微信侧方案——webhook 仍在 YAML，需改造 `wechat-config.ts` 让推送分流读 `domain_push_filters`（按 webhook.id 字符串匹配 `channel_target_id`），并处理其"全局无 user_id"与 filter 的 user_id 不一致问题。

---

### 🔴 4. `daily_summaries` 唯一约束 + upsert 语义（会写坏数据）

- 当前唯一性是**索引** `idx_daily_summaries_user_date_type`（`sql/010:34`），不是表级约束。设计 §2.4 说 "UNIQUE 约束变更"，实现上必须 **DROP INDEX 再 CREATE 新唯一索引**（含 group_id），不能只 `ALTER ADD COLUMN`。
- `saveDailySummary` 的 upsert 是 `onConflict(['user_id','summary_date','summary_type'])`（`daily-summary-repository.ts:249-255`）。**必须同步把 group_id 加进 onConflict 列**，否则同一 (user,date,type) 不同分组会互相覆盖。设计文字里没提这处改动。
- **SQLite 唯一索引把 NULL 视为互不相等**：`search` / `insights` / 历史遗留行的 group_id 为 NULL 时，upsert 不会命中 → 每次重复插入。同样的 NULL 问题也存在于 `domain_push_filters` 的 `UNIQUE(...,group_id,...)`（`new_articles` / `pdf_summary` 的 group_id=NULL）。

**修复**：DROP/CREATE 唯一索引；`saveDailySummary` onConflict 加 group_id；用哨兵值（如 `0`）代替 NULL 以获得正确的 upsert / 唯一语义。

---

## 二、中等问题

### 🟠 5. NULL `summary_group_id` 孤儿领域 → 文章静默丢失

- 调度器按 `getActiveSummaryGroups(userId)` 迭代分组。若某领域 `summary_group_id` 为 NULL，它**不属于任何分组**，其通过文章在所有分组总结里都取不到 → 静默消失。
- 启动迁移（§3.1）只处理了**已存在**的领域。但新建领域走 `createTopicDomain`（`topic-domains.ts:80-106`）**不会设置 summary_group_id**，之后创建的领域就是孤儿。方案没有把"领域创建 → 自动建/挂分组"接线，也没有兜底的"未分组"catch-all。
- 另外 `sql/037` 的 `domain_id` **是可空列**（`037:9` 只有 `REFERENCES`，无 `NOT NULL`），domain_id 为 NULL 的源其文章也会因 JOIN 不到分组而丢失。

**修复**：`createTopicDomain` 自动建/挂分组，或引入兜底"未分组"catch-all；处理 domain_id / summary_group_id 可空的情况。

---

### 🟠 6. Insights 与期刊白名单叠加会产生大量空分组

`getInsightsArticles`（`daily-summary-repository.ts:412-499`）**额外用全局期刊白名单**（`utils/journals-whitelist`）过滤 `rss_sources.name` / `journals.name`，且**不含 email 源**（未 JOIN `email_sources`）。keyword 源虽已 JOIN（`:437`）并包含在 WHERE 条件中（`:442-443`），但白名单过滤只查 `rss_sources.name` 和 `journals.name`（`:446-449`），keyword 来源的文章除非恰好有同名 RSS/期刊在白名单中，否则仍被滤除。再叠加按分组过滤后，**不含白名单期刊的分组几乎恒为空**。设计 §4.3 "insights 同理" 没考虑白名单与分组的交互，会产生很多空洞察分组。

**修复**：明确 insights 分组与白名单的交互定义，跳过空分组。

---

### 🟠 7. LLM 成本与调度时长放大

生成从 `types` 变成 `groups × types`（+ 每组一次 insights，1500-3000 字）。N 个分组即 N 倍 LLM 调用与耗时；`waitForCompletion` 只等 5 分钟（`daily-summary-scheduler.ts:127`），分组多时可能被强制关闭或跨到下一次 run 被 `isExecuting` 跳过。方案未讨论并发 / 上限 / 空组跳过策略。

（好在生成函数在 `articles.length===0` 时会在调 LLM 前提前返回——`daily-summary-generator.ts:130-139`——空组不会浪费 LLM 调用。）

---

### 🟠 8. 逐类型的数量上限现在变成"逐分组上限"

`getDailyPassedArticles` 的 50/30/60 限额（`daily-summary-repository.ts:101-104`）加上 groupId 过滤后，会变成**每个分组各自 50 篇**。语义变化本身可接受，但设计未说明，需明确。

---

## 三、次要 / 文档不准确

### 🟡 9. README 与实际代码不符

`docs/handoffs/README.md` §57 声称四源表 `domain_id NOT NULL`，但 `sql/037` 实际是可空列 + 回填。方案又依赖"领域绑定必然非空"，需以实际为准并加兜底。

### 🟡 10. `domain_push_filters.summary_type` 取值口径混用

CHECK 里用的是 `daily_summary_journal` 等（Telegram 列名，见 `telegram-chats.ts:21-26`），而 `daily_summaries.summary_type` 用的是 `journal` / `blog_news`（`daily-summary-repository.ts:22`）。两套命名之间需要一层映射，设计未明说。

### 🟡 11. ER 图措辞

§2.5 "topic_domains (domain_id)" 应是 FK `summary_group_id`，连接键是 `topic_domains.id`。

### 🟡 12. API 破坏性变更范围未完全覆盖

`/today` 从单对象改数组会影响 `public/js/daily-summary.js`（`summaryCache` 是按 type 的对象，见 `daily-summary.js:29,143,158`），设计已覆盖；但以下未纳入讨论，需确认保持向后兼容：

- CLI 端点 `POST /daily-summary/cli`（`daily-summary.routes.ts:242`）
- `GET /:date`（`:124`）、`GET /:date/articles`（`:172`）
- `generateSearchSummary`（无分组、type=search，`daily-summary-generator.ts:250`）

---

## 四、建议补充到方案里的改动清单

| # | 改动 | 级别 |
|---|------|------|
| 1 | `scripts/migrate.ts` 增加 `if (file === '041_add_summary_group.sql')` 处理块（幂等守卫 + `continue`） | 🔴 阻断 |
| 2 | `daily_summaries`：DROP 旧唯一索引 + 建含 group_id 的新唯一索引；`saveDailySummary` onConflict 加 group_id；`saveDailySummary` insert VALUES 加 group_id；用哨兵值处理 NULL group_id 的 upsert 语义 | 🔴 阻断 |
| 3 | Telegram / WeChat notifier 的 `getCacheKey` 加入 groupId，避免多分组去重误杀 | 🔴 阻断 |
| 4 | 明确企业微信侧方案：改 `wechat-config.ts` 让推送分流读 `domain_push_filters`（按 webhook.id 字符串），处理"全局无 user_id"与 filter user_id 不一致 | 🔴 阻断 |
| 5 | `createTopicDomain` 自动建/挂分组，或引入兜底"未分组"catch-all；处理 domain_id / summary_group_id 可空 | 🟠 中等 |
| 6 | Insights 分组与期刊白名单交互定义清楚，跳过空分组；`getInsightsArticles` 补充 `email_sources` JOIN | 🟠 中等 |
| 7 | `domain_push_filters` 的 NULL group_id 唯一性同样用哨兵值处理 | 🟠 中等 |
| 8 | 明确"逐类型上限"变为"逐分组上限"的语义 | 🟡 次要 |
| 9 | Insights 调度器推送改为逐 chat/webhook 迭代（与 daily-summary 一致） | 🟡 次要 |
| 10 | 设计方案补充 `getActiveSummaryGroups` 接口定义 | 🟡 次要 |
| 11 | 明确 `getAllJournalArticles` 叠加分组过滤时是否包含被拒文章 | 🟡 次要 |

---

## 五、评审遗漏的补充事项

以下问题在第一轮评审中未被覆盖，经代码验证补录于此：

### 🟡 13. Insights 调度器推送架构与 daily-summary 不同

Insights 调度器当前推送直接调用 `getTelegramNotifier().sendInsightsSummary()` 和 `getWeChatNotifier().sendInsightsSummary()`（`insights-scheduler.ts:265-279`），**不走逐 chat / 逐 webhook 迭代**。设计 §4.3 说 "insights 同理"，但实际 insights 推送到 chat 选择是在 `telegram/index.ts` / `wechat/index.ts` 内部完成的（通过 `getDailySummaryChatsByType` / `getWebhooksForPushType`），需与 daily-summary 推送一起改造为逐 chat 查 `domain_push_filters`。

### 🟡 14. `saveDailySummary` 的 insert VALUES（不仅是 onConflict）需新增 `group_id`

`saveDailySummary` 当前插入语句（`daily-summary-repository.ts:240-248`）不含 `group_id` 列。除 §四#2 提到的 onConflict 改动外，insert VALUES 本身也需增加 `group_id`；且所有调用方（调度器 `daily-summary-scheduler.ts:196-203`、facade `daily-summary.ts:124-132`、路由 `daily-summary.routes.ts:52-59`）都需传入 `groupId`。

### 🟡 15. 设计方案中 `getActiveSummaryGroups` 函数未定义

设计 §4.3 伪代码使用了 `getActiveSummaryGroups(userId)`，但该函数在文件变更清单 §10 中未曾列出（推测归入 `domain-summary-groups.ts`，但清单只列出了 CRUD，缺查询接口定义）。

### 🟡 16. `getAllJournalArticles` 也需分组过滤时明确语义

`getAllJournalArticles`（`daily-summary-repository.ts:330-407`）用于 `journal_all` 类型，**不限 `filter_status`**（含未通过文章）。叠加 `groupId` 过滤后，"某分组所有期刊文章"可能包含该领域被拒的文章，语义需设计明确：分组过滤是只取通过文章还是全部文章？

---

## 六、评审涉及的关键源文件

| 文件 | 评审用途 |
|------|---------|
| `scripts/migrate.ts` | 迁移注册机制（问题 1） |
| `src/telegram/index.ts` | 通知去重缓存 + 推送分流（问题 2） |
| `src/wechat/index.ts` / `src/config/wechat-config.ts` | 企业微信 YAML 模型（问题 3） |
| `src/api/daily-summary-repository.ts` | 文章拉取 / upsert / 唯一约束（问题 4、6、8） |
| `src/api/daily-summary-generator.ts` | LLM 生成流程（问题 7） |
| `src/daily-summary-scheduler.ts` / `src/insights-scheduler.ts` | 调度迭代逻辑（问题 2、7） |
| `src/api/topic-domains.ts` | 领域 CRUD（问题 5） |
| `sql/037_add_domain_id_to_sources.sql` / `sql/010_fix_daily_summary_unique.sql` | 实际表结构（问题 4、5、9） |
| `src/api/routes/daily-summary.routes.ts` | API 兼容范围（问题 12） |
| `src/api/telegram-chats.ts` | 推送类型列命名（问题 10） |
