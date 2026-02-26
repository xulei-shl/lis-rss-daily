-- ===========================================
-- 添加文章评级字段
-- 用于给通过的文章打等级（1-5星）
-- ===========================================

ALTER TABLE articles ADD COLUMN rating INTEGER CHECK(rating IS NULL OR (rating >= 1 AND rating <= 5));

CREATE INDEX IF NOT EXISTS idx_articles_rating ON articles(rating) WHERE rating IS NOT NULL;
