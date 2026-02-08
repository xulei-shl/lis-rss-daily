/**
 * RSS Sources CRUD Service
 *
 * Database operations for RSS source management.
 * Provides CRUD operations with user isolation.
 */

import { getDb, type DB, type DatabaseTable } from '../db.js';
import { logger } from '../logger.js';
import type { RssSourcesTable } from '../db.js';

const log = logger.child({ module: 'rss-sources-service' });

/**
 * RSS source record type
 */
export type RssSourceRecord = RssSourcesTable;

/**
 * Create RSS source input
 */
export interface CreateRSSSourceInput {
  name: string;
  url: string;
  sourceType?: 'journal' | 'blog' | 'news';
  fetchInterval?: number;
  status?: 'active' | 'inactive';
}

/**
 * Update RSS source input
 */
export interface UpdateRSSSourceInput {
  name?: string;
  url?: string;
  sourceType?: 'journal' | 'blog' | 'news';
  fetchInterval?: number;
  status?: 'active' | 'inactive';
}

/**
 * Query options for listing RSS sources
 */
export interface QueryOptions {
  status?: 'active' | 'inactive';
  page?: number;
  limit?: number;
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  sources: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Create RSS source insert result
 */
export interface CreateResult {
  id: number;
  name: string;
  url: string;
}

/**
 * Create a new RSS source
 * @param userId - User ID
 * @param data - RSS source data
 * @returns Created RSS source info
 */
export async function createRSSSource(
  userId: number,
  data: CreateRSSSourceInput
): Promise<CreateResult> {
  const db = getDb();

  const result = await db
    .insertInto('rss_sources')
    .values({
      user_id: userId,
      name: data.name,
      url: data.url,
      source_type: data.sourceType ?? 'blog',
      fetch_interval: data.fetchInterval ?? 3600,
      status: data.status ?? 'active',
      updated_at: new Date().toISOString(),
    } as any)
    .executeTakeFirstOrThrow();

  const insertedId = Number(result.insertId);

  log.info({ userId, rssSourceId: insertedId, name: data.name }, 'RSS source created');

  return {
    id: insertedId,
    name: data.name,
    url: data.url,
  };
}

/**
 * Get user's RSS sources with pagination
 * @param userId - User ID
 * @param options - Query options
 * @returns Paginated RSS sources
 */
export async function getUserRSSSources(
  userId: number,
  options: QueryOptions = {}
): Promise<PaginatedResult<RssSourceRecord>> {
  const db = getDb();
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const offset = (page - 1) * limit;

  let query = db
    .selectFrom('rss_sources')
    .where('user_id', '=', userId);

  if (options.status) {
    query = query.where('status', '=', options.status);
  }

  // Get total count
  const totalCountResult = await query
    .select((eb) => eb.fn.count('id').as('count'))
    .executeTakeFirst();

  const total = Number(totalCountResult?.count ?? 0);

  // Get paginated results
  const sources = await query
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  return {
    sources,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Get RSS source by ID
 * @param id - RSS source ID
 * @param userId - User ID (for ownership check)
 * @returns RSS source or undefined
 */
export async function getRSSSourceById(
  id: number,
  userId: number
): Promise<RssSourceRecord | undefined> {
  const db = getDb();

  const source = await db
    .selectFrom('rss_sources')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst();

  return source;
}

/**
 * Update RSS source
 * @param id - RSS source ID
 * @param userId - User ID (for ownership check)
 * @param data - Update data
 * @returns void
 * @throws Error if RSS source not found
 */
export async function updateRSSSource(
  id: number,
  userId: number,
  data: UpdateRSSSourceInput
): Promise<void> {
  const db = getDb();

  const result = await db
    .updateTable('rss_sources')
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.url !== undefined && { url: data.url }),
      ...(data.sourceType !== undefined && { source_type: data.sourceType }),
      ...(data.fetchInterval !== undefined && { fetch_interval: data.fetchInterval }),
      ...(data.status !== undefined && { status: data.status }),
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (result.numUpdatedRows === 0n) {
    throw new Error('RSS source not found');
  }

  log.info({ userId, rssSourceId: id }, 'RSS source updated');
}

/**
 * Delete RSS source
 * @param id - RSS source ID
 * @param userId - User ID (for ownership check)
 * @returns void
 * @throws Error if RSS source not found
 */
export async function deleteRSSSource(id: number, userId: number): Promise<void> {
  const db = getDb();

  const result = await db
    .deleteFrom('rss_sources')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (result.numDeletedRows === 0n) {
    throw new Error('RSS source not found');
  }

  log.info({ userId, rssSourceId: id }, 'RSS source deleted');
}

/**
 * Update last fetched timestamp
 * @param id - RSS source ID
 * @param timestamp - ISO timestamp string
 */
export async function updateLastFetched(id: number, timestamp: string): Promise<void> {
  const db = getDb();

  await db
    .updateTable('rss_sources')
    .set({
      last_fetched_at: timestamp,
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', id)
    .execute();
}

/**
 * Check if URL already exists for user
 * @param userId - User ID
 * @param url - RSS source URL
 * @param excludeId - Exclude this RSS source ID (for updates)
 * @returns true if URL exists
 */
export async function checkURLExists(
  userId: number,
  url: string,
  excludeId?: number
): Promise<boolean> {
  const db = getDb();

  let query = db
    .selectFrom('rss_sources')
    .where('user_id', '=', userId)
    .where('url', '=', url);

  if (excludeId !== undefined) {
    query = query.where('id', '!=', excludeId);
  }

  const result = await query
    .select('id')
    .executeTakeFirst();

  return result !== undefined;
}

/**
 * Get all active RSS sources for fetching (used by scheduler)
 * @returns Array of active RSS sources
 */
export async function getActiveRSSSourcesForFetch(): Promise<
  Array<{
    id: number;
    url: string;
    user_id: number;
    fetch_interval: number;
    name: string;
  }>
> {
  const db = getDb();

  const sources = await db
    .selectFrom('rss_sources')
    .where('status', '=', 'active')
    .select(['id', 'url', 'user_id', 'fetch_interval', 'name'])
    .execute();

  return sources;
}

/**
 * Batch update last fetched timestamps
 * @param updates - Array of { id, timestamp }
 */
export async function batchUpdateLastFetched(
  updates: Array<{ id: number; timestamp: string }>
): Promise<void> {
  if (updates.length === 0) return;

  const db = getDb();

  // Process updates in a transaction
  for (const { id, timestamp } of updates) {
    await db
      .updateTable('rss_sources')
      .set({
        last_fetched_at: timestamp,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', id)
      .execute();
  }

  log.info({ count: updates.length }, 'Batch updated last fetched timestamps');
}

/**
 * Get RSS source by URL
 * @param userId - User ID
 * @param url - RSS source URL
 * @returns RSS source or undefined
 */
export async function getRSSSourceByURL(
  userId: number,
  url: string
): Promise<RssSourceRecord | undefined> {
  const db = getDb();

  const source = await db
    .selectFrom('rss_sources')
    .where('user_id', '=', userId)
    .where('url', '=', url)
    .selectAll()
    .executeTakeFirst();

  return source;
}
