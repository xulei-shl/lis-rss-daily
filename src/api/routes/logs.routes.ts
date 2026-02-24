import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import { getFilterLogs } from '../filter-logs.js';
import * as journalsService from '../journals.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'api-routes/logs' });

const router = express.Router();

/**
 * GET /api/logs/filter
 * 过滤日志分页
 */
router.get(['/logs/filter', '/filter/logs'], requireAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    let domainId: number | undefined;
    if (typeof req.query.domainId === 'string' && req.query.domainId.trim().length > 0) {
      const parsed = parseInt(req.query.domainId, 10);
      if (!Number.isNaN(parsed)) {
        domainId = parsed;
      }
    }

    let isPassed: boolean | undefined;
    if (typeof req.query.isPassed === 'string' && req.query.isPassed.length > 0) {
      isPassed = req.query.isPassed === 'true';
    }

    const result = await getFilterLogs({
      userId: req.userId!,
      page,
      limit,
      domainId,
      isPassed,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get filter logs');
    res.status(500).json({ error: 'Failed to get filter logs' });
  }
});

/**
 * GET /api/logs/crawl
 * 爬取日志分页
 */
router.get(['/logs/crawl', '/journals/logs'], requireAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const result = await journalsService.getCrawlLogs(req.userId!, undefined, page, limit);
    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get crawl logs');
    res.status(500).json({ error: 'Failed to get crawl logs' });
  }
});

/**
 * GET /api/logs/journals/:id
 * 单个期刊爬取日志
 */
router.get(['/logs/journals/:id', '/journals/:id/logs'], requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (Array.isArray(idParam)) {
      return res.status(400).json({ error: 'Invalid journal ID' });
    }
    const id = parseInt(idParam, 10);

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid journal ID' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    const result = await journalsService.getCrawlLogs(req.userId!, id, page, limit);

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get crawl logs for journal');
    res.status(500).json({ error: 'Failed to get crawl logs' });
  }
});

export default router;
