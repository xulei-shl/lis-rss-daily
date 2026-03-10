import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import {
  getTelegramChats,
  getTelegramChatById,
  addTelegramChat,
  updateTelegramChat,
  deleteTelegramChat,
  type CreateTelegramChatInput,
  type UpdateTelegramChatInput,
  type TelegramChatRole,
} from '../telegram-chats.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'api-routes/telegram-chats' });

const router = express.Router();

/**
 * GET /api/telegram-chats
 * 获取所有 Telegram Chats
 */
router.get('/telegram-chats', requireAuth, async (req: AuthRequest, res) => {
  try {
    const chats = await getTelegramChats(req.userId!);
    res.json(chats);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get Telegram chats');
    res.status(500).json({ error: 'Failed to get Telegram chats' });
  }
});

/**
 * POST /api/telegram-chats
 * 添加新的 Telegram Chat
 */
router.post('/telegram-chats', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { chatId, chatName, role, dailySummary, journalAll, newArticles, isActive } = req.body || {};

    // Validate chatId
    if (!chatId || typeof chatId !== 'string') {
      return res.status(400).json({ error: 'chatId 不能为空' });
    }

    const trimmedChatId = chatId.trim();
    if (trimmedChatId.length === 0) {
      return res.status(400).json({ error: 'chatId 不能为空' });
    }

    // Validate chatId format (number or @username)
    if (!/^-?\d+$/.test(trimmedChatId) && !trimmedChatId.startsWith('@')) {
      return res.status(400).json({ error: 'Chat ID 格式不正确（应为数字或 @开头的用户名）' });
    }

    // Validate role
    if (role !== undefined && !['admin', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'role 必须是 admin 或 viewer' });
    }

    const input: CreateTelegramChatInput = {
      chatId: trimmedChatId,
      chatName,
      role: role as TelegramChatRole | undefined,
      dailySummary,
      journalAll,
      newArticles,
      isActive,
    };

    const chat = await addTelegramChat(req.userId!, input);
    res.status(201).json(chat);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to add Telegram chat');
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: '该 Chat ID 已存在' });
    }
    res.status(500).json({ error: 'Failed to add Telegram chat' });
  }
});

/**
 * PUT /api/telegram-chats/:id
 * 更新 Telegram Chat
 */
router.put('/telegram-chats/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    const id = parseInt(Array.isArray(idParam) ? idParam[0] : idParam, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的 ID' });
    }

    const { chatName, role, dailySummary, journalAll, newArticles, isActive } = req.body || {};

    // Validate role
    if (role !== undefined && !['admin', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'role 必须是 admin 或 viewer' });
    }

    const input: UpdateTelegramChatInput = {
      chatName,
      role: role as TelegramChatRole | undefined,
      dailySummary,
      journalAll,
      newArticles,
      isActive,
    };

    const chat = await updateTelegramChat(req.userId!, id, input);
    if (!chat) {
      return res.status(404).json({ error: 'Telegram Chat 不存在' });
    }

    res.json(chat);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to update Telegram chat');
    res.status(500).json({ error: 'Failed to update Telegram chat' });
  }
});

/**
 * DELETE /api/telegram-chats/:id
 * 删除 Telegram Chat
 */
router.delete('/telegram-chats/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    const id = parseInt(Array.isArray(idParam) ? idParam[0] : idParam, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的 ID' });
    }

    const deleted = await deleteTelegramChat(req.userId!, id);
    if (!deleted) {
      return res.status(404).json({ error: 'Telegram Chat 不存在' });
    }

    res.json({ success: true });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to delete Telegram chat');
    res.status(500).json({ error: 'Failed to delete Telegram chat' });
  }
});

export default router;
