-- ===========================================
-- 054. 研究空白增加来源范围 scope 区分
-- ===========================================
-- 说明：
--   为 cluster_topic_gaps 增加 scope 列（'topic' | 'subtopic'），
--   将阶段 B 产出的宏观主题空白（'topic'）与子课题独立 LLM 空白（'subtopic'）
--   隔离存储与增量替换，互不覆写。历史存量行默认 'topic'。

ALTER TABLE cluster_topic_gaps ADD COLUMN scope TEXT NOT NULL DEFAULT 'topic';

CREATE INDEX IF NOT EXISTS idx_ctg_topic_scope ON cluster_topic_gaps(topic_id, scope, status);
