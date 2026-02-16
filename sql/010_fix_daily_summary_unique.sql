-- ===========================================
-- 修复 daily_summaries 表的唯一约束
-- ===========================================
-- 问题：表级别的 UNIQUE(user_id, summary_date) 导致无法在同一天保存不同类型的总结
-- 解决方案：重建表，移除表级约束，只保留索引级约束 UNIQUE(user_id, summary_date, summary_type)

-- 1. 创建新表（正确结构）
CREATE TABLE IF NOT EXISTS daily_summaries_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  summary_date TEXT NOT NULL,
  summary_type TEXT DEFAULT 'all',
  article_count INTEGER NOT NULL,
  summary_content TEXT NOT NULL,
  articles_data TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2. 迁移数据
INSERT INTO daily_summaries_new (id, user_id, summary_date, summary_type, article_count, summary_content, articles_data, created_at)
SELECT id, user_id, summary_date,
  COALESCE(summary_type, 'all') AS summary_type,
  article_count, summary_content, articles_data, created_at
FROM daily_summaries;

-- 3. 删除旧表
DROP TABLE daily_summaries;

-- 4. 重命名新表
ALTER TABLE daily_summaries_new RENAME TO daily_summaries;

-- 5. 重建索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_summaries_user_date_type ON daily_summaries(user_id, summary_date, summary_type);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_type ON daily_summaries(summary_type);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_user_date ON daily_summaries(user_id, summary_date DESC);
