# 统一检索外部 API 调用说明

本文档说明如何从外部项目调用 LIS-RSS 的统一检索接口。

对应接口实现：

- `POST /api/external/search`
- 路由文件：`src/api/routes/external-search.routes.ts`

这个接口是在现有统一检索服务之上新增的一层 HTTP 封装，不影响站内已有搜索页面和原有接口。

## 1. 接口概览

统一检索外部 API 提供一个统一入口，支持以下 4 种检索模式：

- `semantic`：语义检索
- `keyword`：关键词检索
- `hybrid`：混合检索
- `related`：相关文章推荐

其中：

- `hybrid` 支持语义检索失败后自动回退到关键词检索
- `related` 支持缓存结果
- 返回结构统一，便于外部系统直接接入

## 2. 请求地址

如果服务部署在本机 `8007` 端口，请求地址为：

```text
POST http://localhost:8007/api/external/search
```

如果已经部署到服务器，请将 `localhost:8007` 替换为你的实际服务地址。

## 3. 鉴权方式

该接口复用项目现有的 `CLI_API_KEY` 鉴权机制。

服务端需要配置：

```bash
CLI_API_KEY=your-secret-key-here
```

客户端请求时需要提供：

- 请求头：`x-api-key`
- 用户标识：`userId`

说明：

- 推荐把 `userId` 放在请求体中
- 路由会自动兼容现有鉴权中间件
- 如果同时传了 query 参数 `user_id` 和 body 参数 `userId`，则以 `user_id` 为准

## 4. 请求方式

只支持 `POST`。

请求头：

```http
Content-Type: application/json
x-api-key: your-secret-key-here
```

请求体使用 JSON。

## 5. 请求参数

### 5.1 公共参数

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `userId` | `number` | 是 | 用户 ID |
| `mode` | `string` | 是 | 检索模式：`semantic` / `keyword` / `hybrid` / `related` |
| `limit` | `number` | 否 | 返回数量 |
| `offset` | `number` | 否 | 偏移量，用于分页 |
| `semanticWeight` | `number` | 否 | 语义权重，主要用于 `hybrid` |
| `keywordWeight` | `number` | 否 | 关键词权重，主要用于 `hybrid` |
| `normalizeScores` | `boolean` | 否 | 是否归一化语义分数 |
| `fallbackEnabled` | `boolean` | 否 | `hybrid` 模式下是否启用回退 |
| `useCache` | `boolean` | 否 | `related` 模式下是否优先使用缓存 |
| `refreshCache` | `boolean` | 否 | `related` 模式下是否强制刷新缓存 |

### 5.2 按模式区分的必填参数

#### `semantic`

必填：

- `query`

#### `keyword`

必填：

- `query`

#### `hybrid`

必填：

- `query`

兼容写法：

- `mode: "mixed"` 也会被识别为 `hybrid`

#### `related`

必填：

- `articleId`

## 6. 请求体示例

### 6.1 语义检索

```json
{
  "userId": 1,
  "mode": "semantic",
  "query": "machine learning in library science",
  "limit": 10
}
```

### 6.2 关键词检索

```json
{
  "userId": 1,
  "mode": "keyword",
  "query": "knowledge graph",
  "limit": 20,
  "offset": 0
}
```

### 6.3 混合检索

```json
{
  "userId": 1,
  "mode": "hybrid",
  "query": "digital humanities",
  "limit": 10,
  "offset": 0,
  "semanticWeight": 0.7,
  "keywordWeight": 0.3,
  "normalizeScores": true,
  "fallbackEnabled": true
}
```

### 6.4 相关文章推荐

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

## 7. 返回结构

接口返回统一检索结果结构：

```json
{
  "results": [
    {
      "articleId": 123,
      "score": 0.93,
      "semanticScore": 0.91,
      "keywordScore": 0.8,
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
  ],
  "mode": "hybrid",
  "query": "digital humanities",
  "total": 1,
  "page": 1,
  "limit": 10,
  "cached": false,
  "fallback": false
}
```

### 7.1 顶层字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `results` | `array` | 检索结果列表 |
| `mode` | `string` | 实际执行的检索模式 |
| `query` | `string` | 查询词，`related` 模式通常没有该字段 |
| `total` | `number` | 总结果数 |
| `page` | `number` | 当前页码 |
| `limit` | `number` | 本次限制返回条数 |
| `cached` | `boolean` | 是否命中缓存，主要用于 `related` |
| `fallback` | `boolean` | 是否发生回退，主要用于 `hybrid` |

### 7.2 `results` 字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `articleId` | `number` | 文章 ID |
| `score` | `number` | 最终得分 |
| `semanticScore` | `number` | 语义得分，部分模式下存在 |
| `keywordScore` | `number` | 关键词得分，部分模式下存在 |
| `metadata.title` | `string` | 标题 |
| `metadata.url` | `string` | 原文链接 |
| `metadata.summary` | `string \| null` | 摘要 |
| `metadata.published_at` | `string \| null` | 发布时间 |
| `metadata.source_origin` | `string` | 来源类型：`rss` / `journal` / `keyword` |
| `metadata.rss_source_name` | `string` | RSS 源名称 |
| `metadata.journal_name` | `string` | 期刊名称 |
| `metadata.keyword_name` | `string` | 关键词订阅名称 |

## 8. 调用示例

### 8.1 curl

#### 混合检索

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

#### 相关文章

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

### 8.2 JavaScript

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

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  return data;
}
```

### 8.3 Python

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
response.raise_for_status()
data = response.json()

print(data["total"])
for item in data["results"]:
    print(item["articleId"], item["score"], item.get("metadata", {}).get("title"))
```

## 9. 分页说明

接口采用 `limit + offset` 方式分页。

示例：

- 第 1 页：`limit = 10`, `offset = 0`
- 第 2 页：`limit = 10`, `offset = 10`
- 第 3 页：`limit = 10`, `offset = 20`

如果外部项目使用页码分页，可以自行换算：

```text
offset = (page - 1) * limit
```

返回中的 `page` 字段也是按上述规则计算出来的。

## 10. 各模式使用建议

### `semantic`

适合：

- 自然语言提问
- 主题相关性搜索
- 不确定准确关键词时的检索

示例：

- “图书馆学中知识组织的最新研究”
- “大模型在情报分析中的应用”

### `keyword`

适合：

- 精确术语匹配
- 标题关键词查找
- 对性能要求较高的场景

示例：

- `RAG`
- `knowledge graph`
- `metadata`

### `hybrid`

适合：

- 通用搜索场景
- 既要语义召回又要关键词命中
- 推荐作为外部系统默认模式

### `related`

适合：

- 文章详情页的相关推荐
- 已有文章基础上的相似内容推荐

## 11. 错误响应

### 11.1 参数错误

返回 `400`，例如：

```json
{
  "error": "mode must be one of: semantic, keyword, hybrid, related"
}
```

常见场景：

- 缺少 `mode`
- `mode` 非法
- `related` 模式缺少 `articleId`
- 非 `related` 模式缺少 `query`
- `limit <= 0`
- `offset < 0`

### 11.2 鉴权失败

返回 `401`，例如：

```json
{
  "status": "error",
  "error": "Missing api_key"
}
```

或：

```json
{
  "status": "error",
  "error": "Invalid api_key"
}
```

### 11.3 用户不存在

返回 `404`：

```json
{
  "status": "error",
  "error": "User not found"
}
```

### 11.4 服务端异常

返回 `500`：

```json
{
  "error": "Failed to execute external search"
}
```

补充说明：

- 统一检索服务内部对于部分检索失败会兜底返回空结果，而不是直接抛出异常
- 因此某些底层检索异常，外部看到的可能是 `200 + 空结果`
- `hybrid` 模式下如果语义检索失败且启用了回退，返回中会看到 `fallback: true`

## 12. 兼容性说明

### 12.1 `mode` 兼容值

以下写法等价：

- `hybrid`
- `mixed`

建议新项目统一使用 `hybrid`。

### 12.2 `userId` 传递方式

支持两种方式：

方式 1：放在 body 中，推荐

```json
{
  "userId": 1,
  "mode": "hybrid",
  "query": "test"
}
```

方式 2：放在 query 中

```text
POST /api/external/search?user_id=1
```

如果两者同时存在：

- 优先使用 query 中的 `user_id`

## 13. 接入建议

建议外部项目按以下方式封装：

1. 把服务地址和 `x-api-key` 做成配置项
2. 默认使用 `hybrid` 模式
3. 搜索列表使用 `limit + offset`
4. 文章详情相关推荐使用 `related` 模式
5. 对 `fallback` 和 `cached` 字段做埋点或日志记录
6. 对空结果和超时做单独处理

## 14. 推荐的最小接入方式

如果你只想快速接入，最小必需参数如下：

### 搜索

```json
{
  "userId": 1,
  "mode": "hybrid",
  "query": "your query"
}
```

### 相关文章

```json
{
  "userId": 1,
  "mode": "related",
  "articleId": 123
}
```

## 15. 版本说明

当前文档对应的外部接口版本为当前仓库实现版本，接口入口：

```text
POST /api/external/search
```

后续如果新增筛选条件或开放更多外部能力，建议继续在该路径下做兼容扩展，尽量不要破坏现有请求结构。
