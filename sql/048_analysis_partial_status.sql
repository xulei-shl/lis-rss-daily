-- ===========================================
-- 048. 两阶段分析：cluster_topic_analysis.status 增加 partial
-- ===========================================
-- 说明：
--   阶段 A 成功后即落库，阶段 B 失败时状态为 partial，is_dirty 保持 1。
--   SQLite 无法直接修改 CHECK，因此重建本表；数据原样迁移。
--   migrate.ts 会检查建表 SQL 是否已包含 'partial'，重复执行时跳过。

PRAGMA foreign_keys = OFF;

CREATE TABLE cluster_topic_analysis_new (
  topic_id INTEGER PRIMARY KEY,
  analysis_json TEXT NOT NULL,
  matrix_json TEXT,
  input_hash TEXT,
  linked_count INTEGER NOT NULL,
  contract_version TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK(status IN ('ok', 'partial', 'insufficient_data', 'failed')),
  error_message TEXT,
  analyzed_at TEXT,
  FOREIGN KEY (topic_id) REFERENCES cluster_topics(id) ON DELETE CASCADE
);

INSERT INTO cluster_topic_analysis_new (
  topic_id, analysis_json, matrix_json, input_hash, linked_count,
  contract_version, status, error_message, analyzed_at
)
SELECT
  topic_id, analysis_json, matrix_json, input_hash, linked_count,
  contract_version, status, error_message, analyzed_at
FROM cluster_topic_analysis;

DROP TABLE cluster_topic_analysis;

ALTER TABLE cluster_topic_analysis_new RENAME TO cluster_topic_analysis;

CREATE INDEX IF NOT EXISTS idx_cta_status ON cluster_topic_analysis(status);

PRAGMA foreign_keys = ON;
