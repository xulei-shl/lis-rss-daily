-- Migration 013: Add journal issue fields to articles table
-- 在 articles 表添加年卷期字段，用于显示期刊文章的年卷期信息

-- 新增字段
ALTER TABLE articles ADD COLUMN published_year INTEGER;     -- 年份
ALTER TABLE articles ADD COLUMN published_issue INTEGER;    -- 期号
ALTER TABLE articles ADD COLUMN published_volume INTEGER;   -- 卷号

-- 创建索引（可选，用于按年卷期查询）
CREATE INDEX IF NOT EXISTS idx_articles_published_year ON articles(published_year);
CREATE INDEX IF NOT EXISTS idx_articles_published_issue ON articles(published_issue);
