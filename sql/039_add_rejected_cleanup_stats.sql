-- ===========================================
-- 39. 添加拒绝文章清理统计缓存表
-- ===========================================
-- 当 auto_cleanup_rejected=1 的源执行清理时，
-- 记录每用户每天被清理的 rejected 文章数量。
-- 首页统计时加上此缓存，避免因清理导致统计失真。
-- ===========================================

CREATE TABLE IF NOT EXISTS rejected_cleanup_stats (
  user_id INTEGER NOT NULL,
  article_date TEXT NOT NULL,       -- created_at 的日期部分（UTC）
  rejected_count INTEGER NOT NULL DEFAULT 0,
  completed_rejected_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, article_date)
);
