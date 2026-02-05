/**
 * Topic Domains CRUD Service
 *
 * Database operations for topic domain management.
 * Provides CRUD operations with user isolation.
 */

import { getDb, type DB } from '../db.js';
import { logger } from '../logger.js';
import type { TopicDomainsTable } from '../db.js';

const log = logger.child({ module: 'topic-domains-service' });

/**
 * Topic domain record type
 */
export type TopicDomainRecord = TopicDomainsTable;

/**
 * Create topic domain input
 */
export interface CreateTopicDomainInput {
  name: string;
  description?: string;
  priority?: number;
  isActive?: boolean;
}

/**
 * Update topic domain input
 */
export interface UpdateTopicDomainInput {
  name?: string;
  description?: string;
  priority?: number;
  isActive?: boolean;
}

/**
 * Query options for listing topic domains
 */
export interface QueryOptions {
  isActive?: boolean;
  page?: number;
  limit?: number;
}

/**
 * Paginated result
 */
export interface PaginatedTopicDomains {
  domains: TopicDomainRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Create result
 */
export interface CreateResult {
  id: number;
  name: string;
}

/**
 * Topic domain with keyword count
 */
export interface TopicDomainWithKeywordCount extends TopicDomainRecord {
  keyword_count: number;
}

/**
 * Create a new topic domain
 * @param userId - User ID
 * @param data - Topic domain data
 * @returns Created topic domain info
 */
export async function createTopicDomain(
  userId: number,
  data: CreateTopicDomainInput
): Promise<CreateResult> {
  const db = getDb();

  const result = await db
    .insertInto('topic_domains')
    .values({
      user_id: userId,
      name: data.name,
      description: data.description ?? null,
      priority: data.priority ?? 0,
      is_active: data.isActive !== undefined ? (data.isActive ? 1 : 0) : 1,
      updated_at: new Date().toISOString(),
    })
    .executeTakeFirstOrThrow();

  const insertedId = Number(result.insertId);

  log.info({ userId, domainId: insertedId, name: data.name }, 'Topic domain created');

  return {
    id: insertedId,
    name: data.name,
  };
}

/**
 * Get user's topic domains with pagination
 * @param userId - User ID
 * @param options - Query options
 * @returns Paginated topic domains
 */
export async function getUserTopicDomains(
  userId: number,
  options: QueryOptions = {}
): Promise<PaginatedTopicDomains> {
  const db = getDb();
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const offset = (page - 1) * limit;

  let query = db
    .selectFrom('topic_domains')
    .where('user_id', '=', userId);

  if (options.isActive !== undefined) {
    query = query.where('is_active', '=', options.isActive ? 1 : 0);
  }

  // Get total count
  const totalCountResult = await query
    .select((eb) => eb.fn.count('id').as('count'))
    .executeTakeFirst();

  const total = Number(totalCountResult?.count ?? 0);

  // Get paginated results
  const domains = await query
    .selectAll()
    .orderBy('priority', 'desc')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  return {
    domains,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Get user's topic domains with keyword count
 * @param userId - User ID
 * @param options - Query options
 * @returns Topic domains with keyword count
 */
export async function getUserTopicDomainsWithKeywordCount(
  userId: number,
  options: QueryOptions = {}
): Promise<TopicDomainWithKeywordCount[]> {
  const db = getDb();

  let query = db
    .selectFrom('topic_domains')
    .leftJoin('topic_keywords', 'topic_keywords.domain_id', 'topic_domains.id')
    .where('topic_domains.user_id', '=', userId)
    .select([
      'topic_domains.id',
      'topic_domains.user_id',
      'topic_domains.name',
      'topic_domains.description',
      'topic_domains.is_active',
      'topic_domains.priority',
      'topic_domains.created_at',
      'topic_domains.updated_at',
      (eb) => eb.fn.count('topic_keywords.id').as('keyword_count'),
    ])
    .groupBy('topic_domains.id');

  if (options.isActive !== undefined) {
    query = query.where('topic_domains.is_active', '=', options.isActive ? 1 : 0);
  }

  const domains = await query
    .orderBy('topic_domains.priority', 'desc')
    .orderBy('topic_domains.created_at', 'desc')
    .execute();

  return domains as TopicDomainWithKeywordCount[];
}

/**
 * Get topic domain by ID
 * @param id - Topic domain ID
 * @param userId - User ID (for ownership check)
 * @returns Topic domain or undefined
 */
export async function getTopicDomainById(
  id: number,
  userId: number
): Promise<TopicDomainRecord | undefined> {
  const db = getDb();

  const domain = await db
    .selectFrom('topic_domains')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst();

  return domain;
}

/**
 * Update topic domain
 * @param id - Topic domain ID
 * @param userId - User ID (for ownership check)
 * @param data - Update data
 * @returns void
 * @throws Error if topic domain not found
 */
export async function updateTopicDomain(
  id: number,
  userId: number,
  data: UpdateTopicDomainInput
): Promise<void> {
  const db = getDb();

  const result = await db
    .updateTable('topic_domains')
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.priority !== undefined && { priority: data.priority }),
      ...(data.isActive !== undefined && { is_active: data.isActive ? 1 : 0 }),
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (Number(result.numUpdatedRows) === 0) {
    throw new Error('Topic domain not found');
  }

  log.info({ userId, domainId: id }, 'Topic domain updated');
}

/**
 * Delete topic domain
 * @param id - Topic domain ID
 * @param userId - User ID (for ownership check)
 * @returns void
 * @throws Error if topic domain not found
 */
export async function deleteTopicDomain(id: number, userId: number): Promise<void> {
  const db = getDb();

  const result = await db
    .deleteFrom('topic_domains')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (Number(result.numDeletedRows) === 0) {
    throw new Error('Topic domain not found');
  }

  log.info({ userId, domainId: id }, 'Topic domain deleted');
}

/**
 * Check if name already exists for user
 * @param userId - User ID
 * @param name - Topic domain name
 * @param excludeId - Exclude this domain ID (for updates)
 * @returns true if name exists
 */
export async function checkNameExists(
  userId: number,
  name: string,
  excludeId?: number
): Promise<boolean> {
  const db = getDb();

  let query = db
    .selectFrom('topic_domains')
    .where('user_id', '=', userId)
    .where('name', '=', name);

  if (excludeId !== undefined) {
    query = query.where('id', '!=', excludeId);
  }

  const result = await query
    .select('id')
    .executeTakeFirst();

  return result !== undefined;
}

/**
 * Get all active topic domains for filtering (used by filter module)
 * @param userId - User ID
 * @returns Array of active topic domains
 */
export async function getActiveTopicDomains(
  userId: number
): Promise<Array<{
  id: number;
  name: string;
  description: string | null;
  priority: number;
}>> {
  const db = getDb();

  const domains = await db
    .selectFrom('topic_domains')
    .where('user_id', '=', userId)
    .where('is_active', '=', 1)
    .select(['id', 'name', 'description', 'priority'])
    .orderBy('priority', 'desc')
    .execute();

  return domains;
}

/**
 * Get topic domain by name
 * @param userId - User ID
 * @param name - Topic domain name
 * @returns Topic domain or undefined
 */
export async function getTopicDomainByName(
  userId: number,
  name: string
): Promise<TopicDomainRecord | undefined> {
  const db = getDb();

  const domain = await db
    .selectFrom('topic_domains')
    .where('user_id', '=', userId)
    .where('name', '=', name)
    .selectAll()
    .executeTakeFirst();

  return domain;
}
