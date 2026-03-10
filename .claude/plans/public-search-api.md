# 公开语义搜索API接口技术文档

## Context

现有的文章检索功能只对登录用户开放（需要JWT认证），外部服务无法调用。需要将语义搜索能力开放为公开API接口，供其他服务嵌入使用。

## 目标

1. 创建公开的搜索API端点，无需JWT登录
2. 使用 `.env` 中的 `CLI_API_KEY` 进行API密钥认证
3. 复用现有的统一检索服务（支持语义/关键词/混合搜索）
4. 外部服务可通过HTTP调用获取文章列表

## 关键文件

### 需要新建的文件

1. **`src/api/routes/public-search.routes.ts`**
   - 新建公开搜索API路由
   - 使用 `requireCliAuth` 中间件进行API Key认证

### 可复用的现有功能

1. **`src/middleware/auth.ts`** - 现有的CLI认证中间件
   - `requireCliAuth` - 验证 `CLI_API_KEY` 和 `user_id`

2. **`src/vector/search.ts`** - 统一检索服务
   - 支持四种模式：`SEMANTIC`、`KEYWORD`、`HYBRID`、`RELATED`
   - 详细的接口文档见 `docs/统一检索接口.md`

3. **`src/api/routes/search.routes.ts`** - 现有搜索API实现参考
   - 已有完整的搜索实现，可作为参考

## 实现方案

### 1. 新建公开搜索API路由

```typescript
// src/api/routes/public-search.routes.ts
import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireCliAuth } from '../../middleware/auth.js';
import { logger } from '../../logger.js';
import { search, SearchMode } from '../../vector/search.js';

const log = logger.child({ module: 'api-routes/public-search' });
const router = express.Router();

/**
 * GET /api/public/search
 * 公开的文章语义搜索接口
 *
 * Query parameters:
 * - q: 搜索关键词 (必需)
 * - mode: 搜索模式 - 'semantic' | 'keyword' | 'hybrid' (默认: 'hybrid')
 * - limit: 返回结果数量 (默认: 10, 最大: 100)
 * - offset: 分页偏移 (默认: 0)
 * - user_id: 用户ID (必需，用于获取该用户的文章)
 * - api_key: API密钥 (必需)
 *
 * Authentication:
 * - Header: X-API-Key: <CLI_API_KEY>
 * - 或 Query: api_key=<CLI_API_KEY>
 */
router.get('/search', requireCliAuth, async (req: AuthRequest, res) => {
  try {
    const query = req.query.q as string;
    const mode = (req.query.mode as string) || 'hybrid';
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: '搜索关键词不能为空' });
    }

    const searchMode = mode === 'semantic' ? SearchMode.SEMANTIC
      : mode === 'keyword' ? SearchMode.KEYWORD
      : SearchMode.HYBRID;

    log.info({ 
      userId: req.userId, 
      query, 
      mode, 
      limit, 
      offset 
    }, 'Public search request');

    const response = await search({
      mode: searchMode,
      userId: req.userId!,
      query: query.trim(),
      limit,
      offset,
      normalizeScores: true,
    });

    res.json({
      results: response.results.map((r) => ({
        id: r.articleId,
        title: r.metadata?.title,
        url: r.metadata?.url,
        summary: r.metadata?.summary,
        published_at: r.metadata?.published_at,
        source_origin: r.metadata?.source_origin,
        rss_source_name: r.metadata?.rss_source_name,
        journal_name: r.metadata?.journal_name,
        keyword_name: r.metadata?.keyword_name,
        relevance: r.score,
      })),
      mode: response.mode,
      query: response.query,
      total: response.total,
      limit: response.limit,
      offset: offset,
      totalPages: Math.ceil(response.total / limit),
      fallback: response.fallback,
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to search articles');
    res.status(500).json({ error: '搜索失败' });
  }
});

export default router;
```

### 2. 注册路由到主应用

在 `src/api/routes.ts` 或 `src/index.ts` 中注册新路由：

```typescript
import publicSearchRouter from './routes/public-search.routes.js';

// ... existing routes ...

// 公开API路由（需要API Key认证）
app.use('/api/public', publicSearchRouter);
```

### 3. 环境变量说明

在 `.env` 中配置：

```bash
# CLI API 密钥 - 用于每日总结 CLI/外部 API 调用
CLI_API_KEY=sk-s8sdjn73nsdnau
```

## API 接口设计

### 请求格式

```
GET /api/public/search?q=<关键词>&mode=<模式>&limit=<数量>&user_id=<用户ID>&api_key=<密钥>
```

或使用 Header 方式：

```
GET /api/public/search?q=<关键词>&mode=<模式>&limit=<数量>&user_id=<用户ID>
Header: X-API-Key: <密钥>
```

### 参数说明

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| q | string | 是 | - | 搜索关键词 |
| mode | string | 否 | hybrid | 搜索模式：semantic/keyword/hybrid |
| limit | number | 否 | 10 | 返回结果数量（最大100） |
| offset | number | 否 | 0 | 分页偏移 |
| user_id | number | 是 | - | 用户ID，决定搜索范围 |
| api_key | string | 是 | - | API密钥（CLI_API_KEY） |

### 响应格式

```json
{
  "results": [
    {
      "id": 123,
      "title": "文章标题",
      "url": "https://...",
      "summary": "文章摘要",
      "published_at": "2026-03-10T00:00:00.000Z",
      "source_origin": "rss",
      "rss_source_name": "来源名称",
      "relevance": 0.95
    }
  ],
  "mode": "hybrid",
  "query": "搜索词",
  "total": 50,
  "limit": 10,
  "offset": 0,
  "totalPages": 5,
  "fallback": false
}
```

### 错误响应

```json
// 401 未授权
{ "status": "error", "error": "Invalid api_key" }

// 400 参数错误
{ "error": "搜索关键词不能为空" }

// 500 服务器错误
{ "error": "搜索失败" }
```

## 调用示例

### cURL

```bash
# 语义搜索
curl "http://localhost:8007/api/public/search?q=机器学习&mode=semantic&limit=10&user_id=1&api_key=sk-s8sdjn73nsdnau"

# 混合搜索（默认）
curl "http://localhost:8007/api/public/search?q=人工智能&mode=hybrid&limit=20&user_id=1" \
  -H "X-API-Key: sk-s8sdjn73nsdnau"

# 关键词搜索
curl "http://localhost:8007/api/public/search?q=深度学习&mode=keyword&user_id=1&api_key=sk-s8sdjn73nsdnau"
```

### JavaScript

```javascript
async function searchArticles(query, mode = 'hybrid', limit = 10) {
  const response = await fetch(
    `http://localhost:8007/api/public/search?q=${encodeURIComponent(query)}&mode=${mode}&limit=${limit}&user_id=1`,
    {
      headers: {
        'X-API-Key': 'sk-s8sdjn73nsdnau'
      }
    }
  );
  return response.json();
}

// 使用示例
const results = await searchArticles('机器学习');
console.log(results.results);
```

## 搜索模式说明

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| semantic | 纯语义检索（向量相似度） | 理解查询意图，语义相关性 |
| keyword | 纯关键词检索（SQL LIKE） | 精确匹配，性能最好 |
| hybrid | 混合检索（语义+关键词，70/30权重） | 平衡准确性和召回率，推荐使用 |

## 验证步骤

1. **测试API Key验证**
   - 不提供api_key：应返回401错误
   - 提供错误的api_key：应返回401错误

2. **测试搜索功能**
   - 语义搜索：`q=机器学习&mode=semantic`
   - 关键词搜索：`q=机器学习&mode=keyword`
   - 混合搜索：`q=机器学习&mode=hybrid`

3. **测试分页**
   - 设置limit和offset参数
   - 验证返回的total和totalPages字段

4. **测试参数边界**
   - 不提供必需参数（q, user_id）
   - limit超过最大值（100）

5. **测试不同用户**
   - 使用不同的user_id，验证搜索结果范围不同
