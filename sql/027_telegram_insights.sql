-- ============================================================
-- 027: 添加 insights 字段到 telegram_chats 表
-- ============================================================
-- 洞察功能需要为 telegram_chats 表添加 insights 字段
-- 此迁移为增量添加，不影响现有数据

-- 检查 insights 列是否已存在，如果不存在则添加
ALTER TABLE telegram_chats ADD COLUMN insights INTEGER DEFAULT 1;
