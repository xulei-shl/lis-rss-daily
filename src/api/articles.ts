/**
 * Articles CRUD Service
 *
 * Database operations for article management.
 * Provides article storage with URL deduplication.
 */

import { getDb, type DatabaseTable } from '../db.js';
import { logger } from '../logger.js';
import type { RSSFeedItem } from '../rss-parser.js';
import { toSimpleMarkdown } from '../utils/markdown.js';
import { search, SearchMode } from '../vector/search.js';

const log = logger.child({ module: 'articles-service' });

/**
 * Create article input
 */
export interface CreateArticleInput {
  rssSourceId: number;
  title: string;
  url: string;
  summary?: string;
  content?: string;
  publishedAt?: string;
}

/**
 * Article record with RSS source name
 */
export interface ArticleWithSource {
  id: number;
  rss_source_id: number;
  rss_source_name?: string;
  title: string;
  url: string;
  summary: string | null;
  content: string | null;
  markdown_content: string | null;
  summary_zh: string | null;  // 翻译摘要
  filter_status: 'pending' | 'passed' | 'rejected';
  filter_score: number | null;
  filtered_at: string | null;
  process_status: 'pending' | 'processing' | 'completed' | 'failed';
  process_stages: string | null;  // 步骤状态 JSON
  processed_at: string | null;
  published_at: string | null;
  error_message: string | null;
  is_read: number;  // 0 = 未读, 1 = 已读
  created_at: string;
  updated_at: string;
}

/**
 * Paginated articles result
 */
export interface PaginatedArticlesResult {
  articles: ArticleWithSource[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * 过滤匹配结果（用于导出与详情展示）
 */
export interface ArticleFilterMatch {
  domainId: number | null;
  domainName: string | null;
  isPassed: boolean;
  relevanceScore: number | null;
  filterReason: string | null;
}

/**
 * 翻译结果
 */
export interface ArticleTranslation {
  title_zh: string | null;
  summary_zh: string | null;
  source_lang: string | null;
}

/**
 * 相关文章（用于展示）
 */
export interface RelatedArticle {
  id: number;
  title: string;
  url: string;
  summary: string | null;
  published_at: string | null;
  rss_source_name?: string;
  score: number;
}

/**
 * Batch save articles
 * @param rssSourceId - RSS source ID
 * @param items - RSS feed items
 * @returns Number of saved articles and array of saved article IDs
 */
export async function saveArticles(
  rssSourceId: number,
  items: RSSFeedItem[]
): Promise<{ count: number; articleIds: number[] }> {
  const db = getDb();
  const now = new Date().toISOString();
  const savedArticleIds: number[] = [];

  for (const item of items) {
    try {
      // Check if already exists by (rss_source_id, title) combination
      const exists = await db
        .selectFrom('articles')
        .where('rss_source_id', '=', rssSourceId)
        .where('title', '=', item.title)
        .select('id')
        .executeTakeFirst();

      if (exists) {
        continue;
      }

      // Insert new article and return the inserted ID
      const rawContent = chooseBestContent([
        item.content,
        item.description,
        item.contentSnippet,
      ]);
      const markdown = toSimpleMarkdown(rawContent);

      const result = await db
        .insertInto('articles')
        .values({
          rss_source_id: rssSourceId,
          title: item.title,
          url: item.link,
          // RSS 入库阶段不生成摘要（由后续 AI 分析生成）
          summary: null,
          // content 保存原始 RSS 文本，markdown_content 保存清洗后的 Markdown
          content: rawContent || null,
          markdown_content: markdown || null,
          filter_status: 'pending',
          process_status: 'pending',
          published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
          created_at: now,
          updated_at: now,
        } as any)
        .returning('id')
        .executeTakeFirst();

      if (result) {
        savedArticleIds.push(result.id);
      } else {
        log.warn({ rssSourceId, url: item.link }, 'Failed to get inserted article ID');
      }
    } catch (error) {
      // Check if this is a UNIQUE constraint error on URL
      if (error && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        // URL already exists in a different RSS source - this is expected for cross-source duplicates
        log.debug(
          { rssSourceId, url: item.link, title: item.title },
          'Article URL exists in another RSS source, skipping'
        );
        continue;
      }
      // Log other errors
      log.error({ error, rssSourceId, url: item.link }, 'Failed to save article');
    }
  }

  if (savedArticleIds.length > 0) {
    log.info(
      { rssSourceId, savedCount: savedArticleIds.length, totalItems: items.length },
      'Articles saved'
    );
  }

  return { count: savedArticleIds.length, articleIds: savedArticleIds };
}

/**
 * 选择最有价值的内容来源（优先更长且更丰富的文本）
 */
function chooseBestContent(candidates: Array<string | undefined | null>): string {
  const cleaned = candidates
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    .map((c) => c.trim());

  if (cleaned.length === 0) return '';

  let best = cleaned[0];
  let bestScore = scoreContent(best);

  for (const content of cleaned.slice(1)) {
    const score = scoreContent(content);
    if (score > bestScore) {
      best = content;
      bestScore = score;
    }
  }

  return best;
}

/**
 * 简单评分：正文长度 + 去标签长度
 */
function scoreContent(content: string): number {
  const textOnly = content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const lengthScore = textOnly.length;
  const rawScore = content.length * 0.1;
  return lengthScore + rawScore;
}

/**
 * Batch check if articles exist by (rss_source_id, title) combination
 * @param rssSourceId - RSS source ID
 * @param titles - Article titles to check
 * @returns Set of existing titles within this RSS source
 */
export async function checkArticlesExistByTitle(
  rssSourceId: number,
  titles: string[]
): Promise<Set<string>> {
  if (titles.length === 0) {
    return new Set();
  }

  const db = getDb();

  const existing = await db
    .selectFrom('articles')
    .where('rss_source_id', '=', rssSourceId)
    .where('title', 'in', titles)
    .select('title')
    .execute();

  return new Set(existing.map((e) => e.title));
}

/**
 * Batch check if articles exist by URL (fallback method)
 * @param urls - Article URLs
 * @returns Set of existing URLs
 */
export async function checkArticlesExistByURL(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) {
    return new Set();
  }

  const db = getDb();

  const existing = await db
    .selectFrom('articles')
    .where('url', 'in', urls)
    .select('url')
    .execute();

  return new Set(existing.map((e) => e.url));
}

/**
 * Get article by ID
 * @param id - Article ID
 * @param userId - User ID (for permission check)
 */
export async function getArticleById(
  id: number,
  userId: number
): Promise<ArticleWithSource | undefined> {
  const db = getDb();

  const article = await db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('articles.id', '=', id)
    .where('rss_sources.user_id', '=', userId)
    .select([
      'articles.id',
      'articles.rss_source_id',
      'articles.title',
      'articles.url',
      'articles.summary',
      'articles.content',
      'articles.markdown_content',
      'articles.filter_status',
      'articles.filter_score',
      'articles.filtered_at',
      'articles.process_status',
      'articles.processed_at',
      'articles.published_at',
      'articles.error_message',
      'articles.is_read',
      'articles.created_at',
      'articles.updated_at',
      'rss_sources.name as rss_source_name',
    ])
    .executeTakeFirst();

  return article as ArticleWithSource | undefined;
}


/**
 * 获取过滤匹配结果（含原因）
 */
export async function getArticleFilterMatches(
  articleId: number,
  userId: number
): Promise<ArticleFilterMatch[]> {
  const db = getDb();

  const rows = await db
    .selectFrom('article_filter_logs')
    .innerJoin('articles', 'articles.id', 'article_filter_logs.article_id')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('topic_domains', 'topic_domains.id', 'article_filter_logs.domain_id')
    .where('article_filter_logs.article_id', '=', articleId)
    .where('rss_sources.user_id', '=', userId)
    .where('article_filter_logs.is_passed', '=', 1)
    .select([
      'article_filter_logs.domain_id as domainId',
      'topic_domains.name as domainName',
      'article_filter_logs.is_passed as isPassed',
      'article_filter_logs.relevance_score as relevanceScore',
      'article_filter_logs.filter_reason as filterReason',
    ])
    .orderBy('article_filter_logs.id', 'asc')
    .execute();

  return rows.map((row) => ({
    domainId: row.domainId ?? null,
    domainName: row.domainName ?? null,
    isPassed: Number(row.isPassed) === 1,
    relevanceScore: row.relevanceScore ?? null,
    filterReason: row.filterReason ?? null,
  }));
}


/**
 * 获取翻译结果
 */
export async function getArticleTranslation(
  articleId: number,
  userId: number
): Promise<ArticleTranslation | null> {
  const db = getDb();
  const article = await getArticleById(articleId, userId);
  if (!article) return null;

  const row = await db
    .selectFrom('article_translations')
    .select(['title_zh', 'summary_zh', 'source_lang'])
    .where('article_id', '=', articleId)
    .executeTakeFirst();

  if (!row) return null;
  return {
    title_zh: row.title_zh ?? null,
    summary_zh: row.summary_zh ?? null,
    source_lang: row.source_lang ?? null,
  };
}

/**
 * 写入翻译结果（覆盖更新）
 */
export async function upsertArticleTranslation(
  articleId: number,
  userId: number,
  translation: ArticleTranslation
): Promise<void> {
  const db = getDb();
  const article = await getArticleById(articleId, userId);
  if (!article) {
    throw new Error('Article not found');
  }

  const now = new Date().toISOString();

  await db
    .insertInto('article_translations')
    .values({
      article_id: articleId,
      title_zh: translation.title_zh ?? null,
      summary_zh: translation.summary_zh ?? null,
      source_lang: translation.source_lang ?? null,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.column('article_id').doUpdateSet({
        title_zh: translation.title_zh ?? null,
        summary_zh: translation.summary_zh ?? null,
        source_lang: translation.source_lang ?? null,
        updated_at: now,
      })
    )
    .execute();
}

/**
 * Get user articles with pagination
 * @param userId - User ID
 * @param options - Query options
 */
export async function getUserArticles(
  userId: number,
  options: {
    rssSourceId?: number;
    filterStatus?: 'pending' | 'passed' | 'rejected';
    processStatus?: 'pending' | 'processing' | 'completed' | 'failed';
    search?: string;
    page?: number;
    limit?: number;
    daysAgo?: number;
    /** 爬取日期范围过滤 */
    createdAfter?: string;  // ISO date string (YYYY-MM-DD)
    createdBefore?: string; // ISO date string (YYYY-MM-DD)
    /** 搜索时是否跳过时间过滤（搜索在全量数据中进行，结果显示不受时间限制） */
    skipDaysFilterForSearch?: boolean;
    /** 已读状态过滤 */
    isRead?: boolean;
  } = {}
): Promise<PaginatedArticlesResult> {
  const db = getDb();
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const offset = (page - 1) * limit;

  // 判断是否应该应用时间过滤
  // 如果是搜索模式且启用了 skipDaysFilterForSearch，则不应用时间过滤
  // 日期范围过滤优先于 daysAgo 过滤
  const hasDateRange = options.createdAfter || options.createdBefore;
  const shouldApplyDaysFilter = options.daysAgo !== undefined &&
    !hasDateRange &&
    !(options.skipDaysFilterForSearch && options.search && options.search.trim() !== '');

  let query = db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('rss_sources.user_id', '=', userId);

  if (options.rssSourceId !== undefined) {
    query = query.where('articles.rss_source_id', '=', options.rssSourceId);
  }

  if (options.filterStatus !== undefined) {
    query = query.where('articles.filter_status', '=', options.filterStatus);
  }

  if (options.processStatus !== undefined) {
    query = query.where('articles.process_status', '=', options.processStatus);
  }

  if (options.isRead !== undefined) {
    query = query.where('articles.is_read', '=', options.isRead ? 1 : 0);
  }

  if (options.search !== undefined && options.search.trim() !== '') {
    const searchTerm = `%${options.search.trim()}%`;
    query = query.where((eb) => eb.or([
      eb('articles.title', 'like', searchTerm),
      eb('articles.summary', 'like', searchTerm),
    ]));
  }

  // 时间过滤：根据 shouldApplyDaysFilter 决定是否应用
  if (shouldApplyDaysFilter) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - options.daysAgo!);
    query = query.where('articles.created_at', '>=', cutoffDate.toISOString());
  }

  // 日期范围过滤（优先级高于 daysAgo）
  if (options.createdAfter) {
    const startDate = new Date(options.createdAfter);
    startDate.setHours(0, 0, 0, 0);
    query = query.where('articles.created_at', '>=', startDate.toISOString());
  }
  if (options.createdBefore) {
    const endDate = new Date(options.createdBefore);
    endDate.setHours(23, 59, 59, 999);
    query = query.where('articles.created_at', '<=', endDate.toISOString());
  }

  // Get total count
  const totalCountResult = await query
    .select((eb) => eb.fn.count('articles.id').as('count'))
    .executeTakeFirst();

  const total = Number(totalCountResult?.count ?? 0);

  // Build a fresh query for articles with translation left join
  let articlesQuery = db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('article_translations', 'article_translations.article_id', 'articles.id')
    .where('rss_sources.user_id', '=', userId);

  // Re-apply filters (same logic as above)
  if (options.rssSourceId !== undefined) {
    articlesQuery = articlesQuery.where('articles.rss_source_id', '=', options.rssSourceId);
  }
  if (options.filterStatus !== undefined) {
    articlesQuery = articlesQuery.where('articles.filter_status', '=', options.filterStatus);
  }
  if (options.processStatus !== undefined) {
    articlesQuery = articlesQuery.where('articles.process_status', '=', options.processStatus);
  }
  if (options.isRead !== undefined) {
    articlesQuery = articlesQuery.where('articles.is_read', '=', options.isRead ? 1 : 0);
  }
  if (options.search !== undefined && options.search.trim() !== '') {
    const searchTerm = `%${options.search.trim()}%`;
    articlesQuery = articlesQuery.where((eb) => eb.or([
      eb('articles.title', 'like', searchTerm),
      eb('articles.summary', 'like', searchTerm),
    ]));
  }

  // 时间过滤：使用相同的 shouldApplyDaysFilter 逻辑
  if (shouldApplyDaysFilter) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - options.daysAgo!);
    articlesQuery = articlesQuery.where('articles.created_at', '>=', cutoffDate.toISOString());
  }

  // 日期范围过滤（优先级高于 daysAgo）
  if (options.createdAfter) {
    const startDate = new Date(options.createdAfter);
    startDate.setHours(0, 0, 0, 0);
    articlesQuery = articlesQuery.where('articles.created_at', '>=', startDate.toISOString());
  }
  if (options.createdBefore) {
    const endDate = new Date(options.createdBefore);
    endDate.setHours(23, 59, 59, 999);
    articlesQuery = articlesQuery.where('articles.created_at', '<=', endDate.toISOString());
  }

  // Get paginated results with translation
  const articles = await articlesQuery
    .select([
      'articles.id',
      'articles.rss_source_id',
      'articles.title',
      'articles.url',
      'articles.summary',
      'articles.content',
      'articles.markdown_content',
      'articles.filter_status',
      'articles.filter_score',
      'articles.filtered_at',
      'articles.process_status',
      'articles.processed_at',
      'articles.published_at',
      'articles.error_message',
      'articles.is_read',
      'articles.created_at',
      'articles.updated_at',
      'rss_sources.name as rss_source_name',
      'article_translations.summary_zh',
    ])
    .orderBy('articles.created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  return {
    articles: articles as ArticleWithSource[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Batch update article filter status
 * @param updates - Update list
 */
export async function batchUpdateFilterStatus(
  updates: Array<{
    articleId: number;
    status: 'passed' | 'rejected';
    score?: number;
  }>
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  for (const update of updates) {
    await db
      .updateTable('articles')
      .set({
        filter_status: update.status,
        filter_score: update.score ?? null,
        filtered_at: now,
        updated_at: now,
      })
      .where('id', '=', update.articleId)
      .execute();
  }

  log.info({ count: updates.length }, 'Batch updated article filter status');
}

/**
 * Update article process status
 * @param articleId - Article ID
 * @param status - Process status
 * @param errorMessage - Error message (if failed)
 */
export async function updateArticleProcessStatus(
  articleId: number,
  status: 'processing' | 'completed' | 'failed',
  errorMessage?: string
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  await db
    .updateTable('articles')
    .set({
      process_status: status,
      processed_at: now,
      updated_at: now,
      ...(errorMessage && { error_message: errorMessage }),
    })
    .where('id', '=', articleId)
    .execute();
}

/**
 * Delete article by ID
 * @param id - Article ID
 * @param userId - User ID (for permission check)
 */
export async function deleteArticle(id: number, userId: number): Promise<void> {
  const db = getDb();

  const result = await db
    .deleteFrom('articles')
    .where('id', '=', id)
    .where('rss_source_id', 'in', (eb) =>
      eb
        .selectFrom('rss_sources')
        .select('id')
        .where('user_id', '=', userId)
    )
    .executeTakeFirst();

  if (result.numDeletedRows === 0n) {
    throw new Error('Article not found');
  }

  log.info({ articleId: id, userId }, 'Article deleted');
}

/**
 * 获取相关文章（优先缓存，不足时计算并写回）
 */
export async function getRelatedArticles(
  articleId: number,
  userId: number,
  limit: number = 5
): Promise<RelatedArticle[]> {
  const response = await search({
    mode: SearchMode.RELATED,
    userId,
    articleId,
    limit,
    normalizeScores: false,
    useCache: true,
  });

  return response.results.map((r) => ({
    id: r.articleId,
    title: r.metadata?.title || '',
    url: r.metadata?.url || '',
    summary: r.metadata?.summary ?? null,
    published_at: r.metadata?.published_at ?? null,
    rss_source_name: r.metadata?.rss_source_name,
    score: r.score,
  }));
}

/**
 * 重新计算并写入相关文章缓存（用于流水线）
 */
export async function refreshRelatedArticles(
  articleId: number,
  userId: number,
  limit: number = 5
): Promise<RelatedArticle[]> {
  const response = await search({
    mode: SearchMode.RELATED,
    userId,
    articleId,
    limit,
    normalizeScores: false,
    useCache: false,
    refreshCache: true,
  });

  return response.results.map((r) => ({
    id: r.articleId,
    title: r.metadata?.title || '',
    url: r.metadata?.url || '',
    summary: r.metadata?.summary ?? null,
    published_at: r.metadata?.published_at ?? null,
    rss_source_name: r.metadata?.rss_source_name,
    score: r.score,
  }));
}

/**
 * 更新文章已读状态
 * @param articleId - Article ID
 * @param userId - User ID (for permission check)
 * @param isRead - Read status
 */
export async function updateArticleReadStatus(
  articleId: number,
  userId: number,
  isRead: boolean
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  const result = await db
    .updateTable('articles')
    .set({
      is_read: isRead ? 1 : 0,
      updated_at: now,
    })
    .where('id', '=', articleId)
    .where('rss_source_id', 'in', (eb) =>
      eb
        .selectFrom('rss_sources')
        .select('id')
        .where('user_id', '=', userId)
    )
    .executeTakeFirst();

  if (result.numUpdatedRows === 0n) {
    throw new Error('Article not found');
  }

  log.info({ articleId, userId, isRead }, 'Article read status updated');
}

/**
 * 批量更新文章已读状态
 * @param userId - User ID
 * @param articleIds - Article IDs to update
 * @param isRead - Read status
 * @returns Number of updated articles
 */
export async function batchUpdateArticleReadStatus(
  userId: number,
  articleIds: number[],
  isRead: boolean
): Promise<number> {
  if (articleIds.length === 0) return 0;

  const db = getDb();
  const now = new Date().toISOString();

  const result = await db
    .updateTable('articles')
    .set({
      is_read: isRead ? 1 : 0,
      updated_at: now,
    })
    .where('id', 'in', articleIds)
    .where('rss_source_id', 'in', (eb) =>
      eb
        .selectFrom('rss_sources')
        .select('id')
        .where('user_id', '=', userId)
    )
    .executeTakeFirst();

  const count = Number(result.numUpdatedRows);
  log.info({ count, userId, isRead }, 'Batch updated article read status');
  return count;
}

/**
 * 批量标记所有未读文章为已读
 * @param userId - User ID
 * @param options - Filter options (filterStatus, daysAgo, etc.)
 * @returns Number of updated articles
 */
export async function markAllAsRead(
  userId: number,
  options: {
    filterStatus?: 'pending' | 'passed' | 'rejected';
    daysAgo?: number;
  } = {}
): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();

  let query = db
    .updateTable('articles')
    .set({
      is_read: 1,
      updated_at: now,
    })
    .where('rss_source_id', 'in', (eb) =>
      eb
        .selectFrom('rss_sources')
        .select('id')
        .where('user_id', '=', userId)
    )
    .where('is_read', '=', 0);

  if (options.filterStatus !== undefined) {
    query = query.where('filter_status', '=', options.filterStatus);
  }

  if (options.daysAgo !== undefined) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - options.daysAgo);
    query = query.where('created_at', '>=', cutoffDate.toISOString());
  }

  const result = await query.executeTakeFirst();
  const count = Number(result.numUpdatedRows);
  log.info({ count, userId, options }, 'Marked all articles as read');
  return count;
}

/**
 * 获取未读文章数量
 * @param userId - User ID
 * @param options - Filter options
 */
export async function getUnreadCount(
  userId: number,
  options: {
    filterStatus?: 'pending' | 'passed' | 'rejected';
    daysAgo?: number;
  } = {}
): Promise<number> {
  const db = getDb();

  let query = db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('rss_sources.user_id', '=', userId)
    .where('articles.is_read', '=', 0);

  if (options.filterStatus !== undefined) {
    query = query.where('articles.filter_status', '=', options.filterStatus);
  }

  if (options.daysAgo !== undefined) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - options.daysAgo);
    query = query.where('articles.created_at', '>=', cutoffDate.toISOString());
  }

  const result = await query
    .select((eb) => eb.fn.count('articles.id').as('count'))
    .executeTakeFirst();

  return Number(result?.count || 0);
}

