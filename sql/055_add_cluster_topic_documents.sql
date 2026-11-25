-- ===========================================
-- 055. 主题洞察版本文件（HTML 快照）
-- ===========================================
-- 说明：
--   每轮「分析 → 综述 → 洞察」成功后，为内容有变化的主题生成一份
--   自包含 HTML 文件（综述与洞察 / 研究脉络 / 矩阵与空白 / 演化趋势），
--   版本号按主题独立递增。文件本体落在 data/cluster-documents/，
--   本表只保存可展示的元数据与磁盘文件名。

CREATE TABLE IF NOT EXISTS cluster_topic_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  set_version INTEGER NOT NULL,
  topic_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (topic_id) REFERENCES cluster_topics(id) ON DELETE CASCADE,
  UNIQUE (topic_id, version)
);

CREATE INDEX IF NOT EXISTS idx_ctd_topic
  ON cluster_topic_documents(topic_id, version DESC);
