# Telegram 通知集成方案

## 需求概述

将 LIS-RSS-Daily 系统的每日总结和新增过滤通过的文章自动推送到 Telegram。

### 分阶段实施

| 阶段 | 功能 | 优先级 |
|------|------|--------|
| **阶段一** | 每日总结生成后自动推送到 Telegram | P0 |
| **阶段二** | 新增过滤通过的文章定时推送到 Telegram | P1 |

---

## 方案对比

### 方案一：Node.js Bot（✅ 已选定）

**优点**：
- 直接集成到现有系统，无额外依赖
- 代码复用性高，统一通知模块
- 支持即时推送和定时汇总两种模式
- 易于扩展新的推送类型

**缺点**：
- 需要修改核心代码

### 方案二：Shell 脚本包装

**优点**：
- 改动最小

**缺点**：
- 每个功能需独立脚本
- 扩展性差，维护成本高
- 无法实现即时推送

### 方案三：Webhook 方式

**优点**：
- 解耦设计

**缺点**：
- 需要额外的 webhook 服务
- 增加系统复杂度

---

## 技术架构

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        设置页面                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Telegram 通知                                       │    │
│  │  ☐ 启用通知                                          │    │
│  │  Bot Token: [_______________]                        │    │
│  │  Chat ID:   [_______________]                        │    │
│  │  推送内容:                                           │    │
│  │    ☐ 每日总结                                        │    │
│  │    ☐ 新增文章                                        │    │
│  │  [测试连接] [保存]                                    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     settings 表存储                          │
│  telegram_enabled    → true                                 │
│  telegram_bot_token  → 123456:ABC-DEF1234ghIkl-zyx57W2v1u123│
│  telegram_chat_id    → 123456789                            │
│  telegram_daily_summary → true                              │
│  telegram_new_articles → false (后期启用)                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   src/telegram/ 模块                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  notifier.ts                                         │    │
│  │  ├── sendToTelegram()          # 统一推送接口         │    │
│  │  ├── testConnection()          # 测试连接             │    │
│  │  └── isEnabled()               # 检查是否启用         │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │  formatters.ts                                       │    │
│  │  ├── formatDailySummary()     # 格式化每日总结        │    │
│  │  ├── formatNewArticle()        # 格式化新文章         │    │
│  │  └── formatArticleDigest()    # 格式化文章汇总        │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      调用触发点                               │
│                                                             │
│  阶段一: src/api/daily-summary.ts                           │
│    generateDailySummary()                                   │
│      └── telegramNotifier.sendDailySummary(result)          │
│                                                             │
│  阶段二: src/pipeline.ts (后期)                             │
│    processArticle()                                         │
│      └── if (passed) telegramNotifier.sendNewArticle(article)│
│                                                             │
│  定时汇总模式 (可选):                                        │
│    每小时/每天汇总新文章一次性推送                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Telegram Bot API                          │
│                                                             │
│  POST https://api.telegram.org/bot<token>/sendMessage       │
│  Body: {                                                    │
│    chat_id: 123456789,                                      │
│    text: "📅 每日文献总结...",                              │
│    parse_mode: "Markdown"                                   │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 文件结构

### 新增文件

```
src/telegram/
├── index.ts              # 模块导出
├── notifier.ts           # Telegram 通知核心逻辑
├── formatters.ts         # 消息格式化
└── types.ts              # 类型定义

src/views/settings/
└── panel-telegram.ejs    # Telegram 设置面板
```

### 修改文件

```
src/api/settings.ts               # 添加 Telegram 设置读写函数
src/api/routes/settings.routes.ts # 添加 /api/settings/telegram 路由
src/views/settings/body.ejs       # 添加 Telegram tab
src/public/js/settings.js         # 添加表单处理逻辑
src/api/daily-summary.ts          # 生成总结后调用推送
package.json                      # 添加 node-telegram-bot-api 依赖
```

---

## 数据库设计

### settings 表新增字段

| Key | Type | 说明 | 默认值 |
|-----|------|------|--------|
| `telegram_enabled` | boolean | 是否启用 Telegram 通知 | `false` |
| `telegram_bot_token` | string | Telegram Bot Token | `""` |
| `telegram_chat_id` | string | Telegram Chat ID | `""` |
| `telegram_daily_summary` | boolean | 是否推送每日总结 | `false` |
| `telegram_new_articles` | boolean | 是否推送新文章 | `false` |

### API 接口

#### GET /api/settings/telegram

获取 Telegram 配置

**响应示例**：
```json
{
  "enabled": true,
  "botToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123",
  "chatId": "123456789",
  "dailySummary": true,
  "newArticles": false
}
```

#### PUT /api/settings/telegram

更新 Telegram 配置

**请求体**：
```json
{
  "enabled": true,
  "botToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123",
  "chatId": "123456789",
  "dailySummary": true,
  "newArticles": false
}
```

#### POST /api/settings/telegram/test

测试 Telegram 连接

**请求体**：
```json
{
  "botToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123",
  "chatId": "123456789"
}
```

**响应示例**：
```json
{
  "success": true,
  "message": "测试消息已发送"
}
```

---

## 消息格式设计

### 每日总结消息

```
📅 每日文献总结
🗓 2026-03-01

📊 统计
  期刊精选: 40 篇
  博客推荐: 15 篇
  资讯动态: 5 篇

📝 内容摘要
今日关注的主题包括：

### 人工智能
- [论文标题]
  摘要内容...

### 信息检索
- [论文标题]
  摘要内容...

🔗 查看详情: http://your-domain/articles
```

### 新增文章消息（即时模式）

```
🆕 新文献推荐

【期刊精选】
标题: Deep Learning for Information Retrieval
来源: Journal of Information Science
作者: Zhang et al.
年份: 2026

摘要: 本文提出了一种...

🔗 链接: https://...
```

### 新增文章消息（定时汇总模式）

```
📚 新文献汇总
🗓 2026-03-01 10:00 - 11:00

本期共发现 8 篇新文献

### 期刊精选 (5篇)
1. Deep Learning for IR
2. Neural Information Retrieval
...

### 博客推荐 (2篇)
1. The Future of Search
2. Vector Database Guide
...

### 资讯动态 (1篇)
1. Google Releases New Search API
...
```

---

## 实施步骤

### 阶段一：每日总结推送

#### Step 1: 安装依赖
```bash
pnpm add node-telegram-bot-api
pnpm add -D @types/node-telegram-bot-api
```

#### Step 2: 创建 Telegram 模块

**src/telegram/types.ts**
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
    journal: any[];
    blog: any[];
    news: any[];
  };
}
```

**src/telegram/formatters.ts**
```typescript
export function formatDailySummary(data: DailySummaryData): string {
  // 格式化每日总结消息
}

export function formatNewArticle(article: any): string {
  // 格式化单篇文章消息（后期）
}
```

**src/telegram/notifier.ts**
```typescript
import TelegramBot from 'node-telegram-bot-api';

export class TelegramNotifier {
  async sendDailySummary(data: DailySummaryData): Promise<void> {
    // 推送每日总结
  }

  async testConnection(botToken: string, chatId: string): Promise<boolean> {
    // 测试连接
  }
}
```

#### Step 3: 添加设置 API

**src/api/settings.ts**
```typescript
export async function getTelegramSettings(userId: number): Promise<TelegramConfig> {
  const settings = await getUserSettings(userId, [
    'telegram_enabled',
    'telegram_bot_token',
    'telegram_chat_id',
    'telegram_daily_summary',
    'telegram_new_articles',
  ]);

  return {
    enabled: settings.telegram_enabled === 'true',
    botToken: settings.telegram_bot_token || '',
    chatId: settings.telegram_chat_id || '',
    dailySummary: settings.telegram_daily_summary === 'true',
    newArticles: settings.telegram_new_articles === 'true',
  };
}

export async function updateTelegramSettings(
  userId: number,
  config: Partial<TelegramConfig>
): Promise<void> {
  // 实现更新逻辑
}
```

**src/api/routes/settings.routes.ts**
```typescript
router.get('/settings/telegram', requireAuth, async (req, res) => {
  // 获取配置
});

router.put('/settings/telegram', requireAuth, async (req, res) => {
  // 更新配置
});

router.post('/settings/telegram/test', requireAuth, async (req, res) => {
  // 测试连接
});
```

#### Step 4: 创建设置页面 UI

**src/views/settings/panel-telegram.ejs**
```html
<section class="settings-panel" data-tab="telegram">
  <div class="telegram-section">
    <div class="section-header">
      <h2>Telegram 通知</h2>
    </div>
    <form id="telegramForm" class="telegram-form">
      <!-- 表单内容 -->
    </form>
  </div>
</section>
```

**src/views/settings/body.ejs**
```html
<button class="settings-tab" data-tab="telegram">Telegram 通知</button>
<%- include('panel-telegram') %>
```

**src/public/js/settings.js**
```javascript
// 加载 Telegram 配置
async function loadTelegramSettings() { }

// 保存 Telegram 配置
document.getElementById('telegramForm').addEventListener('submit', async (e) => {
  // 处理保存
});

// 测试连接
document.getElementById('testTelegramBtn').addEventListener('click', async () => {
  // 测试连接
});
```

#### Step 5: 集成到每日总结

**src/api/daily-summary.ts**
```typescript
import { telegramNotifier } from '../telegram/index.js';

export async function generateDailySummary(
  input: DailySummaryInput
): Promise<DailySummaryResult> {
  // ... 现有逻辑 ...

  const result = {
    // ... 结果数据 ...
  };

  // 推送到 Telegram
  telegramNotifier.sendDailySummary(result).catch(err => {
    log.warn({ error: err }, 'Failed to send daily summary to Telegram');
  });

  return result;
}
```

---

### 阶段二：新增文章推送（后期）

#### 推送模式选择

**模式 A：即时推送**
```typescript
// src/pipeline.ts
export async function processArticle(articleId: number, userId: number) {
  // ... 过滤逻辑 ...

  if (filterResult.passed) {
    // 立即推送
    telegramNotifier.sendNewArticle(article).catch(err => {
      log.warn({ error: err }, 'Failed to send article to Telegram');
    });
  }
}
```

**模式 B：定时汇总**
```typescript
// src/telegram/scheduler.ts
export class TelegramDigestScheduler {
  // 每小时汇总一次
  async sendHourlyDigest(): Promise<void> {
    const articles = await getArticlesSince(lastDigestTime);
    if (articles.length > 0) {
      await telegramNotifier.sendArticleDigest(articles);
    }
  }
}
```

---

## 使用指南

### 准备工作

#### 1. 创建 Telegram Bot

1. 在 Telegram 中搜索 `@BotFather`
2. 发送 `/newbot` 命令
3. 按提示设置 bot 名称和用户名
4. 保存返回的 **Bot Token**（格式：`123456:ABC-DEF1234ghIkl-zyx57W2v1u123`）

#### 2. 获取 Chat ID

**方法一：发送消息给 bot**
1. 在 Telegram 中搜索你的 bot
2. 发送任意消息（如 `/start`）
3. 访问：`https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
4. 在返回结果中找到 `chat.id`

**方法二：使用 userinfobot**
1. 在 Telegram 中搜索 `@userinfobot`
2. 发送 `/start`
3. Bot 会返回你的 Chat ID

### 配置步骤

1. 登录 LIS-RSS-Daily 系统
2. 进入「设置」→「Telegram 通知」
3. 填写 Bot Token 和 Chat ID
4. 点击「测试连接」验证配置
5. 勾选「每日总结」
6. 点击「保存」

---

## 注意事项

### 安全性
- Bot Token 和 Chat ID 存储在数据库中，需确保数据库访问安全
- 建议使用环境变量设置默认值（可选）
- Bot Token 不应在日志中明文输出

### 可靠性
- Telegram API 调用失败不应阻塞主流程
- 建议添加重试机制（3次重试，指数退避）
- 记录推送失败的日志，便于排查问题

### 性能
- 大量文章推送时应控制频率（避免触发 Telegram 限流）
- 考虑使用消息队列（如后续需要）

### 限流
Telegram Bot API 限流规则：
- 同一群组：每秒最多 20 条消息
- 不同群组：每秒最多 30 条消息
- 建议每条消息间隔 50ms+

---

## 后续扩展

### 可能的增强功能

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 推送模板自定义 | 允许用户自定义消息格式 | P2 |
| 过滤规则 | 按主题/来源选择性推送 | P2 |
| 消息交互 | 支持在 Telegram 中查看文章详情 | P3 |
| 推送时间控制 | 设置免打扰时段 | P3 |
| 多 Chat ID 支持 | 同时推送到多个群组/频道 | P3 |

### 其他通知渠道

基于统一的通知模块设计，可轻松扩展到：
- 邮件通知
- 企业微信/飞书
- Discord
- Slack

---

## 故障排查

### 常见问题

**Q: 测试连接失败**
- 检查 Bot Token 格式是否正确
- 检查 Chat ID 是否正确
- 确保 Bot 已启动（发送 `/start` 给 bot）
- 检查网络连接

**Q: 消息未收到**
- 检查是否启用了相应的推送选项
- 查看系统日志确认推送是否触发
- 确认 Telegram 未屏蔽 bot 消息

**Q: 消息格式错乱**
- 检查 Markdown 格式是否正确
- 特殊字符需要转义（如 `_` `*` `[` `]`）

---

## 参考资源

- [Telegram Bot API 官方文档](https://core.telegram.org/bots/api)
- [node-telegram-bot-api 文档](https://github.com/yagop/node-telegram-bot-api)
- [BotFather 指南](https://core.telegram.org/bots#6-botfather)
