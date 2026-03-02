-- Migration: 022_add_keyword_id_to_articles.sql
-- Description: 为 articles 表添加 keyword_id 字段，用于关联关键词订阅
-- Date: 2025-03-02

-- 添加 keyword_id 字段
ALTER TABLE articles ADD COLUMN keyword_id INTEGER REFERENCES keyword_subscriptions(id) ON DELETE SET NULL;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_articles_keyword_id ON articles(keyword_id);

-- 注意：source_origin 字段的 CHECK 约束需要在应用层扩展支持 'keyword' 值
-- 由于 SQLite 不支持直接修改 CHECK 约束，这里不修改数据库约束
