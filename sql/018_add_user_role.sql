-- ===========================================
-- 添加用户角色字段 (role)
-- 用于实现访客只读模式
-- ===========================================

-- 1. 添加 role 字段
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'admin' CHECK(role IN ('admin', 'guest'));

-- 2. 更新现有的 admin 用户为 admin 角色
UPDATE users SET role = 'admin' WHERE username = 'admin';

-- 3. 插入 guest 访客账号 (密码: cc@7007)
-- 注意：生产环境请使用更安全的密码
-- 密码哈希使用 SHA256 格式（兼容 bcryptjs ESM 加载问题）
INSERT OR IGNORE INTO users (username, password_hash, role)
VALUES ('guest', '369a85abf5be438e8d598ede77a8efabff97669c483efaa2ca0a29f749d83f22', 'guest');

-- 4. 为 guest 用户创建默认设置
-- 注意：访客需要有自己的设置记录才能正常使用系统
INSERT OR IGNORE INTO settings (user_id, key, value)
SELECT id, 'rss_fetch_schedule', '0 9 * * *' FROM users WHERE username = 'guest';

INSERT OR IGNORE INTO settings (user_id, key, value)
SELECT id, 'rss_fetch_enabled', 'true' FROM users WHERE username = 'guest';

INSERT OR IGNORE INTO settings (user_id, key, value)
SELECT id, 'llm_filter_enabled', 'true' FROM users WHERE username = 'guest';

INSERT OR IGNORE INTO settings (user_id, key, value)
SELECT id, 'max_concurrent_fetch', '5' FROM users WHERE username = 'guest';

INSERT OR IGNORE INTO settings (user_id, key, value)
SELECT id, 'timezone', 'Asia/Shanghai' FROM users WHERE username = 'guest';

INSERT OR IGNORE INTO settings (user_id, key, value)
SELECT id, 'language', 'zh-CN' FROM users WHERE username = 'guest';

INSERT OR IGNORE INTO settings (user_id, key, value)
SELECT id, 'chroma_host', '127.0.0.1' FROM users WHERE username = 'guest';

INSERT OR IGNORE INTO settings (user_id, key, value)
SELECT id, 'chroma_port', '8000' FROM users WHERE username = 'guest';

INSERT OR IGNORE INTO settings (user_id, key, value)
SELECT id, 'chroma_collection', 'articles' FROM users WHERE username = 'guest';

INSERT OR IGNORE INTO settings (user_id, key, value)
SELECT id, 'chroma_distance_metric', 'cosine' FROM users WHERE username = 'guest';
