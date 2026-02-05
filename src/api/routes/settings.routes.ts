import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import { getChromaSettings, updateChromaSettings } from '../settings.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'api-routes/settings' });

const router = express.Router();

/**
 * GET /api/settings/chroma
 * 获取 Chroma 配置
 */
router.get('/settings/chroma', requireAuth, async (req: AuthRequest, res) => {
  try {
    const settings = await getChromaSettings(req.userId!);
    res.json(settings);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get Chroma settings');
    res.status(500).json({ error: 'Failed to get Chroma settings' });
  }
});

/**
 * PUT /api/settings/chroma
 * 更新 Chroma 配置
 */
router.put('/settings/chroma', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { host, port, collection, distanceMetric } = req.body || {};

    if (host !== undefined && (typeof host !== 'string' || host.trim().length === 0)) {
      return res.status(400).json({ error: 'host 不能为空' });
    }

    if (port !== undefined) {
      const portNum = parseInt(port, 10);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        return res.status(400).json({ error: 'port 必须是 1-65535 的数字' });
      }
    }

    if (collection !== undefined && (typeof collection !== 'string' || collection.trim().length === 0)) {
      return res.status(400).json({ error: 'collection 不能为空' });
    }

    if (distanceMetric !== undefined && !['cosine', 'l2', 'ip'].includes(distanceMetric)) {
      return res.status(400).json({ error: 'distanceMetric 必须是 cosine、l2 或 ip' });
    }

    await updateChromaSettings(req.userId!, {
      host: host?.trim(),
      port: port !== undefined ? parseInt(port, 10) : undefined,
      collection: collection?.trim(),
      distanceMetric: distanceMetric as 'cosine' | 'l2' | 'ip' | undefined,
    });

    res.json({ success: true });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to update Chroma settings');
    res.status(500).json({ error: 'Failed to update Chroma settings' });
  }
});

export default router;
