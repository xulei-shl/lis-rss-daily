-- ===========================================
-- 050. 主题聚类执行日志
-- ===========================================
-- 说明：
--   1. 每一轮流水线执行写一行，供页面展示「创建/更新时间 + 每次执行新增文献数」。
--   2. topic_deltas 为该轮按主题的净新增链接数（JSON：{"<topic_id>": 新增篇数}），
--      只记录增量 > 0 的主题；链接被淘汰造成的减少不记录。
--   3. 纯旁路记录，不参与任何聚类计算，失败不影响流水线本身。

CREATE TABLE IF NOT EXISTS cluster_run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  set_version INTEGER,
  trigger TEXT NOT NULL CHECK(trigger IN ('cron', 'manual', 'cold_start', 'rebuild')),
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  facet_succeeded INTEGER NOT NULL DEFAULT 0,
  facet_failed INTEGER NOT NULL DEFAULT 0,
  routed_articles INTEGER NOT NULL DEFAULT 0,
  new_topics INTEGER NOT NULL DEFAULT 0,
  reclaimed_links INTEGER NOT NULL DEFAULT 0,
  analyzed_topics INTEGER NOT NULL DEFAULT 0,
  topic_deltas TEXT,
  error_message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_crl_started ON cluster_run_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_crl_set ON cluster_run_logs(set_version, started_at DESC);
