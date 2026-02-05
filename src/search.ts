/**
 * Search: Historical article search module.
 *
 * Phase 6: Simplified SQLite LIKE search.
 * Phase 10: QMD semantic search integration (reserved).
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
 * TODO: Phase 10 - Replace or enhance with QMD semantic search.
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
 * Run a qmd vsearch command with retry on SQLITE_BUSY errors.
 * Uses exponential backoff strategy for retries.
 *
 * @param query - Search query string
 * @param limit - Maximum number of results (default: 10)
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @returns Promise<string> - Raw QMD JSON output
 * @throws Error - If all retries fail or QMD command fails
 */
export async function qmdVsearchWithRetry(
  query: string,
  limit: number = 10,
  maxRetries: number = 3
): Promise<string> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  // Escape shell special characters
  const escapeShell = (s: string): string => {
    return s.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
  };

  // Sleep helper for retry delays
  const sleep = (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  const cmd = `qmd vsearch "${escapeShell(query)}" --json -n ${limit * 3}`;
  const baseDelayMs = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { stdout } = await execAsync(cmd, { encoding: 'utf-8', timeout: 30000 });
      return stdout;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const isBusy = error.message.includes('SQLITE_BUSY');

      if (!isBusy || attempt === maxRetries) {
        throw error;
      }

      const delay = baseDelayMs * Math.pow(2, attempt);
      log.debug({ attempt: attempt + 1, delay, query }, '[qmd-retry] SQLITE_BUSY, retrying...');
      await sleep(delay);
    }
  }

  throw new Error('QMD search failed after retries');
}

/**
 * Search articles using QMD semantic search.
 * Falls back to SQLite LIKE search if QMD is unavailable or fails.
 *
 * @param query - Search query string
 * @param limit - Maximum number of results (default: 10)
 * @param userId - Optional user ID for filtering (multi-tenant support)
 * @returns Array of search results
 */
export async function searchArticlesWithQMD(
  query: string,
  limit: number = 10,
  userId?: number
): Promise<SearchResult[]> {
  try {
    const startTime = Date.now();
    log.debug({ query, limit }, '→ QMD vsearch');

    const stdout = await qmdVsearchWithRetry(query, limit);
    const parsed = JSON.parse(stdout);

    if (!Array.isArray(parsed)) {
      throw new Error('Invalid QMD output format');
    }

    const { config } = await import('./config.js');
    const collectionPrefix = `qmd://${config.qmdArticlesCollection}/`;

    const results = parsed
      .filter((item: any) => item.file?.startsWith(collectionPrefix))
      .slice(0, limit)
      .map((item: any) => {
        // Extract article ID from filename (format: {id}-{slug}.md)
        const filename = item.file?.replace(collectionPrefix, '') || '';
        const idMatch = filename.match(/^(\d+)-/);
        const articleId = idMatch ? parseInt(idMatch[1], 10) : 0;

        return {
          articleId,
          title: item.title || filename,
          url: item.url || '',
          snippet: item.snippet || item.content?.slice(0, 200) || '',
          score: item.score,
        };
      });

    const elapsed = Date.now() - startTime;
    log.info({ elapsed: `${elapsed}ms`, results: results.length, query }, '← QMD vsearch done');

    return results;
  } catch (err) {
    log.warn(
      { query, error: err instanceof Error ? err.message : String(err) },
      'QMD search failed, falling back to SQLite LIKE'
    );
    // Fallback to existing SQLite LIKE search
    return searchHistoricalArticles(query, limit, userId);
  }
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

  // Phase 10: Add notes search when QMD is integrated
  const notes: SearchResult[] = [];

  return { articles, notes };
}
