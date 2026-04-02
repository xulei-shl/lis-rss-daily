-- 将每日总结推送拆分为“通过期刊”和“通过资讯”两个独立配置
ALTER TABLE telegram_chats ADD COLUMN daily_summary_journal INTEGER DEFAULT 1;
ALTER TABLE telegram_chats ADD COLUMN daily_summary_blog_news INTEGER DEFAULT 1;
