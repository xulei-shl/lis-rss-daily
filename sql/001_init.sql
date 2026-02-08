-- ===========================================
-- RSS 文献追踪系统 - 数据库初始化脚本
-- ===========================================

-- Enable WAL mode for better concurrency
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- ===========================================
-- 1. Users Table
-- ===========================================
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- ===========================================
-- 2. RSS Sources Table
-- ===========================================
-- source_type 取值来自 src/constants/source-types.ts: SOURCE_TYPES
--   - 'journal' (期刊)
--   - 'blog' (博客, 默认)
--   - 'news' (资讯)
CREATE TABLE IF NOT EXISTS rss_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  source_type TEXT DEFAULT 'blog' CHECK(source_type IN ('journal', 'blog', 'news')),
  last_fetched_at DATETIME,
  fetch_interval INTEGER DEFAULT 3600,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rss_sources_user_id ON rss_sources(user_id);
CREATE INDEX IF NOT EXISTS idx_rss_sources_status ON rss_sources(status);
CREATE INDEX IF NOT EXISTS idx_rss_sources_source_type ON rss_sources(source_type);

-- ===========================================
-- 3. Articles Table
-- ===========================================
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rss_source_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  summary TEXT,
  content TEXT,
  markdown_content TEXT,
  filter_status TEXT DEFAULT 'pending' CHECK(filter_status IN ('pending', 'passed', 'rejected')),
  filter_score REAL,
  filtered_at DATETIME,
  process_status TEXT DEFAULT 'pending' CHECK(process_status IN ('pending', 'processing', 'completed', 'failed')),
  process_stages TEXT,
  processed_at DATETIME,
  published_at DATETIME,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rss_source_id) REFERENCES rss_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_articles_rss_source_id ON articles(rss_source_id);
CREATE INDEX IF NOT EXISTS idx_articles_filter_status ON articles(filter_status);
CREATE INDEX IF NOT EXISTS idx_articles_process_status ON articles(process_status);
CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);

-- ===========================================
-- 4. Topic Domains Table
-- ===========================================
CREATE TABLE IF NOT EXISTS topic_domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_topic_domains_user_id ON topic_domains(user_id);
CREATE INDEX IF NOT EXISTS idx_topic_domains_is_active ON topic_domains(is_active);

-- ===========================================
-- 5. Topic Keywords Table
-- ===========================================
CREATE TABLE IF NOT EXISTS topic_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id INTEGER NOT NULL,
  keyword TEXT NOT NULL,
  description TEXT,
  weight REAL DEFAULT 1.0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (domain_id) REFERENCES topic_domains(id) ON DELETE CASCADE,
  UNIQUE(domain_id, keyword)
);

CREATE INDEX IF NOT EXISTS idx_topic_keywords_domain_id ON topic_keywords(domain_id);
CREATE INDEX IF NOT EXISTS idx_topic_keywords_is_active ON topic_keywords(is_active);

-- ===========================================
-- 6. Article Filter Logs Table
-- ===========================================
CREATE TABLE IF NOT EXISTS article_filter_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  domain_id INTEGER,
  is_passed INTEGER NOT NULL,
  relevance_score REAL,
  matched_keywords TEXT,
  filter_reason TEXT,
  llm_response TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (domain_id) REFERENCES topic_domains(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_article_filter_logs_article_id ON article_filter_logs(article_id);
CREATE INDEX IF NOT EXISTS idx_article_filter_logs_domain_id ON article_filter_logs(domain_id);
CREATE INDEX IF NOT EXISTS idx_article_filter_logs_is_passed ON article_filter_logs(is_passed);

-- ===========================================
-- 7. Article Related Table
-- ===========================================
CREATE TABLE IF NOT EXISTS article_related (
  article_id INTEGER NOT NULL,
  related_article_id INTEGER NOT NULL,
  score REAL NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (article_id, related_article_id),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (related_article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_article_related_article_id ON article_related(article_id);
CREATE INDEX IF NOT EXISTS idx_article_related_related_article_id ON article_related(related_article_id);
CREATE INDEX IF NOT EXISTS idx_article_related_updated_at ON article_related(updated_at);

-- ===========================================
-- 8. Article Translations Table
-- ===========================================
CREATE TABLE IF NOT EXISTS article_translations (
  article_id INTEGER PRIMARY KEY,
  title_zh TEXT,
  summary_zh TEXT,
  source_lang TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_article_translations_article_id ON article_translations(article_id);

-- ===========================================
-- 9. LLM Configs Table
-- ===========================================
CREATE TABLE IF NOT EXISTS llm_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  model TEXT NOT NULL,
  config_type TEXT NOT NULL DEFAULT 'llm',
  enabled INTEGER DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 100,
  timeout INTEGER DEFAULT 30000,
  max_retries INTEGER DEFAULT 3,
  max_concurrent INTEGER DEFAULT 5,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_llm_configs_user_id ON llm_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_configs_is_default ON llm_configs(is_default);

-- ===========================================
-- 10. Settings Table
-- ===========================================
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id);
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);

-- ===========================================
-- 11. System Prompts Table
-- ===========================================
CREATE TABLE IF NOT EXISTS system_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  variables TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_system_prompts_user_id ON system_prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_system_prompts_type ON system_prompts(type);
CREATE INDEX IF NOT EXISTS idx_system_prompts_is_active ON system_prompts(is_active);

-- ===========================================
-- 12. Daily Summaries Table
-- ===========================================
CREATE TABLE IF NOT EXISTS daily_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  summary_date TEXT NOT NULL,
  article_count INTEGER NOT NULL,
  summary_content TEXT NOT NULL,
  articles_data TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_summaries_user_date ON daily_summaries(user_id, summary_date DESC);

-- ===========================================
-- Insert Default Data
-- ===========================================

-- Default admin user (password: admin123 - CHANGE IN PRODUCTION!)
INSERT OR IGNORE INTO users (id, username, password_hash)
VALUES (1, 'admin', '$2b$10$K8Xj5Z5Z5Z5Z5Z5Z5Z5Z5O5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5');

-- Default settings for admin user
INSERT OR IGNORE INTO settings (user_id, key, value)
VALUES
  (1, 'rss_fetch_schedule', '0 9 * * *'),
  (1, 'rss_fetch_enabled', 'true'),
  (1, 'llm_filter_enabled', 'true'),
  (1, 'max_concurrent_fetch', '5'),
  (1, 'timezone', 'Asia/Shanghai'),
  (1, 'language', 'zh-CN'),
  (1, 'chroma_host', '127.0.0.1'),
  (1, 'chroma_port', '8000'),
  (1, 'chroma_collection', 'articles'),
  (1, 'chroma_distance_metric', 'cosine');

-- Default system prompt for article filtering
INSERT OR IGNORE INTO system_prompts (user_id, type, name, template, variables, is_active)
VALUES (
  1,
  'filter',
  '默认文章过滤提示词',
  '你是一个专业的文献内容分析助手。

## 用户关注的主题领域和主题词：
{{TOPIC_DOMAINS}}

## 待分析文章：
标题：{{ARTICLE_TITLE}}
链接：{{ARTICLE_URL}}

## 输出要求：
请以 JSON 格式输出，包含以下字段：
{
  "is_relevant": true/false,
  "relevance_score": 0.0-1.0,
  "matched_keywords": ["关键词1", "关键词2"],
  "reason": "判断理由（中文）"
}

## 评分标准：
- 0.9-1.0：高度相关，直接涉及核心主题
- 0.6-0.8：中度相关，与主题领域有关联
- 0.3-0.5：低度相关，可能仅提及
- 0.0-0.2：不相关',
  '{"TOPIC_DOMAINS": "主题领域列表", "ARTICLE_TITLE": "文章标题", "ARTICLE_URL": "文章链接"}',
  1
);

-- Default system prompt for article analysis
INSERT OR IGNORE INTO system_prompts (user_id, type, name, template, variables, is_active)
VALUES (
  1,
  'analysis',
  '默认文章分析提示词',
  '请分析以下文章并生成摘要。

## 文章内容：
标题：{{ARTICLE_TITLE}}
来源：{{ARTICLE_SOURCE}}
作者：{{ARTICLE_AUTHOR}}
发布时间：{{PUBLISHED_DATE}}

正文：
{{ARTICLE_CONTENT}}

## 输出要求（JSON 格式）：
{
  "summary": "文章摘要（200-300字中文）",
  "key_points": ["要点1", "要点2", "要点3"],
  "tags": ["标签1", "标签2"],
  "category": "文章分类"
}',
  '{"ARTICLE_TITLE": "文章标题", "ARTICLE_SOURCE": "文章来源", "ARTICLE_AUTHOR": "作者", "PUBLISHED_DATE": "发布时间", "ARTICLE_CONTENT": "正文内容"}',
  1
);
