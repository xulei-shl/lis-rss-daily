import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import { logger } from '../../logger.js';
import {
  listSystemPrompts,
  getSystemPromptById,
  createSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
} from '../system-prompts.js';

const log = logger.child({ module: 'api-routes/system-prompts' });
const router = express.Router();

/**
 * GET /api/system-prompts
 * 获取系统提示词列表
 */
router.get('/system-prompts', requireAuth, async (req: AuthRequest, res) => {
  try {
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const isActive =
      typeof req.query.isActive === 'string'
        ? req.query.isActive === 'true'
        : undefined;

    const prompts = await listSystemPrompts(req.userId!, { type, isActive });
    res.json({ prompts });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to list system prompts');
    res.status(500).json({ error: 'Failed to list system prompts' });
  }
});

/**
 * GET /api/system-prompts/:id
 * 获取单条系统提示词
 */
router.get('/system-prompts/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid system prompt ID' });
    }

    const prompt = await getSystemPromptById(id, req.userId!);
    if (!prompt) {
      return res.status(404).json({ error: 'System prompt not found' });
    }
    res.json(prompt);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get system prompt');
    res.status(500).json({ error: 'Failed to get system prompt' });
  }
});

/**
 * POST /api/system-prompts
 * 创建系统提示词
 */
router.post('/system-prompts', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { type, name, template, variables, isActive } = req.body || {};
    const isActiveValue =
      typeof isActive === 'boolean'
        ? isActive
        : typeof isActive === 'string'
          ? isActive === 'true'
          : undefined;

    if (!type || typeof type !== 'string' || type.trim().length === 0) {
      return res.status(400).json({ error: 'type 不能为空' });
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name 不能为空' });
    }
    if (!template || typeof template !== 'string' || template.trim().length === 0) {
      return res.status(400).json({ error: 'template 不能为空' });
    }

    const result = await createSystemPrompt(req.userId!, {
      type,
      name,
      template,
      variables,
      isActive: isActiveValue,
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create system prompt';
    log.error({ error, userId: req.userId }, 'Failed to create system prompt');
    res.status(400).json({ error: message });
  }
});

/**
 * PUT /api/system-prompts/:id
 * 更新系统提示词
 */
router.put('/system-prompts/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid system prompt ID' });
    }

    const { type, name, template, variables, isActive } = req.body || {};
    const isActiveValue =
      typeof isActive === 'boolean'
        ? isActive
        : typeof isActive === 'string'
          ? isActive === 'true'
          : undefined;

    await updateSystemPrompt(id, req.userId!, {
      type,
      name,
      template,
      variables,
      isActive: isActiveValue,
    });

    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update system prompt';
    log.error({ error, userId: req.userId }, 'Failed to update system prompt');
    if (message === 'System prompt not found') {
      return res.status(404).json({ error: message });
    }
    res.status(400).json({ error: message });
  }
});

/**
 * DELETE /api/system-prompts/:id
 * 删除系统提示词
 */
router.delete('/system-prompts/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid system prompt ID' });
    }
    await deleteSystemPrompt(id, req.userId!);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete system prompt';
    log.error({ error, userId: req.userId }, 'Failed to delete system prompt');
    if (message === 'System prompt not found') {
      return res.status(404).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

export default router;
