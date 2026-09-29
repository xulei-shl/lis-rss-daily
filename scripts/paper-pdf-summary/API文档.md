# Paper PDF Summary API 接口文档

> 论文 PDF 摘要工作流 API，支持 PDF 下载 → 总结 → 并行上传到多个平台，以及直接文本上传。

- **服务地址**: `http://<服务器IP>:8081`
- **基础路径**: `/`
- **认证**: 无（局域网内调用，如需保护建议前置反向代理）
- **响应格式**: JSON

---

## 端点一览

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/process` | 提交论文全文处理请求（默认阻塞等待完成；`wait=false` 时异步提交，立即返回 `task_id`） |
| `GET`  | `/process/status/{task_id}` | 查询异步任务实时状态（心跳/进度轮询） |
| `POST` | `/upload-text` | 直接上传文本内容到所有平台（无需 PDF 下载和总结） |
| `GET`  | `/health` | 健康检查 + 队列状态 |

---

## 1. 提交处理请求

```
POST /process
```

### 请求体

```json
{
  "title": "面向数字图书馆的智能检索技术研究",
  "id": 42,
  "push_wechat": false
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `title` | `string` | **是** | — | 论文标题，用作 PDF 下载搜索关键词 |
| `id` | `int` | 否 | `null` | LIS-RSS 文章 ID。提供则更新对应文章摘要；`null`/`0` 则跳过 LIS-RSS 回写 |
| `push_wechat` | `bool` | 否 | `false` | 是否强制推送企业微信（默认取环境变量 `PDF_SUMMARY_PUSH_WECHAT`） |
| `push_hiagent` | `bool` | 否 | `null` | 是否上传到 HiAgent RAG。`null` 沿用 config 配置；`true` 强制上传；`false` 强制跳过 |
| `push_memos` | `bool` | 否 | `null` | 是否上传到 Memos。`null` 沿用 config 配置；`true` 强制上传；`false` 强制跳过 |
| `push_blinko` | `bool` | 否 | `null` | 是否上传到 Blinko。`null` 沿用 config 配置；`true` 强制上传；`false` 强制跳过 |
| `wait` | `bool` | 否 | `true` | `true` 阻塞等待工作流完成后返回结果；`false` 异步模式，立即返回 `task_id`，配合 `GET /process/status/{task_id}` 轮询（适合 agent 调用，避免长时间阻塞被误判为卡死） |

### 响应（200，默认阻塞模式）

```json
{
  "success": true,
  "article_id": 42,
  "md_path": "/opt/lis-rss-daily/scripts/paper-pdf-summary/download/2026-05-25/xxx.md",
  "md_content": "# 摘要标题\n\n摘要正文...",
  "stages": {
    "pdf_download": "success",
    "pdf_validate": "success",
    "pdf_summary": "success",
    "upload": {
      "hiagent_rag": true,
      "lis_rss": true,
      "memos": true,
      "blinko": true,
      "wechat": false,
      "_skipped": ["wechat"]
    }
  },
  "reason": null
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | `bool` | 工作流整体是否成功（至少一个上传目标成功即视为成功） |
| `article_id` | `int` / `null` | 文章 ID（回显） |
| `md_path` | `string` / `null` | 生成的摘要 Markdown 文件路径 |
| `md_content` | `string` / `null` | 摘要 Markdown 原文内容（可直接使用，无需再通过路径读取） |
| `stages` | `object` | 各阶段详细结果 |
| `reason` | `string` / `null` | 失败原因（成功时为 `null`） |

### `stages` 字段说明

| 阶段 | 说明 | 成功值 | 失败值 |
|------|------|--------|--------|
| `pdf_download` | PDF 下载（按优先级依次尝试 知社科 → 万方 → CNKI） | `"success"` | `"failed"` |
| `pdf_validate` | PDF 文件名与标题匹配校验 | `"success"` | `"failed"` |
| `pdf_summary` | HiAgent 生成 AI 摘要 | `"success"` | `"failed"` |
| `upload` | 并行上传结果（详见下） | `object` | `{"error": "..."}` |

## 2. 查询任务状态（心跳轮询）

```
GET /process/status/{task_id}
```

查询 `POST /process`（`wait=false`）提交的任务的实时状态。轮询间隔建议 **5-10 秒**。

### 响应（200，任务进行中）

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "面向数字图书馆的智能检索技术研究",
  "status": "running",
  "stage": "pdf_summary",
  "elapsed_seconds": 95.3,
  "queue_wait_seconds": null,
  "queued_at": 1769700000.123,
  "finished_at": null,
  "result": null
}
```

### 响应（200，任务完成）

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "面向数字图书馆的智能检索技术研究",
  "status": "completed",
  "stage": "upload",
  "elapsed_seconds": 132.6,
  "queue_wait_seconds": null,
  "queued_at": 1769700000.123,
  "finished_at": 1769700132.7,
  "result": {
    "success": true,
    "article_id": 42,
    "md_path": "/opt/lis-rss-daily/scripts/paper-pdf-summary/download/2026-05-25/xxx.md",
    "md_content": "# 摘要标题\n\n摘要正文...",
    "stages": { "...": "与阻塞模式响应中的 stages 结构一致" },
    "reason": null
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | `string` | `queued` 排队中 → `running` 处理中 → `completed` / `failed` |
| `stage` | `string` | 处理中的具体阶段：`pdf_download` → `pdf_validate` → `pdf_summary` → `pdf_summary_check` → `upload`；排队时为 `queued` |
| `elapsed_seconds` | `float` / `null` | 任务开始处理至今（或至完成）的秒数；未开始时为 `null` |
| `queue_wait_seconds` | `float` / `null` | 排队已等待秒数（仅 `status=queued` 时有值） |
| `queued_at` / `finished_at` | `float` / `null` | 提交 / 完成的 Unix 时间戳 |
| `result` | `object` / `null` | 完成后为完整工作流结果（与阻塞模式响应结构一致）；未完成时为 `null` |

### 响应（404）

```json
{
  "detail": "Task not found or expired"
}
```

> 任务完成后结果保留 **5 分钟**（TTL）供轮询读取，过期后返回 404。服务重启后任务状态丢失（内存队列）。

## 3. `upload` 上传结果

| 子字段 | 类型 | 说明 |
|--------|------|------|
| `hiagent_rag` | `bool` | 上传到 HiAgent RAG 知识库 |
| `lis_rss` | `bool` | 更新 LIS-RSS 文章摘要（仅 `id` 有效时） |
| `memos` | `bool` | 发布到 Memos（带 `#bot #AI速读` 标签） |
| `blinko` | `bool` | 发布到 Blinko（带 `bot` / `AI速读` 标签） |
| `wechat` | `bool` | 推送企业微信 |
| `_skipped` | `string[]` | 被跳过的子系统列表（如 `["lis_rss"]`） |

### 响应（200，异步模式 `wait=false`）

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "queue_size": 0,
  "duplicate": false
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `task_id` | `string` | 任务 ID，用于轮询 `GET /process/status/{task_id}` |
| `queue_size` | `int` | 提交时队列中等待的任务数 |
| `duplicate` | `bool` | 是否命中在途任务去重：相同标题（忽略大小写/首尾空白）已有排队或处理中的任务时，不重复执行，直接返回现有 `task_id` 并标记 `duplicate=true` |

### 响应（500 — 处理异常，仅阻塞模式）

```json
{
  "detail": "PDF下载失败（所有脚本均失败）"
}
```

```json
{
  "detail": "PDF总结失败（生成的摘要包含错误信息，可能是PDF损坏或无法读取）"
}
```

---

## 4. 直接上传文本

```
POST /upload-text
```

直接传入 Markdown 文本内容，并行上传到所有子系统（HiAgent RAG / LIS-RSS / Memos / Blinko / 企业微信），无需经历 PDF 下载和总结流程。

### 请求体

```json
{
  "content": "# 摘要标题\n\n摘要正文...",
  "title": "面向数字图书馆的智能检索技术研究",
  "id": 42,
  "source_name": "知社科",
  "push_wechat": false
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `content` | `string` | **是** | — | Markdown 文本内容（直接上传，不用文件路径） |
| `title` | `string` | **是** | — | 文章标题，用于 Memos/Blinko/企业微信消息展示 |
| `id` | `int` | 否 | `null` | LIS-RSS 文章 ID。提供则更新对应文章摘要；`null`/`0` 则跳过 LIS-RSS 回写 |
| `source_name` | `string` | 否 | `null` | 来源名称（仅企业微信消息中展示，其余平台忽略） |
| `push_wechat` | `bool` | 否 | `false` | 是否强制推送企业微信（默认取环境变量 `PDF_SUMMARY_PUSH_WECHAT`） |
| `push_hiagent` | `bool` | 否 | `null` | 是否上传到 HiAgent RAG。`null` 沿用 config；`true` 强制上传；`false` 强制跳过 |
| `push_memos` | `bool` | 否 | `null` | 是否上传到 Memos。`null` 沿用 config；`true` 强制上传；`false` 强制跳过 |
| `push_blinko` | `bool` | 否 | `null` | 是否上传到 Blinko。`null` 沿用 config；`true` 强制上传；`false` 强制跳过 |

### 响应（200）

```json
{
  "success": true,
  "article_id": 42,
  "title": "面向数字图书馆的智能检索技术研究",
  "stages": {
    "upload": {
      "hiagent_rag": true,
      "lis_rss": true,
      "memos": true,
      "blinko": true,
      "wechat": false,
      "_skipped": ["wechat"]
    }
  },
  "reason": null
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | `bool` | 是否至少一个上传目标成功 |
| `article_id` | `int` / `null` | 文章 ID（回显） |
| `title` | `string` | 文章标题（回显） |
| `stages` | `object` | 仅包含 `upload` 字段，结构与 `/process` 响应中的 `upload` 一致 |
| `reason` | `string` / `null` | 失败原因（成功时为 `null`） |

> `upload` 子字段定义与 [`/process` 的 `upload` 结果](#upload-上传结果) 完全一致。

### 响应（500 — 处理异常）

```json
{
  "detail": "所有上传任务均失败"
}
```

---

## 5. 健康检查

```
GET /health
```

### 响应

```json
{
  "status": "ok",
  "queue_size": 0
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | `string` | `"ok"` 表示服务正常运行 |
| `queue_size` | `int` | 当前队列中等待处理的任务数 |

---

## 工作流说明

### `/process` — 完整工作流

```
title
  │
  ▼
┌─────────────────────────────────┐
│ ① PDF 下载                      │
│    优先级: 知社科 → 万方 → CNKI  │
│    保存到: download/YYYY-MM-DD/  │
└─────────────────────────────────┘
  │ (成功)
  ▼
┌─────────────────────────────────┐
│ ② 文件名匹配校验                 │
│    检查 PDF 文件名是否匹配标题    │
└─────────────────────────────────┘
  │ (成功)
  ▼
┌─────────────────────────────────┐
│ ③ HiAgent PDF 摘要生成          │
│    使用 Playwright 上传 + 提取   │
│    输出: 与 PDF 同名的 .md 文件  │
└─────────────────────────────────┘
  │ (成功)
  ▼
┌─────────────────────────────────┐
│ ④ 并行上传（asyncio.gather）    │
│    ├─ HiAgent RAG 知识库        │
│    ├─ LIS-RSS 文章摘要更新      │
│    ├─ Memos（#bot #AI速读）      │
│    ├─ Blinko（bot / AI速读）     │
│    └─ 企业微信（可选）           │
└─────────────────────────────────┘
```

### `/upload-text` — 仅上传工作流

```
content + title + id?
  │
  ▼
┌─────────────────────────────────┐
│ 并行上传（asyncio.gather）       │
│    ├─ HiAgent RAG 知识库        │
│    ├─ LIS-RSS 文章摘要更新      │
│    ├─ Memos（#bot #AI速读）      │
│    ├─ Blinko（bot / AI速读）     │
│    └─ 企业微信（可选）           │
└─────────────────────────────────┘
```

### 重要说明

- **串行处理**: 服务端 `max_concurrent=1`，同一时间只处理一个请求，后续请求排队等待
- **阻塞模式**: `POST /process` 会一直阻塞直到整个工作流完成（可能耗时数分钟）；`POST /upload-text` 仅执行上传阶段，通常秒级完成
- **PDF 来源**: 当前通过知社科、万方、CNKI 三个学术数据库按优先级依次尝试下载

---

## 可配置开关（`config/config.yaml`）

每个上传目标均可独立开关，无需修改代码：

```yaml
summary_upload:
  hiagent_rag:
    enabled: true     # 是否上传 HiAgent RAG 知识库
  lis_rss:
    enabled: true     # 是否回写 LIS-RSS 文章摘要
  memos:
    enabled: true     # 是否发布到 Memos
  blinko:
    enabled: true     # 是否发布到 Blinko
  wechat:
    enabled: true     # 是否推送企业微信
```

---

## 环境变量配置（`.env`）

### 必需配置

| 变量 | 说明 |
|------|------|
| `LIS_RSS_API_URL` | LIS-RSS 主应用地址，如 `http://10.40.92.18:8007` |
| `LIS_RSS_USERNAME` | LIS-RSS 登录用户名 |
| `LIS_RSS_PASSWORD` | LIS-RSS 登录密码 |
| `MEMOS_BASE_URL` | Memos 服务地址 |
| `MEMOS_ACCESS_TOKEN` | Memos API Token |
| `HIAGENT_PDF_URL` | HiAgent PDF 总结对话 URL |
| `WorkspaceType` | HiAgent RAG 工作区类型（`personal`） |
| `WorkspaceID` | HiAgent RAG 工作区 ID |
| `DatasetID` | HiAgent RAG 数据集 ID |

### 可选配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PDF_SUMMARY_PUSH_WECHAT` | `false` | 是否默认推送企业微信 |
| `WECHAT_WEBHOOK_KEY` | — | 企业微信机器人 Webhook Key |
| `CLI_API_KEY` | — | LIS-RSS 统一推送 API Key |
| `PDF_SUMMARY_NOTIFY_USER_ID` | `1` | 推送目标用户 ID |
| `HTTP_PROXY` | — | 代理地址（Telegram/外网请求） |

---

## 调用示例

### cURL

```bash
# 提交处理（仅标题，不关联文章 ID，不推微信）
curl -X POST http://localhost:8081/process \
  -H "Content-Type: application/json" \
  -d '{"title": "基于大模型的学术文献自动摘要研究"}'

# 提交处理（关联 LIS-RSS 文章，并推企业微信）
curl -X POST http://localhost:8081/process \
  -H "Content-Type: application/json" \
  -d '{"title": "面向数字图书馆的智能检索技术研究", "id": 42, "push_wechat": true}'

# 异步提交（适合 agent：立即返回 task_id，不阻塞）
TASK_ID=$(curl -s -X POST http://localhost:8081/process \
  -H "Content-Type: application/json" \
  -d '{"title": "基于大模型的学术文献自动摘要研究", "wait": false}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['task_id'])")

# 每 5-10 秒轮询一次，status 变为 completed/failed 后读取 result
curl http://localhost:8081/process/status/$TASK_ID

# 直接上传文本（携带 LIS-RSS 文章 ID）
curl -X POST http://localhost:8081/upload-text \
  -H "Content-Type: application/json" \
  -d '{"content": "# 标题\n\n正文", "title": "示例文章", "id": 42, "source_name": "知社科"}'

# 直接上传文本（仅上传，不关联 LIS-RSS）
curl -X POST http://localhost:8081/upload-text \
  -H "Content-Type: application/json" \
  -d '{"content": "# 标题\n\n正文", "title": "示例文章"}'

# 健康检查
curl http://localhost:8081/health
```

### Python

```python
import time
import requests

# 异步提交 + 轮询（推荐 agent 使用，可随时感知进度、不会长时间阻塞）
resp = requests.post("http://localhost:8081/process", json={
    "title": "基于大模型的学术文献自动摘要研究",
    "id": 42,
    "push_wechat": False,
    "wait": False
})
task_id = resp.json()["task_id"]

while True:
    st = requests.get(f"http://localhost:8081/process/status/{task_id}").json()
    print(f"[{st['status']}] stage={st['stage']} elapsed={st['elapsed_seconds']}s")
    if st["status"] in ("completed", "failed"):
        result = st["result"]
        break
    time.sleep(5)

# 阻塞模式（一次调用等到底）
resp = requests.post("http://localhost:8081/process", json={
    "title": "基于大模型的学术文献自动摘要研究",
    "id": 42,
    "push_wechat": False
})
result = resp.json()
print(result["success"])
print(result["stages"]["upload"])

# 直接使用摘要内容（无需再访问服务端文件系统）
if result.get("md_content"):
    print(result["md_content"])

# 直接上传文本
resp = requests.post("http://localhost:8081/upload-text", json={
    "content": "# 摘要标题\n\n摘要正文...",
    "title": "示例文章",
    "id": 42,
    "source_name": "知社科"
})
result = resp.json()
print(result["success"], result["stages"]["upload"])

# 健康检查
health = requests.get("http://localhost:8081/health")
print(health.json())
```

### JavaScript

```javascript
// 异步提交 + 轮询
const resp = await fetch("http://localhost:8081/process", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "基于大模型的学术文献自动摘要研究",
    id: 42,
    push_wechat: false,
    wait: false
  })
});
const { task_id } = await resp.json();

// 每 5-10 秒轮询一次，直到 status 变为 completed/failed
const status = await fetch(`http://localhost:8081/process/status/${task_id}`).then(r => r.json());
console.log(status.status, status.stage, status.elapsed_seconds);

// 阻塞模式
const resp2 = await fetch("http://localhost:8081/process", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "基于大模型的学术文献自动摘要研究",
    id: 42,
    push_wechat: false
  })
});
const result = await resp.json();
console.log(result.success, result.stages.upload);

// 直接获取摘要内容
console.log(result.md_content);

// 健康检查
const health = await fetch("http://localhost:8081/health");
console.log(await health.json());
```

---

## 注意事项

1. **耗时差异**: `/process` 通常需要 1-5 分钟（PDF 下载 + 总结）；`/upload-text` 仅上传，通常秒级完成
2. **幂等性**: 相同标题（忽略大小写/首尾空白）的重复 `/process` 调用在途（排队/处理中）时会被去重，返回同一个 `task_id`（异步模式响应中 `duplicate=true`）；任务已完成/失败后的重复调用会重新执行完整流程；`/upload-text` 重复调用会重复上传相同内容
3. **自动清理**: `/process` 生成的 PDF 文件默认在上传后删除（`config.yaml` 中 `delete_pdf: true`），MD 文件默认保留；`/upload-text` 自动创建临时文件，上传后立即删除
4. **队列**: `/process` 请求会排队串行处理，队列中等待数可通过 `/health` 的 `queue_size` 查看；`/upload-text` 直接执行，不排队
5. **PDF 下载**: 依赖知社科、万方、CNKI 三个数据库的可访问性，如果论文不在这些数据库中则无法获取 PDF
6. **心跳/进度**: agent 调用推荐使用 `wait=false` 异步提交 + `GET /process/status/{task_id}` 轮询（建议 5-10 秒一次），可实时区分“排队中 / 下载中 / 总结中 / 上传中”，避免长时间阻塞被误判为卡死；任务状态保存在内存中，服务重启后丢失
7. **稳健性**: 处理阶段在线程池中执行，处理期间 `/health` 与状态查询端点始终可响应；阻塞模式经代理调用时 Node 侧设为 10 分钟总超时 + 5 秒轮询，超过总超时返回失败原因，但 Python 端任务仍会继续执行并正常上传

---

## 服务部署

对应 systemd 服务：`paper-pdf-api`

```bash
sudo systemctl status paper-pdf-api
sudo journalctl -u paper-pdf-api -f
```

API 服务由 `uvicorn api:app --host 0.0.0.0 --port 8081` 启动，CORS 已全开（`allow_origins=["*"]`）。

---

*文档版本: v1.2 | 最后更新: 2026-09-29*
