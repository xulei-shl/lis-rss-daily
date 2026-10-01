# Paper PDF Summary API 接口文档

> 论文 PDF 摘要工作流 API：PDF 下载 → 摘要生成 → 并行分发到多个平台，以及直接文本分发。

- **服务地址**: `http://<服务器IP>:8081`
- **基础路径**: `/`
- **认证**: 无（局域网内调用，如需保护建议前置反向代理）
- **响应格式**: JSON
- **API 版本**: `2.0`（可通过 `GET /health` 的 `api_version` 与 `capabilities` 发现能力）

---

## 契约约定（先读这一节）

这三条是 v2.0 的核心，调用方**必须**按此理解响应，否则会出现「摘要已生成却被判为失败」的错误认知。

### 1. `success` 只表示摘要流水线成败，与推送无关

```
摘要流水线 = pdf_download → pdf_validate → pdf_summary
```

只有这三段全部 `success` **且** `md_content` 非空时，`success` 才为 `true`。

**推送（HiAgent RAG / LIS-RSS / Memos / Blinko / 企业微信）是独立的副作用**，其结果一律看 `distribution` 字段。推送全部跳过、全部失败，都**不会**把 `success` 改成 `false`。

> v1.x 的 `success` 语义是「至少一个平台推送成功」，导致「只生成摘要、不外发」的调用方恒定拿到 `success=false`。v2.0 已修正。

### 2. 失败原因看 `error_code`（稳定枚举），不要匹配 `reason` 文案

`reason` 是中文自然语言，仅供人读，可能随版本调整。程序化分支请只用 `error_code`。

| `error_code` | 触发端点 | 含义 | 建议处理 |
|--------------|---------|------|----------|
| `pdf_unavailable` | `/process` | 三个来源（知社科/万方/CNKI）都拿不到 PDF | 换标题重试，或确认该文献不在库内 |
| `title_mismatch` | `/process` | 下载到的 PDF 文件名与标题不匹配 | 换更精确的标题重试 |
| `summary_failed` | `/process` | HiAgent 摘要生成失败，或返回内容是错误信息 | 可重试；连续失败则人工介入 |
| `summary_empty` | `/process` | 三段都 `success` 但摘要正文为空 | 可重试 |
| `internal_error` | `/process` | 任务执行抛异常（此时 `status=failed`） | 查服务端日志 |
| `distribution_failed` | `/upload-text` | 所有推送目标均失败 | 检查 `distribution.failed` |

`success=true` 时 `error_code` 与 `reason` 均为 `null`。

> `/process` **不会**返回 `distribution_failed`：推送失败不影响摘要成败，只体现在
> `distribution.failed` 里。推送完全不会影响 `success`。

### 3. `status` 只表示任务执行终态，不表示业务成败

```
queued → running → completed
                  ↘ failed（仅任务抛异常时）
```

**业务失败（PDF 拿不到等）同样是 `status=completed`**，此时 `status` 正常但 `result.success=false`、`result.error_code` 非空。判定成败必须读 `result.success`。

同时，**业务失败一律返回 HTTP 200**，不再用 5xx 表达业务结果；5xx 只保留给协议错误与服务内部异常。

---

## 端点一览

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/process` | 提交论文处理请求（默认阻塞；`wait=false` 时异步返回 `task_id`） |
| `GET`  | `/process/status/{task_id}` | 查询异步任务状态（`include=meta` 轻量轮询） |
| `POST` | `/upload-text` | 直接分发文本到各平台（不经过 PDF 下载与摘要） |
| `GET`  | `/health` | 健康检查 + 队列状态 + 能力发现 |

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
| `push_wechat` | `bool` | 否 | `null` | 三态：`null` 沿用服务端配置（`config.yaml` 与 `PDF_SUMMARY_PUSH_WECHAT`）；`true` 强制推送；`false` **强制不推** |
| `push_hiagent` | `bool` | 否 | `null` | 同上三态，作用于 HiAgent RAG |
| `push_memos` | `bool` | 否 | `null` | 同上三态，作用于 Memos |
| `push_blinko` | `bool` | 否 | `null` | 同上三态，作用于 Blinko |
| `wait` | `bool` | 否 | `true` | `true` 阻塞等待完成后返回；`false` 立即返回 `task_id`，配合状态端点轮询 |
| `include_summary` | `bool` | 否 | `true` | `false` 时不内联 `md_content`，只给 `md_path` + `md_bytes`（长摘要场景可省 Token 与管道体积） |

> **v2.0 修正**：v1.x 中 `push_wechat` 是普通 `bool`（默认 `false`），且服务端用 `push_wechat or env_default` 合成，导致客户端传 `false` 时仍可能被环境变量翻转成推送。现四个 `push_*` 统一为三态，`false` 一定生效。

### 响应（200，阻塞模式）

以下为**真实响应**（`id=42`，推送目标部分成功）：

```json
{
  "success": true,
  "error_code": null,
  "reason": null,
  "article_id": 42,
  "md_path": "/opt/lis-rss-daily/scripts/paper-pdf-summary/download/2026-05-25/xxx.md",
  "md_bytes": 8421,
  "md_content": "# 摘要标题\n\n摘要正文...",
  "stages": {
    "pdf_download": "success",
    "pdf_validate": "success",
    "pdf_summary": "success",
    "upload": {
      "hiagent_rag": true,
      "lis_rss": false,
      "memos": true,
      "blinko": false,
      "wechat": false,
      "_skipped": ["blinko", "wechat"]
    }
  },
  "distribution": {
    "requested": ["hiagent_rag", "lis_rss", "memos"],
    "ok": ["hiagent_rag", "memos"],
    "failed": ["lis_rss"],
    "skipped": ["blinko", "wechat"],
    "error": null
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | `bool` | **仅**代表摘要流水线三段是否全部成功且正文非空 |
| `error_code` | `string` / `null` | 稳定错误码，见上文表格 |
| `reason` | `string` / `null` | 中文失败说明，仅供人读 |
| `article_id` | `int` | 文章 ID；未传 `id` 时为 `0`（注意是 `0` 而非 `null`） |
| `md_path` | `string` / `null` | 摘要 Markdown 文件路径（**服务端本地路径**，供落盘/审计，非 URL） |
| `md_bytes` | `int` / `null` | 摘要文件字节数 |
| `md_content` | `string` / `null` | 摘要正文；`include_summary=false` 时为 `null` |
| `stages` | `object` | 各阶段原始结果（见下） |
| `distribution` | `object` / `null` | 推送结果视图（见下）；**流水线在中途失败、未进入推送阶段时为 `null`** |

> 注意本响应体没有 `title` 字段。阻塞模式不回显标题（标题由调用方自己持有）；
> `GET /process/status/{task_id}` 顶层与其中的 `result` 才带 `title`。

### 响应（200，流水线失败）

摘要流水线失败时同样返回 **200**，`error_code` 给出稳定码，`distribution` 为 `null`：

```json
{
  "success": false,
  "error_code": "pdf_unavailable",
  "reason": "PDF下载失败（所有脚本均失败）",
  "article_id": 42,
  "md_path": null,
  "md_bytes": null,
  "md_content": null,
  "stages": {},
  "distribution": null
}
```

标题不匹配（`stages` 里已写 `pdf_download: success`，失败阶段写 `failed`）：

```json
{
  "success": false,
  "error_code": "title_mismatch",
  "reason": "PDF文件名不匹配: 相似度 0.42 < 阈值 0.9",
  "article_id": 42,
  "md_path": null,
  "md_bytes": null,
  "md_content": null,
  "stages": { "pdf_download": "success", "pdf_validate": "failed" },
  "distribution": null
}
```

### `stages` 字段说明

| 阶段 | 说明 | 成功值 | 失败值 |
|------|------|--------|--------|
| `pdf_download` | PDF 下载（优先级：知社科 → 万方 → CNKI） | `"success"` | 缺省（不写键） |
| `pdf_validate` | PDF 文件名与标题匹配校验 | `"success"` | `"failed"` |
| `pdf_summary` | HiAgent 生成 AI 摘要 | `"success"` | `"failed"` |
| `upload` | 推送原始结果（含 `_skipped`，保留兼容） | `object` | `{"error": "..."}` |

> 只有**失败**的阶段才写 `"failed"`；未走到的阶段**键不存在**。下载失败时 `stages` 为空对象 `{}`。
> 判定成败请用顶层 `success` / `error_code`，不要遍历 `stages` 猜状态。

### `distribution` 推送结果（v2.0 新增，替代解析 `_skipped`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `requested` | `string[]` | 本次**实际尝试**推送的目标 |
| `ok` | `string[]` | 推送成功的目标 |
| `failed` | `string[]` | 推送失败的目标 |
| `skipped` | `string[]` | 被跳过的目标（配置关闭 / 客户端显式 `false` / 无 `id` 跳过 LIS-RSS） |
| `error` | `string` / `null` | 推送阶段整体异常信息 |

**不变量**：`ok` / `failed` 均是 `requested` 的子集，四者并集恰为五个平台全集
（`hiagent_rag`、`lis_rss`、`memos`、`blinko`、`wechat`），互不重叠。全部跳过时 `requested` 为空数组——**「没请求」不等于「失败」**。

推送阶段整体抛异常时（如 `{"error": "..."}`），所有未被跳过的目标都计入 `failed`，`error` 非空。

> v1.x 里 `upload.<target>=false` 有「跳过」和「真失败」两种含义，调用方必须靠 `_skipped` 自行区分，极易误报。`distribution` 三段式消除了这个歧义；`stages.upload` 仅为兼容保留，新代码请勿依赖。

### 响应（200，异步模式 `wait=false`）

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status_url": "/process/status/550e8400-e29b-41d4-a716-446655440000"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `task_id` | `string` | 任务 ID |
| `status_url` | `string` | 状态查询路径（**相对**路径，需自行拼接服务地址） |

调度元信息改由**响应头**承载：

| 响应头 | 说明 |
|--------|------|
| `X-Queue-Size` | 提交时队列中等待的任务数 |
| `X-Deduplicated` | `true` 表示命中在途去重（相同标题忽略大小写/首尾空白已有排队或处理中任务），复用了现有 `task_id`，未重复执行 |

两种模式（阻塞 / 异步）都会带这两个响应头。

> v1.x 把 `queue_size` / `duplicate` 放在响应体里，与业务字段混在一起容易被模型当作业务状态误读，现已移出头。

### 响应（404）

阻塞模式下若任务在等待期间消失（不应发生）：

```json
{ "detail": "Task not found or expired" }
```

---

## 2. 查询任务状态

```
GET /process/status/{task_id}?include=full|meta
```

### `include` 参数

| 值 | 返回内容 | 体积 | 用途 |
|----|---------|------|------|
| `full`（默认） | 含 `result`（含 `md_content`） | 可达数十 KB | 任务终结后取最终结果 |
| `meta` | **不含** `result` 摘要正文，只有进度与 `error_code` | < 1 KB | 高频心跳轮询 |

> 轮询期间每次都搬运整篇摘要会持续消耗上下文。推荐：全程用 `include=meta` 轮询，确认 `completed` 后再取一次 `full`。

### 响应（200，`include=meta`，任务进行中）

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
  "error_code": null,
  "result": null
}
```

### 响应（200，`include=meta`，业务失败已终结）

注意 `status=completed` 但 `error_code` 非空——**任务跑完了，摘要没拿到**：

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "面向数字图书馆的智能检索技术研究",
  "status": "completed",
  "stage": "pdf_download",
  "elapsed_seconds": 42.1,
  "queue_wait_seconds": null,
  "queued_at": 1769700000.123,
  "finished_at": 1769700042.2,
  "error_code": "pdf_unavailable",
  "result": null
}
```

> `include=meta` 下 `result` **恒为 `null`**（不是「没有结果」，而是「本视图不含结果」）。
> 轮询循环可以只靠 `error_code` 判断是否已失败并提前退出，不必等取全量。

### 响应（200，`include=full`，任务终结）

`result` 结构与阻塞模式响应一致，但**额外带 `title`**：

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
  "error_code": null,
  "result": {
    "article_id": 42,
    "title": "面向数字图书馆的智能检索技术研究",
    "success": true,
    "error_code": null,
    "reason": null,
    "stages": { "...": "与阻塞模式的 stages 一致" },
    "distribution": { "...": "与阻塞模式的 distribution 一致" },
    "md_path": "/opt/lis-rss-daily/scripts/paper-pdf-summary/download/2026-05-25/xxx.md",
    "md_content": "# 摘要标题\n\n摘要正文..."
  }
}
```

> `result` 是内部结果对象的原样透出，因此字段名与顺序同内部结构，**含 `title`、且不含 `md_bytes`**（`md_bytes` 只在 `/process` 阻塞响应里计算）。需要字节数时用 `len(md_content.encode('utf-8'))`。

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | `string` | `queued` → `running` → `completed` / `failed`（`failed` 仅任务抛异常） |
| `stage` | `string` | `pdf_download` → `pdf_validate` → `pdf_summary` → `pdf_summary_check` → `upload`；排队时为 `queued`；终态时保留**最后进入**的阶段 |
| `elapsed_seconds` | `float` / `null` | 开始处理至今（或至完成）的秒数 |
| `queue_wait_seconds` | `float` / `null` | 排队已等待秒数（仅 `status=queued` 有值） |
| `queued_at` / `finished_at` | `float` / `null` | 提交 / 完成的 Unix 时间戳 |
| `error_code` | `string` / `null` | 任务终结后与 `result.error_code` 一致；未终结或成功时为 `null` |
| `result` | `object` / `null` | `include=meta` 时恒为 `null`；`include=full` 时为完整结果 |

### 结果保留策略

结果有**两把独立的尺子**：

| 载体 | 保留时长 | 语义 |
|------|---------|------|
| 内存（`QueueManager.results`） | **5 分钟** | 高频轮询窗口 |
| 落盘（`logs/tasks/<task_id>.json`） | **24 小时** | 跨服务重启可查 |

- 每个任务终结即落盘；服务启动时自动回载未过期的落盘结果，因此**重启后仍可查**。
- 内存条目到期只从内存移除，**不会**误删仍有 24 小时效力的落盘文件。
- 落盘文件按 24 小时 TTL 清理（启动回载与每次提交时各清一次），目录不会无限增长。
- 404 语义：任务 ID 不存在，或结果已过对应载体的保留期。

> v1.x 结果仅存内存，重启即丢且 404 与「任务从未存在」不可区分。

---

## 3. 直接上传文本

```
POST /upload-text
```

直接传入 Markdown 文本，并行分发到各平台（HiAgent RAG / LIS-RSS / Memos / Blinko / 企业微信），不经过 PDF 下载与摘要生成。

### 请求体

```json
{
  "content": "# 摘要标题\n\n摘要正文...",
  "title": "面向数字图书馆的智能检索技术研究",
  "id": 42,
  "source_name": "知社科"
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `content` | `string` | **是** | — | Markdown 文本内容 |
| `title` | `string` | **是** | — | 文章标题，用于 Memos/Blinko/企业微信消息展示 |
| `id` | `int` | 否 | `null` | LIS-RSS 文章 ID；`null`/`0` 跳过 LIS-RSS 回写 |
| `source_name` | `string` | 否 | `null` | 来源名称（仅企业微信消息展示） |
| `push_wechat` | `bool` | 否 | `null` | 三态，同 `/process` |
| `push_hiagent` | `bool` | 否 | `null` | 三态，同 `/process` |
| `push_memos` | `bool` | 否 | `null` | 三态，同 `/process` |
| `push_blinko` | `bool` | 否 | `null` | 三态，同 `/process` |

### 响应（200，部分成功）

```json
{
  "success": true,
  "error_code": null,
  "reason": null,
  "article_id": 42,
  "title": "面向数字图书馆的智能检索技术研究",
  "stages": {
    "upload": {
      "hiagent_rag": true,
      "lis_rss": false,
      "memos": true,
      "blinko": false,
      "wechat": false,
      "_skipped": ["blinko", "wechat"]
    }
  },
  "distribution": {
    "requested": ["hiagent_rag", "lis_rss", "memos"],
    "ok": ["hiagent_rag", "memos"],
    "failed": ["lis_rss"],
    "skipped": ["blinko", "wechat"],
    "error": null
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | `bool` | 至少一个推送目标成功（等价于 `distribution.ok` 非空） |
| `error_code` | `string` / `null` | 全部失败时为 `distribution_failed` |
| `reason` | `string` / `null` | 全部失败时为「所有上传任务均失败」 |
| `article_id` | `int` / `null` | 文章 ID（回显；未传时为 `null`，与 `/process` 的 `0` 不同） |
| `title` | `string` | 文章标题（回显） |
| `stages.upload` | `object` | 推送原始结果（兼容保留） |
| `distribution` | `object` | 推送结果视图，结构同 `/process` |

> 本端点**只做推送**，因此 `success` 直接由推送结果决定（与 `/process` 的语义不同）。
> 部分失败仍返回 `success=true`——逐项目标的状态请看 `distribution.failed`。

### 响应（200，全部失败）

全平台失败**不是** 5xx，仍是 200 + `success=false`：

```json
{
  "success": false,
  "error_code": "distribution_failed",
  "reason": "所有上传任务均失败",
  "article_id": null,
  "title": "示例文章",
  "stages": { "upload": { "...": "原始结果" } },
  "distribution": {
    "requested": ["hiagent_rag", "lis_rss", "memos"],
    "ok": [],
    "failed": ["hiagent_rag", "lis_rss", "memos"],
    "skipped": ["blinko", "wechat"],
    "error": null
  }
}
```

### 响应（500 — 服务内部异常）

仅当服务端处理本身抛异常（如配置文件缺失、上传模块导入失败）：

```json
{ "detail": "<异常信息>" }
```

> 「全部推送目标失败」是业务结果，返回 200；500 只表示服务端自己出了问题。

---

## 4. 健康检查

```
GET /health
```

### 响应

```json
{
  "status": "ok",
  "queue_size": 0,
  "api_version": "2.0",
  "capabilities": [
    "async_task",
    "error_code",
    "distribution_view",
    "include_meta",
    "include_summary",
    "persistent_results"
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | `string` | `"ok"` 表示服务正常（该端点不返回失败态） |
| `queue_size` | `int` | 当前队列等待任务数（**不含**正在处理的那个） |
| `api_version` | `string` | API 语义版本，当前 `"2.0"` |
| `capabilities` | `string[]` | 能力标识，用于协商是否可依赖新字段 |

`capabilities` 取值含义：

| 值 | 含义 |
|----|------|
| `async_task` | 支持 `wait=false` + `/process/status/{task_id}` 轮询 |
| `error_code` | 失败响应带稳定 `error_code` |
| `distribution_view` | 带 `distribution` 三段式推送结果 |
| `include_meta` | 状态端点支持 `?include=meta` 轻量视图 |
| `include_summary` | `/process` 支持 `include_summary=false` |
| `persistent_results` | 结果落盘，跨服务重启可查 |

> `api_version` **必现**（v1.x 也有此端点但字段较少）；`capabilities` 是 v2.0 新增。
> 客户端应按 `capabilities` 判定能否依赖 `error_code` / `distribution`，而不是硬编码版本号字符串比较——
> v1.x 服务端返回的响应里没有 `capabilities`，据此即可安全降级。

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
  │ 失败 → error_code=pdf_unavailable
  ▼                                            任何一步失败都**立即返回**，
┌─────────────────────────────────┐              不再进入后续阶段（distribution 为 null）
│ ② 文件名匹配校验                 │
│    检查 PDF 文件名是否匹配标题    │
└─────────────────────────────────┘
  │ 失败 → error_code=title_mismatch
  ▼
┌─────────────────────────────────┐
│ ③ HiAgent PDF 摘要生成          │
│    输出: 与 PDF 同名的 .md 文件  │
│    另有摘要内容检查阶段          │
└─────────────────────────────────┘
  │ 失败 → error_code=summary_failed
  │ 正文为空 → error_code=summary_empty
  ▼
┌─────────────────────────────────┐
│ ④ 并行分发（asyncio.gather）    │  ← 独立副作用，不影响 success
│    ├─ HiAgent RAG 知识库        │
│    ├─ LIS-RSS 文章摘要更新      │
│    ├─ Memos（#bot #AI速读）      │
│    ├─ Blinko（bot / AI速读）     │
│    └─ 企业微信（可选）           │
└─────────────────────────────────┘
  │
  ▼
success = 前三段全 success 且摘要正文非空
distribution = ④ 的推送结果（成败不影响 success）
```

> ④ 之后的阶段**一定不会**让 `success` 变 `false`。
> 若希望完全不外发，四个 `push_*` 全部传 `false` 即可，此时 `distribution.requested` 为空数组。

### `/upload-text` — 仅分发

```
content + title + id?
  │
  ▼
┌─────────────────────────────────┐
│ 并行分发（asyncio.gather）       │
│    （同 ④ 的五个目标）           │
└─────────────────────────────────┘
```

### 重要说明

- **串行处理**: 服务端 `max_concurrent=1`，同一时间只处理一个 `/process` 任务，其余排队
- **阻塞模式**: `POST /process` 阻塞至工作流完成（可能数分钟）；`POST /upload-text` 通常秒级
- **PDF 来源**: 知社科 → 万方 → CNKI 依次尝试
- **`md_path` 是服务端本地路径**，不是可下载 URL；调用方与 API 服务同机时可自行读取
- **`/upload-text` 不排队**: 它不走任务队列，直接在请求内完成分发，与 `/process` 的串行队列互不影响

---

## 可配置开关（`config/config.yaml`）

每个推送目标可独立开关，客户端的 `push_*` 三态在其之上生效（客户端 `false` 优先级最高）：

```yaml
summary_upload:
  hiagent_rag:
    enabled: true
    delete_md: false      # 推送后是否删除摘要 MD 文件
  lis_rss:
    enabled: true
  memos:
    enabled: true
  blinko:
    enabled: false
  wechat:
    enabled: true
    timeout: 30
    max_retries: 2
```

**优先级**（`push_*` 三态 > `config.yaml` > 环境变量默认）：

| 客户端 `push_*` | 服务端 `enabled` | 实际行为 |
|-----------------|-----------------|---------|
| `false` | 任意（含 `true`） | **强制跳过**（最高优先级，客户端能真正关掉任一通道） |
| `true` | `false` | 强制推送 |
| `true` / `null` | `true` | 推送 |
| `null` | `false` | 跳过 |

> 唯一下方还有环境变量兜底的是 `push_wechat`：`push_wechat=null` 时读 `PDF_SUMMARY_PUSH_WECHAT`（缺省 `false`），
> 再叠加 `config.yaml` 的 `summary_upload.wechat.enabled`。其余四个目标无环境变量兜底，只看 `config.yaml`。

其他与本 API 相关的配置：

```yaml
storage:
  download_root: "download"   # PDF/MD 工作目录（按 YYYY-MM-DD 分子目录）
  logs_root: "logs"           # 任务结果落盘于 logs/tasks/<task_id>.json
pdf_download:
  priority_scripts: [ ... ]   # 下载脚本优先级
  match_threshold: 0          # PDF 文件名匹配阈值（0 = 完全匹配）
pdf_summary:
  script: "pdf-summary/hiagent_upload.py"
  delete_pdf: true            # 摘要生成后是否删除 PDF
```

> `delete_pdf: true` 意味着**只有摘要生成成功时** PDF 才被保留/清理；流水线失败的 PDF 处理由
> `pdf_validator` 的 `delete_on_mismatch=True` 负责（校验不通过即删）。

---

## 环境变量配置（`.env`）

### 必需配置

| 变量 | 说明 |
|------|------|
| `LIS_RSS_API_URL` | LIS-RSS 主应用地址 |
| `LIS_RSS_USERNAME` / `LIS_RSS_PASSWORD` | LIS-RSS 登录凭据 |
| `MEMOS_BASE_URL` / `MEMOS_ACCESS_TOKEN` | Memos 服务地址与 Token |
| `HIAGENT_PDF_URL` | HiAgent PDF 总结对话 URL |
| `WorkspaceType` / `WorkspaceID` / `DatasetID` | HiAgent RAG 工作区与数据集 |

### 可选配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PDF_SUMMARY_PUSH_WECHAT` | `false` | `push_wechat=null` 时的企业微信默认值 |
| `WECHAT_WEBHOOK_KEY` | — | 企业微信机器人 Webhook Key |
| `CLI_API_KEY` | — | LIS-RSS 统一推送 API Key |
| `PDF_SUMMARY_NOTIFY_USER_ID` | `1` | 推送目标用户 ID |
| `HTTP_PROXY` | — | 代理地址 |

---

## 调用示例

### cURL

```bash
# 异步提交（agent 推荐：立即拿 task_id，不阻塞）
TASK_ID=$(curl -s -X POST http://localhost:8081/process \
  -H "Content-Type: application/json" \
  -d '{"title": "基于大模型的学术文献自动摘要研究", "wait": false}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['task_id'])")

# 轻量轮询（< 1KB，不含摘要正文）
curl "http://localhost:8081/process/status/$TASK_ID?include=meta"

# 完成后取完整结果
curl "http://localhost:8081/process/status/$TASK_ID"

# 只要摘要文件路径，不要正文（省 Token）
curl -X POST http://localhost:8081/process \
  -H "Content-Type: application/json" \
  -d '{"title": "基于大模型的学术文献自动摘要研究", "include_summary": false}'

# 只生成摘要，绝不外发（四平台全 false，LIS-RSS 不传 id）
# → distribution.requested 为空数组，success 仍为 true
curl -X POST http://localhost:8081/process \
  -H "Content-Type: application/json" \
  -d '{"title": "示例论文", "push_hiagent": false, "push_memos": false, "push_blinko": false, "push_wechat": false}'

# 直接分发文本
curl -X POST http://localhost:8081/upload-text \
  -H "Content-Type: application/json" \
  -d '{"content": "# 标题\n\n正文", "title": "示例文章", "id": 42}'

curl http://localhost:8081/health
```

### Python

```python
import time
import requests

BASE = "http://localhost:8081"

# ---- 推荐：异步提交 + 轻量轮询 + 终态取全量 ----
task_id = requests.post(f"{BASE}/process", json={
    "title": "基于大模型的学术文献自动摘要研究",
    "push_hiagent": False, "push_memos": False,
    "push_blinko": False, "push_wechat": False,
    "wait": False,
}).json()["task_id"]

while True:
    st = requests.get(f"{BASE}/process/status/{task_id}", params={"include": "meta"}).json()
    if st["status"] in ("completed", "failed"):
        break
    if st.get("error_code"):          # 轻量视图已带错误码，可提前退出
        break
    time.sleep(6)

# status=completed 只代表任务跑完；业务成败看 result.success
result = requests.get(f"{BASE}/process/status/{task_id}").json()["result"]

if result["success"]:
    print(result["md_content"])
    print("推送结果:", result["distribution"])
else:
    # 用 error_code 分支，不要匹配 reason 文案
    code = result["error_code"]
    print({"pdf_unavailable": "换个标题重试",
           "title_mismatch": "标题不精确",
           "summary_failed": "摘要服务异常"}.get(code, code))
    print(result["reason"])   # 仅人读

# ---- 阻塞模式 ----
r = requests.post(f"{BASE}/process", json={"title": "示例论文", "include_summary": False})
print(r.status_code, r.json()["success"], r.json()["md_path"])

# ---- 直接分发文本 ----
r = requests.post(f"{BASE}/upload-text", json={
    "content": "# 摘要标题\n\n摘要正文...",
    "title": "示例文章", "id": 42,
})
print(r.json()["distribution"])
```

### JavaScript

```javascript
const BASE = "http://localhost:8081";

// 异步提交 + 轻量轮询
const { task_id } = await fetch(`${BASE}/process`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "示例论文", push_wechat: false, wait: false }),
}).then(r => r.json());

let status;
for (;;) {
  status = await fetch(`${BASE}/process/status/${task_id}?include=meta`).then(r => r.json());
  if (status.status === "completed" || status.status === "failed") break;
  await new Promise(r => setTimeout(r, 6000));
}

const { result } = await fetch(`${BASE}/process/status/${task_id}`).then(r => r.json());
if (result.success) {
  console.log(result.md_content, result.distribution);
} else {
  console.error(result.error_code, result.reason);
}
```

---

## 注意事项

1. **耗时差异**: `/process` 通常 1-5 分钟；`/upload-text` 通常秒级
2. **幂等性**: 相同标题（忽略大小写/首尾空白）的重复 `/process` 在途请求会去重，复用同一 `task_id`（响应头 `X-Deduplicated: true`）；任务终结后重复提交会重新执行；`/upload-text` 重复调用会重复分发
3. **文件清理**: `/process` 生成的 PDF 在摘要成功后按 `pdf_summary.delete_pdf`（当前 `true`）删除，校验不通过的 PDF 由校验器即时删除；摘要 MD 按 `summary_upload.hiagent_rag.delete_md`（当前 `false`，即保留）处理；`/upload-text` 自动创建临时文件，分发后立即删除。任务结果 JSON 按 24 小时 TTL 清理
4. **队列**: `/process` 排队串行处理，深度见 `/health` 的 `queue_size`；`/upload-text` 不排队
5. **PDF 可得性**: 依赖知社科/万方/CNKI 可访问性，库外文献无法获取
6. **结果保留**: 内存 5 分钟 / 落盘 24 小时（跨重启可查）；轮询超时**不等于**任务失败，服务端可能仍在跑，可用同一 `task_id` 复查
7. **稳健性**: 处理阶段（PDF 下载 / 校验 / 摘要）在线程池执行，不阻塞事件循环，期间 `/health` 与状态端点始终可响应
8. **无鉴权**: 服务不校验来源，局域网内任意可达方均可提交任务。如需保护请前置反向代理

---

## 服务部署

对应 systemd 服务：`paper-pdf-api`

```bash
sudo systemctl status paper-pdf-api
sudo journalctl -u paper-pdf-api -f
```

`uvicorn api:app --host 0.0.0.0 --port 8081` 启动，CORS 已全开（`allow_origins=["*"]`）。

启动时会自动回载 `logs/tasks/` 下未过期的任务结果（日志中可见「已回载历史任务结果 N 条」）。

---

## v1.x → v2.0 迁移对照

| 变更 | v1.x | v2.0 | 调用方动作 |
|------|------|------|-----------|
| `success` 语义 | 至少一个平台推送成功 | 仅摘要流水线三段成功 | 若曾用 `success` 判推送结果，改读 `distribution.ok` |
| 失败原因 | 中文 `reason` / `detail` 子串匹配 | `error_code` 稳定枚举 | 改用 `error_code` 分支 |
| 业务失败状态码 | 阻塞模式 500 | 一律 200 | 移除「非 2xx 即失败」的判断 |
| `push_wechat` | `bool`，`false` 可能被环境变量翻转 | 三态，`false` 一定生效 | 无需改动，行为更符合预期 |
| `queue_size` / `duplicate` | 响应体字段 | 响应头 `X-Queue-Size` / `X-Deduplicated` | 改读响应头 |
| 异步提交响应 | `{task_id, queue_size, duplicate}` | `{task_id, status_url}` | 多读 `task_id` 即可，其余可选 |
| 推送结果 | `stages.upload` + 解析 `_skipped` | `distribution` 三段式 | 改读 `distribution`（`stages.upload` 仍保留可用） |
| 轮询 | 每次携带完整 `md_content` | `?include=meta` 轻量（<1KB） | 轮询加 `include=meta`，终结再取全量 |
| 摘要正文 | 无法关闭内联 | `include_summary=false` 可只取 `md_path` | 长摘要场景可省 Token |
| 结果保留 | 内存 5 分钟，重启即丢 | 内存 5 分钟 / 落盘 24 小时，重启回载 | 无需改动（404 语义不变） |
| 能力发现 | 无 | `/health` 返回 `api_version` + `capabilities[]` | 可据此安全降级到 v1.x 行为 |

### 兼容性说明

- **响应体只增不减**：`stages.upload` 与 `_skipped` 作为兼容字段保留，未删除。旧客户端不改也能继续跑，只是语义解释需按上文「契约约定」调整。
- **破坏性变更仅两处**：业务失败的状态码（500 → 200）、响应体移除 `queue_size` / `duplicate`。仓内两个调用方（`src/api/routes/pdf-summary.routes.ts`、`telegram-bot/index.ts`）已同步适配。
- **服务端降级路径**：客户端应先读 `/health` 的 `capabilities`，缺失 `error_code` / `distribution_view` 时退回 v1.x 解析逻辑，而不是硬判版本号。

---

*文档版本: v2.0.1 | 最后更新: 2026-10-01*
*本文所有响应示例均由真实服务输出核对（`api.py` v2.0 契约）。*
