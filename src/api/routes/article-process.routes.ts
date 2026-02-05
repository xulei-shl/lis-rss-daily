import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import * as articleProcessService from '../article-process.js';

const router = express.Router();

// ============================================================================
// Article Process Routes
// ============================================================================

/**
 * POST /api/articles/:id/process
 * Trigger processing for a single article
 */
router.post('/articles/:id/process', requireAuth, async (req: AuthRequest, res) => {
  await articleProcessService.triggerProcess(req, res);
});

/**
 * POST /api/articles/process-batch
 * Trigger batch processing for pending or failed articles
 */
router.post('/articles/process-batch', requireAuth, async (req: AuthRequest, res) => {
  await articleProcessService.triggerBatchProcess(req, res);
});

/**
 * POST /api/articles/:id/retry
 * Retry a single failed article
 */
router.post('/articles/:id/retry', requireAuth, async (req: AuthRequest, res) => {
  await articleProcessService.retryArticle(req, res);
});

/**
 * GET /api/articles/process-stats
 * Get processing statistics for a user
 */
router.get('/articles/process-stats', requireAuth, async (req: AuthRequest, res) => {
  await articleProcessService.getProcessStats(req, res);
});

/**
 * GET /api/articles/pending
 * Get pending articles for processing
 */
router.get('/articles/pending', requireAuth, async (req: AuthRequest, res) => {
  await articleProcessService.getPendingArticles(req, res);
});

/**
 * GET /api/articles/failed
 * Get failed articles for retry
 */
router.get('/articles/failed', requireAuth, async (req: AuthRequest, res) => {
  await articleProcessService.getFailedArticles(req, res);
});

export default router;
