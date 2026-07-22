/**
 * Web Sources API Routes
 * 网络爬虫来源管理路由
 */

import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { logger } from '../../logger.js';
import { getSourceTypeCodes } from '../../config/types-config.js';
import { getScraperTypeCodes, getAllScraperConfigs } from '../../spiders/web-scrapers/config.js';
import * as webSourcesService from '../web-sources.js';
import { initWebScheduler } from '../../web-scheduler.js';

const log = logger.child({ module: 'api-routes/web-sources' });

const router = express.Router();

// Helper to get numeric ID from params
function paramId(req: any): number {
  return parseInt(req.params.id, 10);
}

// ============================================================================
// Web Sources Routes
// ============================================================================

/**
 * GET /api/web-sources/scraper-types
 * 获取可用的爬虫脚本类型列表
 * ⚠️ 必须放在 /web-sources/:id 之前，避免 Express 将 'scraper-types' 匹配为 :id
 */
router.get('/web-sources/scraper-types', requireAuth, async (_req: AuthRequest, res) => {
  try {
    const scraperTypes = getAllScraperConfigs().map(c => ({
      code: c.scraperType,
      label: c.label,
      scriptType: c.scriptType,
    }));

    res.json({ scraperTypes });
  } catch (error) {
    log.error({ error }, 'Failed to get scraper types');
    res.status(500).json({ error: 'Failed to get scraper types' });
  }
});

/**
 * GET /api/web-sources
 * 获取所有网络爬虫来源
 */
router.get('/web-sources', requireAuth, async (req: AuthRequest, res) => {
  try {
    const sources = await webSourcesService.getWebSources(req.userId!);
    res.json({ sources });
  } catch (error) {
    log.error({ error }, 'Failed to get web sources');
    res.status(500).json({ error: 'Failed to get web sources' });
  }
});

/**
 * POST /api/web-sources
 * 创建新的网络爬虫来源
 */
router.post('/web-sources', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const body = req.body as any;
    const { name, url, scraperType, sourceType, domainId, fetchInterval } = body;
    const autoCleanupRejected = body.autoCleanupRejected;
    const status = body.status;

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!url || !url.trim()) {
      return res.status(400).json({ error: 'URL is required' });
    }
    if (!scraperType || !String(scraperType).trim()) {
      return res.status(400).json({ error: 'Scraper type is required' });
    }

    // Validate scraper type
    const validScraperTypes = getScraperTypeCodes();
    const scraperTypeStr = String(scraperType);
    if (!validScraperTypes.includes(scraperTypeStr)) {
      return res.status(400).json({
        error: `Invalid scraper type. Must be one of: ${validScraperTypes.join(', ')}`,
      });
    }

    // Validate source type if provided (must be one of journal/blog/news)
    const st = typeof sourceType === 'string' ? sourceType : undefined;
    if (st !== undefined) {
      const validSourceTypes = getSourceTypeCodes();
      if (!validSourceTypes.includes(st) || st === 'email') {
        return res.status(400).json({
          error: `Invalid source type. Must be one of: journal, blog, news`,
        });
      }
    }

    // Check for duplicate name
    const nameExists = await webSourcesService.checkWebSourceNameExists(req.userId!, name.trim());
    if (nameExists) {
      return res.status(409).json({ error: 'A web source with this name already exists' });
    }

    // Check for duplicate URL
    const urlExists = await webSourcesService.checkWebSourceUrlExists(req.userId!, url.trim());
    if (urlExists) {
      return res.status(409).json({ error: 'A web source with this URL already exists' });
    }

    const result = await webSourcesService.createWebSource(req.userId!, {
      name: name.trim(),
      url: url.trim(),
      scraperType: scraperTypeStr,
      sourceType: (typeof sourceType === 'string' ? sourceType : undefined) as any,
      domainId,
      fetchInterval,
      autoCleanupRejected: Boolean(autoCleanupRejected),
      status,
    });

    res.status(201).json(result);
  } catch (error) {
    log.error({ error, body: req.body }, 'Failed to create web source');
    res.status(500).json({ error: 'Failed to create web source' });
  }
});

/**
 * GET /api/web-sources/:id
 * 获取单个网络爬虫来源
 */
router.get('/web-sources/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = paramId(req);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const source = await webSourcesService.getWebSourceById(id, req.userId!);
    if (!source) {
      return res.status(404).json({ error: 'Web source not found' });
    }

    res.json({ source });
  } catch (error) {
    log.error({ error, id: req.params.id }, 'Failed to get web source');
    res.status(500).json({ error: 'Failed to get web source' });
  }
});

/**
 * PUT /api/web-sources/:id
 * 更新网络爬虫来源
 */
router.put('/web-sources/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const id = paramId(req);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const body = req.body as any;
    const { name, url, scraperType, sourceType, domainId, fetchInterval } = body;
    const autoCleanupRejected = body.autoCleanupRejected;
    const status = body.status;

    // Validate scraper type if provided
    if (scraperType !== undefined) {
      const validScraperTypes = getScraperTypeCodes();
      if (!validScraperTypes.includes(String(scraperType))) {
        return res.status(400).json({
          error: `Invalid scraper type. Must be one of: ${validScraperTypes.join(', ')}`,
        });
      }
    }

    // Validate source type if provided (must be one of journal/blog/news)
    const st = typeof sourceType === 'string' ? sourceType : undefined;
    if (st !== undefined) {
      const validSourceTypes = getSourceTypeCodes();
      if (!validSourceTypes.includes(st) || st === 'email') {
        return res.status(400).json({
          error: `Invalid source type. Must be one of: journal, blog, news`,
        });
      }
    }

    // Check for duplicate name
    if (name !== undefined) {
      const nameExists = await webSourcesService.checkWebSourceNameExists(req.userId!, name.trim(), id);
      if (nameExists) {
        return res.status(409).json({ error: 'A web source with this name already exists' });
      }
    }

    // Check for duplicate URL
    if (url !== undefined) {
      const urlExists = await webSourcesService.checkWebSourceUrlExists(req.userId!, url.trim(), id);
      if (urlExists) {
        return res.status(409).json({ error: 'A web source with this URL already exists' });
      }
    }

    const updated = await webSourcesService.updateWebSource(id, req.userId!, {
      name: name?.trim(),
      url: url?.trim(),
      scraperType,
      sourceType,
      domainId,
      fetchInterval,
      autoCleanupRejected,
      status,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Web source not found' });
    }

    res.json({ success: true });
  } catch (error) {
    log.error({ error, id: req.params.id, body: req.body }, 'Failed to update web source');
    res.status(500).json({ error: 'Failed to update web source' });
  }
});

/**
 * DELETE /api/web-sources/:id
 * 删除网络爬虫来源
 */
router.delete('/web-sources/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const id = paramId(req);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const deleted = await webSourcesService.deleteWebSource(id, req.userId!);
    if (!deleted) {
      return res.status(404).json({ error: 'Web source not found' });
    }

    res.json({ success: true });
  } catch (error) {
    log.error({ error, id: req.params.id }, 'Failed to delete web source');
    res.status(500).json({ error: 'Failed to delete web source' });
  }
});

/**
 * POST /api/web-sources/:id/fetch
 * 手动触发抓取
 */
router.post('/web-sources/:id/fetch', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const id = paramId(req);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const source = await webSourcesService.getWebSourceById(id, req.userId!);
    if (!source) {
      return res.status(404).json({ error: 'Web source not found' });
    }

    // Trigger fetch via scheduler
    const scheduler = initWebScheduler();
    const result = await scheduler.fetchSourceNow(id);

    res.json(result);
  } catch (error) {
    log.error({ error, id: req.params.id }, 'Failed to fetch web source');
    res.status(500).json({ error: 'Failed to fetch web source' });
  }
});

export default router;
