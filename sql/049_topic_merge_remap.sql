-- ===========================================
-- 7. 微主题整合重定向（同版本内合并，避免旧 URL 404）
-- ===========================================
-- cluster_topic_remap 的 old_topic_id 外键会随旧主题删除而级联删除，
-- 因此同版本整合不能复用该表。本表不建立外键，保留旧主题 id/slug 到新主题的映射。
CREATE TABLE IF NOT EXISTS cluster_topic_merge_remap (
  old_topic_id INTEGER NOT NULL,
  old_slug TEXT NOT NULL,
  new_topic_id INTEGER NOT NULL,
  similarity REAL NOT NULL,
  set_version INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (old_topic_id, new_topic_id)
);

CREATE INDEX IF NOT EXISTS idx_ctmr_old_slug ON cluster_topic_merge_remap(old_slug);
CREATE INDEX IF NOT EXISTS idx_ctmr_old_id ON cluster_topic_merge_remap(old_topic_id);
CREATE INDEX IF NOT EXISTS idx_ctmr_new ON cluster_topic_merge_remap(new_topic_id);
