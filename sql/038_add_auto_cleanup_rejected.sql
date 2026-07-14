-- ===========================================
-- 38. 添加自动清理拒绝文章的字段和归档表
-- ===========================================
-- 为每个源添加 auto_cleanup_rejected 开关
-- 新增 rejected_articles 归档表用于存储被迁移的拒绝文章
-- 默认关闭（0），用户可通过 UI/API 单独开启每个源
-- ===========================================

-- rss_sources
ALTER TABLE rss_sources ADD COLUMN auto_cleanup_rejected INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_rss_sources_auto_cleanup ON rss_sources(auto_cleanup_rejected);

-- journals
ALTER TABLE journals ADD COLUMN auto_cleanup_rejected INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_journals_auto_cleanup ON journals(auto_cleanup_rejected);

-- keyword_subscriptions
ALTER TABLE keyword_subscriptions ADD COLUMN auto_cleanup_rejected INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_keyword_subscriptions_auto_cleanup ON keyword_subscriptions(auto_cleanup_rejected);

-- email_sources
ALTER TABLE email_sources ADD COLUMN auto_cleanup_rejected INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_email_sources_auto_cleanup ON email_sources(auto_cleanup_rejected);

-- rejected_articles 归档表
CREATE TABLE IF NOT EXISTS rejected_articles (
  id INTEGER PRIMARY KEY,
  rss_source_id INTEGER,
  journal_id INTEGER,
  keyword_id INTEGER,
  email_source_id INTEGER,
  title TEXT NOT NULL,
  title_normalized TEXT,
  url TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  markdown_content TEXT,
  filter_status TEXT,
  filter_score REAL,
  filtered_at TEXT,
  process_status TEXT,
  process_stages TEXT,
  processed_at TEXT,
  published_at TEXT,
  published_year INTEGER,
  published_issue INTEGER,
  published_volume INTEGER,
  error_message TEXT,
  is_read INTEGER,
  source_origin TEXT,
  rating INTEGER,
  ai_summary TEXT,
  created_at TEXT,
  updated_at TEXT,
  filter_logs_data TEXT,
  translation_data TEXT,
  process_logs_data TEXT,
  related_data TEXT,
  source_name TEXT,
  moved_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_rejected_articles_source_origin ON rejected_articles(source_origin);
CREATE INDEX IF NOT EXISTS idx_rejected_articles_moved_at ON rejected_articles(moved_at);
CREATE INDEX IF NOT EXISTS idx_rejected_articles_rss_source_id ON rejected_articles(rss_source_id);
CREATE INDEX IF NOT EXISTS idx_rejected_articles_journal_id ON rejected_articles(journal_id);
CREATE INDEX IF NOT EXISTS idx_rejected_articles_keyword_id ON rejected_articles(keyword_id);
CREATE INDEX IF NOT EXISTS idx_rejected_articles_email_source_id ON rejected_articles(email_source_id);