-- ===========================================
-- 045. 主题聚类与多维分析模块
-- ===========================================
-- 设计文档：docs/prd/主题聚类模块设计.md
--
-- 说明：
--   1. 本迁移只新增表与索引，不对任何既有表做 ALTER。
--   2. 归属模型为「多归属 + 每篇上限 + 主归属标记」，见 article_topic_links。
--   3. 主题集合版本化：全量重聚类产生新版本，旧版本归档保留（见 cluster_topic_sets）。
--   4. 所有时间字段使用应用层写入的 ISO 字符串；INTEGER 为 0/1 布尔。

-- ===========================================
-- 1. cluster_topic_sets（主题集合版本）
-- ===========================================
-- 同时充当「重建触发器」：把 embedding 模型/维度、切面契约版本、冷启动阈值
-- 作为快照落库，流水线启动时与当前配置比对，不一致即提示需要重建。
CREATE TABLE IF NOT EXISTS cluster_topic_sets (
  version INTEGER PRIMARY KEY,          -- 1,2,3…（应用层取 max+1）
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  trigger_reason TEXT,                  -- init | threshold_change | facet_contract_change | embedding_model_change | manual
  embedding_model TEXT,
  embedding_dim INTEGER,
  facet_contract_version TEXT,
  init_threshold REAL,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);

-- 任一时刻只允许一个 active 版本
CREATE UNIQUE INDEX IF NOT EXISTS idx_cts_single_active
  ON cluster_topic_sets(status) WHERE status = 'active';

-- ===========================================
-- 2. cluster_topics（主题）
-- ===========================================
CREATE TABLE IF NOT EXISTS cluster_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  set_version INTEGER NOT NULL,         -- 所属主题集合版本
  slug TEXT NOT NULL,                   -- 形如 v1-t-003-a1b2c3；不可变、永不复用
  name TEXT NOT NULL,                   -- LLM 生成的主题名称
  keywords TEXT,                        -- JSON 数组，3~5 个核心词
  status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW', 'ACTIVE', 'DORMANT', 'ARCHIVED')),
  centroid BLOB,                        -- float32[dim]，主题语义中心
  centroid_dim INTEGER,
  linked_count INTEGER NOT NULL DEFAULT 0,   -- 主题内唯一文章数
  primary_count INTEGER NOT NULL DEFAULT 0,  -- 主归属文章数
  period_added_count INTEGER NOT NULL DEFAULT 0,
  first_event_date TEXT,
  last_event_date TEXT,
  is_dirty INTEGER NOT NULL DEFAULT 1,
  last_analyzed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, set_version, slug)
);

CREATE INDEX IF NOT EXISTS idx_cluster_topics_set ON cluster_topics(set_version, status);
CREATE INDEX IF NOT EXISTS idx_cluster_topics_status ON cluster_topics(status);
CREATE INDEX IF NOT EXISTS idx_cluster_topics_dirty ON cluster_topics(is_dirty);
CREATE INDEX IF NOT EXISTS idx_cluster_topics_sort
  ON cluster_topics(set_version, period_added_count DESC, last_analyzed_at DESC);

-- ===========================================
-- 3. article_cluster_facets（单篇切面 + 向量）
-- ===========================================
-- 本表不存放归属关系（归属见 article_topic_links）。
-- 游离池 = 在 active 版本下无任何链接的文章。
CREATE TABLE IF NOT EXISTS article_cluster_facets (
  article_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  facet_json TEXT NOT NULL,             -- 切面契约（见设计文档 §7.1）
  facet_text TEXT NOT NULL,             -- 用于 embedding 的拼接文本（保留以便复算）
  facet_contract_version TEXT NOT NULL DEFAULT 'v1',
  embedding BLOB NOT NULL,              -- float32[dim]，小端
  embedding_model TEXT,
  embedding_dim INTEGER NOT NULL,
  event_date TEXT,                      -- 统一事件时间
  date_precision TEXT CHECK(date_precision IN ('day', 'year', 'ingest')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_acf_user ON article_cluster_facets(user_id);
CREATE INDEX IF NOT EXISTS idx_acf_event_date ON article_cluster_facets(event_date);

-- ===========================================
-- 4. article_topic_links（文章 ↔ 主题，多归属）
-- ===========================================
CREATE TABLE IF NOT EXISTS article_topic_links (
  article_id INTEGER NOT NULL,
  topic_id INTEGER NOT NULL,
  set_version INTEGER NOT NULL,         -- 冗余自 cluster_topics.set_version，用于按版本过滤
  similarity REAL NOT NULL,             -- 归入时与主题质心的余弦相似度
  is_primary INTEGER NOT NULL DEFAULT 0, -- 主归属（每篇每版本恰好 1 条）
  link_rank INTEGER NOT NULL DEFAULT 1,  -- 按相似度排序，1 = 最高
  assign_method TEXT NOT NULL CHECK(assign_method IN ('init', 'centroid', 'incubation', 'reclaim')),
  assigned_at TEXT,
  PRIMARY KEY (article_id, topic_id),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (topic_id) REFERENCES cluster_topics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_atl_topic ON article_topic_links(topic_id, is_primary);
CREATE INDEX IF NOT EXISTS idx_atl_article ON article_topic_links(article_id);
CREATE INDEX IF NOT EXISTS idx_atl_set ON article_topic_links(set_version);

-- 每篇文章在每个版本下恰好一个主归属
CREATE UNIQUE INDEX IF NOT EXISTS idx_atl_one_primary
  ON article_topic_links(article_id, set_version) WHERE is_primary = 1;

-- ===========================================
-- 5. cluster_topic_remap（跨版本重定向，保证旧 URL 不失效）
-- ===========================================
CREATE TABLE IF NOT EXISTS cluster_topic_remap (
  old_topic_id INTEGER NOT NULL,
  new_topic_id INTEGER NOT NULL,
  similarity REAL NOT NULL,
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (old_topic_id, new_topic_id),
  FOREIGN KEY (old_topic_id) REFERENCES cluster_topics(id) ON DELETE CASCADE,
  FOREIGN KEY (new_topic_id) REFERENCES cluster_topics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ctr_old ON cluster_topic_remap(old_topic_id);

-- ===========================================
-- 6. topic_threads（簇内研究脉络 = 角度 + 时间链）
-- ===========================================
CREATE TABLE IF NOT EXISTS topic_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL,
  angle_key TEXT NOT NULL,              -- 规则生成的角度稳定键（避免 LLM 改名导致漂移）
  angle_label TEXT,                     -- LLM 生成的角度名称
  article_count INTEGER NOT NULL DEFAULT 0,
  period_start TEXT,
  period_end TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'DORMANT')),
  trend TEXT CHECK(trend IN ('up', 'flat', 'down')),  -- 规则计算
  summary TEXT,                         -- LLM 写的脉络叙述（必须回链文章）
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (topic_id) REFERENCES cluster_topics(id) ON DELETE CASCADE,
  UNIQUE(topic_id, angle_key)
);

CREATE INDEX IF NOT EXISTS idx_topic_threads_topic ON topic_threads(topic_id);

-- ===========================================
-- 7. thread_articles（脉络内的文章序列）
-- ===========================================
CREATE TABLE IF NOT EXISTS thread_articles (
  thread_id INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,                 -- 脉络内序号（按 event_date）
  relation TEXT CHECK(relation IN ('origin', 'continue', 'shift', 'refute')),
  similarity_to_prev REAL,
  shared_method INTEGER NOT NULL DEFAULT 0,
  shared_object INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (thread_id, article_id),
  FOREIGN KEY (thread_id) REFERENCES topic_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_thread_articles_article ON thread_articles(article_id);

-- ===========================================
-- 8. topic_metrics_period（周期指标，规则计算）
-- ===========================================
CREATE TABLE IF NOT EXISTS topic_metrics_period (
  topic_id INTEGER NOT NULL,
  period TEXT NOT NULL,                 -- 'YYYY-MM'
  added_linked_count INTEGER NOT NULL DEFAULT 0,
  added_primary_count INTEGER NOT NULL DEFAULT 0,
  cumulative_linked_count INTEGER NOT NULL DEFAULT 0,
  cumulative_primary_count INTEGER NOT NULL DEFAULT 0,
  active_angle_count INTEGER,
  avg_similarity REAL,
  centroid_drift REAL,                  -- 该周期质心位移量
  method_entropy REAL,                  -- 方法分布熵（0=单一，越大越发散）
  object_entropy REAL,
  PRIMARY KEY (topic_id, period),
  FOREIGN KEY (topic_id) REFERENCES cluster_topics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tmp_period ON topic_metrics_period(period);

-- ===========================================
-- 9. cluster_topic_analysis（多维分析缓存）
-- ===========================================
CREATE TABLE IF NOT EXISTS cluster_topic_analysis (
  topic_id INTEGER PRIMARY KEY,
  analysis_json TEXT NOT NULL,          -- 见设计文档 §7.7 输出契约
  matrix_json TEXT,                     -- method × object 规则聚合结果（零 token）
  input_hash TEXT,                      -- sha256(输入)，审计与可复现
  linked_count INTEGER NOT NULL,
  contract_version TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK(status IN ('ok', 'insufficient_data', 'failed')),
  error_message TEXT,
  analyzed_at TEXT,
  FOREIGN KEY (topic_id) REFERENCES cluster_topics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cta_status ON cluster_topic_analysis(status);
