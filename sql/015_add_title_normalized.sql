-- Migration 015: Add title_normalized field for title-based deduplication
-- 添加 title_normalized 字段，实现基于标题的去重机制

-- 1. 添加 title_normalized 字段
ALTER TABLE articles ADD COLUMN title_normalized TEXT;

-- 2. 创建唯一索引（仅对非 NULL 值生效，历史数据为 NULL 不受影响）
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_title_normalized
ON articles(title_normalized)
WHERE title_normalized IS NOT NULL;
