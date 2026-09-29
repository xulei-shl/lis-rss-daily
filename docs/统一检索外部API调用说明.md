# 统一检索外部 API 调用说明

本文档说明如何从外部项目 / agent 调用 LIS-RSS 的统一检索接口。

对应实现：

- 接口：`POST /api/external/search`
- 路由：`src/api/routes/external-search.routes.ts`
- 响应信封：`src/api/external-api-response.ts`

这个接口是在现有统一检索服务之上的一层 HTTP 封装，不影响站内搜索页面和原有接口。

## 1. 接口概览

支持 4 种检索模式：

- `semantic`：语义检索
- `keyword`：关键词检索
- `hybrid`：混合检索（兼容写法 `mixed`）
- `related`：相关文章推荐（必填 `articleId`）

其中：

- `hybrid` 支持语义检索失败后自动回退到关键词检索（返回中 `data.fallback = true`）
- `related` 支持结果缓存（返回中 `data.cached`）
- 鉴权沿用既有 CLI 机制，**不需要账号密码**

## 2. 请求地址

```text
POST http://localhost:8007/api/external/search
```

将 `localhost:8007` 替换为实际服务地址。

## 3. 鉴权方式

复用项目现有的 `CLI_API_KEY` 机制。服务端需配置：

```bash
CLI_API_KEY=your-secret-key-here
```

客户端需提供：

- API Key：请求头 `x-api-key`（也支持 query 参数 `api_key`）
- 用户标识：query 参数 `user_id`，或请求体中的 `userId`（二者同时存在时以 query 的 `user_id` 为准）

## 4. 请求方式

只支持 `POST`。

```http
Content-Type: application/json
x-api-key: your-secret-key-here
```

## 5. 请求参数

### 5.1 公共参数

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `userId` | `number` | 是 | 用户 ID（也可用 query `user_id`） |
| `mode` | `string` | 是 | 检索模式：`semantic` / `keyword` / `hybrid` / `related` |
| `limit` | `number` | 否 | 返回数量（须为正整数），**默认 20** |
| `offset` | `number` | 否 | 偏移量，用于分页（须 ≥ 0） |
| `minScore` | `number` | 否 | 最低**最终得分**过滤，取值 `0~1`；缺省不过滤 |
| `semanticWeight` | `number` | 否 | 语义权重，主要用于 `hybrid` |
| `keywordWeight` | `number` | 否 | 关键词权重，主要用于 `hybrid` |
| `normalizeScores` | `boolean` | 否 | 是否归一化语义分数 |
| `fallbackEnabled` | `boolean` | 否 | `hybrid` 模式下是否启用回退 |
| `useCache` | `boolean` | 否 | `related` 模式下是否优先使用缓存 |
| `refreshCache` | `boolean` | 否 | `related` 模式下是否强制刷新缓存 |

### 5.2 `minScore` 说明

`minScore` 按返回值里的 **`score`（最终得分）** 在**分页前**过滤，因此 `data.total` 与分页都会基于过滤后的集合。

注意 `score` 的口径**随模式变化**，所以同一个阈值在不同模式下效果差异很大：

| 模式 | `score` 含义 | 典型范围 |
| --- | --- | --- |
| `hybrid` / `semantic`（走了 JEV 精排） | JEV 综合分（`SEARCH_JEV_WEIGHT=1` 时） | 偏低，实测一条主题相关查询 `max≈0.91`、`mean≈0.22` |
| `semantic`（未走 JEV）/ `hybrid` 回退 | 归一化向量分融合 | `0~1` |
| `keyword` | 标题匹配分 | 基本为 `0.7` / `1.0` |
| `related` | 相关文章分 | `0~1` |

因此**没有默认 `minScore`**：是否过滤、阈值多少由调用方按场景决定（例如 `minScore: 0.3`）。

### 5.3 按模式区分的必填参数

| 模式 | 必填 |
| --- | --- |
| `semantic` | `query` |
| `keyword` | `query` |
| `hybrid`（或 `mixed`） | `query` |
| `related` | `articleId` |

## 6. 请求体示例

```json
{
  "userId": 1,
  "mode": "hybrid",
  "query": "digital humanities",
  "limit": 20,
  "offset": 0,
  "minScore": 0.3,
  "semanticWeight": 0.7,
  "keywordWeight": 0.3,
  "normalizeScores": true,
  "fallbackEnabled": true
}
```

```json
{
  "userId": 1,
  "mode": "related",
  "articleId": 123,
  "limit": 5,
  "useCache": true,
  "refreshCache": false
}
```

## 7. 响应约定（统一信封）

**所有响应（成功与失败）都使用同一层信封**，agent 无需猜测结构：

```json
{
  "ok": true,
  "code": "SEARCH_COMPLETED",
  "message": "检索完成，共 3 条结果",
  "retryable": false,
  "data": { "...": "成功时的结构化结果，失败时为 null" },
  "details": null
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ok` | `boolean` | 请求是否成功完成。`false` 时 `data` 必为 `null`，原因见 `code` / `message` |
| `code` | `string` | 机器可读的稳定状态码，可枚举（见第 9 节） |
| `message` | `string` | 人类可读说明 |
| `retryable` | `boolean` | 失败是否可能通过重试恢复；成功时恒为 `false` |
| `data` | `object \| null` | 成功时的结构化结果，失败时为 `null` |
| `details` | `object \| null` | 诊断上下文（失败时的 `userId` / `requiredAction` / `reason` 等），无则为 `null` |

> `ok = true` 仅表示「请求被正确处理」。即使没有命中结果，也是 `ok = true` + `code = SEARCH_NO_RESULTS`。

## 8. `data` 结构（成功时）

```json
{
  "mode": "hybrid",
  "query": "digital humanities",
  "total": 3,
  "page": 1,
  "limit": 10,
  "cached": false,
  "fallback": false,
  "rerank": "jev",
  "results": [
    {
      "articleId": 123,
      "score": 0.93,
      "semanticScore": 0.91,
      "keywordScore": 0.8,
      "jevScore": 0.88,
      "relevanceLevel": 3,
      "ranked": true,
      "metadata": {
        "title": "Example Title",
        "url": "https://example.com/article",
        "summary": null,
        "published_at": "2026-04-10T08:00:00.000Z",
        "source_origin": "journal",
        "rss_source_name": null,
        "journal_name": "Journal of Example",
        "keyword_name": null
      }
    }
  ]
}
```

### 8.1 顶层字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `mode` | `string` | 实际执行的检索模式 |
| `query` | `string \| null` | 查询词；`related` 模式通常为 `null` |
| `total` | `number` | 结果总数 |
| `page` | `number \| null` | 当前页码 |
| `limit` | `number \| null` | 本次限制返回条数（默认 20） |
| `cached` | `boolean` | 是否命中缓存，主要用于 `related` |
| `fallback` | `boolean` | 是否发生回退，主要用于 `hybrid` |
| `rerank` | `string \| null` | 本次实际使用的精排方式：`jev` / `rerank` / `vector` |
| `results` | `array` | 检索结果列表 |

### 8.2 `results[]` 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `articleId` | `number` | 文章 ID |
| `score` | `number` | 最终得分 |
| `semanticScore` | `number` | 语义得分，部分模式下存在 |
| `keywordScore` | `number` | 关键词得分，部分模式下存在 |
| `jevScore` | `number` | JEV 精排综合分 `0-1`（未走 JEV 时缺省） |
| `relevanceLevel` | `number \| null` | JEV 档位 `0-4`（未走 JEV 时为 `null`） |
| `ranked` | `boolean` | 是否经过 JEV/rerank 判分；`false` 表示回退向量分，建议沉底 |
| `metadata.title` | `string` | 标题 |
| `metadata.url` | `string` | 原文链接 |
| `metadata.summary` | `string \| null` | 摘要 |
| `metadata.published_at` | `string \| null` | 发布时间 |
| `metadata.source_origin` | `string` | 来源类型：`rss` / `journal` / `keyword` / `email` / `web` |
| `metadata.rss_source_name` | `string` | RSS 源名称 |
| `metadata.journal_name` | `string` | 期刊名称 |
| `metadata.keyword_name` | `string` | 关键词订阅名称 |

## 9. 状态码总表

### 9.1 成功（`ok = true`，HTTP 200）

| `code` | 含义 |
| --- | --- |
| `SEARCH_COMPLETED` | 检索完成，`data.total > 0` |
| `SEARCH_NO_RESULTS` | 检索成功，但没有匹配结果，`data.total = 0` |

### 9.2 失败（`ok = false`，`data = null`）

| `code` | HTTP | `retryable` | 含义 |
| --- | --- | --- | --- |
| `INVALID_JSON_BODY` | 400 | `false` | 请求体不是合法 JSON（由 body 解析层返回） |
| `MISSING_USER_ID` | 400 | `false` | 缺少 `user_id` / `userId` |
| `INVALID_USER_ID` | 400 | `false` | `user_id` 不是合法数字 |
| `INVALID_MODE` | 400 | `false` | `mode` 缺失或非法 |
| `MISSING_QUERY` | 400 | `false` | `semantic` / `keyword` / `hybrid` 模式缺少 `query` |
| `MISSING_ARTICLE_ID` | 400 | `false` | `related` 模式缺少 `articleId` |
| `INVALID_LIMIT` | 400 | `false` | `limit` 不是正整数 |
| `INVALID_OFFSET` | 400 | `false` | `offset` 小于 0 |
| `INVALID_MIN_SCORE` | 400 | `false` | `minScore` 不在 `0~1` |
| `MISSING_API_KEY` | 401 | `false` | 未提供 `x-api-key` / `api_key` |
| `INVALID_API_KEY` | 401 | `false` | `api_key` 与服务端 `CLI_API_KEY` 不一致 |
| `USER_NOT_FOUND` | 404 | `false` | `user_id` 对应的用户不存在 |
| `CLI_API_KEY_NOT_CONFIGURED` | 500 | `false` | 服务端未配置 `CLI_API_KEY`（`details.requiredAction = configure_cli_api_key`） |
| `INTERNAL_ERROR` | 500 | `true` | 服务端异常，`details.reason` 为原始错误信息 |

> 说明：统一检索服务内部对部分检索失败会兜底返回空结果，因此某些底层检索异常
> 外部看到的可能是 `200 + SEARCH_NO_RESULTS`；`hybrid` 模式下语义检索失败且启用回退时，
> 会看到 `data.fallback = true`。

## 10. 调用示例

### 10.1 curl：混合检索

```bash
curl -X POST "http://localhost:8007/api/external/search" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-key-here" \
  -d '{
    "userId": 1,
    "mode": "hybrid",
    "query": "machine learning",
    "limit": 10,
    "semanticWeight": 0.7,
    "keywordWeight": 0.3,
    "normalizeScores": true,
    "fallbackEnabled": true
  }'
```

### 10.2 curl：相关文章

```bash
curl -X POST "http://localhost:8007/api/external/search" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-key-here" \
  -d '{
    "userId": 1,
    "mode": "related",
    "articleId": 123,
    "limit": 5,
    "useCache": true
  }'
```

### 10.3 JavaScript

```javascript
async function searchArticles() {
  const response = await fetch('http://localhost:8007/api/external/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'your-secret-key-here'
    },
    body: JSON.stringify({
      userId: 1,
      mode: 'hybrid',
      query: 'large language model',
      limit: 10,
      offset: 0,
      semanticWeight: 0.7,
      keywordWeight: 0.3,
      normalizeScores: true,
      fallbackEnabled: true
    })
  });

  const body = await response.json();
  if (!body.ok) {
    // 按 code 分支处理
    if (body.code === 'INVALID_API_KEY') { /* 检查密钥 */ }
    throw new Error(`${body.code}: ${body.message}`);
  }
  return body.data; // { mode, total, results, ... }
}
```

### 10.4 Python

```python
import requests

url = "http://localhost:8007/api/external/search"
headers = {
    "Content-Type": "application/json",
    "x-api-key": "your-secret-key-here"
}
payload = {
    "userId": 1,
    "mode": "hybrid",
    "query": "information retrieval",
    "limit": 10,
    "offset": 0,
    "semanticWeight": 0.7,
    "keywordWeight": 0.3,
    "normalizeScores": True,
    "fallbackEnabled": True
}

response = requests.post(url, headers=headers, json=payload, timeout=60)
body = response.json()

if not body["ok"]:
    raise RuntimeError(f'{body["code"]}: {body["message"]}')

data = body["data"]
print(data["total"])
for item in data["results"]:
    print(item["articleId"], item["score"], item.get("metadata", {}).get("title"))
```

## 11. 分页说明

接口采用 `limit + offset` 方式分页：

- 第 1 页：`limit = 10`, `offset = 0`
- 第 2 页：`limit = 10`, `offset = 10`
- 第 3 页：`limit = 10`, `offset = 20`

若使用页码分页，自行换算：`offset = (page - 1) * limit`。

## 12. 各模式使用建议

| 模式 | 适合场景 | 示例 |
| --- | --- | --- |
| `semantic` | 自然语言提问、主题相关性搜索、不确定关键词 | “图书馆学中知识组织的最新研究” |
| `keyword` | 精确术语匹配、标题关键词、对性能要求高 | `RAG`、`knowledge graph`、`metadata` |
| `hybrid` | 通用搜索，兼顾语义召回与关键词命中（推荐默认） | “大模型在情报分析中的应用” |
| `related` | 文章详情页相关推荐、基于已有文章的相似内容 | `articleId: 123` |

## 13. 兼容性说明

- `mode` 的 `hybrid` 与 `mixed` 等价，建议新项目统一用 `hybrid`。
- `userId` 可放在请求体或 query `user_id`；两者同时存在时以 query 的 `user_id` 为准。

## 14. 给 agent 的接入建议

1. **只看 `ok` 判断成败**，再看 `code` 做分支；不要依赖 `message` 文案。
2. `retryable = true`（`INTERNAL_ERROR`）可退避重试；其余为输入 / 鉴权 / 配置问题，重试无用。
3. 建议默认使用 `hybrid`；搜索列表用 `limit + offset` 分页（`limit` 不传为 20）；文章详情相关推荐用 `related`。
4. 需要相关性门槛时显式传 `minScore`（按最终得分过滤，分页前生效）；注意 `score` 口径随模式变化，阈值建议先在真实数据上验证。
5. 对 `data.fallback`、`data.cached`、`data.rerank` 做埋点或日志，便于观测检索退化。
6. 对空结果（`SEARCH_NO_RESULTS`）与超时做单独处理。

## 15. 版本说明

当前接口入口：

```text
POST /api/external/search
```

后续新增筛选条件或开放更多能力时，建议在该路径下做兼容扩展，尽量不破坏现有请求结构。
