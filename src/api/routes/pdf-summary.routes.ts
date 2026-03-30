import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth, requireAdmin, requireCliAuth } from '../../middleware/auth.js';
import { getArticleById } from '../../api/articles.js';
import { TelegramClient } from '../../telegram/client.js';
import { getTelegramNotifier } from '../../telegram/index.js';
import { getWeChatNotifier } from '../../wechat/index.js';
import type { PdfSummaryNotificationData } from '../../telegram/types.js';

const router = express.Router();

const PDF_API_URL = process.env.PDF_SUMMARY_API_URL || 'http://localhost:8081';
const DEFAULT_SOURCE_NAME = 'PDF 全文总结';

interface PdfSummaryNotifyPayload {
  articleId?: number;
  title?: string;
  sourceName?: string;
  summary?: string;
  success?: boolean;
  reason?: string;
}

function normalizeNotifyPayload(body: any): PdfSummaryNotifyPayload {
  const articleId = typeof body?.articleId === 'number'
    ? body.articleId
    : typeof body?.id === 'number'
      ? body.id
      : undefined;

  return {
    articleId,
    title: typeof body?.title === 'string' ? body.title.trim() : undefined,
    sourceName: typeof body?.sourceName === 'string' ? body.sourceName.trim() : undefined,
    summary: typeof body?.summary === 'string' ? body.summary : undefined,
    success: body?.success !== false,
    reason: typeof body?.reason === 'string' ? body.reason.trim() : undefined,
  };
}

async function buildPdfSummaryNotifyData(
  userId: number,
  payload: PdfSummaryNotifyPayload
): Promise<PdfSummaryNotificationData> {
  const article = payload.articleId !== undefined
    ? await getArticleById(payload.articleId, userId)
    : undefined;

  const title = payload.title || article?.title;
  if (!title) {
    throw new Error('Title is required');
  }

  const sourceName =
    payload.sourceName ||
    article?.source_name ||
    article?.rss_source_name ||
    article?.journal_name ||
    article?.keyword_name ||
    DEFAULT_SOURCE_NAME;

  const summary = payload.summary ?? article?.ai_summary ?? '';

  return {
    articleId: payload.articleId,
    title,
    sourceName,
    summary,
    success: payload.success !== false,
    reason: payload.reason,
  };
}

async function dispatchPdfSummaryNotification(userId: number, data: PdfSummaryNotificationData) {
  const [telegram, wechat] = await Promise.all([
    getTelegramNotifier().sendPdfSummary(userId, data),
    getWeChatNotifier().sendPdfSummary(userId, data),
  ]);

  return {
    telegram,
    wechat,
    notified: telegram || wechat,
  };
}

function formatAdminFailureMessage(data: {
  articleId?: number;
  title: string;
  sourceName: string;
  reason: string;
}): string {
  const lines: string[] = ['❌ PDF 全文总结失败', ''];

  if (data.articleId !== undefined) {
    lines.push(`ID: ${data.articleId}`);
  }

  lines.push(`来源: ${data.sourceName}`);
  lines.push(`标题: ${data.title}`);
  lines.push('');
  lines.push(`失败原因: ${data.reason}`);

  return lines.join('\n');
}

async function sendAdminFailureMessage(data: {
  articleId?: number;
  title: string;
  sourceName: string;
  reason: string;
}): Promise<boolean> {
  const botToken =
    process.env.PDF_SUMMARY_ADMIN_TELEGRAM_BOT_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN;
  const chatId =
    process.env.PDF_SUMMARY_ADMIN_TELEGRAM_CHAT_ID ||
    process.env.TELEGRAM_USER_ID;

  if (!botToken || !chatId) {
    console.warn('PDF summary admin Telegram bot is not configured');
    return false;
  }

  try {
    const client = new TelegramClient(botToken);
    const result = await client.sendMessage(chatId, formatAdminFailureMessage(data));
    return result.ok;
  } catch (error) {
    console.error('Failed to send PDF summary failure to admin Telegram bot:', error);
    return false;
  }
}

router.post('/pdf-summary', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const { title, id } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  try {
    const response = await fetch(`${PDF_API_URL}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, id, push_wechat: false })
    });

    const result = await response.json();
    const userId = req.userId;

    if (!userId) {
      return res.json(result);
    }

    if (result.success) {
      try {
        const notifyData = await buildPdfSummaryNotifyData(userId, {
          articleId: typeof id === 'number' ? id : undefined,
          title,
          success: true,
        });
        await dispatchPdfSummaryNotification(userId, notifyData);
      } catch (notifyError) {
        console.error('Failed to send PDF summary notification:', notifyError);
      }
    } else {
      const article = typeof id === 'number' ? await getArticleById(id, userId) : undefined;
      const sourceName =
        article?.source_name ||
        article?.rss_source_name ||
        article?.journal_name ||
        article?.keyword_name ||
        DEFAULT_SOURCE_NAME;
      const articleId = typeof id === 'number' ? id : undefined;
      const notifyData = {
        articleId,
        title,
        sourceName,
        reason: result.reason || '未知错误',
      };

      await sendAdminFailureMessage(notifyData);
    }

    res.json(result);
  } catch (error) {
    console.error('PDF summary proxy error:', error);
    res.status(500).json({ error: 'Failed to call PDF summary service' });
  }
});

router.post('/pdf-summary/notify/cli', requireCliAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload = normalizeNotifyPayload(req.body);
    const notifyData = await buildPdfSummaryNotifyData(userId, payload);
    const notifyResult = await dispatchPdfSummaryNotification(userId, notifyData);

    res.json({
      success: true,
      ...notifyResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send PDF summary notification';
    console.error('PDF summary CLI notify error:', error);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;
