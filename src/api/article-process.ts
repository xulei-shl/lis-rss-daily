/**
 * Article Process API Service
 *
 * API endpoints for triggering and managing article processing.
 * Provides endpoints for single article processing, batch processing,
 * retrying failed articles, and retrieving processing statistics.
 */

import { processArticle, processBatchArticles, retryFailedArticle, getPendingArticleIds, getFailedArticleIds, type ProcessResult } from '../pipeline.js';
import { getUserArticles, type ArticleWithSource } from './articles.js';
import { logger } from '../logger.js';
import type { Request, Response } from 'express';

const log = logger.child({ module: 'article-process-api' });

/* ── Public Types ── */

export interface ProcessStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  avgDuration?: number;
}

export interface BatchOptions {
  limit?: number;
  processStatus?: 'pending' | 'failed';
  maxConcurrent?: number;
}

/* ── API Handlers ── */

/**
 * Trigger processing for a single article.
 * POST /api/articles/:id/process
 */
export async function triggerProcess(req: Request, res: Response): Promise<void> {
  const userId = (req as any).userId;
  const idParam = req.params.id;
  const articleId = typeof idParam === 'string' ? parseInt(idParam, 10) : -1;

  if (isNaN(articleId) || articleId < 0) {
    res.status(400).json({ error: 'Invalid article ID' });
    return;
  }

  try {
    log.info({ articleId, userId }, '[API] Trigger article process');

    // Process in background - don't await
    processArticle(articleId, userId)
      .then((result) => {
        log.info({ articleId, userId, result }, '[API] Article process completed');
      })
      .catch((error) => {
        log.error({ articleId, userId, error: error.message }, '[API] Article process failed');
      });

    res.json({
      success: true,
      message: 'Article processing started',
      articleId,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error({ articleId, userId, error: errMsg }, '[API] Trigger process failed');
    res.status(500).json({ error: errMsg });
  }
}

/**
 * Trigger batch processing for pending or failed articles.
 * POST /api/articles/process-batch
 *
 * Body:
 * {
 *   limit?: number;           // Max articles to process (default: 10)
 *   processStatus?: 'pending' | 'failed';  // Which articles to process (default: 'pending')
 *   maxConcurrent?: number;   // Max concurrent processing (default: from env)
 * }
 */
export async function triggerBatchProcess(req: Request, res: Response): Promise<void> {
  const userId = (req as any).userId;
  const options: BatchOptions = req.body || {};
  const limit = options.limit || 10;
  const status = options.processStatus || 'pending';

  try {
    log.info({ userId, options }, '[API] Trigger batch process');

    // Get article IDs to process
    const articleIds =
      status === 'failed'
        ? await getFailedArticleIds(userId, limit)
        : await getPendingArticleIds(userId, limit);

    if (articleIds.length === 0) {
      res.json({
        success: true,
        message: `No ${status} articles to process`,
        count: 0,
      });
      return;
    }

    // Process in background - don't await
    processBatchArticles(articleIds, userId, {
      maxConcurrent: options.maxConcurrent,
      onProgress: (articleId, stage) => {
        log.debug({ articleId, stage }, '[API] Batch progress');
      },
    })
      .then((results) => {
        const completed = results.filter((r) => r.status === 'completed').length;
        const failed = results.filter((r) => r.status === 'failed').length;
        const skipped = results.filter((r) => r.status === 'skipped').length;

        log.info(
          { userId, total: results.length, completed, failed, skipped },
          '[API] Batch process completed'
        );
      })
      .catch((error) => {
        log.error({ userId, error: error.message }, '[API] Batch process failed');
      });

    res.json({
      success: true,
      message: `Batch processing started for ${articleIds.length} articles`,
      count: articleIds.length,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error({ userId, error: errMsg }, '[API] Trigger batch process failed');
    res.status(500).json({ error: errMsg });
  }
}

/**
 * Retry a single failed article.
 * POST /api/articles/:id/retry
 */
export async function retryArticle(req: Request, res: Response): Promise<void> {
  const userId = (req as any).userId;
  const idParam = req.params.id;
  const articleId = typeof idParam === 'string' ? parseInt(idParam, 10) : -1;

  if (isNaN(articleId) || articleId < 0) {
    res.status(400).json({ error: 'Invalid article ID' });
    return;
  }

  try {
    log.info({ articleId, userId }, '[API] Retry article');

    // Process in background - don't await
    retryFailedArticle(articleId, userId)
      .then((result) => {
        log.info({ articleId, userId, result }, '[API] Article retry completed');
      })
      .catch((error) => {
        log.error({ articleId, userId, error: error.message }, '[API] Article retry failed');
      });

    res.json({
      success: true,
      message: 'Article retry started',
      articleId,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error({ articleId, userId, error: errMsg }, '[API] Retry article failed');
    res.status(500).json({ error: errMsg });
  }
}

/**
 * Get processing statistics for a user.
 * GET /api/articles/process-stats
 */
export async function getProcessStats(req: Request, res: Response): Promise<void> {
  const userId = (req as any).userId;

  try {
    // Get counts by status
    const pendingResult = await getUserArticles(userId, { processStatus: 'pending', limit: 1 });
    const processingResult = await getUserArticles(userId, { processStatus: 'processing', limit: 1 });
    const completedResult = await getUserArticles(userId, { processStatus: 'completed', limit: 1 });
    const failedResult = await getUserArticles(userId, { processStatus: 'failed', limit: 1 });

    const stats: ProcessStats = {
      total: pendingResult.total + processingResult.total + completedResult.total + failedResult.total,
      pending: pendingResult.total,
      processing: processingResult.total,
      completed: completedResult.total,
      failed: failedResult.total,
    };

    res.json(stats);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error({ userId, error: errMsg }, '[API] Get process stats failed');
    res.status(500).json({ error: errMsg });
  }
}

/**
 * Get pending articles for processing.
 * GET /api/articles/pending
 *
 * Query:
 * - limit: number of articles to return (default: 20)
 */
export async function getPendingArticles(req: Request, res: Response): Promise<void> {
  const userId = (req as any).userId;
  const limit = parseInt(req.query.limit as string, 10) || 20;

  try {
    const result = await getUserArticles(userId, {
      filterStatus: 'passed',
      processStatus: 'pending',
      limit,
    });

    res.json({
      articles: result.articles,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error({ userId, error: errMsg }, '[API] Get pending articles failed');
    res.status(500).json({ error: errMsg });
  }
}

/**
 * Get failed articles for retry.
 * GET /api/articles/failed
 *
 * Query:
 * - limit: number of articles to return (default: 20)
 */
export async function getFailedArticles(req: Request, res: Response): Promise<void> {
  const userId = (req as any).userId;
  const limit = parseInt(req.query.limit as string, 10) || 20;

  try {
    const result = await getUserArticles(userId, {
      filterStatus: 'passed',
      processStatus: 'failed',
      limit,
    });

    res.json({
      articles: result.articles,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error({ userId, error: errMsg }, '[API] Get failed articles failed');
    res.status(500).json({ error: errMsg });
  }
}
