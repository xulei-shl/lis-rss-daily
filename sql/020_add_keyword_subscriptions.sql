-- Migration: 020_add_keyword_subscriptions.sql
-- Description: 添加关键词订阅配置表
-- Date: 2025-03-02

-- 关键词订阅配置表
CREATE TABLE IF NOT EXISTS keyword_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  keyword TEXT NOT NULL,
  year_start INTEGER,
  year_end INTEGER,
  is_active INTEGER DEFAULT 1,
  spider_type TEXT DEFAULT 'google_scholar' CHECK(spider_type IN ('google_scholar', 'cnki')),
  num_results INTEGER DEFAULT 20,
  last_crawl_time DATETIME,
  crawl_count INTEGER DEFAULT 0,
  total_articles INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_keyword_subscriptions_user_id ON keyword_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_keyword_subscriptions_is_active ON keyword_subscriptions(is_active);
CREATE INDEX IF NOT EXISTS idx_keyword_subscriptions_spider_type ON keyword_subscriptions(spider_type);
