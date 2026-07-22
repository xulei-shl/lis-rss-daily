-- ===========================================
-- Migration 041: Add web scraper sources (网络爬虫来源)
-- ===========================================

-- Enable WAL mode for better concurrency
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ===========================================
-- 1. Create web_sources table
-- ===========================================
-- 通用网络爬虫来源表，用于管理定期爬取网站的配置
-- scraper_type: 爬虫脚本类型（如 'lsc' 中图学会）
-- source_type: RSS 源类型（journal/blog/news），用于每日总结分类
CREATE TABLE IF NOT EXISTS web_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,                        -- 爬取目标 URL
  source_type TEXT DEFAULT 'blog' CHECK(source_type IN ('journal', 'blog', 'news')),
  scraper_type TEXT NOT NULL DEFAULT 'lsc', -- 爬虫脚本类型
  domain_id INTEGER NOT NULL REFERENCES topic_domains(id),
  last_fetched_at DATETIME,
  fetch_interval INTEGER DEFAULT 3600,      -- 抓取间隔（秒）
  auto_cleanup_rejected INTEGER NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, url)
);

CREATE INDEX IF NOT EXISTS idx_web_sources_user_id ON web_sources(user_id);
CREATE INDEX IF NOT EXISTS idx_web_sources_status ON web_sources(status);
CREATE INDEX IF NOT EXISTS idx_web_sources_scraper_type ON web_sources(scraper_type);
CREATE INDEX IF NOT EXISTS idx_web_sources_source_type ON web_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_web_sources_domain_id ON web_sources(domain_id);

-- ===========================================
-- 2. Add web_source_id to articles table
-- ===========================================
ALTER TABLE articles ADD COLUMN web_source_id INTEGER REFERENCES web_sources(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_articles_web_source_id ON articles(web_source_id);

-- ===========================================
-- 3. Update source_origin CHECK constraint to include 'web'
-- ===========================================
-- SQLite does not support ALTER TABLE ... ALTER CHECK, so we need to recreate the table
-- For existing databases, we'll use a pragmatic approach:
-- Drop the old constraint by recreating the table (SQLite limitation)

-- First, create a new table with the updated CHECK constraint
CREATE TABLE IF NOT EXISTS articles_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rss_source_id INTEGER,
  journal_id INTEGER,
  keyword_id INTEGER,
  email_source_id INTEGER,
  web_source_id INTEGER,        -- 新增：网络爬虫来源ID
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
  source_origin TEXT DEFAULT 'rss' CHECK(source_origin IN ('rss', 'journal', 'keyword', 'email', 'web')),
  rating INTEGER,
  ai_summary TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rss_source_id) REFERENCES rss_sources(id) ON DELETE CASCADE,
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE SET NULL,
  FOREIGN KEY (keyword_id) REFERENCES keyword_subscriptions(id) ON DELETE SET NULL,
  FOREIGN KEY (email_source_id) REFERENCES email_sources(id) ON DELETE CASCADE,
  FOREIGN KEY (web_source_id) REFERENCES web_sources(id) ON DELETE CASCADE
);

-- Copy data from old table to new table
INSERT INTO articles_new (
  id, rss_source_id, journal_id, keyword_id, email_source_id, web_source_id,
  title, title_normalized, url, summary, content, markdown_content,
  filter_status, filter_score, filtered_at,
  process_status, process_stages, processed_at,
  published_at, published_year, published_issue, published_volume,
  error_message, is_read, source_origin, rating, ai_summary,
  created_at, updated_at
)
SELECT
  id, rss_source_id, journal_id, keyword_id, email_source_id, NULL as web_source_id,
  title, title_normalized, url, summary, content, markdown_content,
  filter_status, filter_score, filtered_at,
  process_status, process_stages, processed_at,
  published_at, published_year, published_issue, published_volume,
  error_message, is_read, source_origin, rating, ai_summary,
  created_at, updated_at
FROM articles;

-- Drop old table and rename new one
DROP TABLE articles;
ALTER TABLE articles_new RENAME TO articles;

-- Recreate all indexes on articles
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
CREATE INDEX IF NOT EXISTS idx_articles_web_source_id ON articles(web_source_id);
CREATE INDEX IF NOT EXISTS idx_articles_published_year ON articles(published_year);
CREATE INDEX IF NOT EXISTS idx_articles_published_issue ON articles(published_issue);
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_title_normalized ON articles(title_normalized) WHERE title_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_articles_rating ON articles(rating) WHERE rating IS NOT NULL;

-- ===========================================
-- 4. Add web_source_id to rejected_articles table
-- ===========================================
ALTER TABLE rejected_articles ADD COLUMN web_source_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_rejected_articles_web_source_id ON rejected_articles(web_source_id);

-- ===========================================
-- 5. Create web fetch logs table
-- ===========================================
CREATE TABLE IF NOT EXISTS web_fetch_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  web_source_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'partial')),
  articles_count INTEGER DEFAULT 0,
  new_articles_count INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  is_scheduled INTEGER DEFAULT 0,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (web_source_id) REFERENCES web_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_web_fetch_logs_web_source_id ON web_fetch_logs(web_source_id);
CREATE INDEX IF NOT EXISTS idx_web_fetch_logs_created_at ON web_fetch_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_web_fetch_logs_status ON web_fetch_logs(status);
