# Telegram /getarticles 命令实现计划

## Context

用户希望在 Telegram Bot 中添加 `/getarticles` 命令，用于检索指定年月的未读文章，并保持现有的交互功能（评分、标记已读）。

### 现有基础

- **Telegram Bot**: `src/telegram/bot.ts` - 目前只处理 `callback_query`（内联键盘点击）
- **文章 API**: `GET /api/articles` - 支持按日期范围、已读状态筛选
- **键盘机制**: `createArticleKeyboard()` - 已实现文章交互键盘
- **消息格式**: `formatNewArticle()` - 已实现文章消息格式化

### 功能需求

- **命令格式**: `/getarticles YYYY-MM-DD` 或 `/getarticles YYYYMMDD`（如 `/getarticles 2026-3-1` 或 `/getarticles 20260301`）
- **检索条件**: 指定爬取日期 + 已读状态为未读
- **返回数量**: 最多 5 篇
- **交互支持**: 检索到的文章支持评分和标记已读（复用现有键盘）
- **输入灵活性**: 支持 `2026-3-1`、`2026-03-01` 和 `20260301` 三种格式

---

## 实施方案

### 架构设计

扩展现有的 TelegramBot 类，在处理 `callback_query` 的基础上增加对 `message` 类型的处理：

```
┌─────────────┐      轮询       ┌──────────────┐
│ Telegram Bot│ ───────────────►│ getUpdates() │
└─────────────┘                  └──────────────┘
       ▲                                │
       │                                ▼
       │                         ┌──────────────┐
       │                         │ processUpdates│
       │                         └──────────────┘
       │                                │
       │                    ┌───────────┴───────────┐
       │                    ▼                       ▼
       │            ┌──────────────┐        ┌──────────────┐
       │            │ callback_query│        │   message    │
       │            │   (已有)     │        │  (新增)      │
       │            └──────────────┘        └──────────────┘
       │                    │                       │
       │                    ▼                       ▼
       │            ┌──────────────┐        ┌──────────────┐
       │            │  键盘交互     │        │ /getarticles │
       │            │  (已有)     │        │   命令处理    │
       │            └──────────────┘        └──────────────┘
       │                                            │
       │                                            ▼
       │                                    ┌──────────────┐
       │                                    │ 检索文章    │
       │                                    │ 发送消息    │
       │                                    └──────────────┘
       └──────────────────────────────────────────────────┘
                    用户操作（键盘/命令）
```

---

## 实施步骤

### Step 1: 扩展类型定义

**修改**: `src/telegram/types.ts`

在现有类型基础上添加 `Message` 接口，并扩展 `TelegramUpdate`：

```typescript
/**
 * Telegram Message
 */
export interface Message {
  message_id: number;
  chat: {
    id: number;
    type: string;
  };
  date: number;
  text?: string;
  from?: TelegramUser;
}

/**
 * Update from Telegram getUpdates
 */
export interface TelegramUpdate {
  update_id: number;
  callback_query?: CallbackQuery;
  message?: Message;  // NEW: Add message support
}
```

---

### Step 2: 创建命令解析器

**新增**: `src/telegram/command-parser.ts`

```typescript
export interface GetArticlesCommand {
  year: number;
  month: number;
  day: number;
}

/**
 * Parse /getarticles command arguments
 * Supported formats:
 * - YYYY-M-D (e.g., 2026-3-1)
 * - YYYY-MM-DD (e.g., 2026-03-01)
 * - YYYYMMDD (e.g., 20260301)
 */
export function parseGetArticlesCommand(args: string): GetArticlesCommand | null {
  if (!args || args.trim() === '') {
    return null;
  }

  const trimmed = args.trim();

  // Try YYYY-MM-DD format (flexible: YYYY-M-D or YYYY-MM-DD)
  let match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  // Try YYYYMMDD format
  if (!match) {
    match = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  }

  if (!match) {
    return null;
  }

  const [, yearStr, monthStr, dayStr] = match;
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // Validate ranges
  if (year < 2000 || year > 2100) {
    return null;
  }

  if (month < 1 || month > 12) {
    return null;
  }

  // Validate day based on month
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) {
    return null;
  }

  return { year, month, day };
}
```

---

### Step 3: 扩展 TelegramBot 类

**修改**: `src/telegram/bot.ts`

#### 3.1 添加导入

在文件顶部添加：
```typescript
import { getUserArticles } from '../api/articles.js';
import { formatNewArticle, createArticleKeyboard } from './formatters.js';
import { parseGetArticlesCommand } from './command-parser.js';
```

#### 3.2 修改 `processUpdates()` 方法（约第 207 行）

在 `for (const update of updates)` 循环中添加 message 处理分支：

```typescript
for (const update of updates) {
  this.latestUpdateId = update.update_id;

  // NEW: Process message commands
  if (update.message) {
    const messageId = `${update.update_id}-msg`;
    this.pendingCallbacks.add(messageId);
    try {
      await this.handleMessage(update.message);
      successCount++;
    } catch (error) {
      errorCount++;
      throw error;
    } finally {
      this.pendingCallbacks.delete(messageId);
    }
    continue; // Skip callback processing for this update
  }

  // Existing callback processing
  if (update.callback_query) {
    // ... 现有代码保持不变 ...
  }
}
```

#### 3.3 添加新方法

在 `handleCancel()` 方法后添加以下方法：

```typescript
/**
 * Handle incoming message (commands)
 */
private async handleMessage(message: Message): Promise<void> {
  const { from, chat, text } = message;

  // Validate user (only allow configured user)
  const chatId = String(chat.id);
  if (chatId !== this.chatId) {
    log.warn({ from: from?.id, chatId }, 'Unauthorized message');
    await this.client.sendMessage(chatId, '❌ 无权操作');
    return;
  }

  // Parse command
  if (!text || !text.startsWith('/')) {
    return; // Ignore non-command messages
  }

  const parts = text.trim().split(/\s+/);
  const command = parts[0];

  switch (command) {
    case '/getarticles':
      await this.handleGetArticlesCommandWrapper(parts.slice(1).join(' '));
      break;

    default:
      log.debug({ command }, 'Unknown command');
  }
}

/**
 * Wrapper for getarticles command with error handling
 */
private async handleGetArticlesCommandWrapper(args: string): Promise<void> {
  try {
    const parsed = parseGetArticlesCommand(args);
    if (!parsed) {
      await this.client.sendMessage(this.chatId,
        '❌ 格式错误。正确格式：/getarticles YYYY-MM-DD 或 YYYYMMDD\n例如：/getarticles 2026-3-1 或 /getarticles 20260301');
      return;
    }

    const { year, month, day } = parsed;

    // Validate not in future
    const now = new Date();
    const cmdDate = new Date(year, month - 1, day);
    cmdDate.setHours(23, 59, 59, 999); // Set to end of the day
    if (cmdDate > now) {
      await this.client.sendMessage(this.chatId, '❌ 日期不能是未来时间');
      return;
    }

    await this.handleGetArticlesCommand(year, month, day);
  } catch (error) {
    log.error({ error, args }, 'Error in getarticles command');
    await this.client.sendMessage(this.chatId, '❌ 查询失败，请稍后重试');
  }
}

/**
 * Handle /getarticles command
 */
private async handleGetArticlesCommand(year: number, month: number, day: number): Promise<void> {
  // Format date string (YYYY-MM-DD)
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // Query articles for the specific date
  const result = await getUserArticles(this.userId, {
    createdAfter: dateStr,
    createdBefore: dateStr,
    isRead: false,
    filterStatus: 'passed',
    limit: 5,
    page: 1,
  });

  const articles = result.articles;

  if (articles.length === 0) {
    await this.client.sendMessage(this.chatId,
      `📭 ${year}年${month}月${day}日没有符合条件的未读文章`);
    return;
  }

  // Send summary
  await this.client.sendMessage(this.chatId,
    `📚 找到 ${articles.length} 篇${year}年${month}月${day}日的未读文章：`);

  // Send articles with delay to avoid rate limits
  for (const article of articles) {
    const message = formatNewArticle({
      title: article.title,
      url: article.url,
      sourceName: article.source_name || article.rss_source_name || article.journal_name || 'Unknown',
      sourceType: article.source_origin === 'journal' ? '期刊文章' : 'RSS订阅',
      summary: article.summary_zh || article.summary || undefined,
    });

    const keyboard = createArticleKeyboard(
      article.id,
      article.is_read === 1,
      article.rating
    );

    await this.client.sendMessageWithKeyboard(this.chatId, message, keyboard, 'HTML');

    // Rate limiting: 1 second between messages
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  log.info({ userId: this.userId, year, month, day, count: articles.length },
    'Sent articles via /getarticles command');
}
```

---

## 文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/telegram/command-parser.ts` | 命令解析和验证逻辑 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/telegram/types.ts` | 添加 Message 接口，扩展 TelegramUpdate |
| `src/telegram/bot.ts` | 添加 message 处理和命令处理器 |

---

## 用户交互流程

```
1. 用户发送命令
   支持以下三种格式：
   /getarticles 2026-3-1
   /getarticles 2026-03-01
   /getarticles 20260301

2. Bot 验证格式
   ✓ 有效格式: YYYY-MM-DD 或 YYYYMMDD
   ✓ 年份合理: 2000-2100
   ✓ 月份合理: 1-12
   ✓ 日期合理: 根据月份验证天数
   ✓ 非未来日期

3. Bot 查询文章
   created_at: 2026-03-01 (当天)
   is_read: 0 (未读)
   filter_status: 'passed'
   limit: 5

4. Bot 发送结果
   情况A: 找到文章
   ┌─────────────────────────────┐
   │ 📚 找到 3 篇2026年3月1日的未读文章：│
   └─────────────────────────────┘
   ┌─────────────────────────────┐
   │ 🆕 新文献推荐               │
   │ 【期刊文章】Nature          │
   │ 标题: Deep Learning...      │
   │ 摘要: ...                   │
   │ 🔗 链接                     │
   │ [⭐ 评分] [📖 标记已读]      │
   └─────────────────────────────┘
   ... (更多文章)

   情况B: 没有文章
   ┌─────────────────────────────┐
   │ 📭 2026年3月1日没有符合条件的未读文章 │
   └─────────────────────────────┘

5. 用户可对每篇文章进行交互
   - 点击评分按钮 → 显示评分键盘 → 提交评分
   - 点击标记已读 → 切换已读状态
```

---

## 验证步骤

### 功能测试

1. **基本功能测试**：
   - 发送 `/getarticles 2026-3-1`
   - 发送 `/getarticles 2026-03-01`
   - 发送 `/getarticles 20260301`
   - 验证返回指定日期的未读文章（最多5篇）
   - 验证每篇文章带有操作键盘
   - 验证评分和标记已读功能正常

2. **边界情况测试**：
   - 空结果：发送没有未读文章的日期
   - 日期验证：发送无效格式（如 `2026/3/1`、`2026-13-01`、`2026-2-30`、`20261301`）
   - 日期灵活性：测试 `2026-3-1`、`2026-03-01` 和 `20260301` 三种格式
   - 权限验证：非配置用户发送命令

3. **错误处理测试**：
   - 网络断开时的行为
   - 数据库查询失败时的行为

### 日志检查

确认以下日志正常输出：
- Bot 正确接收和解析命令
- 文章查询结果正确
- 消息发送成功
- 错误情况有适当的日志

---

## 技术细节

### 时区处理

- `created_at` 字段存储为 UTC 时间戳
- API 层已处理本地时区转换（通过 `buildUtcRangeFromLocalDate`）
- 命令解析的日期范围会被正确转换为 UTC 范围

### 速率限制

- 发送多条消息时，每条消息间隔 1 秒
- 避免触发 Telegram API 速率限制（同 chat 每秒 20 条消息）

### 并发控制

- 复用现有的 `pendingCallbacks` Set 防止重复处理
- 消息处理使用唯一 ID 格式：`${update_id}-msg`

### 错误处理

遵循现有模式：
- 文章不存在：友好提示
- 网络错误：自动重试提示
- 无效输入：格式说明提示

---

## 后期扩展（可选）

如果未来需要更多功能：
- **分页支持**: 添加 `offset` 参数支持获取更多文章
- **更多筛选**: 支持按来源、评级筛选
- **批量操作**: 一键标记所有检索到的文章为已读
- **更多命令**: 如 `/stats` 查看统计信息
