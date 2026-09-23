# 我的每日 — JEV 评分实现逻辑

> 对应初始需求：[我的每日-初始需求.md](./我的每日-初始需求.md)
>
> 主要代码：`src/jev.ts`（JEV 调用与评分）、`src/my-daily-scorer-scheduler.ts`（调度与并发控制）、`src/api/my-daily.ts`（查询）、`src/api/routes/my-daily.routes.ts`（路由）、`src/public/js/my-daily.js`（前端展示）。

## 1. 问题类型：noul / choice / score 三种全用

JEV 支持 `noul`、`choice`、`score` 三种问题模式。本模块对每篇文章的**一次** JEV 调用中按情况组合使用三种模式（`src/jev.ts` `buildJevRequest`）：

| 问题 key | 类型 | 作用 | 触发条件 |
|---|---|---|---|
| `is_relevant` | `noul` | 二值判断：文章是否与用户主题相关 | 始终使用 |
| `relevance_level` | `score` | 细粒度相关程度（0–4 五档） | 始终使用 |
| `best_domain` | `choice` | 从多个主题领域中选出最匹配的一个 | 仅当用户配置了 ≥2 个主题领域 |

三种模式的分工：`noul` 提供粗粒度的「相关 / 不相关」概率门控，`score` 提供细粒度的相关程度，`choice` 提供领域归因打标。三者各自独立提问，由前端综合算法汇总为一个分数。

## 2. 请求构建

### 2.1 state（输入维度）

```js
{
  article: "标题：<title>\n摘要：<summary>",   // 无摘要时只有标题
  user_topics: "<领域名>（关键词：a、b）：<描述>\n..."
}
```

- `article`：文章原文标题 + 摘要（中文翻译 `title_zh` / `summary_zh` 不参与评分，仅用于前端展示）。
- `user_topics`：来自 `/topics` 页面用户配置的**激活**主题领域（`topic_domains.is_active = 1`）及其激活关键词（`topic_keywords.is_active = 1`）。

### 2.2 questions（打分指标与标准）

**`noul` — `is_relevant`（是否相关）**

| 取值 | 判断标准 |
|---|---|
| `true` | 文章内容直接涉及或紧密关联用户关注的主题领域或关键词 |
| `false` | 文章内容与用户关注的主题领域无关，仅表面词汇相似但实质不同 |

**`score` — `relevance_level`（相关程度，0–4 五档）**

| 分值 | 标准 |
|---|---|
| 0 | 完全不相关，与用户主题无任何关联 |
| 1 | 边缘相关，仅涉及相邻领域或间接关联 |
| 2 | 中度相关，涉及用户主题的部分方面 |
| 3 | 高度相关，直接讨论用户关注的核心主题 |
| 4 | 完全匹配，深入讨论用户核心主题且包含关键词 |

**`choice` — `best_domain`（最匹配领域，多领域时）**

- 选项为每个领域名，选项描述为该领域的 `description`（无描述则为 `null`）。
- 提问：`article` 最匹配 `user_topics` 中的哪个主题领域？

## 3. 综合评分算法（`calculateScore`）

```
relevanceScore = noul概率 × (score值 / 4)
```

- `noul` 概率 ∈ [0, 1] 作为门控；`score` 归一化到 [0, 1] 作为程度。
- 两者相乘：被判为「不相关」的文章，即使 score 打高分也会被压到接近 0。
- 结果保留两位小数，范围 0–1；前端展示为百分比（`★ 85%`）。
- `matched_domain` 直接取 `choice` 答案；单领域用户（无 `best_domain` 问题）为 `null`。
- JEV 调用失败时写入占位 0 分并标记 `failed: true`，`jev_response` 中记录错误信息——占位 0 分不代表真实相关性。

原始响应完整 JSON 存入 `user_daily_scores.jev_response`，便于事后审计与调参。

## 4. 数据存储

`user_daily_scores` 表（`sql/044_add_user_role_and_daily_scores.sql`）：

| 字段 | 说明 |
|---|---|
| `user_id` + `article_id` + `score_date` | 联合唯一键；重复评分时 upsert 覆盖 |
| `relevance_score` | 综合评分（REAL，0–1） |
| `matched_domain` | 匹配的主题领域名称（可空） |
| `jev_response` | JEV 原始响应 JSON（TEXT） |

日期口径：`score_date` 是**用户时区下的本地自然日**（YYYY-MM-DD）。查询文章时先换算成对应 UTC 区间（`buildUtcRangeFromLocalDate`）再按 `created_at` 过滤，避免凌晨抓取的文章被拆到两天。

覆盖范围：**不过滤 `filter_status`**——需求要求 JEV 对当日所有新增文章评分打标（低分灰显），已过关键词预过滤的文章也参与评分。

## 5. 调度与并发控制（`my-daily-scorer-scheduler.ts`）

### 5.1 定时任务

- cron 表达式默认 `30 7 * * *`（每日 07:30），可通过 `MY_DAILY_SCHEDULE` 配置。
- 遍历所有 `role='user'` 的用户，**串行**逐个评分；日期按各用户时区的当天计算。
- 未配置 JEV 密钥时跳过整个任务（不报错）。

### 5.2 全局互斥与排队（`acquireScoringSlot` / `releaseScoringSlot`）

- 全局同一时刻只允许**一个**评分任务执行（不分用户），定时任务与多个用户手动点击「重新评分」共用同一把锁。
- 重叠触发按 **FIFO** 排队：名额释放时直接转交给队首，新请求无法插队。
- 同一 `(userId, date)` 已在执行或排队时，重复触发直接返回 `skipped: reason='duplicate'`。
- 排队上限 10 个（超出返回 `queue_full`），最长等待 10 分钟（超时返回 `wait_timeout`），避免请求无限挂起。

### 5.3 文章级并发

- 单个用户内按 `MY_DAILY_CONCURRENCY`（默认 5）分批并行调用 JEV。
- 每批内 `Promise.all` 等全部完成后进入下一批；每篇完成即触发回调（写库 + SSE 推送）。

### 5.4 重试与失败处理（`callJevApi`）

- 带超时（`JEV_REQUEST_TIMEOUT_MS`，默认 30s，AbortController 实现）。
- 最多重试 `JEV_MAX_RETRIES`（默认 2）次。
- 可重试条件：5xx、408 / 429 / 529、网络异常、超时；按指数退避 + 抖动（1s 起步，单次上限 30s），优先遵循响应头 `Retry-After`。
- 单篇最终失败不阻塞批次：写占位 0 分（`failed: true`），完成后在 `done` 事件中单独报告 `failed` 数。

## 6. API 层（`/api/my-daily`）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/my-daily?date=` | GET | 查询指定日期的评分文章（联表 articles + translations），按 `relevance_score` 降序 |
| `/api/my-daily/dates` | GET | 可评分日期列表 = 已有评分结果的日期 ∪ 最近 30 个自然日内有新增文章的日期（倒序，上限 30） |
| `/api/my-daily/refresh` | POST | 手动触发当前用户评分；`Accept: text/event-stream` 时走 SSE 流式，否则走传统 JSON |

**SSE 流式评分**（前端「Jev 评分」按钮）推送三类事件：

| 事件 | 时机 | 载荷 |
|---|---|---|
| `start` | 评分开始 | `{ total }` |
| `item` | 每篇出分 | `{ current, total, article: { ..., relevance_score, matched_domain } }` |
| `done` | 全部完成 | `{ total, scored, failed }` |

另有 `info`（`no_articles` / `duplicate`）与 `error`（未配置主题、排队失败、JEV 异常）事件。前端收到 `item` 即插入卡片并按分数动态重排（FLIP 动画），直到全部完成。

## 7. 前端展示分档（`my-daily.js`）

| 档位 | 阈值 | 展示 |
|---|---|---|
| 高度相关 | score ≥ 0.7 | 正常高亮徽章 |
| 中度相关 | 0.3 ≤ score < 0.7 | 正常徽章 |
| 低相关 | score < 0.3 | 徽章为 low 样式，整卡 `is-low-score` **灰显** |

工具栏统计三类数量（高 / 中 / 低），三项之和必须等于总数（不一致时控制台报错）。摘要展示优先中文翻译（`summary_zh`），超过 400 字折叠。

## 8. 配置项（`src/config.ts`）

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `TYPESAFE_API_KEY` | — | JEV 兜底密钥（优先用 llm_configs 数据库配置） |
| `JEV_REQUEST_TIMEOUT_MS` | `30000` | 单次请求超时 |
| `JEV_MAX_RETRIES` | `2` | 最大重试次数 |
| `MY_DAILY_ENABLED` | `true` | 是否启用定时评分（`false` 显式关闭） |
| `MY_DAILY_SCHEDULE` | `30 7 * * *` | 定时 cron 表达式 |
| `MY_DAILY_CONCURRENCY` | `5` | 单用户内文章并行评分并发数 |

JEV 配置解析优先级（`resolveJevConfig`）：`llm_configs` 表中 `config_type='jev'`（或 `provider='typesafe'`）且启用的配置 > `.env` 的 `TYPESAFE_API_KEY`；两者皆无时抛错并引导用户到「设置 → LLM 配置」添加。
