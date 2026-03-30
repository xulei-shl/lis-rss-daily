import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { getArticleById } from '../../api/articles.js';
import { TelegramClient } from '../../telegram/client.js';
import { getTelegramNotifier } from '../../telegram/index.js';
import { getWeChatNotifier } from '../../wechat/index.js';

const router = express.Router();

const PDF_API_URL = process.env.PDF_SUMMARY_API_URL || 'http://localhost:8081';

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

    const article = typeof id === 'number' ? await getArticleById(id, userId) : undefined;
    const sourceName =
      article?.source_name ||
      article?.rss_source_name ||
      article?.journal_name ||
      article?.keyword_name ||
      'PDF 全文总结';
    const articleId = typeof id === 'number' ? id : undefined;

    if (result.success) {
      const summaryContent = article?.ai_summary || '';

      const notifyData = {
        articleId,
        title,
        sourceName,
        summary: summaryContent,
        success: true,
      };

      try {
        await Promise.all([
          getTelegramNotifier().sendPdfSummary(userId, notifyData),
          getWeChatNotifier().sendPdfSummary(userId, notifyData),
        ]);
      } catch (notifyError) {
        console.error('Failed to send PDF summary notification:', notifyError);
      }
    } else {
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

export default router;
