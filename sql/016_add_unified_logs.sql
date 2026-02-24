-- Migration 016: Unified process logging
-- 新增 RSS 抓取日志与文章处理阶段日志，支撑统一日志视图

PRAGMA foreign_keys = ON;

-- ===========================================
-- 1. RSS 抓取日志
-- ===========================================
CREATE TABLE IF NOT EXISTS rss_fetch_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  rss_source_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'partial')),
  articles_count INTEGER DEFAULT 0,
  new_articles_count INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  is_scheduled INTEGER DEFAULT 0, -- 0 = 手动，1 = 定时
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (rss_source_id) REFERENCES rss_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rss_fetch_logs_user_id ON rss_fetch_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_rss_fetch_logs_rss_source_id ON rss_fetch_logs(rss_source_id);
CREATE INDEX IF NOT EXISTS idx_rss_fetch_logs_status ON rss_fetch_logs(status);
CREATE INDEX IF NOT EXISTS idx_rss_fetch_logs_created_at ON rss_fetch_logs(created_at);

-- ===========================================
-- 2. 文章处理阶段日志
-- ===========================================
CREATE TABLE IF NOT EXISTS article_process_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('markdown', 'translate', 'vector', 'related', 'pipeline_complete')),
  status TEXT NOT NULL CHECK(status IN ('processing', 'completed', 'failed', 'skipped')),
  duration_ms INTEGER,
  error_message TEXT,
  details TEXT, -- 可选 JSON 文本，存放额外上下文
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_article_process_logs_user_id ON article_process_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_article_process_logs_article_id ON article_process_logs(article_id);
CREATE INDEX IF NOT EXISTS idx_article_process_logs_stage ON article_process_logs(stage);
CREATE INDEX IF NOT EXISTS idx_article_process_logs_created_at ON article_process_logs(created_at);
