# 每日总结 CLI 使用说明

## 概述

CLI 工具允许通过命令行或其他 LLM Agent 调用每日总结功能，无需浏览器登录。

## 配置

### 1. 设置 CLI API Key

在项目根目录的 `.env` 文件中添加：

```bash
CLI_API_KEY=your-secret-key-here
```

**生成安全密钥**：

```bash
# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Python
python -c "import secrets; print(secrets.token_hex(32))"
```

### 2. 启动服务

```bash
npm run dev
# 或 Windows
scripts\start.bat
```

服务默认运行在 `http://localhost:8007`

---

## CLI 使用

### 基本用法

```bash
tsx scripts/cli-daily-summary.ts --user-id 1 --api-key your-key
```

### 完整参数

| 参数 | 简写 | 说明 | 必需 |
|------|------|------|------|
| `--user-id` | `-u` | 用户 ID | 是 |
| `--api-key` | `-k` | CLI API 密钥 | 是 |
| `--date` | `-d` | 日期 (YYYY-MM-DD) | 否 |
| `--limit` | `-l` | 文章数量限制 | 否 |
| `--base-url` | | 服务地址 | 否 |
| `--json` | | 输出纯 JSON | 否 |
| `--pretty` | | 美化输出 | 否 |
| `--help` | `-h` | 帮助信息 | 否 |

### 使用示例

```bash
# 基本调用
tsx scripts/cli-daily-summary.ts --user-id 1 --api-key mykey

# 指定日期和文章数量
tsx scripts/cli-daily-summary.ts -u 1 -d 2025-02-11 -l 50 --api-key mykey

# 输出 JSON 格式
tsx scripts/cli-daily-summary.ts -u 1 --api-key mykey --json

# 使用环境变量中的 API Key
export CLI_API_KEY=mykey
tsx scripts/cli-daily-summary.ts --user-id 1

# 美化输出（带颜色和格式）
tsx scripts/cli-daily-summary.ts --user-id 1 --api-key mykey --pretty
```

---

## HTTP API 调用

### 端点信息

```
POST /api/daily-summary/cli
```

### 请求参数

**查询参数**：
- `user_id`: 用户 ID
- `api_key`: CLI API 密钥

**请求体**：
```json
{
  "date": "2025-02-11",  // 可选，默认今天
  "limit": 30            // 可选，默认 30
}
```

### 响应格式

**成功** (200)：
```json
{
  "status": "success",
  "data": {
    "date": "2025-02-11",
    "totalArticles": 15,
    "articlesByType": {
      "journal": [...],
      "blog": [...],
      "news": [...]
    },
    "summary": "...",
    "generatedAt": "2025-02-11T10:30:00.000Z"
  }
}
```

**无新文章** (200)：
```json
{
  "status": "empty",
  "message": "当日暂无通过的文章",
  "data": {
    "date": "2025-02-11",
    "totalArticles": 0,
    "articlesByType": {
      "journal": [],
      "blog": [],
      "news": []
    }
  }
}
```

**错误** (4xx/5xx)：
```json
{
  "status": "error",
  "error": "错误描述"
}
```

### cURL 示例

```bash
curl "http://localhost:8007/api/daily-summary/cli?user_id=1&api_key=mykey" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"limit": 30}'
```

---

## 其他语言调用示例

### Python

```python
import requests

response = requests.post(
    "http://localhost:8007/api/daily-summary/cli",
    params={"user_id": 1, "api_key": "mykey"},
    json={"limit": 30}
)
result = response.json()

if result["status"] == "success":
    print(result["data"]["summary"])
elif result["status"] == "empty":
    print("无新文章")
else:
    print("错误:", result["error"])
```

### JavaScript/Node.js

```javascript
const response = await fetch('http://localhost:8007/api/daily-summary/cli?user_id=1&api_key=mykey', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ limit: 30 })
});
const result = await response.json();

if (result.status === 'success') {
  console.log(result.data.summary);
}
```

### Go

```go
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
    "net/url"
)

func main() {
    baseURL, _ := url.Parse("http://localhost:8007/api/daily-summary/cli")
    params := url.Values{}
    params.Add("user_id", "1")
    params.Add("api_key", "mykey")
    baseURL.RawQuery = params.Encode()

    body, _ := json.Marshal(map[string]int{"limit": 30})
    resp, _ := http.Post(baseURL.String(), "application/json", bytes.NewBuffer(body))

    var result map[string]interface{}
    json.NewDecoder(resp.Body).Decode(&result)
}
```

---

## 注意事项

1. **无新文章时不会调用 LLM** - 系统会自动检测当日是否有通过的文章，无新文章时直接返回固定消息，避免浪费

2. **API Key 安全** - 请勿将 `CLI_API_KEY` 提交到代码仓库

3. **服务端口** - 默认端口 8007，可通过 `.env` 中的 `PORT` 变量修改

4. **认证方式** - CLI 端点使用 `user_id` + `api_key` 认证，与 Web 端的 Cookie 认证独立
