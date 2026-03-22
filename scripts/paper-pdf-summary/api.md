# Paper PDF Summary API

论文PDF摘要工作流的 FastAPI 服务封装，供其他项目调用。

## 功能概述

提供 REST API 接口，触发以下处理流程：

```
1. PDF下载（按优先级尝试多个下载脚本）
2. PDF文件名匹配验证
3. 生成PDF摘要（MD格式）
4. 并行上传到四个子系统（hiagent_rag、lis_rss、memos、wechat）
```

## 环境准备

### 1. 安装依赖

```bash
cd /opt/lis-rss-daily/scripts/paper-pdf-summary
pip install -r requirements_api.txt
```

### 2. 配置文件

确保 `config/config.yaml` 存在且配置正确（与原项目共用同一份配置）。

## 启动服务

```bash
uvicorn api:app --host 0.0.0.0 --port 8081
```

如需后台运行：

```bash
nohup uvicorn api:app --host 0.0.0.0 --port 8081 > logs/api.log 2>&1 &
```

## API 接口

### POST /process

处理指定论文，**阻塞返回结果**（内部自动排队）。

**请求体：**

```json
{
  "title": "论文标题",
  "id": 123
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | 是 | 论文题名（用于PDF下载检索） |
| `id` | integer | 否 | LIS-RSS系统ID；不传则跳过LIS-RSS上传 |

**响应：**

```json
{
  "success": true,
  "article_id": 123,
  "md_path": "/opt/lis-rss-daily/scripts/paper-pdf-summary/download/2026-03-22/xxx.md",
  "stages": {
    "pdf_download": "success",
    "pdf_validate": "success",
    "pdf_summary": "success",
    "upload": {
      "hiagent_rss": true,
      "lis_rss": true,
      "memos": true,
      "wechat": true
    }
  },
  "reason": null
}
```

**失败响应示例：**

```json
{
  "success": false,
  "article_id": 0,
  "md_path": null,
  "stages": {
    "pdf_download": "success",
    "pdf_summary": "failed"
  },
  "reason": "PDF总结失败"
}
```

### GET /health

健康检查。

**响应：**

```json
{
  "status": "ok",
  "queue_size": 0
}
```

## 调用示例

### curl

```bash
# 完整调用（含LIS-RSS ID）
curl -X POST http://localhost:8081/process \
  -H "Content-Type: application/json" \
  -d '{"title": "Deep Learning for Computer Vision", "id": 123}'

# 跳过LIS-RSS上传（不传id参数）
curl -X POST http://localhost:8081/process \
  -H "Content-Type: application/json" \
  -d '{"title": "Deep Learning for Computer Vision"}'
```

### Python

```python
import requests

response = requests.post(
    "http://localhost:8081/process",
    json={"title": "Deep Learning for Computer Vision", "id": 123}
)
result = response.json()
print(result["success"], result.get("md_path"))
```

### Node.js

```javascript
const resp = await fetch("http://localhost:8081/process", {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify({title: "Deep Learning for Computer Vision", id: 123})
});
const result = await resp.json();
console.log(result.success, result.md_path);
```

## 行为说明

### 排队机制

- API 内部维护一个 **内存队列**
- 默认 **串行执行**（`max_concurrent=1`），一个任务完成后再处理下一个
- 多次调用时，任务按提交顺序排队

### LIS-RSS 上传控制

| 调用方式 | 行为 |
|----------|------|
| 传入 `id` | 正常执行 LIS-RSS 上传 |
| 不传 `id` 或传 `null` | 跳过 LIS-RSS 上传 |

### 返回时机

- `/process` 是 **阻塞端点**，返回时任务已处理完毕（包括上传）
- 任务在队列中的等待时间也计入响应延迟

### 服务重启

- 服务重启后 **队列丢失**，正在处理的任务结果也会丢失
- 适合个人项目最小可行性方案

## 错误处理

| 错误场景 | HTTP状态码 | 响应示例 |
|----------|------------|----------|
| 配置不存在 | 500 | `{"detail": "配置文件不存在"}` |
| 处理异常 | 500 | `{"detail": "处理异常: ..."}` |

常见失败原因：

- `PDF下载失败（所有脚本均失败）` - 下载脚本均不可用（检查网络、浏览器环境）
- `PDF文件名不匹配` - 下载的PDF文件名与标题相似度低于阈值
- `PDF总结失败` - 总结脚本执行失败
- `部分上传任务失败` - 部分子系统上传失败（非全部失败仍返回`success:true`）

## 项目结构

```
paper-pdf-summary/
├── api.py                  # FastAPI 入口
├── requirements_api.txt    # API依赖
├── main.py                 # CLI入口（原独立运行脚本）
├── config/
│   └── config.yaml         # 共用配置文件
└── utils/
    ├── api_queue.py        # 队列管理模块
    ├── pdf_downloader.py   # PDF下载器
    ├── pdf_validator.py    # PDF验证器
    ├── pdf_summarizer.py   # PDF总结生成
    └── summary_uploader.py # 并行上传模块
```

## systemd 服务部署

通过 systemd 管理服务，支持开机自启和崩溃自动恢复。

### 安装服务

```bash
sudo cp deploy/paper-pdf-summary-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable paper-pdf-summary-api
sudo systemctl start paper-pdf-summary-api
```

### 常用命令

```bash
# 查看状态
sudo systemctl status paper-pdf-summary-api

# 重启服务
sudo systemctl restart paper-pdf-summary-api

# 停止服务
sudo systemctl stop paper-pdf-summary-api

# 查看实时日志
sudo journalctl -u paper-pdf-summary-api -f
```

### 服务配置

| 配置项 | 值 |
|--------|-----|
| 服务名 | `paper-pdf-summary-api` |
| 监听地址 | `0.0.0.0:8081`（局域网可访问） |
| 重启策略 | 崩溃后 5 秒自动恢复 |
| 开机自启 | 已通过 `WantedBy=multi-user.target` 配置 |

服务文件路径：`deploy/paper-pdf-summary-api.service`

## 与原 CLI 的差异

| 特性 | CLI (main.py) | API (api.py) |
|------|---------------|--------------|
| 调用方式 | 命令行参数 | HTTP请求 |
| 队列机制 | 无 | 自动排队 |
| 任务去重 | 数据库记录 | 内存字典 |
| 日志 | 文件日志 | 文件日志（同DailyLogger） |
| 并发 | 串行 | 串行（可配置max_concurrent） |
| LIS-RSS控制 | `--id`参数 | `id`字段（可选） |
