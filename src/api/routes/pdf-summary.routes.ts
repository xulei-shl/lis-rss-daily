import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { getArticleById } from '../../api/articles.js';
import { getTelegramNotifier } from '../../telegram/index.js';
import { getWeChatNotifier } from '../../wechat/index.js';

const router = express.Router();

const PDF_API_URL = process.env.PDF_SUMMARY_API_URL || 'http://localhost:8081';

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
        success: false,
      };

      try {
        await Promise.all([
          getTelegramNotifier().sendPdfSummary(userId, notifyData),
          getWeChatNotifier().sendPdfSummary(userId, notifyData),
        ]);
      } catch (notifyError) {
        console.error('Failed to send PDF summary failure notification:', notifyError);
      }
    }

    res.json(result);
  } catch (error) {
    console.error('PDF summary proxy error:', error);
    res.status(500).json({ error: 'Failed to call PDF summary service' });
  }
});

export default router;
