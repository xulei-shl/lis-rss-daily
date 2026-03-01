# Telegram 双向交互功能实现计划

## Context

LIS-RSS-Daily 项目已实现 Telegram 单向推送功能（每日总结、新文章推送）。用户希望在 Telegram 消息中直接操作文章，实现**标记已读**和**评分**功能，无需切换到 Web 界面。

### 现有基础

- **Telegram Client**: `src/telegram/client.ts` - 支持基础消息发送，使用 undici 代理
- **消息格式化**: `src/telegram/formatters.ts` - HTML 格式支持
- **文章操作 API**: `PATCH /api/articles/:id/rating` 和 `PATCH /api/articles/:id/read`
- **数据库**: Articles 表有 `rating` (1-5|null) 和 `is_read` (0/1) 字段

### 用户选择

- **接收方式**: 轮询模式（无需公网域名，部署简单）
- **评分样式**: 数字 emoji（1⃣2⃣3⃣4⃣5⃣）
- **功能范围**: 仅核心功能（标记已读 + 评分）
- **每日总结**: 不需要交互功能

---

## 实施方案

### 架构设计

采用**轮询模式**，在现有服务启动时启动 Telegram Bot，通过 `getUpdates` API 获取用户操作。

```
┌─────────────┐     轮询      ┌──────────────┐
│ Telegram Bot│ ────────────► │ getUpdates() │
└─────────────┘              └──────────────┘
       ▲                            │
       │ Callback                   │
       │                            ▼
┌─────────────┐              ┌──────────────┐
│   用户操作   │ ────────────►│ Bot 处理器    │
└─────────────┘              └──────────────┘
                                    │
                                    ▼
                             ┌──────────────┐
                             │ 文章操作 API  │
                             └──────────────┘
```

---

## 实施步骤

### Step 1: 扩展 Telegram Client

**修改**: `src/telegram/client.ts`

添加以下方法：

```typescript
// 新增类型
export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

// 发送带键盘的消息
async sendMessageWithKeyboard(
  chatId: string,
  text: string,
  keyboard: InlineKeyboardMarkup,
  parseMode?: 'HTML'
): Promise<TelegramMessageResponse>

// 编辑消息键盘
async editMessageReplyMarkup(
  chatId: string,
  messageId: number,
  keyboard: InlineKeyboardMarkup
): Promise<TelegramMessageResponse>

// 回答 callback query
async answerCallbackQuery(
  queryId: string,
  text?: string,
  showAlert?: boolean
): Promise<{ ok: boolean }>

// 获取更新（轮询）
async getUpdates(
  offset?: number,
  limit?: number,
  timeout?: number
): Promise<{ ok: boolean; result: any[] }>
```

---

### Step 2: 创建 Callback 编码器

**新增**: `src/telegram/callback-encoder.ts`

```typescript
export enum CallbackAction {
  MARK_READ = 'mr',      // 标记已读/未读
  RATE = 'rt',           // 提交评分
  SHOW_RATING = 'sr',    // 显示评分键盘
  CANCEL = 'cl',         // 取消
}

// 编码: "action:articleId:value"
export function encodeCallback(
  action: CallbackAction,
  articleId: number,
  value?: string | number
): string

// 解析 callback_data
export function decodeCallback(
  data: string
): { action: CallbackAction; articleId: number; value?: string } | null
```

---

### Step 3: 扩展消息格式化

**修改**: `src/telegram/formatters.ts`

添加键盘生成函数：

```typescript
import type { InlineKeyboardMarkup } from './client.js';

// 为新文章创建操作键盘
export function createArticleKeyboard(
  articleId: number,
  isRead: boolean,
  currentRating: number | null
): InlineKeyboardMarkup

// 创建评分选择键盘
export function createRatingKeyboard(
  articleId: number
): InlineKeyboardMarkup
```

**键盘布局**：

初始键盘：
```
┌──────────────┐
│ ⭐ 评分       │  ← 点击显示评分键盘
├──────────────┤
│ 📖 标记已读   │  ← 切换已读/未读状态
└──────────────┘
```

评分键盘：
```
┌───┬───┬───┐
│ 1⃣ │ 2⃣ │ 3⃣ │
├───┼───┼───┤
│ 4⃣ │ 5⃣ │   │
└───┴───┴───┘
│ ❌ 取消    │
└───────────┘
```

---

### Step 4: 创建 Telegram Bot

**新增**: `src/telegram/bot.ts`

```typescript
export class TelegramBot {
  constructor(botToken: string, userId: number, chatId: string)

  // 启动轮询
  async start(): Promise<void>

  // 停止轮询
  async stop(): Promise<void>

  // 处理 callback query
  private async handleCallbackQuery(callbackQuery: any): Promise<void>

  // 标记已读/未读
  private async handleMarkRead(...): Promise<void>

  // 提交评分
  private async handleRate(...): Promise<void>

  // 显示评分键盘
  private async handleShowRating(...): Promise<void>

  // 取消操作
  private async handleCancel(...): Promise<void>
}
```

**关键逻辑**：

1. **用户验证**: 检查 callback 来自配置的 chat_id
2. **文章权限**: 通过 `getArticleById(articleId, userId)` 验证所有权
3. **状态同步**: 操作后重新查询文章状态，更新按钮
4. **错误处理**: 网络错误自动重试，用户操作失败显示提示

---

### Step 5: 扩展类型定义

**修改**: `src/telegram/types.ts`

添加 Inline Keyboard 相关类型：

```typescript
export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TelegramMessageResponse {
  ok: boolean;
  result?: {
    message_id: number;
    // ... 现有字段
  };
  // ... 现有字段
}
```

---

### Step 6: 修改推送通知

**修改**: `src/telegram/index.ts`

在 `TelegramNotifier` 类中修改 `sendNewArticle` 方法：

```typescript
async sendNewArticle(userId: number, article: ArticleWithSource): Promise<boolean> {
  // ... 现有配置检查 ...

  const message = formatNewArticle(...);
  const keyboard = createArticleKeyboard(
    article.id,
    article.is_read === 1,
    article.rating
  );

  await client.sendMessageWithKeyboard(
    config.chatId,
    message,
    keyboard,
    'HTML'
  );
}
```

---

### Step 7: 集成到启动流程

**修改**: `src/index.ts`

在 `main()` 函数中添加 Telegram Bot 初始化：

```typescript
import { initTelegramBot } from './telegram/bot.js';

// 在 journal scheduler 启动之后
const telegramBot = initTelegramBot();
if (telegramBot) {
  await telegramBot.start();
  log.info('🤖 Telegram bot started');
}

// 在 shutdown 函数中添加
await telegramBot?.stop();
log.info('🤖 Telegram bot stopped');
```

**新增**: `src/telegram/bot-manager.ts`（可选，用于多用户管理）

```typescript
export async function initTelegramBot(): Promise<TelegramBot | null> {
  // 查询所有启用 Telegram 的用户
  // 为每个用户创建独立的 Bot 实例
  // 返回第一个 Bot（简化实现）或 Bot 管理器
}
```

---

## 文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/telegram/callback-encoder.ts` | Callback data 编解码 |
| `src/telegram/bot.ts` | Telegram Bot 轮询和 callback 处理 |
| `src/telegram/bot-manager.ts` | 多用户 Bot 管理（可选） |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/telegram/client.ts` | 添加 Inline Keyboard 和 getUpdates 方法 |
| `src/telegram/formatters.ts` | 添加键盘生成函数 |
| `src/telegram/types.ts` | 添加 InlineKeyboard 类型定义 |
| `src/telegram/index.ts` | 修改 sendNewArticle 使用键盘 |
| `src/index.ts` | 添加 Telegram Bot 启动/关闭逻辑 |

---

## 用户交互流程

```
1. 用户收到新文章推送
   ┌─────────────────────────────┐
   │ 🆕 新文献推荐               │
   │ 【期刊精选】Nature          │
   │ 标题: Deep Learning...      │
   │                             │
   │ [⭐ 评分] [📖 标记已读]      │
   └─────────────────────────────┘

2. 用户点击 "📖 标记已读"
   → 按钮变为 "✅ 已读"
   → 提示: "✅ 已标记为已读"
   → 数据库: is_read = 1

3. 用户点击 "⭐ 评分"
   ┌─────────────────────────────┐
   │ [1⃣] [2⃣] [3⃣]            │
   │ [4⃣] [5⃣]                 │
   │ [❌ 取消]                   │
   └─────────────────────────────┘

4. 用户点击 "4⃣"
   → 按钮变为 "⭐⭐⭐⭐"
   → 自动显示 "✅ 已读"（评分自动标记已读）
   → 提示: "⭐ 已评为 4 星"
   → 数据库: rating = 4, is_read = 1

5. 用户再次点击 "⭐⭐⭐⭐"
   → 显示评分键盘，可修改评分
```

---

## 安全考虑

1. **Chat ID 验证**: 拒绝非配置 chat 的 callback
2. **文章所有权**: 通过 `getArticleById(articleId, userId)` 验证
3. **Callback 格式**: 解析失败时拒绝操作
4. **权限控制**: 只有配置了 Telegram 的用户才能操作

---

## 验证步骤

1. **功能测试**：
   - 发送测试文章推送
   - 点击"标记已读"，验证按钮状态变化
   - 点击"评分"，选择星级，验证评分保存
   - 在 Web 界面确认状态同步

2. **错误处理**：
   - 测试网络断开情况
   - 测试已删除文章的操作
   - 测试并发操作

3. **日志检查**：
   - 确认 Bot 正常启动
   - 确认 callback 处理日志
   - 确认错误处理日志

---

## 技术限制

- **Callback data 限制**: 64 字节（我们的格式 `mr:12345:1` 仅 10 字节）
- **速率限制**: 同一 chat 每秒 20 条消息（我们的操作每次 2 条请求，符合限制）
- **轮询延迟**: 5-30 秒（可配置）
- **并发处理**: 顺序处理 callback，避免冲突

---

## 后期扩展（可选）

如果未来需要更多功能：

- **批量操作**: 在每日总结中添加"一键全部已读"按钮
- **文章详情**: 点击按钮在 Telegram 显示完整摘要
- **筛选功能**: 按评分/已读状态筛选显示
- **多用户管理**: 支持多个用户同时使用 Telegram 交互

---

## 实施状态

### ✅ 已完成 (2026-03-01)

所有计划功能已成功实现并通过测试：

- [x] Step 1: 扩展 Telegram Client - 添加了 sendMessageWithKeyboard、editMessageReplyMarkup、answerCallbackQuery、getUpdates 方法
- [x] Step 2: 创建 Callback 编码器 - 实现 encodeCallback/decodeCallback
- [x] Step 3: 扩展消息格式化 - 添加 createArticleKeyboard、createRatingKeyboard
- [x] Step 4: 创建 Telegram Bot - 实现 TelegramBot 类及所有处理器
- [x] Step 5: 扩展类型定义 - 添加 InlineKeyboardButton、InlineKeyboardMarkup、CallbackQuery 等类型
- [x] Step 6: 修改推送通知 - sendNewArticle 现在使用 Inline Keyboard
- [x] Step 7: 集成到启动流程 - Bot Manager 在服务启动时自动启动

### 测试结果

- ✅ 标记已读/未读功能正常
- ✅ 评分功能正常（测试评 3 星成功）
- ✅ 按钮状态实时更新
- ✅ 数据库状态同步正确
- ✅ 用户权限验证正常
- ✅ 错误处理正常（"message is not modified" 已优雅处理）

### 额外改进

1. **错误处理优化**: 对于 "message is not modified" 错误（400），客户端会静默跳过而不是重试
2. **代理支持**: 保持了与现有代码一致的 undici 代理配置

---

## 性能和鲁棒性优化 (2026-03-01)

针对用户关注的问题进行了全面优化：

### 优化项目

1. **并发控制** (`src/telegram/bot.ts:27-29`)
   - 添加 `pendingCallbacks` Set 防止重复处理同一 callback
   - 解决快速点击导致的竞态条件问题
   - 保证数据一致性

2. **动态轮询间隔** (`src/telegram/bot.ts:31-35, 96-107`)
   - 活跃时 1 秒轮询，空闲 5 分钟后降至 10 秒
   - 减少不必要的 API 请求，节省资源
   - 对用户体验无影响（响应时间仍为几秒级）

3. **状态持久化** (`src/telegram/bot.ts:62-122`)
   - `latestUpdateId` 保存到文件系统
   - Bot 重启后自动恢复，防止重复处理旧 callback
   - 状态文件位置: `/tmp/lis-rss-daily/telegram/bot-state-user-{userId}.json`
   - 可通过环境变量 `TELEGRAM_STATE_DIR` 自定义

4. **友好的中文错误提示** (`src/telegram/bot.ts:190-227`)
   - 区分文章不存在、网络错误、权限错误
   - 提供清晰的错误消息（如 "❌ 文章不存在或已被删除"）
   - 优雅处理键盘更新失败（不影响核心操作）

5. **性能监控日志** (`src/telegram/bot.ts:135-163`)
   - 记录每次批处理的更新数、成功数、失败数
   - 记录处理耗时和平均耗时
   - 便于监控和调试

### 性能特性

| 场景 | 行为 |
|------|------|
| 用户立即点击按钮 | 最多 1 秒延迟（活跃轮询） |
| 用户几小时后点击 | 最多 10 秒延迟（空闲轮询） |
| Bot 重启 | 自动恢复状态，无重复处理 |
| 快速连续点击 | 并发控制防止冲突 |
| 网络错误 | 自动重试（指数退避） |

### 资源消耗

- **空闲时**: 每 10 秒一次轻量级 GET 请求
- **活跃时**: 每 1 秒一次，但只在有活动时
- **内存**: 极低（只缓存待处理的 callback ID）
- **存储**: 每个 Bot < 1KB 的状态文件

### 错误场景处理

- ✅ 文章已删除 → 友好提示
- ✅ 权限变化 → 拒绝操作
- ✅ 网络波动 → 自动重试
- ✅ Bot 重启 → 状态恢复
- ✅ 快速点击 → 去重保护
- ✅ 消息过期 → Telegram 自动清理（24 小时）
