# API 接口设计文档

## 📋 概述

本文档详细描述 RSS 文献追踪系统的 RESTful API 接口设计。

## 🔐 认证机制

### JWT 认证

所有需要认证的 API 都需要在请求头中携带 JWT Token：

```
Authorization: Bearer <token>
```

### 获取 Token

通过登录接口获取 JWT Token，Token 有效期为 7 天。

---

## 📚 API 接口列表

### 1. 认证相关 API

#### 1.1 用户注册

**接口**：`POST /api/auth/register`

**请求体**：
```json
{
  "username": "testuser",
  "password": "password123",
  "email": "test@example.com"
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "username": "testuser",
    "email": "test@example.com",
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

**错误响应**：
```json
{
  "success": false,
  "error": "用户名已存在"
}
```

---

#### 1.2 用户登录

**接口**：`POST /api/auth/login`

**请求体**：
```json
{
  "username": "testuser",
  "password": "password123"
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "username": "testuser",
      "email": "test@example.com"
    }
  }
}
```

**错误响应**：
```json
{
  "success": false,
  "error": "用户名或密码错误"
}
```

---

#### 1.3 获取当前用户信息

**接口**：`GET /api/auth/me`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "username": "testuser",
    "email": "test@example.com",
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

---

### 2. RSS 源管理 API

#### 2.1 获取 RSS 源列表

**接口**：`GET /api/rss-sources`

**请求头**：
```
Authorization: Bearer <token>
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | integer | 否 | 页码，默认 1 |
| limit | integer | 否 | 每页数量，默认 20 |
| status | string | 否 | 状态筛选（active/inactive） |

**响应**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "arXiv AI",
      "url": "https://arxiv.org/rss/cs.AI",
      "status": "active",
      "last_fetched_at": "2024-01-15T10:30:00Z",
      "fetch_interval": 3600,
      "created_at": "2024-01-15T10:00:00Z"
    }
  ],
  "pagination": {
    "total": 5,
    "page": 1,
    "limit": 20,
    "total_pages": 1
  }
}
```

---

#### 2.2 创建 RSS 源

**接口**：`POST /api/rss-sources`

**请求头**：
```
Authorization: Bearer <token>
```

**请求体**：
```json
{
  "name": "arXiv AI",
  "url": "https://arxiv.org/rss/cs.AI",
  "fetch_interval": 3600
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "arXiv AI",
    "url": "https://arxiv.org/rss/cs.AI",
    "status": "active",
    "fetch_interval": 3600,
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

**错误响应**：
```json
{
  "success": false,
  "error": "RSS 源 URL 已存在"
}
```

---

#### 2.3 更新 RSS 源

**接口**：`PUT /api/rss-sources/:id`

**请求头**：
```
Authorization: Bearer <token>
```

**请求体**：
```json
{
  "name": "arXiv AI",
  "url": "https://arxiv.org/rss/cs.AI",
  "status": "active",
  "fetch_interval": 3600
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "arXiv AI",
    "url": "https://arxiv.org/rss/cs.AI",
    "status": "active",
    "fetch_interval": 3600,
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

---

#### 2.4 删除 RSS 源

**接口**：`DELETE /api/rss-sources/:id`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "message": "RSS 源已删除"
}
```

---

#### 2.5 立即抓取 RSS 源

**接口**：`POST /api/rss-sources/:id/fetch`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "message": "抓取任务已启动",
  "task_id": "12345"
}
```

---

### 3. 主题领域管理 API

#### 3.1 获取主题领域列表

**接口**：`GET /api/topic-domains`

**请求头**：
```
Authorization: Bearer <token>
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| include_keywords | boolean | 否 | 是否包含主题词，默认 false |

**响应**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "人工智能",
      "description": "AI 相关技术",
      "is_active": true,
      "priority": 10,
      "keywords": [
        {
          "id": 1,
          "keyword": "深度学习",
          "weight": 1.0,
          "is_active": true
        }
      ],
      "created_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

#### 3.2 创建主题领域

**接口**：`POST /api/topic-domains`

**请求头**：
```
Authorization: Bearer <token>
```

**请求体**：
```json
{
  "name": "人工智能",
  "description": "AI 相关技术",
  "priority": 10
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "人工智能",
    "description": "AI 相关技术",
    "is_active": true,
    "priority": 10,
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

---

#### 3.3 更新主题领域

**接口**：`PUT /api/topic-domains/:id`

**请求头**：
```
Authorization: Bearer <token>
```

**请求体**：
```json
{
  "name": "人工智能",
  "description": "AI 相关技术",
  "is_active": true,
  "priority": 10
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "人工智能",
    "description": "AI 相关技术",
    "is_active": true,
    "priority": 10,
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

---

#### 3.4 删除主题领域

**接口**：`DELETE /api/topic-domains/:id`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "message": "主题领域已删除"
}
```

---

### 4. 主题词管理 API

#### 4.1 获取主题词列表

**接口**：`GET /api/topic-domains/:domain_id/keywords`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "keyword": "深度学习",
      "description": "神经网络相关",
      "weight": 1.0,
      "is_active": true,
      "created_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

#### 4.2 创建主题词

**接口**：`POST /api/topic-domains/:domain_id/keywords`

**请求头**：
```
Authorization: Bearer <token>
```

**请求体**：
```json
{
  "keyword": "深度学习",
  "description": "神经网络相关",
  "weight": 1.0
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "keyword": "深度学习",
    "description": "神经网络相关",
    "weight": 1.0,
    "is_active": true,
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

---

#### 4.3 更新主题词

**接口**：`PUT /api/topic-keywords/:id`

**请求头**：
```
Authorization: Bearer <token>
```

**请求体**：
```json
{
  "keyword": "深度学习",
  "weight": 0.8,
  "is_active": true
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "keyword": "深度学习",
    "weight": 0.8,
    "is_active": true,
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

---

#### 4.4 删除主题词

**接口**：`DELETE /api/topic-keywords/:id`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "message": "主题词已删除"
}
```

---

### 5. 文章管理 API

#### 5.1 获取文章列表

**接口**：`GET /api/articles`

**请求头**：
```
Authorization: Bearer <token>
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | integer | 否 | 页码，默认 1 |
| limit | integer | 否 | 每页数量，默认 20 |
| rss_source_id | integer | 否 | RSS 源 ID 筛选 |
| filter_status | string | 否 | 过滤状态筛选（pending/passed/rejected/skipped） |
| process_status | string | 否 | 处理状态筛选（pending/processing/completed/failed） |
| start_date | string | 否 | 开始日期（YYYY-MM-DD） |
| end_date | string | 否 | 结束日期（YYYY-MM-DD） |

**响应**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "rss_source_id": 1,
      "title": "深度学习在图像识别中的应用",
      "url": "https://example.com/article1",
      "summary": "本文介绍了深度学习在图像识别领域的最新进展...",
      "filter_status": "passed",
      "filter_score": 0.85,
      "process_status": "completed",
      "published_at": "2024-01-15T10:00:00Z",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "total_pages": 5
  }
}
```

---

#### 5.2 获取文章详情

**接口**：`GET /api/articles/:id`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "rss_source_id": 1,
    "rss_source": {
      "id": 1,
      "name": "arXiv AI"
    },
    "title": "深度学习在图像识别中的应用",
    "url": "https://example.com/article1",
    "summary": "本文介绍了深度学习在图像识别领域的最新进展...",
    "content": "<p>本文介绍了深度学习在图像识别领域的最新进展...</p>",
    "markdown_content": "# 深度学习在图像识别中的应用\n\n本文介绍了...",
    "filter_status": "passed",
    "filter_score": 0.85,
    "filtered_at": "2024-01-15T10:35:00Z",
    "process_status": "completed",
    "processed_at": "2024-01-15T10:40:00Z",
    "published_at": "2024-01-15T10:00:00Z",
    "created_at": "2024-01-15T10:30:00Z",
    "filter_logs": [
      {
        "id": 1,
        "domain_id": 1,
        "domain_name": "人工智能",
        "is_passed": true,
        "relevance_score": 0.85,
        "matched_keywords": ["深度学习", "神经网络"],
        "filter_reason": "文章详细介绍了深度学习在图像识别中的应用，与主题高度相关"
      }
    ]
  }
}
```

---

#### 5.3 重新处理文章

**接口**：`POST /api/articles/:id/reprocess`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "message": "文章已加入重新处理队列",
  "task_id": "12345"
}
```

---

### 6. 过滤日志 API

#### 6.1 获取过滤日志

**接口**：`GET /api/article-filter-logs`

**请求头**：
```
Authorization: Bearer <token>
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | integer | 否 | 页码，默认 1 |
| limit | integer | 否 | 每页数量，默认 20 |
| article_id | integer | 否 | 文章 ID 筛选 |
| domain_id | integer | 否 | 主题领域 ID 筛选 |
| is_passed | boolean | 否 | 是否通过筛选 |
| start_date | string | 否 | 开始日期（YYYY-MM-DD） |
| end_date | string | 否 | 结束日期（YYYY-MM-DD） |

**响应**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "article_id": 1,
      "article_title": "深度学习在图像识别中的应用",
      "domain_id": 1,
      "domain_name": "人工智能",
      "is_passed": true,
      "relevance_score": 0.85,
      "matched_keywords": ["深度学习", "神经网络"],
      "filter_reason": "文章详细介绍了深度学习在图像识别中的应用，与主题高度相关",
      "created_at": "2024-01-15T10:35:00Z"
    }
  ],
  "pagination": {
    "total": 1000,
    "page": 1,
    "limit": 20,
    "total_pages": 50
  }
}
```

---

#### 6.2 获取过滤统计

**接口**：`GET /api/article-filter-stats`

**请求头**：
```
Authorization: Bearer <token>
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| start_date | string | 否 | 开始日期（YYYY-MM-DD） |
| end_date | string | 否 | 结束日期（YYYY-MM-DD） |
| domain_id | integer | 否 | 主题领域 ID 筛选 |

**响应**：
```json
{
  "success": true,
  "data": {
    "total": 1000,
    "passed": 600,
    "rejected": 300,
    "skipped": 100,
    "pass_rate": 0.6,
    "by_domain": [
      {
        "domain_id": 1,
        "domain_name": "人工智能",
        "total": 500,
        "passed": 350,
        "rejected": 100,
        "skipped": 50,
        "pass_rate": 0.7
      }
    ],
    "by_date": [
      {
        "date": "2024-01-15",
        "total": 100,
        "passed": 60,
        "rejected": 30,
        "skipped": 10
      }
    ]
  }
}
```

---

### 7. 大模型配置 API

#### 7.1 获取大模型配置列表

**接口**：`GET /api/llm-configs`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "provider": "openai",
      "base_url": "https://api.openai.com/v1",
      "model": "gpt-4o",
      "is_default": true,
      "timeout": 30,
      "max_retries": 3,
      "max_concurrent": 5,
      "created_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

#### 7.2 创建大模型配置

**接口**：`POST /api/llm-configs`

**请求头**：
```
Authorization: Bearer <token>
```

**请求体**：
```json
{
  "provider": "openai",
  "base_url": "https://api.openai.com/v1",
  "api_key": "sk-...",
  "model": "gpt-4o",
  "is_default": true
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "provider": "openai",
    "base_url": "https://api.openai.com/v1",
    "model": "gpt-4o",
    "is_default": true,
    "timeout": 30,
    "max_retries": 3,
    "max_concurrent": 5,
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

---

#### 7.3 更新大模型配置

**接口**：`PUT /api/llm-configs/:id`

**请求头**：
```
Authorization: Bearer <token>
```

**请求体**：
```json
{
  "base_url": "https://api.openai.com/v1",
  "api_key": "sk-...",
  "model": "gpt-4o"
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "provider": "openai",
    "base_url": "https://api.openai.com/v1",
    "model": "gpt-4o",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

---

#### 7.4 删除大模型配置

**接口**：`DELETE /api/llm-configs/:id`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "message": "大模型配置已删除"
}
```

---

#### 7.5 测试大模型连接

**接口**：`POST /api/llm-configs/:id/test`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "message": "连接成功",
  "data": {
    "model": "gpt-4o",
    "response_time": 1234
  }
}
```

**错误响应**：
```json
{
  "success": false,
  "error": "连接失败：API Key 无效"
}
```

---

### 8. 系统设置 API

#### 8.1 获取系统设置

**接口**：`GET /api/settings`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "data": {
    "timezone": "Asia/Shanghai",
    "language": "zh-CN",
    "date_format": "YYYY-MM-DD",
    "email_notifications": {
      "enabled": true,
      "email": "user@example.com"
    },
    "telegram_notifications": {
      "enabled": true,
      "bot_token": "...",
      "chat_id": "123456789"
    }
  }
}
```

---

#### 8.2 更新系统设置

**接口**：`PUT /api/settings`

**请求头**：
```
Authorization: Bearer <token>
```

**请求体**：
```json
{
  "timezone": "Asia/Shanghai",
  "language": "zh-CN",
  "date_format": "YYYY-MM-DD",
  "email_notifications": {
    "enabled": true,
    "email": "user@example.com"
  },
  "telegram_notifications": {
    "enabled": true,
    "bot_token": "...",
    "chat_id": "123456789"
  }
}
```

**响应**：
```json
{
  "success": true,
  "message": "设置已更新"
}
```

---

#### 8.3 获取系统统计

**接口**：`GET /api/settings/stats`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "data": {
    "database_size": "125 MB",
    "article_count": 1234,
    "rss_source_count": 5,
    "topic_domain_count": 3,
    "topic_keyword_count": 23,
    "filter_log_count": 1000
  }
}
```

---

#### 8.4 备份数据

**接口**：`POST /api/settings/backup`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "data": {
    "backup_url": "/downloads/backup-20240115.zip",
    "backup_size": "125 MB",
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

---

#### 8.5 恢复数据

**接口**：`POST /api/settings/restore`

**请求头**：
```
Authorization: Bearer <token>
```

**请求体**：
```json
{
  "backup_file": "backup-20240115.zip"
}
```

**响应**：
```json
{
  "success": true,
  "message": "数据恢复成功"
}
```

---

#### 8.6 清空缓存

**接口**：`POST /api/settings/clear-cache`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "message": "缓存已清空",
  "data": {
    "cache_size_before": "50 MB",
    "cache_size_after": "0 MB"
  }
}
```

---

### 9. 系统提示词管理 API

#### 9.1 获取系统提示词列表

**接口**：`GET /api/system-prompts`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "type": "filter",
      "name": "文章过滤",
      "description": "用于判断文章是否与主题领域相关的过滤提示词",
      "template": "你是一个专业的文献筛选助手...",
      "is_active": true,
      "created_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

#### 9.2 获取指定类型的系统提示词

**接口**：`GET /api/system-prompts/:type`

**请求头**：
```
Authorization: Bearer <token>
```

**路径参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 是 | 提示词类型（filter/summary） |

**响应**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "type": "filter",
    "name": "文章过滤",
    "description": "用于判断文章是否与主题领域相关的过滤提示词",
    "template": "你是一个专业的文献筛选助手...",
    "is_active": true,
    "created_at": "2024-01-15T10:00:00Z",
    "updated_at": "2024-01-15T10:00:00Z"
  }
}
```

---

#### 9.3 创建系统提示词

**接口**：`POST /api/system-prompts`

**请求头**：
```
Authorization: Bearer <token>
```

**请求体**：
```json
{
  "type": "filter",
  "name": "文章过滤",
  "description": "用于判断文章是否与主题领域相关的过滤提示词",
  "template": "你是一个专业的文献筛选助手...",
  "is_active": true
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "type": "filter",
    "name": "文章过滤",
    "description": "用于判断文章是否与主题领域相关的过滤提示词",
    "template": "你是一个专业的文献筛选助手...",
    "is_active": true,
    "created_at": "2024-01-15T10:00:00Z",
    "updated_at": "2024-01-15T10:00:00Z"
  }
}
```

**错误响应**：
```json
{
  "success": false,
  "error": "该类型的系统提示词已存在"
}
```

---

#### 9.4 更新系统提示词

**接口**：`PUT /api/system-prompts/:id`

**请求头**：
```
Authorization: Bearer <token>
```

**请求体**：
```json
{
  "name": "文章过滤",
  "description": "用于判断文章是否与主题领域相关的过滤提示词",
  "template": "你是一个专业的文献筛选助手...",
  "is_active": true
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "type": "filter",
    "name": "文章过滤",
    "description": "用于判断文章是否与主题领域相关的过滤提示词",
    "template": "你是一个专业的文献筛选助手...",
    "is_active": true,
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

---

#### 9.5 删除系统提示词

**接口**：`DELETE /api/system-prompts/:id`

**请求头**：
```
Authorization: Bearer <token>
```

**响应**：
```json
{
  "success": true,
  "message": "系统提示词已删除"
}
```

---

#### 9.6 重置系统提示词为默认值

**接口**：`POST /api/system-prompts/:type/reset`

**请求头**：
```
Authorization: Bearer <token>
```

**路径参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 是 | 提示词类型（filter/summary） |

**响应**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "type": "filter",
    "name": "文章过滤",
    "description": "用于判断文章是否与主题领域相关的过滤提示词",
    "template": "你是一个专业的文献筛选助手...",
    "is_active": true,
    "updated_at": "2024-01-15T10:30:00Z"
  },
  "message": "系统提示词已重置为默认值"
}
```

---

### 10. 语义搜索 API

#### 9.1 语义搜索

**接口**：`GET /api/search`

**请求头**：
```
Authorization: Bearer <token>
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 搜索关键词 |
| page | integer | 否 | 页码，默认 1 |
| limit | integer | 否 | 每页数量，默认 10 |

**响应**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "深度学习在图像识别中的应用",
      "url": "https://example.com/article1",
      "summary": "本文介绍了深度学习在图像识别领域的最新进展...",
      "score": 0.95,
      "highlight": "本文介绍了<em>深度学习</em>在图像识别领域的最新进展..."
    }
  ],
  "pagination": {
    "total": 10,
    "page": 1,
    "limit": 10,
    "total_pages": 1
  }
}
```

---

## 📊 通用响应格式

### 成功响应

```json
{
  "success": true,
  "data": { ... }
}
```

或

```json
{
  "success": true,
  "message": "操作成功"
}
```

### 错误响应

```json
{
  "success": false,
  "error": "错误信息"
}
```

### 分页响应

```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "total_pages": 5
  }
}
```

---

## 🔒 HTTP 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 201 | 创建成功 |
| 400 | 请求参数错误 |
| 401 | 未认证 |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

---

## 📝 错误码

| 错误码 | 说明 |
|--------|------|
| AUTH_001 | 用户名或密码错误 |
| AUTH_002 | Token 无效或已过期 |
| AUTH_003 | 用户名已存在 |
| RSS_001 | RSS 源 URL 无效 |
| RSS_002 | RSS 源已存在 |
| RSS_003 | RSS 源不存在 |
| TOPIC_001 | 主题领域已存在 |
| TOPIC_002 | 主题领域不存在 |
| KEYWORD_001 | 主题词已存在 |
| KEYWORD_002 | 主题词不存在 |
| ARTICLE_001 | 文章不存在 |
| LLM_001 | LLM 配置不存在 |
| LLM_002 | LLM 连接失败 |
| PROMPT_001 | 系统提示词已存在 |
| PROMPT_002 | 系统提示词不存在 |
| PROMPT_003 | 不支持的提示词类型 |
| SERVER_001 | 服务器内部错误 |

---

## 🚀 使用示例

### 使用 cURL

```bash
# 登录
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"password123"}'

# 获取 RSS 源列表
curl -X GET http://localhost:3000/api/rss-sources \
  -H "Authorization: Bearer <token>"

# 创建 RSS 源
curl -X POST http://localhost:3000/api/rss-sources \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"arXiv AI","url":"https://arxiv.org/rss/cs.AI","fetch_interval":3600}'
```

### 使用 JavaScript (fetch)

```javascript
// 登录
const loginResponse = await fetch('http://localhost:3000/api/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    username: 'testuser',
    password: 'password123'
  })
});
const loginData = await loginResponse.json();
const token = loginData.data.token;

// 获取 RSS 源列表
const rssSourcesResponse = await fetch('http://localhost:3000/api/rss-sources', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const rssSourcesData = await rssSourcesResponse.json();
console.log(rssSourcesData.data);
```

---

## 📚 参考资料

- [RESTful API 设计指南](https://restfulapi.net/)
- [Express.js 文档](https://expressjs.com/)
- [JWT 认证](https://jwt.io/)

---

**文档版本**：v1.0  
**创建日期**：2024-01-15  
**最后更新**：2024-01-15
