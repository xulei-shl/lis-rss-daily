# 「我的每日」外部 API 调用说明

本文档说明如何从外部项目 / Agent 调用 LIS-RSS 的「我的每日」JEV 评分接口。

对应实现：

- 接口：`POST /api/external/my-daily`
- 全量导出接口：`GET /api/external/my-daily/export`
- 路由：`src/api/routes/external-my-daily.routes.ts`
- 鉴权与用户解析：`src/api/external-auth.ts`
- 响应信封：`src/api/external-api-response.ts`

统一检索（语义 / 关键词 / 混合 / 相关）请参考 `docs/统一检索外部API调用说明.md`。

---

## 1. 核心设计原则（双轨分离与语义纯净）

1. **用户标识双轨兼容**：全面支持传 `username`（账号登录名，推荐）或 `userId`（数字主键），服务端自动映射解析。
2. **安全鉴权**：废除密码传递，统一使用 Header `x-api-key`，便于集中鉴权。
3. **低 Token 感知轨（默认）**：
   - 默认仅返回 **5 条**最相关文献（`limit = 5`）；
   - 默认排除长摘要（`fields: "core"`），单次响应严格压缩在 **1KB 级别**，杜绝 CLI / Subprocess 管道 40KB~64KB stdout 截断崩溃。
4. **全量留存轨（文件导出直链）**：
   - 响应信封附带 `exportUrl` 直链，并支持入参 `format: "json_file"`；
   - 包含中英文完整摘要与所有明细，按需生成文件附件下载，大模型零 Token 负担沉淀全量文献。
5. **语义纯净防幻觉**：
   - 服务端自动剔除 `failed: true`（打分占位 0 分）的垃圾条目；
   - 剥离平台内部流转状态，只输出学术文献本身的客观元数据属性。

---

## 2. 鉴权方式

复用服务端 `CLI_API_KEY` 机制。服务端配置环境变量：

```bash
CLI_API_KEY=your-secret-api-key
```

客户端在请求头中携带：

```http
x-api-key: your-secret-api-key
```

*(也支持 query 参数 `api_key=your-secret-api-key`)*

---

## 3. 请求约定（POST /api/external/my-daily）

```http
POST /api/external/my-daily
Content-Type: application/json
x-api-key: your-secret-api-key
```

### 请求体参数

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :---: | :---: | :--- |
| `username` | `string` | 条件必填 | - | 用户名（如 `"alice"`），与 `userId` 二选一（推荐） |
| `userId` | `number` | 条件必填 | - | 用户数据库自增 ID，与 `username` 二选一 |
| `date` | `string` | 否 | 当天 | 评分日期 `YYYY-MM-DD`，默认为用户时区下的当天 |
| `minScore` | `number` | 否 | - | 最低综合相关度过滤（`0~1`），如 `0.7` 仅看高度相关，`0.3` 看中度以上 |
| `limit` | `number` | 否 | `5` | 返回条数（正整数，最大 `100`） |
| `offset` | `number` | 否 | `0` | 分页偏移量（非负整数） |
| `fields` | `string` | 否 | `"core"` | 字段稠密度：`"core"`（轻量感知，无长摘要）或 `"full"`（含长摘要） |
| `format` | `string` | 否 | `"json"` | 输出格式：`"json"`（标准信封）或 `"json_file"`（直接下载全量 JSON 文件） |

---

## 4. 响应约定（统一信封）

所有响应均包装在标准统一信封中：

```json
{
  "ok": true,
  "code": "RESULT_CACHED",
  "message": "该日期（2026-09-30）已有评分结果，直接返回缓存",
  "retryable": false,
  "data": { "...": "成功时的结构化数据，失败时为 null" },
  "details": { "userId": 5, "username": "alice", "date": "2026-09-30", "execution": { "...": "..." } }
}
```

### 4.1 成功响应 `data` 结构

```json
{
  "userId": 5,
  "username": "alice",
  "date": "2026-09-30",
  "minScore": 0.3,
  "total": 108,
  "limit": 5,
  "offset": 0,
  "returned": 5,
  "exportUrl": "/api/external/my-daily/export?username=alice&date=2026-09-30&minScore=0.3",
  "articles": [
    {
      "id": 1024,
      "title": "基于大语言模型的图情学术知识组织研究",
      "title_zh": "基于大语言模型的图情学术知识组织研究",
      "relevance_score": 0.88,
      "relevance_level": "high",
      "matched_domain": "知识组织与大模型",
      "source_origin": "journal",
      "published_at": "2026-09-30T01:00:00.000Z",
      "url": "https://example.com/article/1024"
    }
  ]
}
```

#### `articles[]` 字段说明

| 字段 | 类型 | core 模式 | full 模式 | 说明 |
| :--- | :--- | :---: | :---: | :--- |
| `id` | `number` |  |  | 文章 ID |
| `title` | `string` |  |  | 原文标题 |
| `title_zh` | `string \| null` |  |  | 中文翻译标题 |
| `relevance_score` | `number` |  |  | JEV 综合相关性评分（`0~1`） |
| `relevance_level` | `string` |  |  | 分档：`high` (≥0.7)、`medium` (≥0.3)、`low` |
| `matched_domain` | `string \| null` |  |  | 命中的主题领域名称 |
| `source_origin` | `string \| null` |  |  | 来源类型：`journal` / `rss` / `keyword` / `email` / `web` |
| `published_at` | `string \| null` |  |  | 发布时间 |
| `url` | `string \| null` |  |  | 原文链接 |
| `summary` | `string \| null` | ❌ 剔除 |  | 原文摘要 |
| `summary_zh` | `string \| null` | ❌ 剔除 |  | 中文摘要 |
| `filter_status` | `string \| null` | ❌ 剔除 |  | 预过滤状态 |
| `created_at` | `string \| null` | ❌ 剔除 |  | 入库时间 |

---

## 5. 全量数据导出（留存轨）

当 Agent 或用户需要下载当天完整文献明细（包含完整摘要）时，可通过以下两种方式之一获取：

### 方式 1：直接调用 `exportUrl` 直链
```http
GET /api/external/my-daily/export?username=alice&date=2026-09-30
x-api-key: your-secret-api-key
```
服务端直接以附件形式输出全量 JSON 文件流：`Content-Disposition: attachment; filename="my-daily-alice-2026-09-30.json"`。

### 方式 2：在 POST 请求中传 `format: "json_file"`
```bash
curl -X POST "http://localhost:8007/api/external/my-daily" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-api-key" \
  -d '{ "username": "alice", "date": "2026-09-30", "format": "json_file" }' \
  -o daily_full.json
```

---

## 6. 状态码总表

### 6.1 成功状态码（`ok = true`, HTTP 200）

| `code` | 说明 |
| :--- | :--- |
| `RESULT_CACHED` | 该日期此前已有评分结果，直接返回缓存 |
| `RESULT_SCORED` | 本次触发评分排队并已完成打分，返回新结果 |
| `NO_ARTICLES_FOR_DATE` | 该日期没有新增文章，无需评分（`data.returned = 0`） |

### 6.2 失败状态码（`ok = false`, `data = null`）

| `code` | HTTP | `retryable` | 含义与处置动作 |
| :--- | :---: | :---: | :--- |
| `MISSING_API_KEY` | 401 | `false` | 未提供 `x-api-key` / `api_key` |
| `INVALID_API_KEY` | 401 | `false` | API Key 不正确 |
| `CLI_API_KEY_NOT_CONFIGURED` | 500 | `false` | 服务端未配置 `CLI_API_KEY` 环境变量 |
| `MISSING_USER_IDENTIFIER` | 400 | `false` | 未提供 `username` 或 `userId` |
| `USER_NOT_FOUND` | 404 | `false` | 指定的用户名或用户 ID 不存在 |
| `INVALID_USER_ID` | 400 | `false` | `userId` 不是合法正整数 |
| `FORBIDDEN_ROLE` | 403 | `false` | 用户角色不是 `user` / `admin` |
| `INVALID_LIMIT` | 400 | `false` | `limit` 不是正整数 |
| `INVALID_OFFSET` | 400 | `false` | `offset` 小于 0 |
| `INVALID_DATE_FORMAT` | 400 | `false` | `date` 不是合法的 `YYYY-MM-DD` |
| `INVALID_MIN_SCORE` | 400 | `false` | `minScore` 不在 `0~1` 范围内 |
| `NO_TOPIC_CONFIGURED` | 400 | `false` | 用户未配置主题领域，需在系统前端配置 |
| `JEV_NOT_CONFIGURED` | 503 | `false` | 服务端未配置 JEV LLM 密钥 |
| `SCORING_IN_PROGRESS` | 409 | `true` | 该日期评分任务正在执行中，稍后重试即可读取缓存 |
| `SCORING_QUEUE_FULL` | 429 | `true` | 排队任务队列已满，稍后重试 |
| `SCORING_QUEUE_TIMEOUT` | 429 | `true` | 排队等待超时，稍后重试 |
| `INTERNAL_ERROR` | 500 | `true` | 服务端内部异常 |

---

## 7. 调用示例

### 7.1 curl：查询今天推荐文献（默认 5 条精选）

```bash
curl -X POST "http://localhost:8007/api/external/my-daily" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-api-key" \
  -d '{
    "username": "alice",
    "minScore": 0.3
  }'
```

### 7.2 Python：Agent 编排双轨消费

```python
import requests

API_URL = "http://localhost:8007/api/external/my-daily"
HEADERS = {
    "Content-Type": "application/json",
    "x-api-key": "your-secret-api-key"
}

# 1. 感知轨：获取 5 条高相关核心预览喂给大模型
resp = requests.post(API_URL, headers=HEADERS, json={
    "username": "alice",
    "minScore": 0.5
})
res_json = resp.json()

if not res_json["ok"]:
    raise RuntimeError(f"Error: {res_json['code']} - {res_json['message']}")

data = res_json["data"]
print(f"总计命中 {data['total']} 篇，本次返回前 {data['returned']} 篇精选预览：")
for art in data["articles"]:
    print(f"- [{art['relevance_level']}] {art['title']} (分值: {art['relevance_score']})")

# 2. 留存轨：将全量导出直链输出给用户或下载落盘
print(f"\n全量数据导出直链: {data['exportUrl']}")
```
