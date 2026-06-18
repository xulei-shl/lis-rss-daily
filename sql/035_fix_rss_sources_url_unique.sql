-- Migration: 035_fix_rss_sources_url_unique.sql
-- Description: 将 rss_sources 表的 url 全局 UNIQUE 约束改为 (user_id, url) 复合 UNIQUE
--              允许不同用户添加相同的 RSS 订阅源
-- Date: 2026-06-18

PRAGMA foreign_keys = OFF;

-- ===========================================
-- 1. 重建 rss_sources 表，使用复合唯一约束
-- ===========================================
CREATE TABLE IF NOT EXISTS rss_sources_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  source_type     TEXT DEFAULT 'blog' CHECK(source_type IN ('journal', 'blog', 'news')),
  last_fetched_at DATETIME,
  fetch_interval  INTEGER DEFAULT 3600,
  status          TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, url)
);

-- ===========================================
-- 2. 迁移现有数据
-- ===========================================
INSERT INTO rss_sources_new (
  id, user_id, name, url, source_type, last_fetched_at,
  fetch_interval, status, created_at, updated_at
)
SELECT
  id, user_id, name, url, source_type, last_fetched_at,
  fetch_interval, status, created_at, updated_at
FROM rss_sources;

-- ===========================================
-- 3. 删除旧表并重命名新表
-- ===========================================
DROP TABLE rss_sources;
ALTER TABLE rss_sources_new RENAME TO rss_sources;

-- ===========================================
-- 4. 重建索引
-- ===========================================
CREATE INDEX IF NOT EXISTS idx_rss_sources_user_id ON rss_sources(user_id);
CREATE INDEX IF NOT EXISTS idx_rss_sources_status ON rss_sources(status);
CREATE INDEX IF NOT EXISTS idx_rss_sources_source_type ON rss_sources(source_type);

PRAGMA foreign_keys = ON;
