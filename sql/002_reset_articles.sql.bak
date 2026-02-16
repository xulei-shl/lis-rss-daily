-- ===========================================
-- RSS 文献追踪系统 - 重置文章相关表
-- ===========================================
-- 清空 article_filter_logs, article_related, article_translations, articles 四张表
-- 保留 llm_configs, system_prompts, topic_domains, topic_keywords, rss_sources 等表

-- 临时禁用外键约束
PRAGMA foreign_keys = OFF;

-- 开启事务
BEGIN TRANSACTION;

-- 1. 清空文章过滤日志表
DELETE FROM article_filter_logs;

-- 2. 清空相关文章表
DELETE FROM article_related;

-- 3. 清空文章翻译表
DELETE FROM article_translations;

-- 4. 清空文章表
DELETE FROM articles;

-- 重置自增ID序列
DELETE FROM sqlite_sequence WHERE name IN ('article_filter_logs', 'article_related', 'article_translations', 'articles');

-- 提交事务
COMMIT;

-- 重新启用外键约束
PRAGMA foreign_keys = ON;

-- 验证结果
SELECT 'article_filter_logs' AS table_name, COUNT(*) AS remaining_count FROM article_filter_logs
UNION ALL
SELECT 'article_related', COUNT(*) FROM article_related
UNION ALL
SELECT 'article_translations', COUNT(*) FROM article_translations
UNION ALL
SELECT 'articles', COUNT(*) FROM articles;
