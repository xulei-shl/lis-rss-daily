-- ===========================================
-- 40. 拒绝清理统计缓存增加已完成数量追踪
-- ===========================================
-- 当自动清理移走 rejected 文章时，部分文章可能 process_status='completed'，
-- 这会导致首页「已完成」统计不准确地减少。
-- 新增 completed_rejected_count 字段追踪其中已完成的数量，
-- 统计时加上此值补偿。
-- ===========================================

ALTER TABLE rejected_cleanup_stats ADD COLUMN completed_rejected_count INTEGER NOT NULL DEFAULT 0;
