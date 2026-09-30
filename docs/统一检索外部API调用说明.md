# 统一检索外部 API 调用说明

本文档说明如何从外部项目 / Agent 调用 LIS-RSS 的统一检索接口。

对应实现：

- 接口：`POST /api/external/search`
- 路由：`src/api/routes/external-search.routes.ts`
- 鉴权与用户解析：`src/api/external-auth.ts`
- 响应信封：`src/api/external-api-response.ts`

这个接口是在现有统一检索服务之上的一层 HTTP 封装，不影响站内搜索页面和原有内部接口。

---

## 1. 核心设计原则

1. **用户标识双轨兼容**：请求中同时支持 `username`（用户名，推荐）或 `userId`（数字主键），服务端自动映射解析。
2. **默认返回 5 条（`limit = 5`）**：贴合大模型黄金阅读窗口，单次输出极小，杜绝 CLI / Subprocess 管道 40KB~64KB stdout 截断。
3. **字段稠密度治理（`fields: "core"`）**：默认剔除摘要等长文本与无效占位，保持语义纯净防幻觉。
4. **统一信封**：所有响应结构一致，机器可读稳定状态码。

支持 4 种检索模式：

- `semantic`：语义检索（基于向量相似度）
- `keyword`：关键词检索（基于 SQL LIKE 精准匹配）
- `hybrid`：混合检索（语义 + 关键词加权融合，兼容写法 `mixed`）
- `related`：相关文章推荐（必填 `articleId`）

---

## 2. 请求地址与鉴权

```http
POST http://localhost:8007/api/external/search
Content-Type: application/json
x-api-key: your-secret-api-key
```

- 服务端需配置环境变量：`CLI_API_KEY=your-secret-api-key`
- 客户端在 Header 携带 `x-api-key`（或 query 参数 `api_key`）。

---

## 3. 请求参数

### 3.1 公共参数

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :---: | :---: | :--- |
| `username` | `string` | 条件必填 | - | 用户名（推荐，如 `"alice"`），与 `userId` 二选一 |
| `userId` | `number` | 条件必填 | - | 用户数据库 ID，与 `username` 二选一 |
| `mode` | `string` | 是 | - | 检索模式：`semantic` / `keyword` / `hybrid` / `related` |
| `limit` | `number` | 否 | `5` | 返回数量（正整数，最大 `100`） |
| `offset` | `number` | 否 | `0` | 分页偏移量（非负整数） |
| `fields` | `string` | 否 | `"core"` | 字段集：`"core"`（轻量纯净）或 `"full"`（含长文本） |
| `minScore` | `number` | 否 | - | 最低最终得分过滤，取值 `0~1`；缺省不过滤 |
| `semanticWeight` | `number` | 否 | `0.7` | 语义权重，主要用于 `hybrid` |
| `keywordWeight` | `number` | 否 | `0.3` | 关键词权重，主要用于 `hybrid` |
| `normalizeScores` | `boolean` | 否 | `true` | 是否归一化语义分数 |
| `fallbackEnabled` | `boolean` | 否 | `true` | `hybrid` 模式下是否启用回退 |
| `useCache` | `boolean` | 否 | `true` | `related` 模式下是否优先使用缓存 |
| `refreshCache` | `boolean` | 否 | `false` | `related` 模式下是否强制刷新缓存 |

### 3.2 按模式区分的必填参数

| 模式 | 必填字段 |
| :--- | :--- |
| `semantic` | `query` |
| `keyword` | `query` |
| `hybrid`（或 `mixed`） | `query` |
| `related` | `articleId` |

---

## 4. 响应约定（统一信封）

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

### 4.1 `data` 结构

```json
{
  "userId": 5,
  "username": "alice",
  "mode": "hybrid",
  "query": "digital humanities",
  "total": 3,
  "limit": 5,
  "offset": 0,
  "returned": 3,
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
        "published_at": "2026-04-10T08:00:00.000Z",
        "source_origin": "journal",
        "journal_name": "Journal of Example"
      }
    }
  ]
}
```

---

## 5. 状态码总表

### 5.1 成功（`ok = true`，HTTP 200）

| `code` | 说明 |
| :--- | :--- |
| `SEARCH_COMPLETED` | 检索完成，`data.total > 0` |
| `SEARCH_NO_RESULTS` | 检索成功，但没有匹配结果，`data.total = 0` |

### 5.2 失败（`ok = false`，`data = null`）

| `code` | HTTP | `retryable` | 含义 |
| :--- | :---: | :---: | :--- |
| `MISSING_API_KEY` | 401 | `false` | 未提供 `x-api-key` / `api_key` |
| `INVALID_API_KEY` | 401 | `false` | `api_key` 与服务端不一致 |
| `CLI_API_KEY_NOT_CONFIGURED` | 500 | `false` | 服务端未配置 `CLI_API_KEY` |
| `MISSING_USER_IDENTIFIER` | 400 | `false` | 缺少 `username` 或 `userId` |
| `USER_NOT_FOUND` | 404 | `false` | 对应的用户名或用户 ID 不存在 |
| `INVALID_USER_ID` | 400 | `false` | `userId` 不是合法正整数 |
| `INVALID_MODE` | 400 | `false` | `mode` 缺失或非法 |
| `MISSING_QUERY` | 400 | `false` | `semantic` / `keyword` / `hybrid` 缺少 `query` |
| `MISSING_ARTICLE_ID` | 400 | `false` | `related` 模式缺少 `articleId` |
| `INVALID_LIMIT` | 400 | `false` | `limit` 不是正整数 |
| `INVALID_OFFSET` | 400 | `false` | `offset` 小于 0 |
| `INVALID_MIN_SCORE` | 400 | `false` | `minScore` 不在 `0~1` |
| `INTERNAL_ERROR` | 500 | `true` | 服务端异常 |

---

## 6. 调用示例

### 6.1 curl：传用户名检索（默认 5 条精选）

```bash
curl -X POST "http://localhost:8007/api/external/search" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-api-key" \
  -d '{
    "username": "alice",
    "mode": "hybrid",
    "query": "machine learning"
  }'
```

### 6.2 Python

```python
import requests

url = "http://localhost:8007/api/external/search"
headers = {
    "Content-Type": "application/json",
    "x-api-key": "your-secret-api-key"
}
payload = {
    "username": "alice",
    "mode": "hybrid",
    "query": "information retrieval",
    "limit": 5,
    "offset": 0
}

res = requests.post(url, headers=headers, json=payload).json()
if res["ok"]:
    print(f"命中 {res['data']['total']} 条，返回前 {res['data']['returned']} 条：")
    for r in res["data"]["results"]:
        print(r["score"], r["metadata"]["title"])
```
