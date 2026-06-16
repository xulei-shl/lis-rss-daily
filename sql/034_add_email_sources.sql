-- Migration: 034_add_email_sources.sql
-- Description: 重建 articles 表以支持 email source_origin 和 email_source_id 外键
-- Date: 2026-06-15
--
-- 问题说明：
-- 1. SQLite 的 ALTER TABLE ADD COLUMN 不支持修改 CHECK 约束
-- 2. 需要通过重建表来实现 source_origin 约束扩展
--
-- 本迁移会：
-- 1. 创建 email_sources 表（IMAP 邮件订阅源）
-- 2. 创建 email_fetch_logs 表（邮件抓取日志）
-- 3. 更新 source_origin 约束为 ('rss', 'journal', 'keyword', 'email')
-- 4. 添加 email_source_id 列和外键约束（ON DELETE CASCADE）
-- 5. 保留所有现有数据

PRAGMA foreign_keys = OFF;

-- ===========================================
-- 1. 创建 email_sources 表（IMAP 邮件订阅源）
--    必须在 articles 之前创建，因为 articles 的 FK 引用它
-- ===========================================
CREATE TABLE IF NOT EXISTS email_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  email_address TEXT NOT NULL,
  imap_password_encrypted TEXT NOT NULL,
  target_senders TEXT NOT NULL DEFAULT '[]',
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  last_fetched_at DATETIME,
  last_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_sources_user_id ON email_sources(user_id);
CREATE INDEX IF NOT EXISTS idx_email_sources_status ON email_sources(status);

-- ===========================================
-- 2. 创建 email_fetch_logs 表（邮件抓取日志）
-- ===========================================
CREATE TABLE IF NOT EXISTS email_fetch_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_source_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
  emails_found INTEGER DEFAULT 0,
  emails_new INTEGER DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (email_source_id) REFERENCES email_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_fetch_logs_email_source_id ON email_fetch_logs(email_source_id);
CREATE INDEX IF NOT EXISTS idx_email_fetch_logs_created_at ON email_fetch_logs(created_at);

-- ===========================================
-- 3. 创建新的 articles 表（包含 email 支持）
-- ===========================================
CREATE TABLE IF NOT EXISTS articles_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rss_source_id INTEGER,
  journal_id INTEGER,
  keyword_id INTEGER,
  email_source_id INTEGER,
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
  error_message TEXT,
  is_read INTEGER DEFAULT 0,
  source_origin TEXT DEFAULT 'rss' CHECK(source_origin IN ('rss', 'journal', 'keyword', 'email')),
  rating INTEGER,
  ai_summary TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rss_source_id) REFERENCES rss_sources(id) ON DELETE CASCADE,
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE SET NULL,
  FOREIGN KEY (keyword_id) REFERENCES keyword_subscriptions(id) ON DELETE SET NULL,
  FOREIGN KEY (email_source_id) REFERENCES email_sources(id) ON DELETE CASCADE
);

-- ===========================================
-- 4. 迁移现有数据
-- ===========================================
INSERT INTO articles_new (
  id, rss_source_id, journal_id, keyword_id,
  title, title_normalized, url, summary, content, markdown_content,
  filter_status, filter_score, filtered_at,
  process_status, process_stages, processed_at,
  published_at, published_year, published_issue, published_volume,
  error_message, is_read, source_origin, rating, ai_summary,
  created_at, updated_at
)
SELECT
  id, rss_source_id, journal_id, keyword_id,
  title, title_normalized, url, summary, content, markdown_content,
  filter_status, filter_score, filtered_at,
  process_status, process_stages, processed_at,
  published_at, published_year, published_issue, published_volume,
  error_message, is_read, source_origin, rating, ai_summary,
  created_at, updated_at
FROM articles;

-- ===========================================
-- 5. 删除旧表并重命名新表
-- ===========================================
DROP TABLE articles;
ALTER TABLE articles_new RENAME TO articles;

-- ===========================================
-- 6. 重建所有索引
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
CREATE INDEX IF NOT EXISTS idx_articles_email_source_id ON articles(email_source_id);
CREATE INDEX IF NOT EXISTS idx_articles_published_year ON articles(published_year);
CREATE INDEX IF NOT EXISTS idx_articles_published_issue ON articles(published_issue);
CREATE INDEX IF NOT EXISTS idx_articles_rating ON articles(rating) WHERE rating IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_title_normalized ON articles(title_normalized) WHERE title_normalized IS NOT NULL;

-- 恢复外键约束
PRAGMA foreign_keys = ON;

-- ===========================================
-- 验证数据完整性
-- ===========================================
-- 迁移前后数据量应该一致
-- SELECT COUNT(*) FROM articles;
