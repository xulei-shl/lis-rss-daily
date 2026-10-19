-- ===========================================
-- Telegram Chats 表添加 health_alert 字段
-- ===========================================
-- 服务器健康告警独立于 PDF 全文总结配置。
-- 现有接收者沿用 pdf_summary 的值，避免升级后告警静默消失；
-- 新增接收者默认关闭，需要在设置页手动勾选。

ALTER TABLE telegram_chats ADD COLUMN health_alert INTEGER DEFAULT 0;
UPDATE telegram_chats SET health_alert = pdf_summary;
