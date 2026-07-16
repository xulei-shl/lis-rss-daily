# 09 · 多领域总结系统设计方案

> 本文档记录多领域（Domain）每日总结/洞察报告的分组生成、推送控制与前端展示的完整设计方案。
> 适用版本：基于主分支 2026-07-15 快照，引用行号可能有偏移，以符号名为准。

---

## 1. 问题背景

当前系统已支持通过 `topic_domains` 和 `domain_id` 将信息源绑定到不同主题领域（如"图书馆学"、"AI"），LLM 过滤环节也已按单领域评估。但**每日总结/洞察报告**仍将所有领域的文章混合成一份，导致内容割裂。

**具体表现**：
- 用户有多个不相关领域（如"图书馆学"、"阅读文化与图书馆"），LLM 生成的每日总结跨领域合并，逻辑不连贯
- 推送控制只有 `账号 × 推送类型` 两个维度，缺少 `领域分组` 维度
- 首页和历史页只展示单一总结，无法按领域分组查看

**目标**：引入领域分组概念，实现每个分组独立生成总结、独立控制推送、独立展示，同时兼容现有用户零配置过渡。

---

## 2. 数据模型

### 2.1 `domain_summary_groups`（新建）

```sql
CREATE TABLE domain_summary_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  show_on_homepage INTEGER NOT NULL DEFAULT 1,  -- 首页/历史页是否展示
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name)
);
```

### 2.2 `topic_domains`（新增字段）

```sql
ALTER TABLE topic_domains ADD COLUMN summary_group_id INTEGER REFERENCES domain_summary_groups(id) ON DELETE SET NULL;
```

- `summary_group_id IS NULL`：该领域尚未绑定分组，其文章通过文章拉取 SQL 的兜底逻辑落入"未分组"（`group_id = 0`）。迁移脚本上线后会自动为每个活跃领域创建独立分组（见 §3.1）
- `summary_group_id = X`：该领域与同组其他领域合并生成总结

### 2.3 `domain_push_filters`（新建）

```sql
CREATE TABLE domain_push_filters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK(channel IN ('telegram', 'wechat')),
  channel_target_id TEXT NOT NULL,   -- Telegram: telegram_chats.chat_id / 企业微信: YAML webhook 的 id 字段（如 "webhook-xxx"）
  group_id INTEGER NOT NULL DEFAULT 0,  -- 0 = 不依赖分组的推送类型（new_articles, pdf_summary）；>0 = 关联 domain_summary_groups.id
  summary_type TEXT NOT NULL CHECK(summary_type IN (
    'daily_summary_journal', 'daily_summary_blog_news', 'journal_all',
    'insights', 'new_articles', 'pdf_summary'
  )),
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(user_id, channel, channel_target_id, group_id, summary_type)
);
```

说明：
- `group_id = 0` 为哨兵值，用于 `new_articles` 和 `pdf_summary` 这种不依赖分组的推送类型，确保 SQLite 唯一索引正确工作（NULL 在唯一索引中互不相等，无法约束重复行）
- `group_id = 0` 不关联 `domain_summary_groups` 表（无外键约束），应用层负责完整性

### 2.4 `daily_summaries`（新增字段 + 索引变更）

```sql
ALTER TABLE daily_summaries ADD COLUMN group_id INTEGER NOT NULL DEFAULT 0;
```

唯一性变更为 `UNIQUE(user_id, summary_date, summary_type, group_id)`（由唯一索引实现）。注意：

- 当前唯一性由**索引** `idx_daily_summaries_user_date_type` 实现（见 `sql/010:34`），非表级约束。迁移时需 **DROP 旧索引 → CREATE 新唯一索引**（含 `group_id`）
- `group_id = 0` 为哨兵值，不关联 `domain_summary_groups` 表（无外键约束）。`search`、`insights`、`journal_all` 类型的历史行兼容为 `group_id = 0`；已有 `(user_id, date, type)` 唯一性不受影响——因为 `group_id = 0` 在所有行中相同，旧唯一约束的语义等价于 `(user_id, date, type, 0)`
- `saveDailySummary` 的 upsert（当前 `onConflict(['user_id','summary_date','summary_type'])` 见 `daily-summary-repository.ts:249-255`）需同步将 `group_id` 加入冲突列，否则同 `(user,date,type)` 的不同分组会互相覆盖；insert VALUES 语句也需新增 `group_id` 字段

### 2.5 ER 关系

```
topic_domains (summary_group_id FK) ──N:1──→ domain_summary_groups (id)
daily_summaries (group_id FK) ──N:1──→ domain_summary_groups (id)
domain_push_filters (group_id FK) ──N:1──→ domain_summary_groups (id)
```

---

## 3. 默认行为与迁移

### 3.1 零配置兼容

**历史数据兼容**：现有 `daily_summaries` 行无 `group_id` 字段，迁移 SQL 用 `ALTER TABLE ADD COLUMN ... DEFAULT 0` 自动赋值 `0`，零成本兼容。

**领域自动分组**：新系统上线后，现有用户的每个活跃领域自动按领域名建立独立分组：

```typescript
// 伪代码：启动迁移逻辑
const SENTINEL = 0; // 未分组哨兵值
for each domain where summary_group_id IS NULL:
  group = findOrCreateGroup(domain.user_id, domain.name)
  domain.summary_group_id = group.id
  group.show_on_homepage = true
```

**迁移注册**：SQL 迁移文件 `sql/041_add_summary_group.sql` 必须在 `scripts/migrate.ts` 中注册。该文件当前每个迁移需要在循环体内有硬编码处理块（参见 037/038/039/040 的写法 `migrate.ts:835-893`），格式为：
```typescript
if (file === '041_add_summary_group.sql') {
  const hasTable = hasTable(db, 'domain_summary_groups');
  if (!hasTable) { db.exec(fs.readFileSync(fullPath, 'utf-8')); }
  else { console.log('...Skipped'); }
  continue;
}
```
不注册则 SQL 不会被执行。

**领域创建时自动挂分组**：`createTopicDomain`（`src/api/topic-domains.ts:80-106`）当前不会设置 `summary_group_id`，新增领域将成为"孤儿"——其通过文章在所有分组总结里都取不到。需在 `createTopicDomain` 中自动执行 `findOrCreateGroup` 并赋值 `summary_group_id`。

**兜底 catch-all（虚拟分组）**：引入一个虚拟的分组对象 `{ id: GROUP_ID_NULL_SENTINEL, name: '__catch_all__', show_on_homepage: 0 }`，**存在于应用层代码中而非 DB 表**。其作用：
- `getActiveSummaryGroups()` 返回所有真实分组 + 此虚拟分组
- 调度器迭代时，虚拟分组从 `summary_group_id IS NULL` 的领域和 `domain_id IS NULL` 的源中拉取文章
- `group_id = 0` 的总结在首页/历史页默认不展示（`show_on_homepage=0`）

注意 `domain_id` 是可空列（`sql/037` 的 ALTER 无 `NOT NULL`），`domain_id IS NULL` 的源其文章也会因 JOIN 不到分组而丢失。文章拉取 SQL 需包含兜底：当目标 `groupId = 0` 时，增加 `OR topic_domains.id IS NULL` 条件。

### 3.2 旧推送配置迁移

已有 `telegram_chats.push_types` 和 `wechat.webhooks[].push_types` 迁移到 `domain_push_filters`：

```typescript
// 伪代码：迁移逻辑
const SENTINEL = 0;

for each telegram_chat with daily_summary_journal = 1:
  for each active group of this chat's user:
    INSERT domain_push_filters(user_id, 'telegram', chat.chat_id, group.id, 'daily_summary_journal', 1)

for each telegram_chat with new_articles = 1:
  INSERT domain_push_filters(user_id, 'telegram', chat.chat_id, SENTINEL, 'new_articles', 1)

// 企业微信同理
```

迁移完成后，旧字段不再读取，可择期清理（`telegram_chats.daily_summary_journal` 等列、`wechat.webhooks[].push_types`）。

### 3.3 `domain_push_filters` 默认语义

无记录 = 默认推送（与迁移前的行为一致），用户配置后显式控制。但当前 Telegram 聊天是**显式添加**的（有记录才存在），"无记录 = 默认推送"对未添加聊天不适用。迁移脚本需确保每个已有聊天至少被插入一条对应记录。

**哨兵值 `0`**：`UNIQUE(user_id, channel, channel_target_id, group_id, summary_type)` 中 `new_articles` / `pdf_summary` 的 `group_id = 0`（而非 NULL）。这是因为 SQLite 唯一索引将 NULL 视为互不相等，会导致同 `(user_id, channel, target, summary_type)` 的重复行通过检查。`group_id INTEGER NOT NULL DEFAULT 0` 确保唯一索引对所有行生效。建议在代码中定义常量 `const GROUP_ID_NULL_SENTINEL = 0`。`daily_summaries.group_id` 同理。

**命名映射**：`domain_push_filters.summary_type` 的 CHECK 约束使用了 `daily_summary_journal`、`daily_summary_blog_news` 等命名（源自 `telegram-chats.ts:21-26` 的列名），而 `daily_summaries.summary_type` 用的是 `journal`、`blog_news`（`daily-summary-repository.ts:22`）。推送判断逻辑中需建立两者之间的映射关系，例如 `{ journal: 'daily_summary_journal', blog_news: 'daily_summary_blog_news', journal_all: 'journal_all', insights: 'insights' }`。

---

## 4. 总结生成流程

### 4.1 文章拉取（Repository）

`src/api/daily-summary-repository.ts` 变更：

| 方法 | 变更 |
|------|------|
| `getDailyPassedArticles(userId, date, type, groupId?)` | 新增可选 `groupId` 参数。有值时 JOIN `topic_domains` 和 `domain_summary_groups` 按 `group_id` 过滤；无值时返回所有分组 |
| `getAllJournalArticles(userId, date, groupId?)` | 同上。注意 `journal_all` 不限 filter_status，所有期刊文章都进；分组过滤语义是"只取该分组所属领域的期刊文章" |
| `getInsightsArticles(userId, days, groupId?)` | 同上。但该函数目前**未 JOIN `email_sources`**（`daily-summary-repository.ts:435` 只 JOIN 了 `rss_sources`、`journals`、`keyword_subscriptions`），叠加分组过滤后 email 领域的洞察数据会丢失。建议补充 `email_sources` 的 JOIN 或文档明确这是已知限制 |
| `saveDailySummary(...)` | 入参新增 `groupId?: number`；insert VALUES 增加 `group_id` 列（`daily-summary-repository.ts:240-248`）；`onConflict` 增加 `group_id` 到冲突列（`:249-255`），避免同 `(user,date,type)` 不同分组互相覆盖 |
| `getDailySummaryByDate(userId, date, type, groupId?)` | 新增可选 `groupId` 参数，有值时 WHERE 条件追加 `group_id = :groupId` |
| `getTodaySummary(userId, type, groupId?)` | 新增 `groupId` 参数，透传给 `getDailySummaryByDate` |
| `getDailySummaryHistory(userId, limit, type, groupId?)` | 新增可选 `groupId` 参数，有值时 WHERE 条件追加 `group_id = :groupId` |
| `DailySummaryArticle` | 新增 `domain_name`、`group_id`、`group_name` 字段 |
| `DailySummaryResult` | 新增 `groupId`、`groupName` 字段 |

**按 `groupId` 过滤的核心 SQL 逻辑**：

```sql
-- 通过 source 表 JOIN topic_domains → domain_summary_groups
SELECT articles.*, COALESCE(rss_sources.name, journals.name, ...) AS source_name,
       topic_domains.name AS domain_name,
       COALESCE(domain_summary_groups.id, 0) AS group_id,
       COALESCE(domain_summary_groups.name, '__catch_all__') AS group_name
FROM articles
LEFT JOIN rss_sources ON ...
LEFT JOIN topic_domains ON topic_domains.id = COALESCE(rss_sources.domain_id, journals.domain_id, ...)
LEFT JOIN domain_summary_groups ON domain_summary_groups.id = topic_domains.summary_group_id
WHERE articles.filter_status = 'passed'
  AND (
    domain_summary_groups.id = :groupId           -- 匹配指定真实分组
    OR (0 = :groupId AND topic_domains.id IS NULL)  -- 兜底：groupId=0 时取无 domain 的文章
    OR (0 = :groupId AND topic_domains.summary_group_id IS NULL)  -- 兜底：groupId=0 时取未分组领域的文章
    OR (:groupId IS NULL)                          -- 不传 groupId 时返回所有
  )
```

注意：`domain_id` 是可空列（`sql/037`），`domain_id IS NULL` 的源条目其文章通过 LEFT JOIN 与 `topic_domains` 连接时 `topic_domains.id` 为 NULL，进而不匹配任何真实分组。上述 SQL 通过 `(0 = :groupId AND topic_domains.id IS NULL)` 兜底捕获这部分文章。

### 4.2 LLM 生成（Generator）

`src/api/daily-summary-generator.ts` 变更：

- `generateDailySummary(input)` — `input` 新增 `groupId?: number`，有值时：
  1. 将 `groupId` 传给 repository 层
  2. 在 LLM 提示词开头增加分组标识：`## 领域分组：{groupName}\n`
- `generateJournalAllSummary(input)` — 同上
- `generateInsightsSummary(input)` — 同上
- `DailySummaryInput` 类型定义新增 `groupId?: number` 字段

### 4.3 调度器（Scheduler）

`src/daily-summary-scheduler.ts` 变更：

```typescript
const GROUP_ID_SENTINEL = 0;

/**
 * 获取用户的所有活跃分组（含虚拟 catch-all 分组）
 * 返回数组，每个元素 { id: number, name: string, show_on_homepage: number }
 */
async function getActiveSummaryGroups(userId: number): Promise<SummaryGroup[]> {
  const realGroups = await db.selectFrom('domain_summary_groups')
    .where('user_id', '=', userId)
    .selectAll()
    .execute();
  return [
    ...realGroups,
    { id: GROUP_ID_SENTINEL, name: '__catch_all__', show_on_homepage: 0 },
  ];
}

// 伪代码：runScheduledPush 的迭代逻辑
for (const type of config.types) {           // journal, blog_news, journal_all
  const groups = await getActiveSummaryGroups(userId);
  for (const group of groups) {
    const result = await generateDailySummary({ userId, type, groupId: group.id });
    if (result.totalArticles > 0) {
      await saveDailySummary({ ..., groupId: group.id });
    }
    // 推送逻辑见 §5
    await pushToChannels(result, userId, group);
  }
}
```

`src/insights-scheduler.ts` 同理，每个分组独立生成和推送洞察报告。

**注意事项**：

**通知去重缓存键冲突**：Telegram（`telegram/index.ts:74-75`）和 WeChat（`wechat/index.ts:43-44`）两个 notifier 都有 60 秒去重缓存，键为 `${userId}:${type}:${date}`。同一次运行循环多个分组时，第一个分组推送后写入缓存，后续分组全部命中 "Skipping duplicate" 被静默丢弃。必须将 `groupId` 加入缓存键：`getCacheKey(userId, type, date, groupId)` → `${userId}:${type}:${date}:${groupId}`。`sendJournalAllSummary`、`sendInsightsSummary` 等方法同理。

**`isExecuting` 锁与超时**：`waitForCompletion` 只等待 5 分钟（`daily-summary-scheduler.ts:127`），`groups × types` 组合数多时可能超时。建议设置分组数上限（如最多 20 个分组）并在调度器层跳过空分组（文章数为 0 的 group 提前返回，不调 LLM——此逻辑已在 `daily-summary-generator.ts:130-139` 实现）。

**分组数上限建议**：将分组数上限作为配置项（默认 20），启动时校验超过上限时告警。分组过多时应考虑分批或限制并发。

**Facade 推送路径同步改造**：`src/api/daily-summary.ts`（Facade 层）对 `generateDailySummary`（`:76-114`）、`generateJournalAllSummary`（`:120-165`）、`generateInsightsSummary`（`:171-223`）3 个 wrapper 函数也需改造：
- 接收 `groupId` 参数
- `saveDailySummary` 调用中传入 `groupId`
- 推送逻辑改为逐 chat/webhook 查 `domain_push_filters`（与调度器推送逻辑一致）

该 Facade 当前被 `POST /daily-summary/generate`、`POST /daily-summary/cli`、`POST /daily-summary/journal-all/generate`、`POST /daily-summary/insights/generate` 等 API 路由直接调用，若不改造则 API 手动触发的推送会完全绕过分组控制。

**Insights 调度器特殊处理**：Insights 调度器当前推送逻辑直接调用 `getTelegramNotifier().sendInsightsSummary()` / `getWeChatNotifier().sendInsightsSummary()`（`insights-scheduler.ts:265-279`），不走逐 chat/webhook 迭代。需改为与 daily-summary 调度器相同的模式：迭代分组 → 逐 chat 判断 `shouldPush` → 推送。

---

## 5. 推送控制

### 5.1 推送判断逻辑

每个 `[channel, channel_target, group, summary_type]` 组合的推送决定流程：

```
function shouldPush(userId, channel, targetId, groupId, summaryType):
  // 1. 查 domain_push_filters
  filter = SELECT FROM domain_push_filters
           WHERE user_id=userId AND channel=channel
             AND channel_target_id=targetId
             AND group_id=groupId     -- group_id=0 用于 new_articles/pdf_summary
             AND summary_type=summaryType
  // 2. 无记录 → 默认推送
  if !filter: return true
  // 3. 有记录 → 按 enabled 决定
  return filter.enabled === 1
```

### 5.2 调度器推送修改

当前推送逻辑（以 Telegram 为例）：

```typescript
// 当前：按推送类型查 chats，群发
const chats = getDailySummaryJournalChats(userId);
sendToChats(userId, config, chats, message, opts);
```

改为：

```typescript
// 改后：逐 chat 判断 domain_push_filters
for (const chat of getActiveTelegramChats(userId)) {
  if (shouldPush(userId, 'telegram', chat.chatId, groupId, 'daily_summary_journal')) {
    sendMessage(chat.chatId, messageWithGroupName, opts);
  }
}
```

企业微信同理，逐 webhook 判断。注意当前 `getWebhooksForPushType(pushType)` 和 `getWebhooksForDailySummaryType(type)`（`wechat-config.ts:205-225`）基于 YAML `push_types` 字段做过滤，且**无 `userId` 参数**。改造方案：
1. `getWebhooksForPushType` 改为接受 `userId` + `groupId` + `summaryType`，查询 `domain_push_filters` 表
2. 通过 `webhook.id`（字符串如 `"webhook-xxx"`）匹配 `domain_push_filters.channel_target_id`
3. 保留 YAML 作为 webhook 注册来源，但推送分流判断迁移到 DB
4. `getWebhooksForDailySummaryType` 同理改为读 `domain_push_filters`

**Facade 推送路径同步**：`src/api/daily-summary.ts` 的 `generateDailySummary`、`generateJournalAllSummary`、`generateInsightsSummary` 三个 wrapper 函数当前直接调用 notifier（不查 `domain_push_filters`），需改造为逐 chat/webhook 查 `domain_push_filters` 再推送。

**调度器推送路径同步**：`src/daily-summary-scheduler.ts` 的 `pushDailySummaryToAll`（`:50-66`）和 `pushJournalAllToAll`（`:68-91`）当前直接调用 notifier，需改为逐个 chat/webhook 查 `domain_push_filters` 后推送。

### 5.3 `new_articles` 和 `pdf_summary`

这两种推送类型与分组无关，`domain_push_filters` 中 `group_id = 0`（哨兵值）：

```typescript
if (shouldPush(userId, 'telegram', chat.chatId, GROUP_ID_SENTINEL, 'new_articles')) {
  sendNewArticle(chat.chatId, ...);
}
```

---

## 6. API 变更

### 6.1 读取今日总结

```
GET /api/daily-summary/today?type=journal&group_id=1
```

| 行为 | 说明 |
|------|------|
| `group_id` 不传 | 返回数组，包含所有 `show_on_homepage=1` 的分组总结 |
| `group_id` 传入 | 返回该分组单条总结 |
| 当日无总结 | 返回 `{ summaries: [] }` |

**响应格式变更**：从单对象改为数组

⚠️ **破坏性变更范围**：除 `GET /today` 外，以下端点也需同步修改或保持向后兼容：

| 端点 | 影响 |
|------|------|
| `POST /daily-summary/cli`（`:242`） | 当前返回单条总结。需支持 `group_id` 参数，有值时返回指定分组、无值返回所有分组数组 |
| `GET /:date`（`:124`） | 当前返回单条记录。需新增 `group_id` 查询参数，有值返回单条、无值返回数组 |
| `GET /:date/articles`（`:172`） | 同上 |
| `POST /daily-summary/generate`（`:39`） | **新增** `group_id` body 参数，透传给 Facade `generateDailySummary`，使 API 手动生成也能按分组推送 |
| `POST /daily-summary/journal-all/generate`（`:391`） | **新增** `group_id` body 参数，同上 |
| `POST /daily-summary/insights/generate`（`:480`） | **新增** `group_id` 或 `group_ids` body 参数，同上 |
| `generateSearchSummary`（`daily-summary-generator.ts:250`） | `type=search` 不涉及分组，无需改动但需确认不误受分组过滤影响 |

```json
{
  "summaries": [
    {
      "group_id": 1,
      "group_name": "图情领域",
      "summary_date": "2026-07-15",
      "summary_type": "journal",
      "article_count": 12,
      "summary_content": "...",
      "created_at": "..."
    },
    {
      "group_id": 2,
      "group_name": "AI",
      "summary_date": "2026-07-15",
      "summary_type": "journal",
      "article_count": 8,
      "summary_content": "...",
      "created_at": "..."
    }
  ]
}
```

### 6.2 历史总结

```
GET /api/daily-summary/history?limit=30&type=journal&group_id=1
```

新增 `group_id` 过滤参数。

### 6.3 总结管理 CRUD

```
GET    /api/settings/summary-groups          → 获取所有分组（含 show_on_homepage）
POST   /api/settings/summary-groups          → 新建分组
PUT    /api/settings/summary-groups/:id      → 更新分组（名称、show_on_homepage、领域分配）
DELETE /api/settings/summary-groups/:id      → 删除分组（关联的 domain 恢复 NULL）

GET    /api/settings/push-filters?channel=telegram&target_id=xxx  → 获取某账号的推送过滤器
PUT    /api/settings/push-filters            → 批量更新（body: [{id, enabled}, ...]）
```

---

## 7. 前端变更

### 7.1 统一推送控制面板（新增）

文件：`src/views/settings/panel-summary.ejs`

在设置页「通知」组新增 tab「总结分组推送」，包含两区域：

**区域一：领域分组管理**

```
┌─ 新建分组 ──────────────────────────────────────┐
│ 分组名称: [______]  勾选领域: ☑图书馆学 ☑阅读文化 ☐AI  │
│ [创建]                                             │
└──────────────────────────────────────────────────┘
┌─ 已有分组 ──────────────────────────────────────┐
│ 分组名称       所含领域      首页显示   操作       │
│ ──────────────────────────────────────────────── │
│ 图情领域       图书馆学,阅读文化  ✓   [编辑][删除] │
│ AI             人工智能          ✓   [编辑][删除] │
│ ──────────────────────────────────────────────── │
│ 说明：首页显示关闭后，该分组的总结不出现在首页      │
│ 和历史页，但仍会生成并可按需推送。                  │
└─────────────────────────────────────────────────┘
```

**区域二：推送控制表格**

```
┌─ 统一推送控制 ──────────────────────────────────────────────────────────────────────┐
│ 账号/Target        │ 通过期刊     │ 通过资讯     │ 全部期刊     │ 洞察       │ 新文章 │ PDF总结 │
│                    │ 图情  AI     │ 图情  AI     │ 图情  AI     │ 图情  AI   │       │        │
├────────────────────┼──────────────┼──────────────┼──────────────┼────────────┼───────┼────────┤
│ 📱 Telegram 群A     │  ✓✓   ✓✓    │  ✓✓   ✓✓    │  ✓✘   ✓✘    │  ✓✓   ✓✓  │  ✓✓   │  ✓✓   │
│ 📱 Telegram 群B     │  ✘✓   ✘✓    │  ✓✓   ✓✓    │  ✘✘   ✘✘    │  ✓✓   ✓✘  │  ✘✘   │  ✓✓   │
│ 💬 企微-部门群      │  ✓✓   ✓✓    │  ✓✓   ✓✓    │  ✘✓   ✘✓    │  ✓✓   ✓✓  │  ✓✓   │  ✘✘   │
└────────────────────┴──────────────┴──────────────┴──────────────┴────────────┴───────┴────────┘
```

- 前 4 列每列有 2（或 N）个子列，对应各分组
- 后 2 列无子列（`group_id = 0` 哨兵值）
- 每个单元格点击切换 ✓/✘

### 7.2 Telegram 面板（修改）

文件：`src/views/settings/panel-telegram.ejs`

**保留**：Bot Token 输入 + 保存 + 测试连接、Chat 列表（ID、名称、角色、启用/禁用）

**去掉**：添加/编辑模态框中的全部 6 个推送类型复选框

### 7.3 企业微信面板（修改）

文件：`src/views/settings/panel-wechat.ejs`

**保留**：Webhook 列表（名称、URL、启用/禁用）

**去掉**：添加/编辑模态框中的全部 6 个推送类型复选框

### 7.4 设置页导航（修改）

文件：`src/views/settings/body.ejs`

在「通知」tab 组中新增按钮：

```html
<button class="settings-tab" data-tab="summary-push">总结推送配置</button>
```

以及对应的 panel include：

```html
<%- include('panel-summary') %>
```

### 7.5 首页总结面板（修改）

文件：`src/views/index.ejs` + `src/public/js/daily-summary.js`

当前每个 tab 展示一条总结，改为展示多条（按分组），带分组标题：

```
[期刊精选] [博客资讯] [洞察报告]

── 📂 图情领域 ──────────────────────
[总结内容：期刊精选 · 12 篇文章]
[生成于 07:15]

── 📂 AI ─────────────────────────────
[总结内容：期刊精选 · 8 篇文章]
[生成于 07:16]
```

前端逻辑：
1. `GET /api/daily-summary/today?type=journal` → 返回 `summaries` 数组
2. 遍历数组，每个元素用 `group_name` 做分隔标题
3. `summaryCache` 从单对象改为 `Map<groupId, data>`

### 7.6 历史页（修改）

文件：`src/views/history.ejs` + `src/public/js/history.js`

在类型筛选下拉框旁新增分组筛选下拉框：

```html
<select id="groupFilter">
  <option value="">全部分组</option>
  <option value="1">图情领域</option>
  <option value="2">AI</option>
</select>
```

历史列表每条记录显示分组标签：

```
2026-07-15  [图情领域] [期刊精选]  12 篇 · 2 小时前
2026-07-15  [AI]       [期刊精选]  8 篇  · 2 小时前
```

---

## 8. 推送通知格式变更

### 8.1 Telegram

`DailySummaryData` 新增 `groupName?: string`、`groupId?: number`，消息头部增加：
- `groupId` 用于通知去重缓存键：`getCacheKey(userId, type, date, groupId)` → `${userId}:${type}:${date}:${groupId}`（`telegram/index.ts:74-75` 需改造，`sendDailySummary`、`sendJournalAllSummary`、`sendInsightsSummary` 等方法同理）

```
📅 每日文献总结
🗓 2026-07-15
📂 图情领域
📋 类型：期刊精选
...
```

### 8.2 企业微信

`WeChatDailySummaryData` 新增 `groupName?: string`、`groupId?: number`，消息头部增加：
- `groupId` 用于通知去重缓存键：`getCacheKey(userId, type, date, groupId)` → `${userId}:${type}:${date}:${groupId}`（`wechat/index.ts:43-44` 需改造，`sendDailySummary`、`sendJournalAllSummary`、`sendInsightsSummary` 等方法同理）

```
# 📅 每日总结

**领域分组：** 图情领域
**日期：** 2026-07-15
**类型：** 期刊精选
...
```

---

## 9. 不受影响的部分

| 功能 | 原因 |
|------|------|
| 文章过滤 (`filter.ts`) | 已是单领域评估，不涉及总结分组 |
| 文章处理流水线 (`pipeline.ts`) | 不变，仍是文章级别处理 |
| 向量检索 (`vector/`) | 按 domain_id 搜索，已在现有设计中 |
| 搜索总结 (`search`) | 用户手动触发，按选中文章生成，不参与调度 |
| PDF 论文总结 (`pdf_summary`) | 单篇触发，不涉及分组 |
| DeepSearch | 独立功能 |
| 认证/权限 | 不变 |

---

## 10. 文件变更清单

| # | 文件 | 变更类型 | 说明 |
|---|------|---------|------|
| 1 | `sql/041_add_summary_group.sql` | 新增 | 新建 `domain_summary_groups` 表、`domain_push_filters` 表（`group_id` 无 FK、`NOT NULL DEFAULT 0`）；ALTER `topic_domains` 加 `summary_group_id`；ALTER `daily_summaries` 加 `group_id`（`NOT NULL DEFAULT 0`，无 FK）；DROP 旧唯一索引 `idx_daily_summaries_user_date_type` → CREATE 新唯一索引 `idx_daily_summaries_user_date_type_group` |
| 2 | `scripts/migrate.ts` | 修改 | 新增 `if (file === '041_add_summary_group.sql')` 处理块（幂等守卫 + `continue`），否则 SQL 不会被执行 |
| 3 | `src/db.ts` | 修改 | 新增表接口类型 |
| 4 | `src/api/domain-summary-groups.ts` | 新增 | 分组 CRUD 服务（含 `getActiveSummaryGroups` 查询接口） |
| 5 | `src/api/domain-push-filters.ts` | 新增 | 推送过滤器 CRUD 服务 |
| 6 | `src/api/daily-summary-repository.ts` | 修改 | `getDailyPassedArticles`、`getAllJournalArticles`、`getInsightsArticles` 新增可选 `groupId` 进行文章过滤（含 `groupId=0` 的兜底 SQL）；`getDailySummaryByDate`、`getTodaySummary`、`getDailySummaryHistory` 新增可选 `groupId` 支持分组查询；`saveDailySummary` 常量 `GROUP_ID_SENTINEL = 0`、insert/onConflict 加 `group_id`（`daily-summary-repository.ts:240-255`）；`getInsightsArticles` 补充 `email_sources` JOIN |
| 7 | `src/api/daily-summary-generator.ts` | 修改 | LLM 提示词加分组上下文；`DailySummaryInput` 加 `groupId` |
| 8 | `src/api/daily-summary.ts` | 修改 | Facade 层 `generateDailySummary`（`:76-114`）、`generateJournalAllSummary`（`:120-165`）、`generateInsightsSummary`（`:171-223`）3 个 wrapper 函数接收 `groupId` 参数；`saveDailySummary` 调用传入 `groupId`；推送逻辑改为逐 chat/webhook 查 `domain_push_filters`（与调度器推送逻辑一致） |
| 9 | `src/daily-summary-scheduler.ts` | 修改 | 迭代 `groups × types`；`pushDailySummaryToAll`（`:50-66`）和 `pushJournalAllToAll`（`:68-91`）改为逐 chat/webhook 查 `domain_push_filters`；`isExecuting` 锁超时兜底；分组数上限校验 |
| 10 | `src/insights-scheduler.ts` | 修改 | 按分组生成洞察；推送逻辑改为逐 chat/webhook 迭代 |
| 11 | `src/api/routes/daily-summary.routes.ts` | 修改 | `GET /today` 返回数组；`GET /:date`/`POST /cli` 支持 `group_id` |
| 12 | `src/api/routes/settings.routes.ts` | 修改 | 新增分组/push-filters 端点 |
| 13 | `src/api/topic-domains.ts` | 修改 | `createTopicDomain` 自动建/挂分组 |
| 14 | `src/telegram/index.ts` | 修改 | `getCacheKey` 加 `groupId`；推送逻辑查 `domain_push_filters` |
| 15 | `src/telegram/types.ts` | 修改 | `DailySummaryData` 加 `groupName`、`groupId` |
| 16 | `src/telegram/formatters.ts` | 修改 | 消息头部加分组名 |
| 17 | `src/wechat/index.ts` | 修改 | `getCacheKey` 加 `groupId`；推送逻辑查 `domain_push_filters` |
| 18 | `src/wechat/formatters.ts` | 修改 | 加 `groupName`、`groupId` |
| 19 | `src/config/wechat-config.ts` | 修改 | `getWebhooksForPushType(pushType)` 改为接受 `userId` + `groupId` + `summaryType`，查询 `domain_push_filters` 表（按 webhook.id 匹配 `channel_target_id`）；`getWebhooksForDailySummaryType(type)` 同理；保留 YAML 作为 webhook 注册来源，推送分流判断迁移到 DB |
| 20 | `src/views/settings/panel-summary.ejs` | **新增** | 统一推送配置面板 |
| 21 | `src/views/settings/panel-telegram.ejs` | 修改 | 去掉推送类型复选框 |
| 22 | `src/views/settings/panel-wechat.ejs` | 修改 | 去掉推送类型复选框 |
| 23 | `src/views/settings/body.ejs` | 修改 | 新增 tab 按钮 |
| 24 | `src/public/js/daily-summary.js` | 修改 | `summaryCache` 从单对象改为 `Map<groupId, data>`；响应格式适配数组 |
| 25 | `src/public/js/settings.js` | 修改 | 支持新面板 |
| 26 | `src/views/history.ejs` | 修改 | 加分组筛选 |
| 27 | `src/public/js/history.js` | 修改 | 分组筛选逻辑 |
| 28 | `src/migration/migrate-push-settings.ts` | 新增 | 旧配置 → `domain_push_filters` 迁移脚本，`new_articles`/`pdf_summary` 使用哨兵值 `GROUP_ID_SENTINEL = 0` |

---

## 11. 实现优先级

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **P0** | 数据模型 + SQL 迁移（`domain_summary_groups`、`domain_push_filters` 表；ALTER 加字段；DROP/CREATE 唯一索引；`daily_summaries.group_id NOT NULL DEFAULT 0`） + `scripts/migrate.ts` 注册 + DB 类型 | 无 |
| **P1** | `daily-summary-repository.ts`（含 `getActiveSummaryGroups` 虚拟分组 + 哨兵 `0` 兜底 SQL + 读取方法 `groupId` 支持 + `getInsightsArticles` email JOIN）+ `domain-summary-groups.ts` + `domain-push-filters.ts` API + `topic-domains.ts` 自动挂分组 | P0 |
| **P2a** | `daily-summary-generator.ts` + 调度器（groups × types 迭代 + 空组跳过 + 分组上限 + 推送 helper 改造） | P1 |
| **P2b** | 通知去重缓存键增加 `groupId` 维度（Telegram + WeChat） | P2a |
| **P2c** | 推送控制改造：`telegram/index.ts` 逐 chat 查 `domain_push_filters` + `wechat-config.ts`/`wechat/index.ts` 逐 webhook 查 `domain_push_filters` + **Facade 层（`daily-summary.ts`）推送路径同步改造** | P2a |
| **P3** | 前端：panel-summary + Telegram/微信 panel 简化 | P1, P2c |
| **P4** | 首页 + 历史页多分组展示 | P2a, P3 |
| P5 | Insights 调度器推送架构改造（逐 chat/webhook 迭代） | P2c |
| P6 | 旧配置迁移脚本 | P0 |
| P7 | 旧 `telegram_chats.push_types` 列 / `wechat.yaml push_types` 清理（可选） | P6 |

---

## 12. 回退方案

1. **DB 回退**：DROP TABLE `domain_summary_groups`, `domain_push_filters`; ALTER TABLE `topic_domains` DROP COLUMN `summary_group_id`; ALTER TABLE `daily_summaries` DROP COLUMN `group_id`（注意：DROP COLUMN 后需重建唯一索引 `idx_daily_summaries_user_date_type`）
2. **API 回退**：恢复 `GET /today` 返回单对象
3. **前端回退**：恢复 `panel-telegram.ejs` / `panel-wechat.ejs` 推送类型复选框
4. **调度器回退**：恢复 `runScheduledPush` 为单次生成

但建议保留 `domain_push_filters` 数据（即使回退调度器，数据仍有效）。