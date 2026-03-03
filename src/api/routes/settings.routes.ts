import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { getChromaSettings, updateChromaSettings, getTelegramSettings, updateTelegramSettings } from '../settings.js';
import { getTelegramNotifier } from '../../telegram/index.js';
import { getTelegramChats, hasTelegramChats } from '../telegram-chats.js';
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
router.put('/settings/chroma', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
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

/**
 * Helper to mask sensitive Telegram settings
 * Returns masked values with a `masked` flag to indicate the state
 */
function maskTelegramSettings(settings: any, hasChats: boolean) {
  // Mask bot token for security (show first 4 and last 4 characters if possible)
  let maskedBotToken = '';
  if (settings.botToken) {
    const tokenParts = settings.botToken.split(':');
    if (tokenParts.length > 1) {
      maskedBotToken = `${tokenParts[0].substring(0, 4)}***:${tokenParts[1].substring(0, 4)}***`;
    } else {
      maskedBotToken = settings.botToken.substring(0, 4) + '***';
    }
  }

  return {
    enabled: settings.enabled,
    botToken: maskedBotToken,
    hasChats,
    // Explicit flag to indicate if credentials are configured (masked)
    hasCredentials: !!settings.botToken,
  };
}

/**
 * GET /api/settings/telegram
 * 获取 Telegram 配置（bot token 部分遮蔽显示）
 */
router.get('/settings/telegram', requireAuth, async (req: AuthRequest, res) => {
  try {
    const settings = await getTelegramSettings(req.userId!);
    const hasChats = await hasTelegramChats(req.userId!);
    res.json(maskTelegramSettings(settings, hasChats));
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get Telegram settings');
    res.status(500).json({ error: 'Failed to get Telegram settings' });
  }
});

/**
 * PUT /api/settings/telegram
 * 更新 Telegram 配置（仅全局配置，chat 配置通过 /api/telegram-chats 管理）
 */
router.put('/settings/telegram', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { enabled, botToken } = req.body || {};

    // Validate botToken format (should be "数字:字符串" format from BotFather)
    if (botToken !== undefined) {
      const trimmedToken = botToken?.trim() || '';
      if (trimmedToken && !trimmedToken.includes(':')) {
        return res.status(400).json({ error: 'Bot Token 格式不正确（应为 BotFather 提供的 token）' });
      }
    }

    await updateTelegramSettings(req.userId!, {
      enabled: enabled !== undefined ? Boolean(enabled) : undefined,
      botToken: botToken?.trim(),
    });

    // 获取更新后的完整配置并返回（脱敏处理）
    const updatedSettings = await getTelegramSettings(req.userId!);
    const hasChats = await hasTelegramChats(req.userId!);
    res.json(maskTelegramSettings(updatedSettings, hasChats));
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to update Telegram settings');
    res.status(500).json({ error: 'Failed to update Telegram settings' });
  }
});

/**
 * POST /api/settings/telegram/test
 * 测试 Telegram 连接
 */
router.post('/settings/telegram/test', requireAuth, async (req: AuthRequest, res) => {
  try {
    const notifier = getTelegramNotifier();
    const result = await notifier.testConnection(req.userId!);
    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to test Telegram connection');
    res.status(500).json({ success: false, message: '连接测试失败' });
  }
});

export default router;
