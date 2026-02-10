-- ===========================================
-- Migration: Add task_type to llm_configs
-- ===========================================
-- Purpose: Enable per-task-type model configuration
--          (e.g., filter uses fast model, translation uses quality model)
-- ===========================================

-- Add task_type column (nullable for backward compatibility)
ALTER TABLE llm_configs ADD COLUMN task_type TEXT;

-- Create index for efficient queries by task_type
CREATE INDEX IF NOT EXISTS idx_llm_configs_task_type ON llm_configs(task_type);

-- Create composite index for user + config_type + task_type queries
CREATE INDEX IF NOT EXISTS idx_llm_configs_user_config_task ON llm_configs(user_id, config_type, task_type, is_default, priority);

-- Note: Existing records will have task_type = NULL, serving as fallback configs
