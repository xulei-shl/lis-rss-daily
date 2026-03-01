import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { getChromaSettings, updateChromaSettings, getTelegramSettings, updateTelegramSettings } from '../settings.js';
import { getTelegramNotifier } from '../../telegram/index.js';
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
 */
function maskTelegramSettings(settings: any) {
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

  // Mask chat ID for security (show first 3 and last 3 characters if possible)
  let maskedChatId = '';
  if (settings.chatId) {
    const chatIdStr = String(settings.chatId);
    if (chatIdStr.length > 6) {
      maskedChatId = chatIdStr.substring(0, 3) + '***' + chatIdStr.substring(chatIdStr.length - 3);
    } else {
      maskedChatId = '***';
    }
  }

  return {
    enabled: settings.enabled,
    botToken: maskedBotToken,
    chatId: maskedChatId,
    dailySummary: settings.dailySummary,
    newArticles: settings.newArticles,
  };
}

/**
 * GET /api/settings/telegram
 * 获取 Telegram 配置（bot token 部分遮蔽显示）
 */
router.get('/settings/telegram', requireAuth, async (req: AuthRequest, res) => {
  try {
    const settings = await getTelegramSettings(req.userId!);
    res.json(maskTelegramSettings(settings));
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get Telegram settings');
    res.status(500).json({ error: 'Failed to get Telegram settings' });
  }
});

/**
 * PUT /api/settings/telegram
 * 更新 Telegram 配置
 */
router.put('/settings/telegram', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { enabled, botToken, chatId, dailySummary, newArticles } = req.body || {};

    // Validate botToken format (should be "数字:字符串" format from BotFather)
    if (botToken !== undefined) {
      const trimmedToken = botToken?.trim() || '';
      if (trimmedToken && !trimmedToken.includes(':')) {
        return res.status(400).json({ error: 'Bot Token 格式不正确（应为 BotFather 提供的 token）' });
      }
    }

    // Validate chatId (should be a number for private chat or group username)
    if (chatId !== undefined && chatId !== '') {
      const trimmedChatId = chatId?.trim() || '';
      // Chat ID can be a number (or negative number for groups/supergroups)
      // or a username like @channelname
      if (trimmedChatId && !/^-?\d+$/.test(trimmedChatId) && !trimmedChatId.startsWith('@')) {
        return res.status(400).json({ error: 'Chat ID 格式不正确（应为数字或 @开头的用户名）' });
      }
    }

    await updateTelegramSettings(req.userId!, {
      enabled: enabled !== undefined ? Boolean(enabled) : undefined,
      botToken: botToken?.trim(),
      chatId: chatId?.trim(),
      dailySummary: dailySummary !== undefined ? Boolean(dailySummary) : undefined,
      newArticles: newArticles !== undefined ? Boolean(newArticles) : undefined,
    });

    // 获取更新后的完整配置并返回（脱敏处理）
    const updatedSettings = await getTelegramSettings(req.userId!);
    res.json(maskTelegramSettings(updatedSettings));
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
