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

// PDF 总结服务调用超时（毫秒）
const PDF_SUBMIT_TIMEOUT_MS = 15_000;   // 异步提交本身
const PDF_POLL_TIMEOUT_MS = 10_000;     // 单次状态轮询
const PDF_TOTAL_TIMEOUT_MS = 10 * 60_000; // 等待任务完成的总截止时间（下载+总结可能超过 5 分钟）
const PDF_POLL_INTERVAL_MS = 5_000;

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

function getArticleSourceName(article: Awaited<ReturnType<typeof getArticleById>>): string {
  return (
    article?.source_name ||
    article?.rss_source_name ||
    article?.journal_name ||
    article?.keyword_name ||
    DEFAULT_SOURCE_NAME
  );
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

async function notifyPdfSummaryFailure(
  userId: number | undefined,
  data: {
    articleId?: number;
    title: string;
    reason: string;
  }
): Promise<void> {
  if (!userId) {
    return;
  }

  const article = data.articleId !== undefined
    ? await getArticleById(data.articleId, userId)
    : undefined;

  await sendAdminFailureMessage({
    articleId: data.articleId,
    title: data.title,
    sourceName: getArticleSourceName(article),
    reason: data.reason,
  });
}

router.post('/pdf-summary', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const { title, id } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  try {
    // 异步提交（wait=false），避免长时间阻塞导致客户端/网关超时误判为失败
    const submitResponse = await fetch(`${PDF_API_URL}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, id, push_wechat: false, wait: false }),
      signal: AbortSignal.timeout(PDF_SUBMIT_TIMEOUT_MS),
    });

    if (!submitResponse.ok) {
      throw new Error(`提交失败（HTTP ${submitResponse.status}）`);
    }

    // v2.0：调度元信息（队列深度 / 在途去重）改由响应头承载，响应体只留 task_id
    const submitted = await submitResponse.json() as { task_id: string; status_url?: string };
    if (!submitted.task_id) {
      throw new Error('提交响应缺少 task_id');
    }
    if (submitResponse.headers.get('x-deduplicated') === 'true') {
      console.log(`PDF summary task ${submitted.task_id} deduplicated, reusing in-flight task`);
    }

    // 轮询任务状态直到完成，带单次轮询超时与总截止时间
    const deadline = Date.now() + PDF_TOTAL_TIMEOUT_MS;
    let result: Record<string, unknown> | null = null;
    let lastStage: string | null = null;

    while (Date.now() < deadline) {
      // include=meta：轮询阶段不搬运整篇摘要，控制响应体体积
      const statusResponse = await fetch(`${PDF_API_URL}/process/status/${submitted.task_id}?include=meta`, {
        signal: AbortSignal.timeout(PDF_POLL_TIMEOUT_MS),
      });

      if (statusResponse.status === 404) {
        throw new Error('任务状态丢失（结果已过保留期或服务重启且未落盘）');
      }
      if (!statusResponse.ok) {
        throw new Error(`查询任务状态失败（HTTP ${statusResponse.status}）`);
      }

      const status = await statusResponse.json() as {
        status: string;
        stage?: string;
        error_code?: string | null;
      };

      if (status.stage && status.stage !== lastStage) {
        lastStage = status.stage;
        console.log(`PDF summary task ${submitted.task_id} stage: ${status.stage}`);
      }

      if (status.status === 'completed' || status.status === 'failed') {
        // 终态再取一次完整结果（含摘要正文与 distribution）
        const finalResponse = await fetch(`${PDF_API_URL}/process/status/${submitted.task_id}`, {
          signal: AbortSignal.timeout(PDF_POLL_TIMEOUT_MS),
        });
        if (!finalResponse.ok) {
          throw new Error(`获取任务结果失败（HTTP ${finalResponse.status}）`);
        }
        const final = await finalResponse.json() as { result?: Record<string, unknown> | null };
        result = final.result ?? {
          success: false,
          error_code: status.error_code ?? 'internal_error',
          reason: `任务${status.status === 'failed' ? '失败' : '异常结束'}`,
        };
        break;
      }

      await new Promise(resolve => setTimeout(resolve, PDF_POLL_INTERVAL_MS));
    }

    if (!result) {
      result = { success: false, error_code: 'poll_timeout', reason: `等待 PDF 总结任务超时（${PDF_TOTAL_TIMEOUT_MS / 60000} 分钟）` };
    }

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
      await notifyPdfSummaryFailure(userId, {
        articleId: typeof id === 'number' ? id : undefined,
        title,
        reason: (result.reason as string) || '未知错误',
      });
    }

    res.json(result);
  } catch (error) {
    console.error('PDF summary proxy error:', error);
    await notifyPdfSummaryFailure(req.userId, {
      articleId: typeof id === 'number' ? id : undefined,
      title,
      reason: `请求 PDF 总结服务失败（${PDF_API_URL}/process）：${error instanceof Error ? error.message : String(error)}`,
    });
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
