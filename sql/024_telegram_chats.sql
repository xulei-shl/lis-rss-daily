-- ===========================================
-- Telegram Chats Table (多用户权限支持)
-- ===========================================
-- 存储多个 Telegram Chat ID 及其权限配置
-- 支持 admin（完整功能）和 viewer（只接收推送）两种角色

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

CREATE INDEX IF NOT EXISTS idx_telegram_chats_user_id ON telegram_chats(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_chats_is_active ON telegram_chats(is_active);
CREATE INDEX IF NOT EXISTS idx_telegram_chats_role ON telegram_chats(role);

-- ===========================================
-- Migration: 迁移现有 telegram_chat_id 到新表
-- ===========================================
-- 将 settings 表中的 telegram_chat_id 迁移为 admin 角色

INSERT INTO telegram_chats (user_id, chat_id, role, daily_summary, new_articles, is_active)
SELECT
  s.user_id,
  s.value AS chat_id,
  'admin' AS role,
  CASE WHEN (SELECT value FROM settings WHERE user_id = s.user_id AND key = 'telegram_daily_summary') = 'true' THEN 1 ELSE 0 END AS daily_summary,
  CASE WHEN (SELECT value FROM settings WHERE user_id = s.user_id AND key = 'telegram_new_articles') = 'true' THEN 1 ELSE 0 END AS new_articles,
  1 AS is_active
FROM settings s
WHERE s.key = 'telegram_chat_id'
  AND s.value IS NOT NULL
  AND s.value != ''
  AND NOT EXISTS (
    SELECT 1 FROM telegram_chats tc WHERE tc.user_id = s.user_id AND tc.chat_id = s.value
  );

-- ===========================================
-- Cleanup: 删除旧的 Telegram 相关设置（可选，保留 bot_token 和 enabled）
-- ===========================================
-- 注意：保留 telegram_enabled 和 telegram_bot_token 在 settings 表中
-- 旧的 telegram_chat_id、telegram_daily_summary、telegram_new_articles 已迁移到新表
-- 但暂时不删除，以便回滚
