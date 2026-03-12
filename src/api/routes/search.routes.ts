import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { optionalAuth, requireWriteAccess, requireSearchSummaryAccess } from '../../middleware/auth.js';
import { logger } from '../../logger.js';
import { search, SearchMode } from '../../vector/search.js';
import { generateSearchSummary } from '../daily-summary.js';

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
router.get('/', optionalAuth, async (req: AuthRequest, res) => {
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
      // Use effectiveUserId for guest users to read admin's data
      userId: (req as any).effectiveUserId || req.userId!,
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
        source_origin: r.metadata?.source_origin,
        rss_source_name: r.metadata?.rss_source_name,
        journal_name: r.metadata?.journal_name,
        keyword_name: r.metadata?.keyword_name,
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

/**
 * POST /api/search/summary
 * Generate AI summary from selected articles
 * Requires admin access (or guest access if configured)
 */
router.post('/summary', optionalAuth, requireSearchSummaryAccess, async (req: AuthRequest, res) => {
  try {
    const { articleIds } = req.body;

    // Validation
    if (!articleIds || !Array.isArray(articleIds)) {
      return res.status(400).json({ error: '请提供文章 ID 列表' });
    }
    if (articleIds.length === 0) {
      return res.status(400).json({ error: '请选择至少一篇文章' });
    }
    if (articleIds.length > 50) {
      return res.status(400).json({ error: '最多选择 50 篇文章' });
    }

    // Generate summary (automatically saved to database)
    // Use effectiveUserId so guest users can generate summary from admin's data
    const result = await generateSearchSummary(req.effectiveUserId!, articleIds);

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to generate search summary');
    res.status(500).json({ error: '生成总结失败' });
  }
});

export default router;
