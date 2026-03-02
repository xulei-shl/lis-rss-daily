-- Migration: 023_fix_source_origin_constraint.sql
-- Description: 重建 articles 表以修复 source_origin 约束和 keyword_id 外键
-- Date: 2026-03-03
--
-- 问题说明：
-- 1. SQLite 的 ALTER TABLE ADD COLUMN 不支持修改 CHECK 约束
-- 2. SQLite 的 ALTER TABLE ADD COLUMN 不支持创建外键
-- 3. 需要通过重建表来实现完整的约束更新
--
-- 本迁移会：
-- 1. 更新 source_origin 约束为 ('rss', 'journal', 'keyword')
-- 2. 创建 keyword_id 的外键约束（ON DELETE SET NULL）
-- 3. 保留所有现有数据

BEGIN TRANSACTION;

-- ===========================================
-- 1. 创建新的 articles 表（包含完整约束）
-- ===========================================
CREATE TABLE IF NOT EXISTS articles_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rss_source_id INTEGER,
  title TEXT NOT NULL,
  title_normalized TEXT,
  url TEXT NOT NULL UNIQUE,
  summary TEXT,
  content TEXT,
  markdown_content TEXT,
  filter_status TEXT DEFAULT 'pending' CHECK(filter_status IN ('pending', 'passed', 'rejected')),
  filter_score REAL,
  filtered_at DATETIME,
  process_status TEXT DEFAULT 'pending' CHECK(process_status IN ('pending', 'processing', 'completed', 'failed')),
  process_stages TEXT,
  processed_at DATETIME,
  published_at DATETIME,
  published_year INTEGER,
  published_issue INTEGER,
  published_volume INTEGER,
  is_read INTEGER DEFAULT 0,
  source_origin TEXT DEFAULT 'rss' CHECK(source_origin IN ('rss', 'journal', 'keyword')),
  journal_id INTEGER,
  keyword_id INTEGER,
  error_message TEXT,
  rating INTEGER CHECK(rating IS NULL OR (rating >= 1 AND rating <= 5)),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rss_source_id) REFERENCES rss_sources(id) ON DELETE CASCADE,
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE SET NULL,
  FOREIGN KEY (keyword_id) REFERENCES keyword_subscriptions(id) ON DELETE SET NULL
);

-- ===========================================
-- 2. 迁移现有数据
-- ===========================================
INSERT INTO articles_new (
  id, rss_source_id, title, title_normalized, url, summary, content,
  markdown_content, filter_status, filter_score, filtered_at,
  process_status, process_stages, processed_at, published_at,
  published_year, published_issue, published_volume, is_read,
  source_origin, journal_id, keyword_id, error_message, rating,
  created_at, updated_at
)
SELECT
  id, rss_source_id, title, title_normalized, url, summary, content,
  markdown_content, filter_status, filter_score, filtered_at,
  process_status, process_stages, processed_at, published_at,
  published_year, published_issue, published_volume, is_read,
  source_origin, journal_id, keyword_id, error_message, rating,
  created_at, updated_at
FROM articles;

-- ===========================================
-- 3. 删除旧表并重命名新表
-- ===========================================
DROP TABLE articles;
ALTER TABLE articles_new RENAME TO articles;

-- ===========================================
-- 4. 重建所有索引
-- ===========================================
CREATE INDEX IF NOT EXISTS idx_articles_rss_source_id ON articles(rss_source_id);
CREATE INDEX IF NOT EXISTS idx_articles_filter_status ON articles(filter_status);
CREATE INDEX IF NOT EXISTS idx_articles_process_status ON articles(process_status);
CREATE INDEX IF NOT EXISTS idx_articles_is_read ON articles(is_read);
CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_articles_source_origin ON articles(source_origin);
CREATE INDEX IF NOT EXISTS idx_articles_journal_id ON articles(journal_id);
CREATE INDEX IF NOT EXISTS idx_articles_keyword_id ON articles(keyword_id);
CREATE INDEX IF NOT EXISTS idx_articles_published_year ON articles(published_year);
CREATE INDEX IF NOT EXISTS idx_articles_published_issue ON articles(published_issue);
CREATE INDEX IF NOT EXISTS idx_articles_rating ON articles(rating) WHERE rating IS NOT NULL;

-- ===========================================
-- 5. 重建唯一索引（title_normalized 去重）
-- ===========================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_title_normalized ON articles(title_normalized) WHERE title_normalized IS NOT NULL;

COMMIT;

-- ===========================================
-- 验证数据完整性
-- ===========================================
-- 迁移前后数据量应该一致
-- 可以通过以下 SQL 验证：
-- SELECT COUNT(*) FROM articles;
