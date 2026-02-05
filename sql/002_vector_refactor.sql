-- ===========================================
-- 向量检索重构迁移
-- ===========================================

-- 扩展 llm_configs：config_type + enabled
ALTER TABLE llm_configs ADD COLUMN config_type TEXT NOT NULL DEFAULT 'llm';
ALTER TABLE llm_configs ADD COLUMN enabled INTEGER DEFAULT 0;

UPDATE llm_configs
SET config_type = 'llm'
WHERE config_type IS NULL OR config_type = '';

-- 默认 Chroma 设置（仅管理员）
INSERT OR IGNORE INTO settings (user_id, key, value)
VALUES
  (1, 'chroma_host', '127.0.0.1'),
  (1, 'chroma_port', '8000'),
  (1, 'chroma_collection', 'articles'),
  (1, 'chroma_distance_metric', 'cosine');
