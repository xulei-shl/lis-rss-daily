-- Migration: 021_add_keyword_crawl_logs.sql
-- Description: 添加关键词爬取日志表
-- Date: 2025-03-02

-- 关键词爬取日志表
CREATE TABLE IF NOT EXISTS keyword_crawl_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword_id INTEGER NOT NULL,
  keyword TEXT NOT NULL,
  spider_type TEXT NOT NULL,
  year_start INTEGER,
  year_end INTEGER,
  articles_count INTEGER DEFAULT 0,
  new_articles_count INTEGER DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'partial')),
  error_message TEXT,
  duration_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (keyword_id) REFERENCES keyword_subscriptions(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_keyword_crawl_logs_keyword_id ON keyword_crawl_logs(keyword_id);
CREATE INDEX IF NOT EXISTS idx_keyword_crawl_logs_created_at ON keyword_crawl_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_keyword_crawl_logs_status ON keyword_crawl_logs(status);
