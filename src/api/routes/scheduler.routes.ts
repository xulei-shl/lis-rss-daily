import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import { initRSSScheduler } from '../../rss-scheduler.js';
import { initRejectedCleanupScheduler } from '../../rejected-cleanup-scheduler.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'api-routes/scheduler' });

const router = express.Router();

// ============================================================================
// Scheduler Routes
// ============================================================================

/**
 * POST /api/rss-sources/fetch-all
 * Trigger immediate fetch of all RSS sources
 */
router.post('/rss-sources/fetch-all', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scheduler = initRSSScheduler();
    const results = await scheduler.fetchAllNow();

    const successCount = results.filter((r) => r.success).length;
    const totalArticles = results.reduce((sum, r) => sum + r.articlesCount, 0);
    const newArticles = results.reduce((sum, r) => sum + r.newArticlesCount, 0);

    res.json({
      success: true,
      totalTasks: results.length,
      successCount,
      failedCount: results.length - successCount,
      totalArticles,
      newArticles,
      results: results.map((r) => ({
        rssSourceId: r.rssSourceId,
        success: r.success,
        articlesCount: r.articlesCount,
        newArticlesCount: r.newArticlesCount,
        error: r.error,
      })),
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to fetch all RSS sources');
    res.status(500).json({ error: 'Failed to fetch RSS sources' });
  }
});

/**
 * POST /api/scheduler/rejected-cleanup/trigger
 * Trigger immediate cleanup of rejected articles for all sources with auto_cleanup_rejected=1
 */
router.post('/scheduler/rejected-cleanup/trigger', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scheduler = initRejectedCleanupScheduler();
    const result = await scheduler.cleanupNow(false);

    res.json({
      success: true,
      totalSources: result.totalSources,
      totalArticlesMoved: result.totalArticlesMoved,
      successCount: result.successCount,
      failedCount: result.failedCount,
      durationMs: result.durationMs,
      results: result.sourceResults.map((r) => ({
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        sourceName: r.sourceName,
        articlesMoved: r.articlesMoved,
        success: r.success,
        error: r.error,
      })),
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to trigger rejected cleanup');
    res.status(500).json({ error: 'Failed to trigger rejected article cleanup' });
  }
});

/**
 * GET /api/scheduler/status
 * Get scheduler status
 */
router.get('/scheduler/status', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scheduler = initRSSScheduler();
    const status = scheduler.getStatus();

    res.json(status);
  } catch (error) {
    log.error({ error }, 'Failed to get scheduler status');
    res.status(500).json({ error: 'Failed to get scheduler status' });
  }
});

export default router;
