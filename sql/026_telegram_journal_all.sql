-- ===========================================
-- Telegram Chats 表添加 journal_all 字段
-- ===========================================
-- 支持 Telegram 接收全部期刊总结（包含未通过的文章）

-- 添加 journal_all 字段（默认 0，避免未经用户确认就增加推送噪音）
ALTER TABLE telegram_chats ADD COLUMN journal_all INTEGER DEFAULT 0;

-- 注意：不自动从 daily_summary 迁移，保持用户主动选择
