-- ============================================
-- 058. 执行日志补充「阶段标记」与周分析的再平衡溯源
-- ============================================
-- 说明：
--   日增量与周分析共用 trigger='cron'，无法从触发方式区分是否执行了再平衡/分析。
--   本迁移显式记录每轮实际执行的阶段，并让周分析记录“本轮洞察覆盖了哪些再平衡”。
--
--   rebalance_executed        本轮是否执行归属再平衡（日增量、手动 rebalance 为 1）
--   analysis_executed         本轮是否执行周分析（两阶段分析/综述/洞察为 1）
--   source_rebalance_runs     周分析覆盖的再平衡轮次数
--   source_rebalanced_articles 周分析覆盖的再平衡调整文章数合计
--   source_last_rebalance_at  覆盖范围内最近一次再平衡的完成时间

ALTER TABLE cluster_run_logs ADD COLUMN rebalance_executed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cluster_run_logs ADD COLUMN analysis_executed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cluster_run_logs ADD COLUMN source_rebalance_runs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cluster_run_logs ADD COLUMN source_rebalanced_articles INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cluster_run_logs ADD COLUMN source_last_rebalance_at TEXT;
