# DeepSearch API 使用说明

## 概述

DeepSearch API 提供深度学术文章检索和 PDF 总结服务，基于 FastAPI 构建，异步处理任务。

- 支持通过参数跳过 PDF 总结，仅执行深度检索并导出文章内容

- **服务端口**: 8082
- **基础 URL**: `http://localhost:8082`

---

## API 接口

### 1. 健康检查

```http
GET /health
```

**响应示例**:
```json
{
  "status": "healthy"
}
```

---

### 2. 提交任务

```http
POST /process
```

**请求体 (JSON)**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| input_md | string | 是 | 种子文章内容，格式为 Markdown 列表，每行以 `- ` 开头 |
| input_type | string | 否 | 输入类型: `content` (默认) 或 `file` |
| rounds | integer | 否 | 迭代轮次，默认使用配置 |
| score_threshold | float | 否 | 相似度阈值，默认使用配置 |
| semantic_limit | integer | 否 | 语义检索返回数量，默认使用配置 |
| max_final_articles | integer | 否 | 最终保留的最大文章数，默认使用配置 |
| skip_pdf_summary | boolean | 否 | 是否跳过 PDF 总结，默认 `false`。为 `true` 时不调用 PDF 总结服务，仅导出文章内容 |
| output_dir | string | 否 | 自定义输出目录 |
| config_path | string | 否 | 自定义配置文件路径 |

**input_md 格式**:
```
- 文章标题：12345
- 另一篇文章
```

格式说明：
- 有 ID: `- 标题：ID`
- 无 ID: `- 标题`

**关于 `skip_pdf_summary`**:
- `false` 或不传：执行完整流程，包含 PDF 总结
- `true`：跳过 PDF 总结 API 调用，但仍会生成 `report.md` 和 `articles/` 下的 md 文件
- 跳过后，任务结果中的 `pdfSummarySkipped` 通常会等于本次导出的文章数

**响应示例**:
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "progress": {
    "step": "starting",
    "current": 0,
    "total": 100
  }
}
```

---

### 3. 查询任务状态

```http
GET /task/{task_id}
```

**路径参数**:
- `task_id`: 任务 ID

**响应示例**:
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "progress": {
    "step": "completed",
    "current": 100,
    "total": 100
  },
  "result": {
    "reportPath": "/opt/lis-rss-daily/output/deepsearch/report_20260324.md",
    "articlesDir": "/opt/lis-rss-daily/output/deepsearch/articles",
    "outputDir": "/opt/lis-rss-daily/output/deepsearch",
    "articleCount": 10,
    "pdfSummarySuccess": 8,
    "pdfSummaryFailed": 2,
    "pdfSummarySkipped": 0
  }
}
```

**任务状态**:
- `pending`: 等待中
- `running`: 执行中
- `completed`: 已完成
- `failed`: 失败

---

### 4. 下载结果

```http
GET /task/{task_id}/download
```

下载任务结果为 ZIP 文件，包含：
- 报告文件 (report_*.md)
- 文章目录 (articles/)

---

## 使用示例

### cURL

```bash
# 1. 提交任务
curl -X POST http://localhost:8082/process \
  -H "Content-Type: application/json" \
  -d '{
    "input_md": "- 深度学习在医学影像中的应用：12345\n- 基于Transformer的图像分割方法"
  }'

# 跳过 PDF 总结
curl -X POST http://localhost:8082/process \
  -H "Content-Type: application/json" \
  -d '{
    "input_md": "- 深度学习在医学影像中的应用：12345",
    "skip_pdf_summary": true
  }'

# 返回: {"task_id": "xxx", "status": "running", ...}

# 2. 查询状态
curl http://localhost:8082/task/xxx

# 3. 下载结果
curl -o result.zip http://localhost:8082/task/xxx/download
```

### Python

```python
import requests
import time

BASE_URL = "http://localhost:8082"

# 1. 提交任务
def submit_task(input_md, **kwargs):
    data = {
        "input_md": input_md,
        **kwargs
    }
    resp = requests.post(f"{BASE_URL}/process", json=data)
    return resp.json()

# 2. 查询状态
def get_status(task_id):
    resp = requests.get(f"{BASE_URL}/task/{task_id}")
    return resp.json()

# 3. 下载结果
def download_result(task_id):
    resp = requests.get(f"{BASE_URL}/task/{task_id}/download")
    with open(f"deepsearch_{task_id}.zip", "wb") as f:
        f.write(resp.content)

# 使用
input_md = """- 深度学习在医学影像中的应用：12345
- 基于Transformer的图像分割方法"""

task = submit_task(
    input_md,
    rounds=2,
    max_final_articles=10,
    skip_pdf_summary=True,
)
task_id = task["task_id"]

# 轮询等待完成
while True:
    status = get_status(task_id)
    print(status["status"], status.get("progress", {}).get("step"))
    if status["status"] in ["completed", "failed"]:
        break
    time.sleep(5)

# 下载
if status["status"] == "completed":
    download_result(task_id)
```

---

## 服务管理 (systemd)

服务已配置为开机自启动。

### 查看状态
```bash
sudo systemctl status deepsearch-api
```

### 启动/停止/重启
```bash
sudo systemctl start deepsearch-api
sudo systemctl stop deepsearch-api
sudo systemctl restart deepsearch-api
```

### 查看日志
```bash
# 实时日志
sudo journalctl -u deepsearch-api -f

# 最近 50 行
sudo journalctl -u deepsearch-api -n 50
```

### 服务配置
```bash
sudo cat /etc/systemd/system/deepsearch-api.service
```

---

## 输出文件

任务完成后，结果保存在配置指定的输出目录（默认 `output/deepsearch/`）:

```
output/deepsearch/
├── report_20260324.md          # 综合报告
├── articles/                  # 文章详情目录
│   ├── article_1.md
│   ├── article_2.md
│   └── ...
└── steps/                      # 分步骤报告
```

---

## 错误处理

常见错误:

| 错误 | 说明 |
|------|------|
| 404 Task not found | 任务 ID 不存在 |
| 400 Task not completed | 任务未完成，无法下载 |
| 500 Result files not found | 结果文件丢失 |

任务失败时，状态查询返回 `error` 字段包含错误信息。
