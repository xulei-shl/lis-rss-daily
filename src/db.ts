/**
 * Database module - Kysely + SQLite
 *
 * Database operations with Kysely ORM and SQLite.
 */

import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { logger } from './logger.js';
import { config } from './config.js';
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
  keywords: KeywordsTable;
  article_keywords: ArticleKeywordsTable;
  article_related: ArticleRelatedTable;
  article_translations: ArticleTranslationsTable;
  llm_configs: LlmConfigsTable;
  settings: SettingsTable;
  system_prompts: SystemPromptsTable;
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
  last_fetched_at: string | null;
  fetch_interval: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface ArticlesTable {
  id: number;
  rss_source_id: number;
  title: string;
  url: string;
  summary: string | null;
  content: string | null;
  markdown_content: string | null;
  filter_status: 'pending' | 'passed' | 'rejected';
  filter_score: number | null;
  filtered_at: string | null;
  process_status: 'pending' | 'processing' | 'completed' | 'failed';
  processed_at: string | null;
  published_at: string | null;
  error_message: string | null;
  created_at: string;
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
  id: number;
  article_id: number;
  domain_id: number | null;
  is_passed: number;
  relevance_score: number | null;
  matched_keywords: string | null;
  filter_reason: string | null;
  llm_response: string | null;
  created_at: string;
}

export interface KeywordsTable {
  id: number;
  keyword: string;
  created_at: string;
  updated_at: string;
}

export interface ArticleKeywordsTable {
  article_id: number;
  keyword_id: number;
  created_at: string;
}

export interface ArticleRelatedTable {
  article_id: number;
  related_article_id: number;
  score: number;
  created_at: string;
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
  is_default: number;
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

export type DB = Kysely<DatabaseTable>;

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
