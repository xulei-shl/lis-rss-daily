import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import path from 'path';
import { getConfig } from './config.js';

interface ArticlesTable {
  id: number;
  rss_source_id: number | null;
  title: string;
  title_normalized: string | null;
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
  published_year: number | null;
  published_issue: number | null;
  published_volume: number | null;
  error_message: string | null;
  is_read: number;
  source_origin: 'rss' | 'journal' | 'keyword';
  journal_id: number | null;
  keyword_id: number | null;
  rating: number | null;
  ai_summary: string | null;
  created_at: string;
  updated_at: string;
}

interface ArticleRelatedTable {
  article_id: number;
  related_article_id: number;
  score: number;
  created_at: string;
  updated_at: string;
}

interface RssSourcesTable {
  id: number;
  user_id: number;
  name: string;
  url: string;
  source_type: string;
  last_fetched_at: string | null;
  fetch_interval: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

interface JournalsTable {
  id: number;
  user_id: number;
  name: string;
  source_type: string;
  source_url: string | null;
  created_at: string;
  updated_at: string;
}

interface KeywordSubscriptionsTable {
  id: number;
  user_id: number;
  keyword: string;
  created_at: string;
  updated_at: string;
}

interface LlmConfigsTable {
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

export interface DatabaseSchema {
  articles: ArticlesTable;
  article_related: ArticleRelatedTable;
  rss_sources: RssSourcesTable;
  journals: JournalsTable;
  keyword_subscriptions: KeywordSubscriptionsTable;
  llm_configs: LlmConfigsTable;
}

let dbInstance: Kysely<DatabaseSchema> | null = null;
let simpleDb: Database.Database | null = null;

export function getDb(): Kysely<DatabaseSchema> {
  if (dbInstance) {
    return dbInstance;
  }

  const config = getConfig();
  let dbPath = config.database.path;

  if (!path.isAbsolute(dbPath)) {
    const scriptDir = path.resolve(process.cwd(), 'scripts/deepsearch');
    dbPath = path.join(scriptDir, '..', dbPath);
    dbPath = path.resolve(dbPath);
  }

  const dialect = new SqliteDialect({
    database: new Database(dbPath),
  });

  dbInstance = new Kysely<DatabaseSchema>({
    dialect,
  });

  return dbInstance;
}

export function getSimpleDb(): Database.Database {
  if (simpleDb) {
    return simpleDb;
  }

  const config = getConfig();
  let dbPath = config.database.path;

  if (!path.isAbsolute(dbPath)) {
    const scriptDir = path.resolve(process.cwd(), 'scripts/deepsearch');
    dbPath = path.join(scriptDir, '..', dbPath);
    dbPath = path.resolve(dbPath);
  }

  simpleDb = new Database(dbPath);
  return simpleDb;
}

export async function getArticleById(articleId: number): Promise<ArticlesTable | null> {
  const db = getSimpleDb();
  const row = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId) as ArticlesTable | undefined;
  return row || null;
}

export async function getArticlesByIds(articleIds: number[]): Promise<ArticlesTable[]> {
  if (articleIds.length === 0) return [];
  const db = getSimpleDb();
  const placeholders = articleIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM articles WHERE id IN (${placeholders})`).all(...articleIds) as ArticlesTable[];
  return rows;
}

export async function getRelatedArticles(
  userId: number,
  articleId: number,
  limit: number
): Promise<Array<{ article_id: number; related_article_id: number; score: number; title: string }>> {
  const db = getSimpleDb();
  const rows = db.prepare(`
    SELECT ar.article_id, ar.related_article_id, ar.score, a.title
    FROM article_related ar
    INNER JOIN articles a ON a.id = ar.related_article_id
    LEFT JOIN rss_sources rs ON rs.id = a.rss_source_id
    LEFT JOIN journals j ON j.id = a.journal_id
    LEFT JOIN keyword_subscriptions ks ON ks.id = a.keyword_id
    WHERE ar.article_id = ?
      AND (rs.user_id = ? OR j.user_id = ? OR ks.user_id = ?)
      AND a.filter_status = 'passed'
      AND a.process_status = 'completed'
    ORDER BY ar.score DESC
    LIMIT ?
  `).all(articleId, userId, userId, userId, limit) as Array<{ article_id: number; related_article_id: number; score: number; title: string }>;
  return rows;
}

export async function getLLMConfigs(
  userId: number,
  taskType?: string | null
): Promise<LlmConfigsTable[]> {
  const db = getSimpleDb();
  let query = `
    SELECT * FROM llm_configs
    WHERE user_id = ? AND enabled = 1
  `;
  const params: (string | number)[] = [userId];

  if (taskType) {
    query += ` AND (task_type = ? OR task_type IS NULL)`;
    params.push(taskType);
  }

  query += ` ORDER BY is_default DESC, priority DESC, created_at ASC`;

  const rows = db.prepare(query).all(...params) as LlmConfigsTable[];
  return rows;
}

export async function closeDb(): Promise<void> {
  if (dbInstance) {
    await dbInstance.destroy();
    dbInstance = null;
  }
  if (simpleDb) {
    simpleDb.close();
    simpleDb = null;
  }
}