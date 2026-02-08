/**
 * Topic Keywords CRUD Service
 *
 * Database operations for topic keyword management.
 * Provides CRUD operations with domain ownership verification.
 */

import { getDb, type DB } from '../db.js';
import { logger } from '../logger.js';
import type { TopicKeywordsTable } from '../db.js';
import { getTopicDomainById } from './topic-domains.js';

const log = logger.child({ module: 'topic-keywords-service' });

/**
 * Topic keyword record type
 */
export type TopicKeywordRecord = TopicKeywordsTable;

/**
 * Create topic keyword input
 */
export interface CreateTopicKeywordInput {
  domainId: number;
  keyword: string;
  description?: string;
  weight?: number;
  isActive?: boolean;
}

/**
 * Update topic keyword input
 */
export interface UpdateTopicKeywordInput {
  keyword?: string;
  description?: string;
  weight?: number;
  isActive?: boolean;
}

/**
 * Query options for listing topic keywords
 */
export interface QueryOptions {
  isActive?: boolean;
  page?: number;
  limit?: number;
}

/**
 * Paginated result
 */
export interface PaginatedTopicKeywords {
  keywords: TopicKeywordRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Keyword with domain name
 */
export interface KeywordWithDomain extends TopicKeywordRecord {
  domain_name: string;
}

/**
 * Create result
 */
export interface CreateResult {
  id: number;
  keyword: string;
}

/**
 * Create a new topic keyword
 * @param userId - User ID (for ownership verification)
 * @param data - Topic keyword data
 * @returns Created topic keyword info
 * @throws Error if domain not found or not owned by user
 */
export async function createTopicKeyword(
  userId: number,
  data: CreateTopicKeywordInput
): Promise<CreateResult> {
  const db = getDb();

  // Verify domain ownership
  const domain = await getTopicDomainById(data.domainId, userId);
  if (!domain) {
    throw new Error('Topic domain not found or access denied');
  }

  const result = await db
    .insertInto('topic_keywords')
    .values({
      domain_id: data.domainId,
      keyword: data.keyword,
      description: data.description ?? null,
      weight: data.weight ?? 1.0,
      is_active: data.isActive !== undefined ? (data.isActive ? 1 : 0) : 1,
      updated_at: new Date().toISOString(),
    } as any)
    .executeTakeFirstOrThrow();

  const insertedId = Number(result.insertId);

  log.info({ userId, keywordId: insertedId, keyword: data.keyword }, 'Topic keyword created');

  return {
    id: insertedId,
    keyword: data.keyword,
  };
}

/**
 * Get topic keywords for a domain with pagination
 * @param domainId - Topic domain ID
 * @param userId - User ID (for ownership verification)
 * @param options - Query options
 * @returns Paginated topic keywords
 */
export async function getDomainKeywords(
  domainId: number,
  userId: number,
  options: QueryOptions = {}
): Promise<PaginatedTopicKeywords> {
  const db = getDb();

  // Verify domain ownership
  const domain = await getTopicDomainById(domainId, userId);
  if (!domain) {
    throw new Error('Topic domain not found or access denied');
  }

  const page = options.page ?? 1;
  const limit = options.limit ?? 50;
  const offset = (page - 1) * limit;

  let query = db
    .selectFrom('topic_keywords')
    .where('domain_id', '=', domainId);

  if (options.isActive !== undefined) {
    query = query.where('is_active', '=', options.isActive ? 1 : 0);
  }

  // Get total count
  const totalCountResult = await query
    .select((eb) => eb.fn.count('id').as('count'))
    .executeTakeFirst();

  const total = Number(totalCountResult?.count ?? 0);

  // Get paginated results
  const keywords = await query
    .selectAll()
    .orderBy('weight', 'desc')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  return {
    keywords,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Get topic keyword by ID
 * @param id - Topic keyword ID
 * @param userId - User ID (for ownership verification via domain)
 * @returns Topic keyword or undefined
 */
export async function getTopicKeywordById(
  id: number,
  userId: number
): Promise<TopicKeywordRecord | undefined> {
  const db = getDb();

  const keyword = await db
    .selectFrom('topic_keywords')
    .innerJoin('topic_domains', 'topic_domains.id', 'topic_keywords.domain_id')
    .where('topic_keywords.id', '=', id)
    .where('topic_domains.user_id', '=', userId)
    .selectAll('topic_keywords')
    .executeTakeFirst();

  return keyword;
}

/**
 * Get topic keyword by ID with domain name
 * @param id - Topic keyword ID
 * @param userId - User ID (for ownership verification)
 * @returns Topic keyword with domain name or undefined
 */
export async function getTopicKeywordWithDomain(
  id: number,
  userId: number
): Promise<KeywordWithDomain | undefined> {
  const db = getDb();

  const keyword = await db
    .selectFrom('topic_keywords')
    .innerJoin('topic_domains', 'topic_domains.id', 'topic_keywords.domain_id')
    .where('topic_keywords.id', '=', id)
    .where('topic_domains.user_id', '=', userId)
    .selectAll('topic_keywords')
    .select('topic_domains.name as domain_name')
    .executeTakeFirst();

  return keyword as KeywordWithDomain | undefined;
}

/**
 * Update topic keyword
 * @param id - Topic keyword ID
 * @param userId - User ID (for ownership verification)
 * @param data - Update data
 * @returns void
 * @throws Error if keyword not found
 */
export async function updateTopicKeyword(
  id: number,
  userId: number,
  data: UpdateTopicKeywordInput
): Promise<void> {
  const db = getDb();

  // Verify ownership via domain
  const existing = await getTopicKeywordById(id, userId);
  if (!existing) {
    throw new Error('Topic keyword not found or access denied');
  }

  const result = await db
    .updateTable('topic_keywords')
    .set({
      ...(data.keyword !== undefined && { keyword: data.keyword }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.weight !== undefined && { weight: data.weight }),
      ...(data.isActive !== undefined && { is_active: data.isActive ? 1 : 0 }),
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', id)
    .executeTakeFirst();

  if (Number(result.numUpdatedRows) === 0) {
    throw new Error('Topic keyword not found');
  }

  log.info({ userId, keywordId: id }, 'Topic keyword updated');
}

/**
 * Delete topic keyword
 * @param id - Topic keyword ID
 * @param userId - User ID (for ownership verification)
 * @returns void
 * @throws Error if keyword not found
 */
export async function deleteTopicKeyword(id: number, userId: number): Promise<void> {
  const db = getDb();

  // Verify ownership via domain
  const existing = await getTopicKeywordById(id, userId);
  if (!existing) {
    throw new Error('Topic keyword not found or access denied');
  }

  const result = await db
    .deleteFrom('topic_keywords')
    .where('id', '=', id)
    .executeTakeFirst();

  if (Number(result.numDeletedRows) === 0) {
    throw new Error('Topic keyword not found');
  }

  log.info({ userId, keywordId: id }, 'Topic keyword deleted');
}

/**
 * Check if keyword already exists for domain
 * @param domainId - Topic domain ID
 * @param keyword - Topic keyword
 * @param excludeId - Exclude this keyword ID (for updates)
 * @returns true if keyword exists
 */
export async function checkKeywordExists(
  domainId: number,
  keyword: string,
  excludeId?: number
): Promise<boolean> {
  const db = getDb();

  let query = db
    .selectFrom('topic_keywords')
    .where('domain_id', '=', domainId)
    .where('keyword', '=', keyword);

  if (excludeId !== undefined) {
    query = query.where('id', '!=', excludeId);
  }

  const result = await query
    .select('id')
    .executeTakeFirst();

  return result !== undefined;
}

/**
 * Get all active keywords for a domain (used by filter module)
 * @param domainId - Topic domain ID
 * @returns Array of active topic keywords
 */
export async function getActiveKeywordsForDomain(
  domainId: number
): Promise<Array<{
  id: number;
  keyword: string;
  description: string | null;
  weight: number;
}>> {
  const db = getDb();

  const keywords = await db
    .selectFrom('topic_keywords')
    .where('domain_id', '=', domainId)
    .where('is_active', '=', 1)
    .select(['id', 'keyword', 'description', 'weight'])
    .orderBy('weight', 'desc')
    .execute();

  return keywords;
}

/**
 * Get all active keywords grouped by domain (used by filter module)
 * @param userId - User ID
 * @returns Array of domains with their keywords
 */
export async function getAllActiveKeywords(
  userId: number
): Promise<Array<{
  domainId: number;
  domainName: string;
  keywords: Array<{ id: number; keyword: string; weight: number }>;
}>> {
  const db = getDb();

  const domains = await db
    .selectFrom('topic_domains')
    .where('user_id', '=', userId)
    .where('is_active', '=', 1)
    .select(['id', 'name'])
    .orderBy('priority', 'desc')
    .execute();

  const result = [];

  for (const domain of domains) {
    const keywords = await getActiveKeywordsForDomain(domain.id);
    if (keywords.length > 0) {
      result.push({
        domainId: domain.id,
        domainName: domain.name,
        keywords,
      });
    }
  }

  return result;
}

/**
 * Get all keywords with domain names (for display)
 * @param userId - User ID
 * @param options - Query options
 * @returns Array of keywords with domain names
 */
export async function getAllKeywordsWithDomain(
  userId: number,
  options: QueryOptions = {}
): Promise<KeywordWithDomain[]> {
  const db = getDb();

  let query = db
    .selectFrom('topic_keywords')
    .innerJoin('topic_domains', 'topic_domains.id', 'topic_keywords.domain_id')
    .where('topic_domains.user_id', '=', userId)
    .selectAll('topic_keywords')
    .select('topic_domains.name as domain_name');

  if (options.isActive !== undefined) {
    query = query.where('topic_keywords.is_active', '=', options.isActive ? 1 : 0);
  }

  const keywords = await query
    .orderBy('topic_domains.priority', 'desc')
    .orderBy('topic_keywords.weight', 'desc')
    .orderBy('topic_keywords.created_at', 'desc')
    .execute();

  return keywords as KeywordWithDomain[];
}

/**
 * Delete all keywords for a domain (cascade delete when domain is deleted)
 * @param domainId - Topic domain ID
 * @returns Number of deleted keywords
 */
export async function deleteDomainKeywords(domainId: number): Promise<number> {
  const db = getDb();

  const result = await db
    .deleteFrom('topic_keywords')
    .where('domain_id', '=', domainId)
    .executeTakeFirst();

  const count = Number(result.numDeletedRows);

  if (count > 0) {
    log.info({ domainId, count }, 'Domain keywords deleted (cascade)');
  }

  return count;
}
