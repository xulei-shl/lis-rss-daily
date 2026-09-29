# 「我的每日」外部 API 调用说明

本文档说明如何从外部项目 / agent 调用 LIS-RSS 的「我的每日」JEV 评分接口。

对应实现：

- 接口：`POST /api/external/my-daily`
- 路由：`src/api/routes/external-my-daily.routes.ts`
- 响应信封：`src/api/external-api-response.ts`

统一检索（语义 / 关键词 / 混合 / 相关）仍使用 `POST /api/external/search`，见 `docs/统一检索外部API调用说明.md`。

## 1. 响应约定

**所有响应（成功与失败）都使用同一层信封**，agent 无需猜测结构：

```json
{
  "ok": true,
  "code": "RESULT_CACHED",
  "message": "该日期（2026-09-29）已有评分结果，直接返回缓存",
  "retryable": false,
  "data": { "...": "成功时的结构化结果，失败时为 null" },
  "details": { "userId": 5, "date": "2026-09-29", "execution": { "...": "..." } }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ok` | `boolean` | 请求是否成功完成。`false` 时 `data` 必为 `null`，原因见 `code` / `message` |
| `code` | `string` | 机器可读的稳定状态码，可枚举（见第 4、5 节） |
| `message` | `string` | 人类可读说明，失败时尽量给出下一步动作 |
| `retryable` | `boolean` | 失败是否可能通过重试恢复；成功时恒为 `false` |
| `data` | `object \| null` | 成功时的结构化结果，失败时为 `null` |
| `details` | `object \| null` | 诊断上下文（用户 / 日期 / 执行情况 / 需执行的动作），无则为 `null` |

> 注意：`ok = true` 仅表示「请求被正确处理」，不代表一定有文章。例如
> `NO_ARTICLES_FOR_DATE` 也是 `ok = true`，此时 `data.returned = 0`。

## 2. 请求

```http
POST /api/external/my-daily
Content-Type: application/json
```

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `username` | `string` | 是 | 账号 |
| `password` | `string` | 是 | 密码 |
| `date` | `string` | 否 | 评分日期 `YYYY-MM-DD`，默认用户时区下的当天 |
| `minScore` | `number` | 否 | 最低相关性评分，取值 `0~1`（与 `relevance_score` 同口径） |

`minScore` 单位说明：`user_daily_scores.relevance_score` 取值 `0~1`，页面显示的百分比即
`relevance_score × 100`。因此「高度相关（≥70%）」对应 `minScore: 0.7`，「≥30%」对应 `minScore: 0.3`。

### 为什么用账号密码而不是 API Key

评分结果与具体用户绑定（`user_daily_scores.user_id`），必须取真实用户身份，
因此不使用共享的 `CLI_API_KEY`，而是校验该账号的 `username` + `password`。
接口仅对 `user` / `admin` 角色开放（与站内 `/api/my-daily` 一致）。

## 3. 执行逻辑

1. 校验账号密码 → 得到用户。
2. 解析 `date`（缺省为用户时区下的当天）与 `minScore`。
3. 查询该用户该日期是否已有评分记录（`user_daily_scores`）：
   - **已有** → 直接返回，`code = RESULT_CACHED`。
   - **没有** → 继续第 4 步。
4. 校验用户是否配置了激活的主题领域：
   - **没有** → 返回 `NO_TOPIC_CONFIGURED`，**不执行**评分。
   - **有** → 继续第 5 步。
5. 校验服务端是否配置了 JEV API 密钥：
   - **没有** → 返回 `JEV_NOT_CONFIGURED`。
   - **有** → 触发 JEV 评分（与站内「Jev 评分」按钮同一套逻辑，全局串行排队），完成后返回结果。

## 4. `data` 结构（成功时）

```json
{
  "userId": 5,
  "date": "2026-09-29",
  "minScore": 0.7,
  "total": 12,
  "returned": 3,
  "articles": [
    {
      "id": 123,
      "title": "Example Title",
      "title_zh": "示例标题",
      "summary": "...",
      "summary_zh": "...",
      "url": "https://example.com/article",
      "source_origin": "journal",
      "filter_status": "passed",
      "published_at": "2026-09-29T01:00:00.000Z",
      "created_at": "2026-09-29T02:00:00.000Z",
      "relevance_score": 0.86,
      "relevance_level": "high",
      "matched_domain": "情报分析",
      "failed": false
    }
  ]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `userId` | `number` | 用户 ID |
| `date` | `string` | 实际查询的日期 |
| `minScore` | `number \| null` | 本次生效的过滤阈值，未传为 `null` |
| `total` | `number` | 该日期参与评分的文章总数（过滤前） |
| `returned` | `number` | 本次实际返回条数（应用 `minScore` 后） |
| `articles` | `array` | 文章列表，按相关性倒序 |

### `articles[]` 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `number` | 文章 ID |
| `title` / `title_zh` | `string \| null` | 原文 / 中文标题 |
| `summary` / `summary_zh` | `string \| null` | 原文 / 中文摘要 |
| `url` | `string \| null` | 原文链接 |
| `source_origin` | `string \| null` | 来源类型：`rss` / `journal` / `keyword` / `email` / `web` |
| `filter_status` | `string \| null` | 关键词预过滤结果：`pending` / `passed` / `rejected` |
| `published_at` / `created_at` | `string \| null` | 发布时间 / 入库时间（ISO 8601） |
| `relevance_score` | `number` | JEV 综合相关性评分，`0~1` |
| `relevance_level` | `string \| null` | 分档：`high`（≥0.7）/ `medium`（≥0.3）/ `low`；`failed = true` 时为 `null` |
| `matched_domain` | `string \| null` | 命中的主题领域名称 |
| `failed` | `boolean` | `true` 表示该篇 JEV 调用失败，`relevance_score` 为占位 `0`，**不代表真实相关性**，排序时沉底 |

> `minScore` 过滤是在获取结果后按 `relevance_score` 数值比较。
> 当 `minScore > 0` 时，`failed` 的条目（占位 0 分）会被自然排除。

## 5. `details` 结构

```json
{
  "userId": 5,
  "date": "2026-09-29",
  "execution": {
    "triggered": true,
    "reason": "executed",
    "scored": 11,
    "failed": 1
  },
  "requiredAction": "configure_topic_domain"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `userId` | `number \| undefined` | 已知时的用户 ID |
| `date` | `string \| undefined` | 已知时的目标日期 |
| `execution` | `object \| undefined` | 本次评分的执行情况（见下） |
| `requiredAction` | `string \| undefined` | 失败时需要人工执行的动作：`configure_topic_domain` / `configure_jev_api_key` |

`execution`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `triggered` | `boolean` | 本次是否真正触发了评分 |
| `reason` | `string` | `already_scored` / `executed` / `no_articles` / `in_progress` |
| `scored` | `number \| null` | 本次成功出分篇数；未触发时为 `null` |
| `failed` | `number \| null` | 本次出分失败篇数；未触发时为 `null` |

## 6. 状态码总表

### 6.1 成功（`ok = true`，HTTP 200）

| `code` | `execution.reason` | 含义 |
| --- | --- | --- |
| `RESULT_CACHED` | `already_scored` | 该日期此前已评分，直接返回缓存结果 |
| `RESULT_SCORED` | `executed` | 本次触发评分并已完成，返回结果 |
| `NO_ARTICLES_FOR_DATE` | `no_articles` | 该日期没有新增文章，无需评分（`data.returned = 0`） |

### 6.2 失败（`ok = false`，`data = null`）

| `code` | HTTP | `retryable` | 含义与处理建议 |
| --- | --- | --- | --- |
| `MISSING_CREDENTIALS` | 400 | `false` | 缺少 `username` / `password` |
| `INVALID_JSON_BODY` | 400 | `false` | 请求体不是合法 JSON（由 body 解析层返回） |
| `INVALID_DATE_FORMAT` | 400 | `false` | `date` 不是合法的 `YYYY-MM-DD` 日期（含 2026-13-45 之类不存在的日期） |
| `INVALID_MIN_SCORE` | 400 | `false` | `minScore` 不在 `0~1` |
| `INVALID_CREDENTIALS` | 401 | `false` | 账号或密码错误 |
| `FORBIDDEN_ROLE` | 403 | `false` | 账号角色不是 `user` / `admin`（`details.role` 为实际角色） |
| `NO_TOPIC_CONFIGURED` | 400 | `false` | 账号未配置主题领域，无法评分；需先由用户在「主题」页面配置（`details.requiredAction = configure_topic_domain`） |
| `SCORING_IN_PROGRESS` | 409 | `true` | 该日期评分正在进行中；稍后重试，届时会走 `RESULT_CACHED` |
| `SCORING_QUEUE_FULL` | 429 | `true` | 服务端评分队列已满，稍后重试 |
| `SCORING_QUEUE_TIMEOUT` | 429 | `true` | 排队等待超时，稍后重试 |
| `JEV_NOT_CONFIGURED` | 503 | `false` | 服务端未配置 JEV API 密钥，需管理员处理（`details.requiredAction = configure_jev_api_key`） |
| `INTERNAL_ERROR` | 500 | `true` | 服务端异常，`details.reason` 为原始错误信息 |

## 7. 调用示例

### 7.1 查询今天（默认日期）

```bash
curl -X POST "http://localhost:8007/api/external/my-daily" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "password": "your-password"
  }'
```

### 7.2 指定日期 + 只看高度相关

```bash
curl -X POST "http://localhost:8007/api/external/my-daily" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "password": "your-password",
    "date": "2026-09-29",
    "minScore": 0.7
  }'
```

成功响应示例：

```json
{
  "ok": true,
  "code": "RESULT_SCORED",
  "message": "已完成该日期（2026-09-29）的评分",
  "retryable": false,
  "data": {
    "userId": 5,
    "date": "2026-09-29",
    "minScore": 0.7,
    "total": 12,
    "returned": 3,
    "articles": [ "……" ]
  },
  "details": {
    "userId": 5,
    "date": "2026-09-29",
    "execution": { "triggered": true, "reason": "executed", "scored": 11, "failed": 1 }
  }
}
```

未配置主题领域时的响应示例：

```json
{
  "ok": false,
  "code": "NO_TOPIC_CONFIGURED",
  "message": "该账号尚未配置主题领域，无法执行评分。请先在「主题」页面配置主题领域与关键词",
  "retryable": false,
  "data": null,
  "details": {
    "userId": 5,
    "date": "2026-09-29",
    "requiredAction": "configure_topic_domain"
  }
}
```

### 7.3 JavaScript

```javascript
async function fetchMyDaily() {
  const res = await fetch('http://localhost:8007/api/external/my-daily', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'alice',
      password: 'your-password',
      date: '2026-09-29',
      minScore: 0.7
    })
  });

  const body = await res.json();
  if (!body.ok) {
    // 按 code 分支处理
    if (body.code === 'SCORING_IN_PROGRESS') { /* 稍后重试 */ }
    throw new Error(`${body.code}: ${body.message}`);
  }
  return body.data;
}
```

## 8. 给 agent 的接入建议

1. **只看 `ok` 判断成败**，再看 `code` 做分支；不要依赖 `message` 文案。
2. **`retryable = true` 时**（`SCORING_IN_PROGRESS` / `SCORING_QUEUE_*` / `INTERNAL_ERROR`）可退避重试。
3. **`NO_TOPIC_CONFIGURED` / `JEV_NOT_CONFIGURED`** 不是重试能解决的，需提示用户 / 管理员按 `details.requiredAction` 处理。
4. 常规轮询请优先读缓存：先正常调用，命中缓存时为 `RESULT_CACHED`，不会重复计费。
5. 触发评分会真实调用 JEV（大模型）并产生费用；评分任务全局串行，其他用户评分进行中时本请求会排队等待（最长约 10 分钟），请为 HTTP 客户端设置足够超时。
