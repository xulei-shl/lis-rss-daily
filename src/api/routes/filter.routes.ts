import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import { getDb } from '../../db.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'api-routes/filter' });

const router = express.Router();

// ============================================================================
// Filter Routes
// ============================================================================

/**
 * POST /api/filter/article
 * Filter a single article
 */
router.post('/filter/article', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { articleId, title, description, content, url } = req.body;

    if (!articleId || isNaN(parseInt(articleId))) {
      return res.status(400).json({ error: 'Article ID is required' });
    }

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Title is required' });
    }

    // Dynamic import to avoid circular dependency
    const { filterArticle } = await import('../../filter.js');

    const result = await filterArticle({
      articleId: parseInt(articleId),
      userId: req.userId!,
      url,
      title,
      description: description || '',
      content,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to filter article');
    res.status(500).json({ error: 'Failed to filter article' });
  }
});

/**
 * GET /api/filter/logs
 * Get filter logs (paginated)
 */
router.get('/filter/logs', requireAuth, async (req: AuthRequest, res) => {
  try {
    const db = getDb();
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const domainId = req.query.domainId ? parseInt(req.query.domainId as string) : undefined;
    const isPassed = req.query.isPassed;

    // Build base query conditions
    let baseQuery = db
      .selectFrom('article_filter_logs')
      .innerJoin('articles', 'articles.id', 'article_filter_logs.article_id')
      .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .leftJoin('journals', 'journals.id', 'articles.journal_id')
      .where((eb) =>
        // Match articles where user owns either the RSS source OR the journal
        eb.or([
          eb('rss_sources.user_id', '=', req.userId!),
          eb.and([
            eb('articles.journal_id', 'is not', null),
            eb('journals.user_id', '=', req.userId!)
          ])
        ])
      );

    if (domainId !== undefined && !isNaN(domainId)) {
      baseQuery = baseQuery.where('article_filter_logs.domain_id', '=', domainId);
    }

    if (isPassed !== undefined) {
      const passed = isPassed === 'true';
      baseQuery = baseQuery.where('article_filter_logs.is_passed', '=', passed ? 1 : 0);
    }

    // Get total count (separate query to avoid pollution)
    const totalCountResult = await baseQuery
      .select((eb) => eb.fn.count('article_filter_logs.id').as('count'))
      .executeTakeFirst();

    const total = Number(totalCountResult?.count ?? 0);

    // Get paginated results with article title
    const logs = await baseQuery
      .selectAll('article_filter_logs')
      .select('articles.title as article_title')
      .orderBy('article_filter_logs.created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    res.json({
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get filter logs');
    res.status(500).json({ error: 'Failed to get filter logs' });
  }
});

/**
 * GET /api/filter/stats
 * Get filter statistics
 */
router.get('/filter/stats', requireAuth, async (req: AuthRequest, res) => {
  try {
    // Dynamic import to avoid circular dependency
    const { getFilterStats } = await import('../../filter.js');

    const stats = await getFilterStats(req.userId!);

    res.json(stats);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get filter stats');
    res.status(500).json({ error: 'Failed to get filter stats' });
  }
});

export default router;
