import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import { logger } from '../../logger.js';
import { search, SearchMode } from '../../vector/search.js';

const log = logger.child({ module: 'api-routes/search' });

const router = express.Router();

/**
 * GET /api/search
 * Search articles by semantic, keyword, or hybrid mode
 *
 * Query parameters:
 * - q: search query (required)
 * - mode: 'semantic' | 'keyword' | 'mixed' (default: 'mixed')
 * - page: page number (default: 1)
 * - limit: results per page (default: 10)
 */
router.get('/search', requireAuth, async (req: AuthRequest, res) => {
  try {
    const query = req.query.q as string;
    const mode = (req.query.mode as string) || 'mixed';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const searchMode = mode === 'semantic' ? SearchMode.SEMANTIC
      : mode === 'keyword' ? SearchMode.KEYWORD
      : SearchMode.HYBRID;

    const response = await search({
      mode: searchMode,
      userId: req.userId!,
      query: query.trim(),
      limit,
      offset: (page - 1) * limit,
      normalizeScores: true,
    });

    res.json({
      results: response.results.map((r) => ({
        id: r.articleId,
        title: r.metadata?.title,
        url: r.metadata?.url,
        summary: r.metadata?.summary,
        published_at: r.metadata?.published_at,
        rss_source_name: r.metadata?.rss_source_name,
        relevance: r.score,
        excerpt: r.metadata?.summary || '',
      })),
      mode: response.mode,
      query: response.query,
      total: response.total,
      page: response.page,
      limit: response.limit,
      totalPages: Math.ceil(response.total / limit),
      fallback: response.fallback,
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to search articles');
    res.status(500).json({ error: 'Failed to search articles' });
  }
});

export default router;
