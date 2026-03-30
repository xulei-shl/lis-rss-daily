-- ===========================================
-- Telegram Chats 表添加 pdf_summary 字段
-- ===========================================
-- 支持 Telegram 接收 PDF 全文总结推送

ALTER TABLE telegram_chats ADD COLUMN pdf_summary INTEGER DEFAULT 1;
