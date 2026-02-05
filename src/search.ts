/**
 * Search: Historical article search module.
 *
 * Phase 6: Simplified SQLite LIKE search.
 * Phase 10: 预留语义搜索接口（已迁移到 vector 模块）。
 */

import { getDb } from './db.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'search' });

/**
 * Search result type.
 */
export interface SearchResult {
  articleId: number;
  title: string;
  url: string;
  snippet: string;
  score?: number;
}

/**
 * Search historical articles by title, summary, or content.
 * Uses SQLite LIKE for pattern matching.
 *
 * TODO: Phase 10 - 语义检索已迁移到 vector 模块。
 *
 * @param query - Search query string
 * @param limit - Maximum number of results (default: 10)
 * @param userId - Optional user ID for filtering (multi-tenant support)
 * @returns Array of search results
 */
export async function searchHistoricalArticles(
  query: string,
  limit: number = 10,
  userId?: number
): Promise<SearchResult[]> {
  const db = getDb();

  try {
    const startTime = Date.now();
    log.debug({ query, limit, userId }, '→ Searching historical articles');

    const terms = query
      .trim()
      .split(/\s+/)
      .filter((term) => term.length > 0);

    let queryBuilder = db
      .selectFrom('articles')
      .select(['id as articleId', 'title', 'url', 'summary', 'markdown_content'])
      .where((eb) =>
        eb.and(
          terms.map((term) => {
            const pattern = `%${term}%`;
            return eb.or([
              eb('title', 'like', pattern),
              eb('summary', 'like', pattern),
              // 仅在存在时搜索 markdown_content（避免 NULL 问题）
              eb('markdown_content', 'like', pattern),
            ]);
          })
        )
      )
      .where('process_status', '=', 'completed')
      .orderBy('id', 'desc')
      .limit(limit);

    // Apply user filter if provided (join with rss_sources)
    if (userId !== undefined) {
      queryBuilder = queryBuilder
        .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
        .where('rss_sources.user_id', '=', userId) as any;
    }

    const results = await queryBuilder.execute();

    const elapsed = Date.now() - startTime;
    log.info({ elapsed: `${elapsed}ms`, results: results.length, query }, '← Search completed');

    return results.map((row: any) => ({
      articleId: row.articleId,
      title: row.title,
      url: row.url,
      // Use summary as snippet, or truncate markdown_content if no summary
      snippet:
        row.summary ||
        (row.markdown_content ? row.markdown_content.slice(0, 200) + '...' : ''),
    }));
  } catch (error) {
    log.error({ error, query }, '← Search failed');
    return [];
  }
}

/**
 * Find related articles based on a search query.
 * Alias for searchHistoricalArticles for clearer intent.
 *
 * @param query - Search query string
 * @param limit - Maximum number of results (default: 5)
 * @param userId - Optional user ID for filtering
 * @returns Array of related articles
 */
export async function findRelatedArticles(
  query: string,
  limit: number = 5,
  userId?: number
): Promise<SearchResult[]> {
  return searchHistoricalArticles(query, limit, userId);
}

/**
 * Combined search - Reserved for Phase 10.
 *
 * This will search both local articles and (optionally) user notes.
 * For now, it only searches historical articles.
 *
 * @param query - Search query string
 * @param limit - Maximum number of results per category
 * @param userId - Optional user ID for filtering
 * @returns Object with search results by category
 */
export async function searchAll(
  query: string,
  limit: number = 5,
  userId?: number
): Promise<{ articles: SearchResult[]; notes: SearchResult[] }> {
  // Phase 6: Only search articles
  const articles = await searchHistoricalArticles(query, limit, userId);

  // Phase 10: 预留扩展（可接入笔记向量检索）
  const notes: SearchResult[] = [];

  return { articles, notes };
}
