-- Migration 014: Add wanfang source type support
-- 添加万方数据来源类型支持

-- 由于 SQLite 不支持直接修改 CHECK 约束，需要重建 journals 表

-- 1. 创建新表（包含 wanfang）
CREATE TABLE IF NOT EXISTS journals_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('cnki', 'rdfybk', 'lis', 'wanfang')),
  source_url TEXT,
  journal_code TEXT,
  publication_cycle TEXT NOT NULL CHECK(publication_cycle IN ('monthly', 'bimonthly', 'semimonthly', 'quarterly')),
  issues_per_year INTEGER NOT NULL,
  volume_offset INTEGER DEFAULT 1956,
  last_year INTEGER,
  last_issue INTEGER,
  last_volume INTEGER,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2. 复制现有数据
INSERT INTO journals_new (id, user_id, name, source_type, source_url, journal_code, publication_cycle, issues_per_year, volume_offset, last_year, last_issue, last_volume, status, created_at, updated_at)
SELECT id, user_id, name, source_type, source_url, journal_code, publication_cycle, issues_per_year, volume_offset, last_year, last_issue, last_volume, status, created_at, updated_at
FROM journals;

-- 3. 删除旧表
DROP TABLE journals;

-- 4. 重命名新表
ALTER TABLE journals_new RENAME TO journals;

-- 5. 重建索引
CREATE INDEX IF NOT EXISTS idx_journals_user_id ON journals(user_id);
CREATE INDEX IF NOT EXISTS idx_journals_status ON journals(status);
CREATE INDEX IF NOT EXISTS idx_journals_source_type ON journals(source_type);
