import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import { getDb } from '../../db.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'api-routes/search' });

const router = express.Router();

/**
 * GET /api/search
 * Search articles by title or content
 *
 * Query parameters:
 * - q: search query (required)
 * - mode: 'semantic' | 'keyword' (default: 'keyword')
 * - page: page number (default: 1)
 * - limit: results per page (default: 10)
 *
 * Phase 8: Added QMD semantic search support
 */
router.get('/search', requireAuth, async (req: AuthRequest, res) => {
  try {
    const query = req.query.q as string;
    const mode = (req.query.mode as string) || 'keyword';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    // Phase 8: Use QMD semantic search when mode=semantic
    if (mode === 'semantic') {
      try {
        const { searchArticlesWithQMD } = await import('../../search.js');
        const results = await searchArticlesWithQMD(query.trim(), limit, req.userId);

        res.json({
          results,
          mode: 'semantic',
          query: query.trim(),
          total: results.length,
          page: 1, // QMD doesn't support pagination
          limit,
          totalPages: 1,
        });
        return;
      } catch (error) {
        log.warn({ error, query }, 'QMD search failed, falling back to keyword search');
        // Fall through to keyword search
      }
    }

    // Keyword search (existing implementation)
    const db = getDb();
    const offset = (page - 1) * limit;
    const searchTerm = `%${query.trim()}%`;

    // Get total count
    const countResult = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.filter_status', '=', 'passed')
      .where((eb) =>
        eb.or([
          eb('articles.title', 'like', searchTerm),
          eb('articles.summary', 'like', searchTerm),
          eb('articles.markdown_content', 'like', searchTerm),
        ])
      )
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const total = Number(countResult?.count || 0);

    // Get search results
    const results = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.filter_status', '=', 'passed')
      .where((eb) =>
        eb.or([
          eb('articles.title', 'like', searchTerm),
          eb('articles.summary', 'like', searchTerm),
          eb('articles.markdown_content', 'like', searchTerm),
        ])
      )
      .select([
        'articles.id',
        'articles.title',
        'articles.url',
        'articles.summary',
        'articles.published_at',
        'rss_sources.name as rss_source_name',
      ])
      .orderBy('articles.published_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    // Calculate relevance score (simple: title matches are more relevant)
    const resultsWithScore = results.map((article) => {
      let score = 0;
      const title = article.title.toLowerCase();
      const summary = (article.summary || '').toLowerCase();
      const q = query.toLowerCase();

      if (title.includes(q)) score += 0.5;
      if (title.startsWith(q)) score += 0.3;
      if (summary.includes(q)) score += 0.2;

      return {
        ...article,
        relevance: Math.min(score, 1),
        excerpt: article.summary || article.markdown_content?.substring(0, 300) || '',
      };
    });

    // Sort by relevance
    resultsWithScore.sort((a, b) => b.relevance - a.relevance);

    res.json({
      results: resultsWithScore,
      mode: 'keyword',
      query: query.trim(),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to search articles');
    res.status(500).json({ error: 'Failed to search articles' });
  }
});

export default router;
