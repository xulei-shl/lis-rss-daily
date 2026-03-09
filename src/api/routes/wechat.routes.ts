import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import {
  getWeChatWebhooks,
  getWeChatWebhookById,
  addWeChatWebhook,
  updateWeChatWebhook,
  deleteWeChatWebhook,
  isValidWeChatWebhookUrl,
  type WeChatPushTypes,
} from '../../config/wechat-config.js';
import { getWeChatNotifier } from '../../wechat/index.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'api-routes/wechat' });

const router = express.Router();

/**
 * GET /api/wechat/webhooks
 * 获取所有企业微信 Webhooks
 */
router.get('/wechat/webhooks', requireAuth, async (req: AuthRequest, res) => {
  try {
    const webhooks = getWeChatWebhooks();
    res.json(webhooks);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get WeChat webhooks');
    res.status(500).json({ error: 'Failed to get WeChat webhooks' });
  }
});

/**
 * POST /api/wechat/webhooks
 * 添加新的企业微信 Webhook
 */
router.post('/wechat/webhooks', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { name, url, enabled, push_types } = req.body || {};

    // 验证 name
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: '名称不能为空' });
    }

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      return res.status(400).json({ error: '名称不能为空' });
    }

    // 验证 url
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Webhook URL 不能为空' });
    }

    const trimmedUrl = url.trim();
    if (!isValidWeChatWebhookUrl(trimmedUrl)) {
      return res.status(400).json({
        error: 'Webhook URL 格式不正确，必须是企业微信 webhook 地址',
      });
    }

    // 构建 push_types
    const pushTypes: WeChatPushTypes = {
      daily_summary: push_types?.daily_summary !== false,
      journal_all: push_types?.journal_all !== false,
      new_articles: push_types?.new_articles !== false,
    };

    const webhook = addWeChatWebhook({
      name: trimmedName,
      url: trimmedUrl,
      enabled: enabled !== false,
      push_types: pushTypes,
    });

    res.status(201).json(webhook);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to add WeChat webhook');
    res.status(500).json({ error: 'Failed to add WeChat webhook' });
  }
});

/**
 * PUT /api/wechat/webhooks/:id
 * 更新企业微信 Webhook
 */
router.put('/wechat/webhooks/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: '无效的 ID' });
    }

    // 检查是否存在
    const existing = getWeChatWebhookById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Webhook 不存在' });
    }

    const { name, url, enabled, push_types } = req.body || {};

    // 验证和清理输入
    const updates: Record<string, any> = {};

    if (name !== undefined) {
      const trimmedName = (name || '').toString().trim();
      if (trimmedName.length === 0) {
        return res.status(400).json({ error: '名称不能为空' });
      }
      updates.name = trimmedName;
    }

    if (url !== undefined) {
      const trimmedUrl = (url || '').toString().trim();
      if (!isValidWeChatWebhookUrl(trimmedUrl)) {
        return res.status(400).json({
          error: 'Webhook URL 格式不正确，必须是企业微信 webhook 地址',
        });
      }
      updates.url = trimmedUrl;
    }

    if (enabled !== undefined) {
      updates.enabled = !!enabled;
    }

    if (push_types !== undefined) {
      updates.push_types = {
        daily_summary: push_types.daily_summary !== false,
        journal_all: push_types.journal_all !== false,
        new_articles: push_types.new_articles !== false,
      };
    }

    const webhook = updateWeChatWebhook(id, updates);
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook 不存在' });
    }

    res.json(webhook);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to update WeChat webhook');
    res.status(500).json({ error: 'Failed to update WeChat webhook' });
  }
});

/**
 * DELETE /api/wechat/webhooks/:id
 * 删除企业微信 Webhook
 */
router.delete('/wechat/webhooks/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: '无效的 ID' });
    }

    const deleted = deleteWeChatWebhook(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Webhook 不存在' });
    }

    res.json({ success: true });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to delete WeChat webhook');
    res.status(500).json({ error: 'Failed to delete WeChat webhook' });
  }
});

/**
 * POST /api/wechat/webhooks/:id/test
 * 测试企业微信 Webhook
 */
router.post('/wechat/webhooks/:id/test', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: '无效的 ID' });
    }

    const notifier = getWeChatNotifier();
    const result = await notifier.testWebhook(id);

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to test WeChat webhook');
    res.status(500).json({ error: 'Failed to test WeChat webhook' });
  }
});

export default router;
