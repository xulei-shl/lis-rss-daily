-- ===========================================
-- 添加文章已读状态字段
-- ===========================================

-- 添加 is_read 字段记录文章是否已读
-- 0 = 未读 (默认), 1 = 已读
ALTER TABLE articles ADD COLUMN is_read INTEGER DEFAULT 0;

-- 添加索引以优化已读状态过滤查询
CREATE INDEX IF NOT EXISTS idx_articles_is_read ON articles(is_read);
