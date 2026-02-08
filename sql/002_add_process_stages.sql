-- ===========================================
-- 添加文章处理步骤状态字段
-- ===========================================

-- 添加 process_stages 字段记录每个步骤的状态
ALTER TABLE articles ADD COLUMN process_stages TEXT;

-- 示例值：
-- {"markdown":"completed","translate":"completed","vector":"completed","related":"completed"}
-- {"markdown":"completed","translate":"failed","vector":"skipped","related":"pending"}
