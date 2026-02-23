-- Migration 012: Add journals and journal_crawl_logs tables
-- 期刊网页定时爬取功能数据库迁移

-- ===========================================
-- 1. Journals Table (期刊表)
-- ===========================================
-- 存储待爬取期刊的基本信息
CREATE TABLE IF NOT EXISTS journals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,                    -- 期刊名称
  source_type TEXT NOT NULL CHECK(source_type IN ('cnki', 'rdfybk', 'lis')),  -- 期刊来源类型
  source_url TEXT,                       -- 期刊 URL 或导航页 URL
  journal_code TEXT,                     -- 期刊代码（人大报刊专用）
  publication_cycle TEXT NOT NULL,       -- 发行周期：monthly/bimonthly/semimonthly/quarterly
  issues_per_year INTEGER NOT NULL,      -- 每年期数
  volume_offset INTEGER DEFAULT 1956,    -- 卷号计算偏移量: volume = year - volume_offset
  last_year INTEGER,                     -- 上次爬取年份
  last_issue INTEGER,                    -- 上次爬取期号
  last_volume INTEGER,                   -- 上次爬取卷号（LIS期刊使用）
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_journals_user_id ON journals(user_id);
CREATE INDEX IF NOT EXISTS idx_journals_status ON journals(status);
CREATE INDEX IF NOT EXISTS idx_journals_source_type ON journals(source_type);

-- ===========================================
-- 2. Journal Crawl Logs Table (爬取日志表)
-- ===========================================
-- 记录每次爬取的详细信息，用于追踪和排错
CREATE TABLE IF NOT EXISTS journal_crawl_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id INTEGER NOT NULL,
  crawl_year INTEGER NOT NULL,           -- 爬取年份
  crawl_issue INTEGER NOT NULL,          -- 爬取期号
  crawl_volume INTEGER,                  -- 爬取卷号（LIS期刊使用）
  articles_count INTEGER DEFAULT 0,      -- 爬取文章数
  new_articles_count INTEGER DEFAULT 0,  -- 新增文章数
  status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'partial')),
  error_message TEXT,
  duration_ms INTEGER,                   -- 爬取耗时（毫秒）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_journal_crawl_logs_journal_id ON journal_crawl_logs(journal_id);
CREATE INDEX IF NOT EXISTS idx_journal_crawl_logs_created_at ON journal_crawl_logs(created_at);

-- ===========================================
-- 3. Articles Table Updates (文章表更新)
-- ===========================================
-- 新增 source_origin 字段区分文章来源
ALTER TABLE articles ADD COLUMN source_origin TEXT DEFAULT 'rss' CHECK(source_origin IN ('rss', 'journal'));
ALTER TABLE articles ADD COLUMN journal_id INTEGER REFERENCES journals(id);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_articles_source_origin ON articles(source_origin);
CREATE INDEX IF NOT EXISTS idx_articles_journal_id ON articles(journal_id);

-- ===========================================
-- 4. Initialize Journal Data (初始化期刊数据)
-- ===========================================
-- CNKI 期刊
INSERT OR IGNORE INTO journals (user_id, name, source_type, source_url, publication_cycle, issues_per_year, last_year, last_issue) VALUES
(1, '中国图书馆学报', 'cnki', 'https://navi.cnki.net/knavi/journals/ZGTS/detail', 'bimonthly', 6, 2025, 6),
(1, '图书情报知识', 'cnki', 'https://navi.cnki.net/knavi/journals/TSQC/detail', 'bimonthly', 6, 2025, 6),
(1, '信息资源管理学报', 'cnki', 'https://navi.cnki.net/knavi/journals/XNZY/detail', 'bimonthly', 6, 2025, 4),
(1, '图书馆论坛', 'cnki', 'https://navi.cnki.net/knavi/journals/TSGL/detail', 'monthly', 12, 2025, 12),
(1, '大学图书馆学报', 'cnki', 'https://navi.cnki.net/knavi/journals/DXTS/detail', 'bimonthly', 6, 2025, 6),
(1, '图书馆建设', 'cnki', 'https://navi.cnki.net/knavi/journals/TSGJ/detail', 'bimonthly', 6, 2025, 6),
(1, '国家图书馆学刊', 'cnki', 'https://navi.cnki.net/knavi/journals/BJJG/detail', 'bimonthly', 6, 2025, 6),
(1, '图书与情报', 'cnki', 'https://navi.cnki.net/knavi/journals/BOOK/detail', 'bimonthly', 6, 2025, 5),
(1, '图书馆杂志', 'cnki', 'https://navi.cnki.net/knavi/journals/TNGZ/detail', 'monthly', 12, 2025, 12),
(1, '图书馆学研究', 'cnki', 'https://navi.cnki.net/knavi/journals/TSSS/detail', 'monthly', 12, 2025, 12),
(1, '图书馆工作与研究', 'cnki', 'https://navi.cnki.net/knavi/journals/TSGG/detail', 'monthly', 12, 2025, 12),
(1, '图书馆', 'cnki', 'https://navi.cnki.net/knavi/journals/TSGT/detail', 'monthly', 12, NULL, NULL),
(1, '图书馆理论与实践', 'cnki', 'https://navi.cnki.net/knavi/journals/LSGL/detail', 'monthly', 12, 2025, 12),
(1, '文献与数据学报', 'cnki', 'https://navi.cnki.net/knavi/journals/BXJW/detail', 'quarterly', 4, 2025, 4),
(1, '农业图书情报学报', 'cnki', 'https://navi.cnki.net/knavi/journals/LYTS/detail', 'monthly', 12, 2025, 12);

-- 人大报刊期刊
INSERT OR IGNORE INTO journals (user_id, name, source_type, journal_code, publication_cycle, issues_per_year, last_year, last_issue) VALUES
(1, '图书馆学情报学', 'rdfybk', 'G9', 'monthly', 12, 2025, 12),
(1, '档案学', 'rdfybk', 'G7', 'bimonthly', 6, NULL, NULL),
(1, '出版业', 'rdfybk', 'Z1', 'monthly', 12, NULL, NULL);

-- 独立网站期刊
INSERT OR IGNORE INTO journals (user_id, name, source_type, source_url, publication_cycle, issues_per_year, volume_offset, last_year, last_issue, last_volume) VALUES
(1, '图书情报工作', 'lis', 'https://www.lis.ac.cn', 'semimonthly', 24, 1956, 2026, 4, 70);
