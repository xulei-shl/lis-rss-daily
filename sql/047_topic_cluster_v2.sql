-- ===========================================
-- 047. 主题聚类 v2：脉络类型与学术角色
-- ===========================================
-- 说明：
--   1. 只做加法列，不重建表、不改既有 CHECK；发散角度用 relation=NULL 表示无承接。
--   2. migrate.ts 会按列是否存在逐条跳过，因此本文件可重复执行。
--   3. 不回填历史行：新列默认值即旧行为的等价语义
--      （旧脉络全部是 linear，成员全部是 backbone）。

ALTER TABLE topic_threads ADD COLUMN pattern_type TEXT NOT NULL DEFAULT 'linear';

ALTER TABLE thread_articles ADD COLUMN academic_role TEXT NOT NULL DEFAULT 'backbone';

ALTER TABLE thread_articles ADD COLUMN is_representative INTEGER NOT NULL DEFAULT 0;
