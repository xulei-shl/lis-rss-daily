import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { getTelegramNotifier } from '../../telegram/index.js';
import type { ArticleWithSource } from '../../api/articles.js';

const router = express.Router();

const PDF_API_URL = process.env.PDF_SUMMARY_API_URL || 'http://localhost:8081';

router.post('/pdf-summary', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const { title, id, push_wechat } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  try {
    const response = await fetch(`${PDF_API_URL}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, id, push_wechat })
    });

    const result = await response.json();

    // PDF 总结失败时发送 Telegram 通知
    if (!result.success && result.reason && req.userId) {
      const telegramNotifier = getTelegramNotifier();
      try {
        // 构建通知数据（使用类型断言绕过严格的类型检查）
        const notifyData = {
          id: id || 0,
          title: title,
          url: '',
          source_name: 'PDF全文总结失败',
          source_origin: 'keyword' as const,
          summary: `❌ ${result.reason}`,
          filter_status: 'passed' as const,
          process_status: 'completed' as const,
          is_read: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          rss_source_id: null,
          journal_id: null,
          keyword_id: null,
          ai_summary: null,
          content: null,
          markdown_content: null,
          error_message: null,
          rating: null,
          published_at: null
        } as ArticleWithSource;
        await telegramNotifier.sendNewArticle(req.userId, notifyData);
      } catch (telegramError) {
        console.error('Failed to send Telegram notification:', telegramError);
      }
    }

    // PDF 总结成功时发送 Telegram 通知
    if (result.success && req.userId) {
      const telegramNotifier = getTelegramNotifier();
      try {
        const notifyData = {
          id: id || 0,
          title: title,
          url: '',
          source_name: 'PDF全文总结成功',
          source_origin: 'keyword' as const,
          summary: `✅ PDF 全文总结已生成`,
          filter_status: 'passed' as const,
          process_status: 'completed' as const,
          is_read: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          rss_source_id: null,
          journal_id: null,
          keyword_id: null,
          ai_summary: null,
          content: null,
          markdown_content: null,
          error_message: null,
          rating: null,
          published_at: null
        } as ArticleWithSource;
        await telegramNotifier.sendNewArticle(req.userId, notifyData);
      } catch (telegramError) {
        console.error('Failed to send Telegram notification:', telegramError);
      }
    }

    res.json(result);
  } catch (error) {
    console.error('PDF summary proxy error:', error);
    res.status(500).json({ error: 'Failed to call PDF summary service' });
  }
});

export default router;
