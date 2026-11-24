-- ===========================================
-- 053. 物化研究空白挂载子课题归属
-- ===========================================
-- 说明：
--   为 cluster_topic_gaps 增加 subtopic_key 列，记录研究空白归属的专门子课题分面，
--   供前端在深度综述卡片下方同屏联动呈现专属局限与空白。

ALTER TABLE cluster_topic_gaps ADD COLUMN subtopic_key TEXT;

CREATE INDEX IF NOT EXISTS idx_ctg_subtopic ON cluster_topic_gaps(topic_id, subtopic_key);
