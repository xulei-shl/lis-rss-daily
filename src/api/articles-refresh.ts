/**
 * Related Articles Refresh Service
 *
 * Implements smart refresh strategies for related articles:
 * - Incremental refresh: New articles trigger updates for related old articles
 * - Periodic smart refresh: Batch refresh articles based on priority and recency
 *
 * Balances performance (avoiding full recomputation) with relevance quality
 * (keeping related articles up-to-date as the corpus grows).
 */

import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { refreshRelatedArticles } from './articles.js';

const log = logger.child({ module: 'articles-refresh' });

/* ── Types ── */

export interface RefreshOptions {
  /** Maximum number of articles to refresh in one batch */
  limit?: number;
  /** Only refresh articles updated before this date */
  staleBefore?: Date;
  /** Only refresh articles with minimum views (if tracked) */
  minViews?: number;
}

export interface IncrementalRefreshOptions {
  /** Number of similar articles to find and refresh */
  topN?: number;
  /** Minimum similarity score to consider an article "related" */
  minScore?: number;
}

export interface RefreshResult {
  articleId: number;
  success: boolean;
  error?: string;
}

/* ── Incremental Refresh (Real-time) ── */

/**
 * Perform incremental refresh after a new article is processed.
 *
 * When a new article completes processing, find the most similar existing
 * articles and refresh their related articles lists. This ensures that as
 * new content enters the system, older articles get updated recommendations.
 *
 * @param newArticleId - The newly processed article ID
 * @param userId - User ID
 * @param options - Refresh options
 * @returns Array of refreshed article IDs
 */
export async function incrementalRefreshRelated(
  newArticleId: number,
  userId: number,
  options: IncrementalRefreshOptions = {}
): Promise<number[]> {
  const { topN = 10, minScore = 0.5 } = options;

  log.debug({ articleId: newArticleId, topN, minScore }, '[incremental] Starting incremental refresh');

  // Find articles most similar to the new one
  // We query for articles that might have the new article in their related list
  const db = getDb();

  // Strategy: Find articles where the new article would appear in their top related
  // by searching semantically for similar articles and filtering by score
  const similarArticles = await findMostSimilarToArticle(newArticleId, userId, {
    limit: topN * 2, // Get more candidates, then filter
    minScore,
  });

  if (similarArticles.length === 0) {
    log.debug({ articleId: newArticleId }, '[incremental] No similar articles found, skipping');
    return [];
  }

  log.debug(
    { articleId: newArticleId, candidates: similarArticles.length },
    '[incremental] Found similar articles, refreshing their related lists'
  );

  // Refresh related articles for each similar article (in parallel with concurrency limit)
  const results: RefreshResult[] = [];
  const CONCURRENT_LIMIT = 3;

  for (let i = 0; i < similarArticles.length; i += CONCURRENT_LIMIT) {
    const batch = similarArticles.slice(i, i + CONCURRENT_LIMIT);

    const batchResults = await Promise.allSettled(
      batch.map(async (articleId) => {
        try {
          await refreshRelatedArticles(articleId, userId, 5);
          return { articleId, success: true };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          log.warn({ articleId, error: errMsg }, '[incremental] Failed to refresh related articles');
          return { articleId, success: false, error: errMsg };
        }
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  log.info(
    { articleId: newArticleId, refreshed: successful, failed, total: results.length },
    '[incremental] Incremental refresh complete'
  );

  return results.filter((r) => r.success).map((r) => r.articleId);
}

/**
 * Find articles most similar to a given article (excluding the article itself).
 * Uses vector similarity search to find candidates.
 */
async function findMostSimilarToArticle(
  articleId: number,
  userId: number,
  options: { limit: number; minScore: number }
): Promise<number[]> {
  const db = getDb();

  // Get the article to compare against
  const article = await db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('articles.id', '=', articleId)
    .where('rss_sources.user_id', '=', userId)
    .select(['articles.id', 'articles.title', 'articles.content', 'articles.markdown_content'])
    .executeTakeFirst();

  if (!article) {
    return [];
  }

  // Import dynamically to avoid circular dependency
  const { query: queryVector } = await import('../vector/vector-store.js');
  const { buildVectorText } = await import('../vector/text-builder.js');
  const { getEmbedding } = await import('../vector/embedding-client.js');

  // Build query text and get embedding
  const text = buildVectorText(article as any);
  if (!text) return [];

  const embedding = await getEmbedding(text, userId);
  const hits = await queryVector(userId, embedding, options.limit, {
    user_id: userId,
  });

  // Filter by score and exclude the article itself
  return hits
    .filter((hit) => hit.articleId !== articleId && hit.score >= options.minScore)
    .map((hit) => hit.articleId);
}

/* ── Periodic Smart Refresh ── */

/**
 * Get article IDs that need their related articles refreshed.
 *
 * Priority strategy:
 * 1. Recent articles (last 7 days) - higher priority
 * 2. Articles with stale related caches (older updated_at)
 * 3. Only completed, passed articles
 *
 * @param userId - User ID
 * @param options - Query options
 * @returns Array of article IDs to refresh
 */
export async function getArticlesNeedingRefresh(
  userId: number,
  options: RefreshOptions = {}
): Promise<number[]> {
  const { limit = 50, staleBefore } = options;

  const db = getDb();

  // Default: articles whose related cache hasn't been updated in 7 days
  const staleDate = staleBefore || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Find articles where:
  // - They have related articles cached
  // - The cache was updated before staleDate
  // - Article is completed and passed
  const articles = await db
    .selectFrom('article_related as ar')
    .innerJoin('articles', 'articles.id', 'ar.article_id')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('rss_sources.user_id', '=', userId)
    .where('articles.filter_status', '=', 'passed')
    .where('articles.process_status', '=', 'completed')
    .where('ar.updated_at', '<', staleDate.toISOString())
    .select('ar.article_id')
    .groupBy('ar.article_id')
    .orderBy('ar.updated_at', 'asc') // Oldest first
    .limit(limit)
    .execute();

  const articleIds = articles.map((a) => a.article_id);

  log.debug(
    { userId, count: articleIds.length, staleDate: staleDate.toISOString() },
    '[periodic] Found articles needing refresh'
  );

  return articleIds;
}

/**
 * Perform batch refresh of articles needing refresh.
 *
 * @param userId - User ID
 * @param options - Refresh options
 * @returns Refresh results
 */
export async function batchRefreshRelated(
  userId: number,
  options: RefreshOptions = {}
): Promise<RefreshResult[]> {
  const { limit = 50 } = options;

  log.info({ userId, limit }, '[periodic] Starting batch refresh');

  const articleIds = await getArticlesNeedingRefresh(userId, options);

  if (articleIds.length === 0) {
    log.info({ userId }, '[periodic] No articles need refresh');
    return [];
  }

  // Process in batches with concurrency control
  const results: RefreshResult[] = [];
  const MAX_CONCURRENT = 3; // Same as article processing

  for (let i = 0; i < articleIds.length; i += MAX_CONCURRENT) {
    const batch = articleIds.slice(i, i + MAX_CONCURRENT);

    const batchResults = await Promise.allSettled(
      batch.map(async (articleId) => {
        try {
          await refreshRelatedArticles(articleId, userId, 5);
          return { articleId, success: true };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          log.warn({ articleId, error: errMsg }, '[periodic] Failed to refresh article');
          return { articleId, success: false, error: errMsg };
        }
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  log.info(
    { userId, total: results.length, successful, failed },
    '[periodic] Batch refresh complete'
  );

  return results;
}

/* ── Utility Functions ── */

/**
 * Get statistics about related article cache freshness.
 */
export async function getRefreshStats(userId: number): Promise<{
  total: number;
  fresh: number; // Updated within 7 days
  stale: number; // Updated more than 7 days ago
  missing: number; // No cached related articles
}> {
  const db = getDb();
  const now = Date.now();
  const staleThreshold = now - 7 * 24 * 60 * 60 * 1000;

  // Count total completed/passed articles
  const totalResult = await db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('rss_sources.user_id', '=', userId)
    .where('articles.filter_status', '=', 'passed')
    .where('articles.process_status', '=', 'completed')
    .select((eb) => eb.fn.count('articles.id').as('count'))
    .executeTakeFirst();

  const total = Number(totalResult?.count || 0);

  // Count articles with cached related articles
  const cachedResult = await db
    .selectFrom('article_related as ar')
    .innerJoin('articles', 'articles.id', 'ar.article_id')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('rss_sources.user_id', '=', userId)
    .where('articles.filter_status', '=', 'passed')
    .where('articles.process_status', '=', 'completed')
    .select((eb) => eb.fn.count('ar.article_id').as('count'))
    .executeTakeFirst();

  const cached = Number(cachedResult?.count || 0);

  // Count fresh cached articles (updated within 7 days)
  const freshResult = await db
    .selectFrom('article_related as ar')
    .innerJoin('articles', 'articles.id', 'ar.article_id')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('rss_sources.user_id', '=', userId)
    .where('articles.filter_status', '=', 'passed')
    .where('articles.process_status', '=', 'completed')
    .where('ar.updated_at', '>', new Date(staleThreshold).toISOString())
    .select((eb) => eb.fn.count('ar.article_id').as('count'))
    .executeTakeFirst();

  const fresh = Number(freshResult?.count || 0);

  return {
    total,
    fresh,
    stale: cached - fresh,
    missing: total - cached,
  };
}
