-- ============================================
-- 056. 主题聚类执行日志补充「归属再平衡」与切面积压计数
-- ============================================
-- 说明：
--   /clusters 页面需要展示最近一轮动态调整的规模（变更文章数、主归属迁移数）
--   与切面抽取积压，便于判断增量流水线是否真的在推进。
--   三列均为旁路统计，旧记录默认为 0，不影响流水线逻辑。

ALTER TABLE cluster_run_logs ADD COLUMN rebalanced_articles INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cluster_run_logs ADD COLUMN primary_switches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cluster_run_logs ADD COLUMN facet_pending INTEGER NOT NULL DEFAULT 0;
