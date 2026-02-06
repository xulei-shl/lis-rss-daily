-- ===========================================
-- 迁移脚本：更新系统提示词变量定义
-- ===========================================
-- 说明：
-- 1. 删除包含已废弃变量（ARTICLE_DESCRIPTION、ARTICLE_SUMMARY）的旧提示词
-- 2. 重新初始化为新的变量定义（仅使用 ARTICLE_CONTENT）
-- ===========================================

-- 删除所有用户的旧系统提示词（让用户重新初始化）
DELETE FROM system_prompts WHERE 1=1;

-- 或者：只更新 admin 用户的提示词
-- DELETE FROM system_prompts WHERE user_id = 1;
