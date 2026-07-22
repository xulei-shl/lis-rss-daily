-- ===========================================
-- 42. 添加拒绝文章清理日志表
-- ===========================================
-- 将 rejected-cleanup-scheduler 的每次运行记录持久化到数据库，
-- 供 /filter-logs 页面查看。
-- ===========================================

CREATE TABLE IF NOT EXISTS rejected_cleanup_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  total_sources INTEGER NOT NULL DEFAULT 0,
  total_articles_moved INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  is_scheduled INTEGER NOT NULL DEFAULT 1,
  details_json TEXT,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rejected_cleanup_logs_user_id ON rejected_cleanup_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_rejected_cleanup_logs_created_at ON rejected_cleanup_logs(created_at);
