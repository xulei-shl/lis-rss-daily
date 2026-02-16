-- ===========================================
-- 009: Add summary_type to daily_summaries
-- 支持每日总结分类：期刊类 vs 博客资讯类
-- ===========================================

-- 添加 summary_type 字段
ALTER TABLE daily_summaries ADD COLUMN summary_type TEXT DEFAULT 'all';

-- 更新现有数据，标记为 'all' 类型（兼容历史数据）
UPDATE daily_summaries SET summary_type = 'all' WHERE summary_type IS NULL;

-- 删除旧的唯一索引（如果存在）
DROP INDEX IF EXISTS idx_daily_summaries_user_date;

-- 创建新的复合唯一索引（支持同一天多条不同类型总结）
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_summaries_user_date_type 
ON daily_summaries(user_id, summary_date, summary_type);

-- 创建类型筛选索引
CREATE INDEX IF NOT EXISTS idx_daily_summaries_type ON daily_summaries(summary_type);
