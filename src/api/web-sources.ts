/**
 * Web Sources Service
 *
 * CRUD operations for web scraper source management.
 */

import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { type SourceType, DEFAULT_SOURCE_TYPE, VALID_SOURCE_TYPES } from '../constants/source-types.js';

const log = logger.child({ module: 'web-sources-service' });

export interface CreateWebSourceInput {
  name: string;
  url: string;
  scraperType: string;
  sourceType?: SourceType;
  domainId?: number;
  fetchInterval?: number;
  autoCleanupRejected?: boolean;
  status?: 'active' | 'inactive';
}

export interface UpdateWebSourceInput {
  name?: string;
  url?: string;
  scraperType?: string;
  sourceType?: SourceType;
  domainId?: number;
  fetchInterval?: number;
  autoCleanupRejected?: boolean;
  status?: 'active' | 'inactive';
}

export interface WebSourceRecord {
  id: number;
  user_id: number;
  name: string;
  url: string;
  source_type: SourceType;
  scraper_type: string;
  domain_id: number;
  last_fetched_at: string | null;
  fetch_interval: number;
  auto_cleanup_rejected: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

/**
 * Get all web sources for a user
 */
export async function getWebSources(userId: number): Promise<WebSourceRecord[]> {
  const db = getDb();
  return db
    .selectFrom('web_sources')
    .where('user_id', '=', userId)
    .selectAll()
    .orderBy('created_at', 'desc')
    .execute();
}

/**
 * Get a single web source by ID
 */
export async function getWebSourceById(id: number, userId: number): Promise<WebSourceRecord | undefined> {
  const db = getDb();
  return db
    .selectFrom('web_sources')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst();
}

/**
 * Get active web sources (for scheduler)
 */
export async function getActiveWebSources(userId: number): Promise<WebSourceRecord[]> {
  const db = getDb();
  return db
    .selectFrom('web_sources')
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .selectAll()
    .orderBy('created_at', 'asc')
    .execute();
}

/**
 * Check if a web source name already exists for the user
 */
export async function checkWebSourceNameExists(userId: number, name: string, excludeId?: number): Promise<boolean> {
  const db = getDb();
  let query = db
    .selectFrom('web_sources')
    .where('user_id', '=', userId)
    .where('name', '=', name);

  if (excludeId !== undefined) {
    query = query.where('id', '!=', excludeId);
  }

  const existing = await query.select('id').executeTakeFirst();
  return existing !== undefined;
}

/**
 * Check if a web source URL already exists for the user
 */
export async function checkWebSourceUrlExists(userId: number, url: string, excludeId?: number): Promise<boolean> {
  const db = getDb();
  let query = db
    .selectFrom('web_sources')
    .where('user_id', '=', userId)
    .where('url', '=', url);

  if (excludeId !== undefined) {
    query = query.where('id', '!=', excludeId);
  }

  const existing = await query.select('id').executeTakeFirst();
  return existing !== undefined;
}

/**
 * Create a new web source
 */
export async function createWebSource(
  userId: number,
  input: CreateWebSourceInput
): Promise<{ id: number; name: string }> {
  const db = getDb();

  // If domain_id not specified, use the user's highest-priority active domain
  let domainId = input.domainId;
  if (domainId === undefined) {
    const defaultDomain = await db
      .selectFrom('topic_domains')
      .where('user_id', '=', userId)
      .where('is_active', '=', 1)
      .select('id')
      .orderBy('priority', 'desc')
      .executeTakeFirst();
    domainId = defaultDomain?.id;
  }

  const now = new Date().toISOString();

  // Ensure source_type is one of 'journal', 'blog', 'news' (valid for web_sources)
  // SourceType includes 'email' which is not valid for web_sources
  const webSourceType = input.sourceType && VALID_SOURCE_TYPES.includes(input.sourceType) && input.sourceType !== 'email'
    ? input.sourceType
    : (DEFAULT_SOURCE_TYPE === 'email' ? 'blog' : DEFAULT_SOURCE_TYPE);

  // Explicitly resolve fetchInterval to a number to satisfy Kysely's strict types
  const fetchInterval: number = input.fetchInterval != null ? input.fetchInterval : 3600;

  const result = await db
    .insertInto('web_sources')
    .values({
      user_id: userId,
      name: input.name,
      url: input.url,
      source_type: webSourceType,
      scraper_type: input.scraperType,
      domain_id: domainId as number,
      fetch_interval: fetchInterval,
      auto_cleanup_rejected: input.autoCleanupRejected ? 1 : 0,
      status: input.status || 'active',
      updated_at: now,
    })
    .executeTakeFirstOrThrow();

  const insertedId = Number(result.insertId);
  log.info({ userId, id: insertedId, name: input.name }, 'Web source created');
  return { id: insertedId, name: input.name };
}

/**
 * Update an existing web source
 */
export async function updateWebSource(
  id: number,
  userId: number,
  input: UpdateWebSourceInput
): Promise<boolean> {
  const db = getDb();
  const now = new Date().toISOString();

  // Build update object with proper types for Kysely
  const updateFields: Record<string, any> = { updated_at: now };

  if (input.name !== undefined) updateFields.name = input.name;
  if (input.url !== undefined) updateFields.url = input.url;
  if (input.scraperType !== undefined) updateFields.scraper_type = input.scraperType;
  // Validate source_type: must be one of journal/blog/news (not email)
  if (input.sourceType !== undefined) {
    const validTypes = ['journal', 'blog', 'news'];
    if (validTypes.includes(input.sourceType)) {
      updateFields.source_type = input.sourceType;
    }
  }
  if (input.domainId !== undefined) updateFields.domain_id = input.domainId;
  if (input.fetchInterval !== undefined) updateFields.fetch_interval = input.fetchInterval;
  if (input.autoCleanupRejected !== undefined) updateFields.auto_cleanup_rejected = input.autoCleanupRejected ? 1 : 0;
  if (input.status !== undefined) updateFields.status = input.status;

  const result = await db
    .updateTable('web_sources')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .set(updateFields as any)
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst() as any;
  const affected = Number(result?.numUpdatedRows ?? 0);

  const updated = Number(result.numUpdatedRows) > 0;
  if (updated) {
    log.info({ userId, id }, 'Web source updated');
  }
  return updated;
}

/**
 * Delete a web source
 */
export async function deleteWebSource(id: number, userId: number): Promise<boolean> {
  const db = getDb();
  const result = await db
    .deleteFrom('web_sources')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  const deleted = Number(result.numDeletedRows) > 0;
  if (deleted) {
    log.info({ userId, id }, 'Web source deleted');
  }
  return deleted;
}

/**
 * Update last_fetched_at after successful fetch
 */
export async function updateWebSourceLastFetched(id: number): Promise<void> {
  const db = getDb();
  await db
    .updateTable('web_sources')
    .set({
      last_fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', id)
    .execute();
}

/**
 * Create a web fetch log entry
 */
export async function createWebFetchLog(params: {
  webSourceId: number;
  status: 'success' | 'failed' | 'partial';
  articlesCount: number;
  newArticlesCount: number;
  durationMs: number;
  isScheduled: boolean;
  errorMessage?: string;
}): Promise<void> {
  const db = getDb();
  await db
    .insertInto('web_fetch_logs')
    .values({
      web_source_id: params.webSourceId,
      status: params.status,
      articles_count: params.articlesCount,
      new_articles_count: params.newArticlesCount,
      duration_ms: params.durationMs,
      is_scheduled: params.isScheduled ? 1 : 0,
      error_message: params.errorMessage || null,
    })
    .execute();

  log.debug({ webSourceId: params.webSourceId, status: params.status, newCount: params.newArticlesCount }, 'Web fetch log created');
}
