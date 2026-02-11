# 每日总结 CLI/API 调用功能

## Context

用户希望将每日总结功能封装为可被其他 LLM agent 调用的接口。当前项目已有完整的每日总结 API 实现，但使用 JWT Cookie 认证，不适合 CLI/外部调用。

**目标**：
- 提供 HTTP API 端点，支持通过命令行参数指定用户
- 返回完整的结构化 JSON 数据
- 避免无新文章时调用 LLM（已实现）

---

## 实现方案

### 1. 新增 CLI 认证中间件

**文件**: `src/middleware/auth.ts`

添加 `requireCliAuth` 中间件，支持通过以下方式认证：
- 查询参数: `?user_id=1&api_key=SECRET_KEY`
- 请求头: `X-API-Key`

```typescript
export function requireCliAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  // 1. 从查询参数或请求头获取 user_id 和 api_key
  // 2. 验证 api_key 是否匹配环境变量 CLI_API_KEY
  // 3. 验证 user_id 对应的用户是否存在
  // 4. 附加 userId 到请求对象
}
```

### 2. 新增 CLI 专用 API 端点

**文件**: `src/api/routes/daily-summary.routes.ts`

添加 `POST /api/daily-summary/cli` 端点：

**请求参数**:
- `user_id` (查询参数): 用户 ID
- `api_key` (查询参数): CLI API 密钥
- Body: `{ date?: string, limit?: number }`

**响应格式**:

成功 (200):
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

无新文章 (200):
```json
{
  "status": "empty",
  "message": "当日暂无通过的文章",
  "data": {
    "date": "2025-02-11",
    "totalArticles": 0,
    "articlesByType": { "journal": [], "blog": [], "news": [] }
  }
}
```

错误 (4xx/5xx):
```json
{
  "status": "error",
  "error": "错误描述"
}
```

### 3. 创建 CLI 脚本

**文件**: `scripts/cli-daily-summary.ts`

```bash
# 使用方式
tsx scripts/cli-daily-summary.ts --user-id 1 [--date 2025-02-11] [--limit 30] [--api-key SECRET]
```

**功能**:
- 解析命令行参数
- 调用 HTTP API
- 输出格式化结果（支持 --json 和 --pretty）

### 4. 环境变量配置

**文件**: `.env`

添加：
```
CLI_API_KEY=your-secret-key-here
```

---

## 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/middleware/auth.ts` | 修改 | 添加 `requireCliAuth` 中间件 |
| `src/api/routes/daily-summary.routes.ts` | 修改 | 添加 `/cli` 端点 |
| `src/api/daily-summary.ts` | 无修改 | 复用现有服务函数 |
| `scripts/cli-daily-summary.ts` | 新建 | CLI 脚本 |
| `.env` | 修改 | 添加 CLI_API_KEY |
| `README.md` | 可选 | 添加使用文档 |

---

## 复用的现有代码

1. **服务层**: `src/api/daily-summary.ts`
   - `generateDailySummary()` - 生成总结
   - `getDailyPassedArticles()` - 获取文章

2. **LLM 配置**: `src/llm.ts`
   - `getUserLLMProvider()` - 获取用户 LLM 配置

3. **系统提示词**: `src/api/system-prompts.ts`
   - `resolveSystemPrompt()` - 获取提示词模板

---

## 验证步骤

1. **环境变量测试**
   ```bash
   # 确认 CLI_API_KEY 已设置
   echo $CLI_API_KEY
   ```

2. **API 端点测试**
   ```bash
   # 无新文章场景
   curl "http://localhost:8007/api/daily-summary/cli?user_id=1&api_key=$CLI_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"limit": 30}'

   # 正常生成场景
   curl "http://localhost:8007/api/daily-summary/cli?user_id=1&api_key=$CLI_API_KEY"
   ```

3. **CLI 脚本测试**
   ```bash
   tsx scripts/cli-daily-summary.ts --user-id 1 --api-key $CLI_API_KEY
   tsx scripts/cli-daily-summary.ts --user-id 1 --date 2025-02-10 --json
   ```

4. **验证无新文章时不调用 LLM**
   - 检查日志 `src/api/daily-summary.ts:162` 处提前返回
   - 确认没有 LLM API 请求

---

## 使用示例

**CLI 调用**:
```bash
tsx scripts/cli-daily-summary.ts --user-id 1 --api-key mykey
```

**HTTP API 调用**:
```bash
curl "http://localhost:8007/api/daily-summary/cli?user_id=1&api_key=mykey" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"date": "2025-02-11", "limit": 30}'
```

**其他 LLM Agent 调用** (Python 示例):
```python
import requests

response = requests.post(
    "http://localhost:8007/api/daily-summary/cli",
    params={"user_id": 1, "api_key": "mykey"},
    json={"limit": 30}
)
result = response.json()
```
