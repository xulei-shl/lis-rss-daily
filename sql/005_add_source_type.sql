-- Migration 005: Add source_type to rss_sources and create daily_summaries table

-- 新增 source_type 字段到 rss_sources 表
ALTER TABLE rss_sources ADD COLUMN source_type TEXT DEFAULT 'blog' CHECK(source_type IN ('journal', 'blog', 'news'));

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_rss_sources_source_type ON rss_sources(source_type);

-- 新建 daily_summaries 表存储历史总结
CREATE TABLE IF NOT EXISTS daily_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  summary_date TEXT NOT NULL,
  article_count INTEGER NOT NULL,
  summary_content TEXT NOT NULL,
  articles_data TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, summary_date)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_daily_summaries_user_date ON daily_summaries(user_id, summary_date DESC);
