/**
 * Database module - Kysely + SQLite
 *
 * Database operations with Kysely ORM and SQLite.
 */

import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, Generated } from 'kysely';

/**
 * Unwrap Generated<T> to T for selection results
 * Kysely returns unwrapped types from queries, but Generated<T> is needed for inserts
 */
type UnwrapGenerated<T> = T extends Generated<infer U> ? U : T;

/**
 * Convert a table type to its selection type (unwraps Generated fields)
 */
export type SelectionType<T> = {
  [K in keyof T]: UnwrapGenerated<T[K]>;
};
import { logger } from './logger.js';
import { config } from './config.js';
import { type SourceType } from './constants/source-types.js';
import fs from 'fs';
import path from 'path';

// Database table types
export interface DatabaseTable {
  users: UsersTable;
  rss_sources: RssSourcesTable;
  articles: ArticlesTable;
  topic_domains: TopicDomainsTable;
  topic_keywords: TopicKeywordsTable;
  article_filter_logs: ArticleFilterLogsTable;
  article_related: ArticleRelatedTable;
  article_translations: ArticleTranslationsTable;
  llm_configs: LlmConfigsTable;
  settings: SettingsTable;
  system_prompts: SystemPromptsTable;
  daily_summaries: DailySummariesTable;
  journals: JournalsTable;
  journal_crawl_logs: JournalCrawlLogsTable;
}

export interface UsersTable {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface RssSourcesTable {
  id: number;
  user_id: number;
  name: string;
  url: string;
  source_type: SourceType;
  last_fetched_at: string | null;
  fetch_interval: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface ArticlesTable {
  id: Generated<number>;
  rss_source_id: number | null;  // RSS来源（期刊文章为 null）
  title: string;
  title_normalized: string | null;  // 规范化标题用于去重
  url: string;
  summary: string | null;
  content: string | null;
  markdown_content: string | null;
  filter_status: 'pending' | 'passed' | 'rejected';
  filter_score: number | null;
  filtered_at: string | null;
  process_status: 'pending' | 'processing' | 'completed' | 'failed';
  process_stages: string | null;
  processed_at: string | null;
  published_at: string | null;
  published_year: number | null;    // 年份（期刊文章使用）
  published_issue: number | null;   // 期号（期刊文章使用）
  published_volume: number | null;  // 卷号（期刊文章使用）
  error_message: string | null;
  is_read: number;  // 0 = 未读, 1 = 已读
  source_origin: 'rss' | 'journal';  // 文章来源
  journal_id: number | null;  // 期刊ID（RSS文章为 null）
  created_at: Generated<string>;
  updated_at: string;
}

export interface TopicDomainsTable {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  is_active: number;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface TopicKeywordsTable {
  id: number;
  domain_id: number;
  keyword: string;
  description: string | null;
  weight: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ArticleFilterLogsTable {
  id: Generated<number>;
  article_id: number;
  domain_id: number | null;
  is_passed: number;
  relevance_score: number | null;
  matched_keywords: string | null;
  filter_reason: string | null;
  llm_response: string | null;
  created_at: Generated<string>;
}

export interface ArticleRelatedTable {
  article_id: number;
  related_article_id: number;
  score: number;
  created_at: string;
  updated_at: string;
}

export interface ArticleTranslationsTable {
  article_id: number;
  title_zh: string | null;
  summary_zh: string | null;
  source_lang: string | null;
  created_at: string;
  updated_at: string;
}

export interface LlmConfigsTable {
  id: number;
  user_id: number;
  provider: string;
  base_url: string;
  api_key_encrypted: string;
  model: string;
  config_type: string;
  task_type: string | null;
  enabled: number;
  is_default: number;
  priority: number;
  timeout: number;
  max_retries: number;
  max_concurrent: number;
  created_at: string;
  updated_at: string;
}

export interface SettingsTable {
  id: number;
  user_id: number;
  key: string;
  value: string;
  updated_at: string;
}

export interface SystemPromptsTable {
  id: number;
  user_id: number;
  type: string;
  name: string;
  template: string;
  variables: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface DailySummariesTable {
  id: Generated<number>;
  user_id: number;
  summary_date: string;
  summary_type: 'journal' | 'blog_news' | 'all';
  article_count: number;
  summary_content: string;
  articles_data: string;
  created_at: Generated<string>;
}

export interface JournalsTable {
  id: Generated<number>;
  user_id: number;
  name: string;
  source_type: 'cnki' | 'rdfybk' | 'lis' | 'wanfang';
  source_url: string | null;
  journal_code: string | null;
  publication_cycle: string;
  issues_per_year: number;
  volume_offset: number;
  last_year: number | null;
  last_issue: number | null;
  last_volume: number | null;
  status: 'active' | 'inactive';
  created_at: Generated<string>;
  updated_at: string;
}

export interface JournalCrawlLogsTable {
  id: Generated<number>;
  journal_id: number;
  crawl_year: number;
  crawl_issue: number;
  crawl_volume: number | null;
  articles_count: number;
  new_articles_count: number;
  status: 'success' | 'failed' | 'partial';
  error_message: string | null;
  duration_ms: number | null;
  created_at: Generated<string>;
}

export type DB = Kysely<DatabaseTable>;

// Selection result types (unwraps Generated<T> to T)
export type UsersSelection = SelectionType<UsersTable>;
export type RssSourcesSelection = SelectionType<RssSourcesTable>;
export type ArticlesSelection = SelectionType<ArticlesTable>;
export type TopicDomainsSelection = SelectionType<TopicDomainsTable>;
export type TopicKeywordsSelection = SelectionType<TopicKeywordsTable>;
export type ArticleFilterLogsSelection = SelectionType<ArticleFilterLogsTable>;
export type DailySummariesSelection = SelectionType<DailySummariesTable>;
export type JournalsSelection = SelectionType<JournalsTable>;
export type JournalCrawlLogsSelection = SelectionType<JournalCrawlLogsTable>;

let _db: DB | null = null;

/**
 * Initialize database connection
 */
export function initDb(): DB {
  if (_db) return _db;

  // Ensure data directory exists
  const dbDir = path.dirname(config.databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const sqlite = new Database(config.databasePath);

  // Enable WAL mode for better concurrency
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('cache_size = -64000'); // 64MB cache

  _db = new Kysely<DatabaseTable>({
    dialect: new SqliteDialect({
      database: sqlite,
    }),
  });

  logger.info({ database: config.databasePath }, 'Database initialized');
  return _db;
}

/**
 * Get database instance
 */
export function getDb(): DB {
  if (!_db) {
    return initDb();
  }
  return _db;
}

/**
 * Close database connection
 */
export async function closeDb(): Promise<void> {
  if (_db) {
    await _db.destroy();
    _db = null;
    logger.info('Database connection closed');
  }
}
