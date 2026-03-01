# Telegram 通知模块开发计划

## Context

LIS-RSS-Daily 是一个 RSS 文献追踪系统，用户希望在每日总结生成后自动推送到 Telegram。项目已有完整的设计文档 `docs/telegram-integration-plan.md`，本计划基于该文档和现有代码模式制定详细的实现方案。

**关键约束**：
- Telegram API 调用必须通过代理 `http://127.0.0.1:7890`
- 配置存储在 Settings 表（用户级配置，每个用户有自己的 bot token 和 chat id）

---

## 推荐方案

### HTTP 客户端选择

**使用 fetch API + undici ProxyAgent**，而非 node-telegram-bot-api 库：

理由：
1. 项目已使用 undici（rss-parser.ts），保持技术栈一致性
2. 更好的控制力：重试逻辑、代理配置、超时管理完全可控
3. 项目已有成熟的重试模式可复用（embedding-client.ts）
4. Telegram Bot API 是简单的 REST API，无需复杂封装

---

## 实施步骤

### Step 1: 创建 Telegram 模块

**新增文件**：

#### `src/telegram/types.ts`
```typescript
export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
  dailySummary: boolean;
  newArticles: boolean;
}

export interface DailySummaryData {
  date: string;
  type: 'journal' | 'blog_news' | 'all';
  totalArticles: number;
  summary: string;
  articlesByType: {
    journal: number;
    blog: number;
    news: number;
  };
}
```

#### `src/telegram/client.ts`
- 使用 `undici` 的 `ProxyAgent` 支持代理
- 从环境变量 `TELEGRAM_PROXY` 读取代理地址
- 3次重试，指数退避（500ms * 2^attempt）
- 30秒超时（AbortController）
- 仅在 5xx 或 429 状态码时重试
- 日志记录使用 pino，子模块名为 'telegram-client'

#### `src/telegram/formatters.ts`
- `formatDailySummary(data)` - 格式化每日总结消息
- 消息格式使用 Markdown（非 MarkdownV2），更简单
- 截断超长内容（Telegram 限制 4096 字符）

#### `src/telegram/index.ts`
- `TelegramNotifier` 类，提供 `sendDailySummary(userId, data)` 和 `testConnection(userId)` 方法
- 单例模式导出 `getTelegramNotifier()`

---

### Step 2: 添加 Settings API

**修改文件**：

#### `src/api/settings.ts`
参考 `getChromaSettings` 和 `updateChromaSettings` 的实现模式，添加：

```typescript
export async function getTelegramSettings(userId: number): Promise<{
  enabled: boolean;
  botToken: string;
  chatId: string;
  dailySummary: boolean;
  newArticles: boolean;
}>

export async function updateTelegramSettings(
  userId: number,
  config: Partial<TelegramConfig>
): Promise<void>
```

#### `src/api/routes/settings.routes.ts`
添加三个路由：
- `GET /api/settings/telegram` - 获取配置（bot token 部分遮蔽显示）
- `PUT /api/settings/telegram` - 更新配置（requireAdmin）
- `POST /api/settings/telegram/test` - 测试连接（requireAdmin）

---

### Step 3: 创建设置页面 UI

**新增文件**：

#### `src/views/settings/panel-telegram.ejs`
- 启用通知开关
- Bot Token 输入框
- Chat ID 输入框
- 推送内容复选框（每日总结、新增文章）
- 测试连接按钮、保存按钮
- 状态消息显示区域

**修改文件**：

#### `src/views/settings/body.ejs`
添加 Telegram tab 和面板引用

#### `src/public/js/settings.js`
添加 Telegram 相关逻辑：
- `loadTelegramSettings()` - 加载配置
- 表单提交处理 - 保存配置
- 测试连接按钮处理
- 启用/禁用切换时更新表单状态

---

### Step 4: 集成到每日总结

**修改文件**：

#### `src/api/daily-summary.ts`
在 `generateDailySummary` 函数末尾，return 之前添加：

```typescript
// 推送到 Telegram（异步，不阻塞主流程）
import { getTelegramNotifier } from '../telegram/index.js';

getTelegramNotifier().sendDailySummary(userId, {
  date: result.date,
  type: result.type,
  totalArticles: result.totalArticles,
  summary: result.summary,
  articlesByType: {
    journal: result.articlesByType.journal.length,
    blog: result.articlesByType.blog.length,
    news: result.articlesByType.news.length,
  },
}).catch(err => {
  log.warn({ error: err }, 'Failed to send daily summary to Telegram');
});
```

---

### Step 5: 添加配置

**修改文件**：

#### `src/config.ts`
在 `Config` 接口添加：
```typescript
telegramProxy?: string;
```

在 `getConfig()` 函数添加：
```typescript
telegramProxy: process.env.TELEGRAM_PROXY,
```

#### `.env`（或 .env.example）
添加：
```bash
# Telegram Proxy
TELEGRAM_PROXY=http://127.0.0.1:7890
```

---

## 关键文件路径

### 新增文件
| 文件 | 说明 |
|------|------|
| `src/telegram/types.ts` | 类型定义 |
| `src/telegram/client.ts` | Telegram API 客户端 |
| `src/telegram/formatters.ts` | 消息格式化 |
| `src/telegram/index.ts` | 模块导出 |
| `src/views/settings/panel-telegram.ejs` | 设置面板 UI |

### 修改文件
| 文件 | 修改内容 |
|------|----------|
| `src/api/settings.ts` | 添加 `getTelegramSettings`, `updateTelegramSettings` |
| `src/api/routes/settings.routes.ts` | 添加 Telegram API 路由 |
| `src/views/settings/body.ejs` | 添加 Telegram tab |
| `src/public/js/settings.js` | 添加 Telegram 前端逻辑 |
| `src/api/daily-summary.ts` | 集成 Telegram 推送 |
| `src/config.ts` | 添加 telegramProxy 配置 |

---

## 可复用的现有实现

| 位置 | 可复用内容 |
|------|-----------|
| `src/rss-parser.ts` | undici ProxyAgent 使用方式 |
| `src/vector/embedding-client.ts` | 重试机制实现模式 |
| `src/api/settings.ts` | `getChromaSettings`, `updateChromaSettings` 实现模式 |
| `src/logger.ts` | pino 日志使用方式 |

---

## Settings 表字段

| Key | Type | 默认值 |
|-----|------|--------|
| `telegram_enabled` | boolean | `false` |
| `telegram_bot_token` | string | `""` |
| `telegram_chat_id` | string | `""` |
| `telegram_daily_summary` | boolean | `false` |
| `telegram_new_articles` | boolean | `false` |

---

## 消息格式示例

```
📅 每日文献总结
🗓 2026-03-01

📊 统计
  期刊精选: 40 篇
  博客推荐: 15 篇
  资讯动态: 5 篇
  总计: 60 篇

📝 内容摘要
[LLM 生成的总结内容，最多 3500 字符]
```

---

## 验证步骤

1. **依赖检查**：确认 undici 已在 package.json 中（项目中已有）
2. **配置设置**：在 .env 中添加 `TELEGRAM_PROXY=http://127.0.0.1:7892`
3. **创建 Telegram Bot**：
   - 在 Telegram 搜索 @BotFather
   - 发送 /newbot 创建 bot
   - 保存 Bot Token
4. **获取 Chat ID**：
   - 搜索 @userinfobot
   - 发送 /start 获取 Chat ID
5. **配置测试**：
   - 登录系统，进入设置 → Telegram 通知
   - 填写 Bot Token 和 Chat ID
   - 点击「测试连接」，验证收到消息
   - 勾选「每日总结」，保存
6. **功能验证**：
   - 生成每日总结（手动触发或等待定时任务）
   - 检查 Telegram 是否收到推送消息
7. **日志检查**：
   - 确认日志中显示 "Daily summary sent to Telegram"

---

## 注意事项

1. **安全性**：Bot Token 存储在数据库中，需确保数据库访问安全
2. **可靠性**：Telegram 推送失败不阻塞主流程，记录 warn 级别日志
3. **错误处理**：网络错误、5xx、429 状态码会重试，其他错误直接返回
4. **性能**：推送异步执行，不阻塞每日总结生成
5. **限流**：Telegram Bot API 限制每秒 20 条消息（同群组），当前场景不会触发

---

## 后期扩展：新增文章推送

当前设计已预留扩展能力，阶段二实现**非常简单**：

### 扩展点 1：Settings 表字段
已有 `telegram_new_articles` 字段，UI 中已预留（目前 disabled）

### 扩展点 2：消息格式化
在 `src/telegram/formatters.ts` 添加：
```typescript
export function formatNewArticle(article: Article): string {
  return `🆕 新文献推荐\n\n【${article.source_type}】\n标题: ${article.title}\n...`;
}
```

### 扩展点 3：推送入口
**模式 A - 即时推送**（推荐）：
在文章过滤通过后调用（`src/pipeline.ts` 或相关位置）：
```typescript
if (filterResult.passed && config.telegram_new_articles) {
  getTelegramNotifier().sendNewArticle(userId, article).catch(err => {
    log.warn({ error: err }, 'Failed to send article to Telegram');
  });
}
```

**模式 B - 定时汇总**：
创建定时任务，每小时汇总新文章：
```typescript
// src/telegram/scheduler.ts
export async function sendHourlyDigest(userId: number): Promise<void> {
  const articles = await getArticlesSinceLastDigest(userId);
  if (articles.length > 0) {
    await getTelegramNotifier().sendArticleDigest(userId, articles);
  }
}
```

### 扩展点 4：Notifier 类方法
在 `src/telegram/index.ts` 的 `TelegramNotifier` 类添加：
```typescript
async sendNewArticle(userId: number, article: Article): Promise<void> {
  const config = await this.getConfig(userId);
  if (!config || !config.newArticles) return;

  const client = new TelegramClient(config.botToken);
  const message = formatNewArticle(article);
  await client.sendMessage(config.chatId, message);
}
```

### 扩展性总结
- ✅ Settings 字段已预留
- ✅ `TelegramClient` 复用（无需修改）
- ✅ 重试机制、代理配置自动生效
- ✅ 只需添加格式化函数和调用入口
- ✅ UI 只需移除 disabled 属性

**阶段二开发工作量**：约 30-50 行代码，1-2 小时即可完成
