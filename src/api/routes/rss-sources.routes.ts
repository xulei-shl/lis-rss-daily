import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import * as rssSourceService from '../rss-sources.js';
import { getRSSParser } from '../../rss-parser.js';
import { initRSSScheduler } from '../../rss-scheduler.js';
import { logger } from '../../logger.js';
import { VALID_SOURCE_TYPES } from '../../constants/source-types.js';

const log = logger.child({ module: 'api-routes/rss-sources' });

const router = express.Router();

// ============================================================================
// RSS Sources Routes
// ============================================================================

/**
 * GET /api/rss-sources
 * Get user's RSS sources (paginated)
 */
router.get('/rss-sources', requireAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as 'active' | 'inactive' | undefined;

    const result = await rssSourceService.getUserRSSSources(req.userId!, {
      page,
      limit,
      status,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get RSS sources');
    res.status(500).json({ error: 'Failed to get RSS sources' });
  }
});

/**
 * GET /api/rss-sources/:id
 * Get single RSS source by ID
 */
router.get('/rss-sources/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (Array.isArray(idParam)) {
      return res.status(400).json({ error: 'Invalid RSS source ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid RSS source ID' });
    }

    const source = await rssSourceService.getRSSSourceById(id, req.userId!);

    if (!source) {
      return res.status(404).json({ error: 'RSS source not found' });
    }

    res.json(source);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get RSS source');
    res.status(500).json({ error: 'Failed to get RSS source' });
  }
});

/**
 * POST /api/rss-sources
 * Create a new RSS source
 */
router.post('/rss-sources', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { name, url, sourceType, fetchInterval, status } = req.body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return res.status(400).json({ error: 'URL is required' });
    }

    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    if (sourceType !== undefined && !VALID_SOURCE_TYPES.includes(sourceType)) {
      return res.status(400).json({ error: 'Source type must be journal, blog, or news' });
    }

    // Check if URL already exists
    const exists = await rssSourceService.checkURLExists(req.userId!, url.trim());
    if (exists) {
      return res.status(400).json({ error: 'URL already exists' });
    }

    const result = await rssSourceService.createRSSSource(req.userId!, {
      name: name.trim(),
      url: url.trim(),
      sourceType,
      fetchInterval: fetchInterval ? parseInt(fetchInterval) : undefined,
      status,
    });

    res.status(201).json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to create RSS source');
    res.status(500).json({ error: 'Failed to create RSS source' });
  }
});

/**
 * PUT /api/rss-sources/:id
 * Update RSS source
 */
router.put('/rss-sources/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (Array.isArray(idParam)) {
      return res.status(400).json({ error: 'Invalid RSS source ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid RSS source ID' });
    }

    const { name, url, sourceType, fetchInterval, status } = req.body;

    // Debug logging
    log.info({ id, sourceType, bodyKeys: Object.keys(req.body) }, 'RSS source update request');

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Name cannot be empty' });
      }
      updateData.name = name.trim();
    }

    if (url !== undefined) {
      if (typeof url !== 'string' || url.trim().length === 0) {
        return res.status(400).json({ error: 'URL cannot be empty' });
      }
      try {
        new URL(url);
      } catch {
        return res.status(400).json({ error: 'Invalid URL format' });
      }

      // Check if new URL already exists (excluding current source)
      const exists = await rssSourceService.checkURLExists(req.userId!, url.trim(), id);
      if (exists) {
        return res.status(400).json({ error: 'URL already exists' });
      }

      updateData.url = url.trim();
    }

    if (sourceType !== undefined) {
      if (!['journal', 'blog', 'news'].includes(sourceType)) {
        return res.status(400).json({ error: 'Source type must be journal, blog, or news' });
      }
      updateData.sourceType = sourceType;
    }

    if (fetchInterval !== undefined) {
      const interval = parseInt(fetchInterval);
      if (isNaN(interval) || interval < 60) {
        return res.status(400).json({ error: 'Fetch interval must be at least 60 seconds' });
      }
      updateData.fetchInterval = interval;
    }

    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        return res.status(400).json({ error: 'Status must be "active" or "inactive"' });
      }
      updateData.status = status;
    }

    log.info({ id, updateData }, 'About to update RSS source');

    await rssSourceService.updateRSSSource(id, req.userId!, updateData);

    log.info({ id }, 'RSS source updated successfully');

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'RSS source not found') {
      return res.status(404).json({ error: 'RSS source not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to update RSS source');
    res.status(500).json({ error: 'Failed to update RSS source' });
  }
});

/**
 * DELETE /api/rss-sources/:id
 * Delete RSS source
 */
router.delete('/rss-sources/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (Array.isArray(idParam)) {
      return res.status(400).json({ error: 'Invalid RSS source ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid RSS source ID' });
    }

    await rssSourceService.deleteRSSSource(id, req.userId!);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'RSS source not found') {
      return res.status(404).json({ error: 'RSS source not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to delete RSS source');
    res.status(500).json({ error: 'Failed to delete RSS source' });
  }
});

/**
 * POST /api/rss-sources/:id/fetch
 * Trigger immediate fetch of RSS source
 */
router.post('/rss-sources/:id/fetch', requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (Array.isArray(idParam)) {
      return res.status(400).json({ error: 'Invalid RSS source ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid RSS source ID' });
    }

    const scheduler = initRSSScheduler();
    const result = await scheduler.fetchSourceNow(id, req.userId!);

    res.json({
      success: result.success,
      articlesCount: result.articlesCount,
      newArticlesCount: result.newArticlesCount,
      error: result.error,
      duration: result.duration,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'RSS source not found') {
      return res.status(404).json({ error: 'RSS source not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to fetch RSS source');
    res.status(500).json({ error: 'Failed to fetch RSS source' });
  }
});

/**
 * POST /api/rss-sources/validate
 * Validate RSS source URL
 */
router.post('/rss-sources/validate', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const trimmedUrl = url.trim();

    try {
      new URL(trimmedUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const parser = getRSSParser();
    const result = await parser.validateSource(trimmedUrl);

    if (result.valid) {
      res.json({
        valid: true,
        feedTitle: result.feedTitle,
        itemCount: result.itemCount,
      });
    } else {
      res.json({
        valid: false,
        error: result.error,
      });
    }
  } catch (error) {
    log.error({ error }, 'Failed to validate RSS source');
    res.status(500).json({ error: 'Failed to validate RSS source' });
  }
});

export default router;
