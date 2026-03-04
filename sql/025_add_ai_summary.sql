-- 新增 ai_summary 字段，用于存储 AI 生成的文章总结
ALTER TABLE articles ADD COLUMN ai_summary TEXT;
