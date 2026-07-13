-- ===========================================
-- 37. Add domain_id to all source tables
-- ===========================================
-- 为每个源条目绑定一个主题领域，过滤时 LLM 只对该领域评估
-- 已有行回填用户优先级最高的活跃领域 id
-- ===========================================

-- rss_sources
ALTER TABLE rss_sources ADD COLUMN domain_id INTEGER REFERENCES topic_domains(id);
UPDATE rss_sources SET domain_id = (
  SELECT id FROM topic_domains
  WHERE topic_domains.user_id = rss_sources.user_id AND is_active = 1
  ORDER BY priority DESC LIMIT 1
);
CREATE INDEX IF NOT EXISTS idx_rss_sources_domain_id ON rss_sources(domain_id);

-- journals
ALTER TABLE journals ADD COLUMN domain_id INTEGER REFERENCES topic_domains(id);
UPDATE journals SET domain_id = (
  SELECT id FROM topic_domains
  WHERE topic_domains.user_id = journals.user_id AND is_active = 1
  ORDER BY priority DESC LIMIT 1
);
CREATE INDEX IF NOT EXISTS idx_journals_domain_id ON journals(domain_id);

-- keyword_subscriptions
ALTER TABLE keyword_subscriptions ADD COLUMN domain_id INTEGER REFERENCES topic_domains(id);
UPDATE keyword_subscriptions SET domain_id = (
  SELECT id FROM topic_domains
  WHERE topic_domains.user_id = keyword_subscriptions.user_id AND is_active = 1
  ORDER BY priority DESC LIMIT 1
);
CREATE INDEX IF NOT EXISTS idx_keyword_subscriptions_domain_id ON keyword_subscriptions(domain_id);

-- email_sources
ALTER TABLE email_sources ADD COLUMN domain_id INTEGER REFERENCES topic_domains(id);
UPDATE email_sources SET domain_id = (
  SELECT id FROM topic_domains
  WHERE topic_domains.user_id = email_sources.user_id AND is_active = 1
  ORDER BY priority DESC LIMIT 1
);
CREATE INDEX IF NOT EXISTS idx_email_sources_domain_id ON email_sources(domain_id);