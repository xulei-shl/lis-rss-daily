-- ===========================================
-- 052. 洞察报告收口到单个主题
-- ===========================================
-- 说明：
--   051 的洞察是「跨大主题」产物（topic_ids_json + 跨主题元簇）。
--   现按产品口径改为：洞察只在一个大主题内部，综合该主题的多个综述子簇
--   与研究空白，不再跨主题。
--
--   1. 增加 topic_id，报告身份与唯一性都收口到主题；
--   2. 历史跨主题报告无法映射到单一主题，统一置为 superseded 保留审计，
--      不删除（当前库无此类报告时为空操作）；
--   3. topic_ids_json 保留但只写入一个元素，兼容旧读取路径。

ALTER TABLE cluster_insight_reports ADD COLUMN topic_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_cir_topic
  ON cluster_insight_reports(topic_id, status);

UPDATE cluster_insight_reports
  SET status = 'superseded'
  WHERE topic_id IS NULL AND status != 'superseded';
