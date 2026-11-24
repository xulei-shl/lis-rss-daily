-- ===========================================
-- 051. 主题深度综述与跨主题洞察
-- ===========================================
-- 说明：
--   1. 纯增量：新增 3 张表，并在 cluster_topics / cluster_run_logs 上追加列；
--      不改动任何既有列与约束（迁移器会按列是否存在逐条跳过）。
--   2. cluster_topic_reviews：主题内语义子簇的长篇综述。review_key 是稳定身份，
--      成员变化时按 Jaccard 续写同一行，旧身份保留为 superseded，不删除。
--   3. cluster_topic_gaps：把 analysis_json 中的研究空白物化成可引用、可向量化的行，
--      供跨主题二次聚类与洞察报告回链。gap_key 在同一主题内稳定。
--   4. cluster_insight_reports：综述 + 空白二次聚类后的跨主题洞察报告。
--   5. 所有 centroid/embedding 均复用切面向量质心，不额外调用 embedding 模型。

CREATE TABLE IF NOT EXISTS cluster_topic_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  set_version INTEGER NOT NULL,
  topic_id INTEGER NOT NULL,
  review_key TEXT NOT NULL,
  title TEXT NOT NULL,
  abstract TEXT NOT NULL DEFAULT '',
  review_json TEXT NOT NULL,
  member_ids_json TEXT NOT NULL,
  representative_ids_json TEXT NOT NULL,
  centroid BLOB,
  centroid_dim INTEGER,
  input_hash TEXT NOT NULL,
  linked_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok' CHECK(status IN ('ok', 'partial', 'failed', 'superseded')),
  supersedes_id INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  generated_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL,
  UNIQUE(topic_id, review_key),
  FOREIGN KEY (topic_id) REFERENCES cluster_topics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ctr_topic ON cluster_topic_reviews(topic_id, status);
CREATE INDEX IF NOT EXISTS idx_ctr_set ON cluster_topic_reviews(set_version, status);

CREATE TABLE IF NOT EXISTS cluster_topic_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  set_version INTEGER NOT NULL,
  topic_id INTEGER NOT NULL,
  gap_key TEXT NOT NULL,
  gap TEXT NOT NULL,
  basis TEXT NOT NULL,
  method TEXT,
  object TEXT,
  evidence_ids_json TEXT NOT NULL,
  embedding BLOB,
  embedding_dim INTEGER,
  source_analysis_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'superseded')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL,
  UNIQUE(topic_id, gap_key),
  FOREIGN KEY (topic_id) REFERENCES cluster_topics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ctg_set ON cluster_topic_gaps(set_version, status);

CREATE TABLE IF NOT EXISTS cluster_insight_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  set_version INTEGER NOT NULL,
  report_key TEXT NOT NULL,
  title TEXT NOT NULL,
  report_json TEXT NOT NULL,
  member_refs_json TEXT NOT NULL,
  topic_ids_json TEXT NOT NULL,
  centroid BLOB,
  centroid_dim INTEGER,
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok' CHECK(status IN ('ok', 'failed', 'superseded')),
  supersedes_id INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  generated_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL,
  UNIQUE(set_version, report_key)
);

CREATE INDEX IF NOT EXISTS idx_cir_set ON cluster_insight_reports(set_version, status);

ALTER TABLE cluster_topics ADD COLUMN review_dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cluster_topics ADD COLUMN review_analyzed_at TEXT;

ALTER TABLE cluster_run_logs ADD COLUMN reviewed_topics INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cluster_run_logs ADD COLUMN new_reviews INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cluster_run_logs ADD COLUMN insight_reports INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cluster_run_logs ADD COLUMN review_deltas TEXT;
