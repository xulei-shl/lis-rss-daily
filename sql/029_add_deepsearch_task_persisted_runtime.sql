-- 为 deepsearch_tasks 增加运行态持久化字段
-- 注意：仅新增列，不改动历史数据
ALTER TABLE deepsearch_tasks ADD COLUMN search_stats_json TEXT;
ALTER TABLE deepsearch_tasks ADD COLUMN execution_logs_json TEXT;
