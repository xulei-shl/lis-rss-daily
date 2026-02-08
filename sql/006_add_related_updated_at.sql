-- ===========================================
-- Migration: Add updated_at to article_related
-- ===========================================
-- Purpose: Track last update time for related articles
--          to enable smart refresh strategies
-- ===========================================

ALTER TABLE article_related ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;

-- Update existing records to set updated_at = created_at
UPDATE article_related SET updated_at = created_at WHERE updated_at IS NULL;

-- Create index for efficient queries on stale records
CREATE INDEX IF NOT EXISTS idx_article_related_updated_at ON article_related(updated_at);
