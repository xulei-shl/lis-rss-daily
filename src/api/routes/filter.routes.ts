import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth, requireWriteAccess } from '../../middleware/auth.js';
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
router.post('/filter/article', requireAuth, requireWriteAccess, async (req: AuthRequest, res) => {
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
