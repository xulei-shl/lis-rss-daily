import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import * as articleService from '../articles.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'api-routes/articles' });

const router = express.Router();

// ============================================================================
// Articles Routes
// ============================================================================

/**
 * GET /api/articles
 * Get user articles with pagination
 */
router.get('/articles', requireAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const rssSourceId = req.query.rssSourceId
      ? parseInt(req.query.rssSourceId as string)
      : undefined;
    const filterStatus = req.query.filterStatus as
      | 'pending'
      | 'passed'
      | 'rejected'
      | undefined;
    const processStatus = req.query.processStatus as
      | 'pending'
      | 'processing'
      | 'completed'
      | 'failed'
      | undefined;
    const searchQuery = req.query.search as string | undefined;

    const result = await articleService.getUserArticles(req.userId!, {
      page,
      limit,
      rssSourceId,
      filterStatus,
      processStatus,
      search: searchQuery,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get articles');
    res.status(500).json({ error: 'Failed to get articles' });
  }
});

/**
 * GET /api/articles/stats
 * Get article statistics for the homepage
 */
router.get('/articles/stats', requireAuth, async (req: AuthRequest, res) => {
  try {
    const db = getDb();

    // Get today's new articles count (using UTC to match database)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayCountResult = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.created_at', '>=', today.toISOString())
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const todayNew = Number(todayCountResult?.count || 0);

    // Get pending articles count
    const pendingResult = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.process_status', '=', 'pending')
      .where('articles.filter_status', '=', 'passed')
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const pending = Number(pendingResult?.count || 0);

    // Get analyzed articles count
    const analyzedResult = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.process_status', '=', 'completed')
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const analyzed = Number(analyzedResult?.count || 0);

    // Get pass rate
    const totalResult = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.filter_status', '!=', 'pending')
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const passedResult = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.filter_status', '=', 'passed')
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const total = Number(totalResult?.count || 0);
    const passed = Number(passedResult?.count || 0);
    const passRate = total > 0 ? passed / total : 0;

    res.json({
      todayNew,
      pending,
      analyzed,
      passRate,
      total,
      passed,
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get article stats');
    res.status(500).json({ error: 'Failed to get article stats' });
  }
});

/**
 * GET /api/articles/:id
 * Get single article by ID
 */
router.get('/articles/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid article ID' });
    }

    const article = await articleService.getArticleById(id, req.userId!);

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const [keywords, translation, filterMatches] = await Promise.all([
      articleService.getArticleKeywordsById(id, req.userId!),
      articleService.getArticleTranslation(id, req.userId!),
      articleService.getArticleFilterMatches(id, req.userId!),
    ]);

    res.json({
      ...article,
      keywords,
      translation,
      filter_matches: filterMatches,
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get article');
    res.status(500).json({ error: 'Failed to get article' });
  }
});

/**
 * DELETE /api/articles/:id
 * Delete article by ID
 */
router.delete('/articles/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid article ID' });
    }

    await articleService.deleteArticle(id, req.userId!);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Article not found') {
      return res.status(404).json({ error: 'Article not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to delete article');
    res.status(500).json({ error: 'Failed to delete article' });
  }
});

/**
 * GET /api/articles/:id/related
 * 获取相关文章（缓存优先）
 */
router.get('/articles/:id/related', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid article ID' });
    }

    const related = await articleService.getRelatedArticles(id, req.userId!, 5);
    res.json(related);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get related articles');
    res.status(500).json({ error: 'Failed to get related articles' });
  }
});

export default router;
