-- ===========================================
-- LLM 配置优先级迁移
-- ===========================================

ALTER TABLE llm_configs ADD COLUMN priority INTEGER DEFAULT 100;

UPDATE llm_configs
SET priority = 100
WHERE priority IS NULL;
