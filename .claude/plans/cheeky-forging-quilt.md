# Telegram 多用户权限支持实现计划

## Context

当前 Telegram 模块只支持单个 Chat ID，用户希望一个 Bot 能绑定多个 Chat ID，并支持不同权限：
- **admin**: 完整功能（推送 + 交互写入数据库）
- **viewer**: 只接收推送，无交互功能（或交互不写入数据库）

## 实现方案

### Phase 1: 数据库变更

创建新表 `telegram_chats` 存储多个 Chat ID 及权限：

```sql
CREATE TABLE IF NOT EXISTS telegram_chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  chat_name TEXT,                    -- 显示名称
  role TEXT DEFAULT 'viewer' CHECK(role IN ('admin', 'viewer')),
  daily_summary INTEGER DEFAULT 1,
  new_articles INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, chat_id)
);
```

**迁移脚本**：自动将现有 `telegram_chat_id` 迁移为 admin 角色。

### Phase 2: 后端服务

1. **新建 API 服务** `/src/api/telegram-chats.ts`
   - `getTelegramChats(userId)` - 获取所有 chat
   - `addTelegramChat(userId, config)` - 添加 chat
   - `updateTelegramChat(userId, chatId, updates)` - 更新 chat
   - `deleteTelegramChat(userId, chatId)` - 删除 chat
   - `isChatAdmin(userId, chatId)` - 权限检查

2. **修改 TelegramNotifier** `/src/telegram/index.ts`
   - 推送时遍历所有 chat
   - admin 和 viewer 都发送带交互按钮的消息

3. **修改 TelegramBot** `/src/telegram/bot.ts`
   - 接受多个 chat 配置
   - callback 处理时检查权限
   - viewer 用户点击按钮时提示"❌ 无权限操作，仅管理员可交互"，不写入数据库

### Phase 3: 前端设置

修改 `/src/views/settings/panel-telegram.ejs`：
- 显示接收者列表
- 添加/编辑/删除接收者的弹窗
- 权限选择（admin/viewer）
- 每个接收者独立的推送开关

### Phase 4: 向后兼容

- 保留 `telegram_enabled` 和 `telegram_bot_token` 在 settings 表
- 迁移脚本自动迁移现有配置
- 删除旧的 `telegram_chat_id` 等设置（迁移后）

## 关键文件

| 文件 | 改动 |
|------|------|
| `sql/002_telegram_chats.sql` | 新建迁移脚本 |
| `src/db.ts` | 添加 TelegramChatsTable 类型 |
| `src/api/telegram-chats.ts` | 新建服务 |
| `src/telegram/index.ts` | 支持多 chat 推送 |
| `src/telegram/bot.ts` | 权限检查 |
| `src/views/settings/panel-telegram.ejs` | 多 chat 管理 UI |

## 验证方案

1. 运行迁移脚本，检查现有配置是否正确迁移
2. 添加多个 test chat（admin + viewer）
3. 发送测试推送，验证 admin 收到带按钮消息，viewer 收到纯文本
4. 点击 viewer 收到的按钮（如果有），验证无权限提示
5. admin 的交互功能正常写入数据库
