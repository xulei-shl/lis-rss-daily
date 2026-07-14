/**
 * 企业微信通知模块
 *
 * 企业微信通知的主入口。
 * 提供单例 WeChatNotifier 类用于发送通知。
 * 支持多个 webhook，每个 webhook 可独立配置推送类型。
 */

import { logger } from '../logger.js';
import { WeChatClient } from './client.js';
import {
  formatDailySummary,
  formatJournalAllSummary,
  formatNewArticle,
  formatPdfSummary,
  formatTestMessage,
  type WeChatDailySummaryData,
  type JournalAllSummaryData,
  type NewArticleData,
  type PdfSummaryData,
} from './formatters.js';
import {
  getWebhooksForDailySummaryType,
  getWebhooksForPushType,
  getWeChatWebhooks,
  getWeChatWebhookById,
  type WeChatPushTypes,
  type WeChatWebhook,
} from '../config/wechat-config.js';
import type { SummaryType, DailySummaryArticle } from '../api/daily-summary.js';

const log = logger.child({ module: 'wechat-notifier' });

/**
 * 企业微信通知器
 *
 * 单例类用于发送企业微信通知。
 */
class WeChatNotifier {
  private sentCache = new Map<string, number>();
  private readonly CACHE_TTL = 60000; // 60秒

  private getCacheKey(userId: number, type: string, date: string): string {
    return `${userId}:${type}:${date}`;
  }

  private checkAndSetCache(key: string): boolean {
    const now = Date.now();
    const lastSent = this.sentCache.get(key);
    if (lastSent && now - lastSent < this.CACHE_TTL) {
      return true;
    }
    this.sentCache.set(key, now);
    if (this.sentCache.size > 100) {
      const oldestKey = this.sentCache.keys().next().value;
      if (oldestKey) {
        this.sentCache.delete(oldestKey);
      }
    }
    return false;
  }

  /**
   * 发送每日总结通知到所有配置了该类型的 webhook
   */
  async sendDailySummary(userId: number, data: WeChatDailySummaryData): Promise<boolean> {
    const cacheKey = this.getCacheKey(userId, data.type, data.date);
    if (this.checkAndSetCache(cacheKey)) {
      log.info({ userId, type: data.type, date: data.date }, '[DEBUG] Skipping duplicate sendDailySummary');
      return false;
    }
    if (data.type !== 'journal' && data.type !== 'blog_news' && data.type !== 'all') {
      log.debug({ userId, type: data.type }, 'Unsupported daily summary type for WeChat push');
      return false;
    }

    const webhooks = getWebhooksForDailySummaryType(data.type);
    if (webhooks.length === 0) return false;

    const message = formatDailySummary(data);
    return this.sendToWebhooks(webhooks, message, {
      logLabel: 'Daily summary',
      logContext: { userId, date: data.date, type: data.type, articleCount: data.totalArticles },
    });
  }

  /**
   * 通用发送方法：按推送类型获取 webhook → 格式化 → 发送
   *
   * 提取自 send* 方法的公共模式（cache check + webhook lookup + format + sendToWebhooks）。
   */
  private async sendByPushType(
    pushType: keyof WeChatPushTypes,
    userId: number,
    formatFn: (data: any) => string,
    data: any,
    options: {
      logLabel: string;
      logContext: Record<string, any>;
      cacheKey?: string;
    }
  ): Promise<boolean> {
    const { logLabel, logContext, cacheKey } = options;
    if (cacheKey) {
      if (this.checkAndSetCache(cacheKey)) {
        log.info({ userId, ...logContext }, `[DEBUG] Skipping duplicate ${logLabel}`);
        return false;
      }
    }
    const webhooks = getWebhooksForPushType(pushType);
    if (webhooks.length === 0) return false;

    const message = formatFn(data);
    return this.sendToWebhooks(webhooks, message, { logLabel, logContext });
  }

  /**
   * 发送全部期刊总结通知到所有配置了该类型的 webhook
   */
  async sendJournalAllSummary(
    userId: number,
    data: {
      date: string;
      totalArticles: number;
      summary: string;
      articles: DailySummaryArticle[];
    }
  ): Promise<boolean> {
    return this.sendByPushType('journal_all', userId, formatJournalAllSummary, data, {
      logLabel: 'Journal all summary',
      logContext: { userId, date: data.date, articleCount: data.totalArticles },
      cacheKey: this.getCacheKey(userId, 'journal_all', data.date),
    });
  }

  /**
   * 发送洞察总结通知到所有配置了该类型的 webhook
   */
  async sendInsightsSummary(
    userId: number,
    data: {
      date: string;
      type: 'insights';
      totalArticles: number;
      summary: string;
      articlesByType: { journal: number; blog: number; news: number; email: number };
    }
  ): Promise<boolean> {
    return this.sendByPushType('insights', userId, formatDailySummary, data, {
      logLabel: 'Insights summary',
      logContext: { userId, date: data.date, type: data.type, articleCount: data.totalArticles },
      cacheKey: this.getCacheKey(userId, 'insights', data.date),
    });
  }

  /**
   * 发送新增文章通知到所有配置了该类型的 webhook
   */
  async sendNewArticle(
    userId: number,
    article: NewArticleData
  ): Promise<boolean> {
    return this.sendByPushType('new_articles', userId, formatNewArticle, article, {
      logLabel: 'New article',
      logContext: { userId, articleId: article.id, title: article.title },
    });
  }

  /**
   * 发送 PDF 全文总结通知到所有配置了该类型的 webhook
   */
  async sendPdfSummary(userId: number, data: PdfSummaryData): Promise<boolean> {
    return this.sendByPushType('pdf_summary', userId, formatPdfSummary, data, {
      logLabel: 'PDF summary',
      logContext: { userId, articleId: data.articleId, title: data.title },
    });
  }

  /**
   * 发送格式化的 Markdown 消息到多个 webhook。
   * 提取自 send* 方法的公共发送循环模式。
   */
  private async sendToWebhooks(
    webhooks: WeChatWebhook[],
    message: string,
    options?: {
      logLabel?: string;
      logContext?: Record<string, any>;
    }
  ): Promise<boolean> {
    let successCount = 0;
    let failCount = 0;

    for (const webhook of webhooks) {
      try {
        const client = new WeChatClient(webhook.url);
        const success = await client.sendMarkdown(message);

        if (success) {
          successCount++;
          log.info({
            webhookId: webhook.id,
            webhookName: webhook.name,
            ...options?.logContext,
          }, `${options?.logLabel || 'Message'} sent to WeChat`);
        } else {
          failCount++;
          log.warn({
            webhookId: webhook.id,
            webhookName: webhook.name,
            ...options?.logContext,
          }, `Failed to send ${options?.logLabel || 'message'} to WeChat`);
        }
      } catch (error) {
        failCount++;
        log.error({
          webhookId: webhook.id,
          webhookName: webhook.name,
          error: error instanceof Error ? error.message : String(error),
          ...options?.logContext,
        }, `Failed to send ${options?.logLabel || 'message'} to WeChat`);
      }
    }

    return successCount > 0;
  }

  /**
   * 测试指定 webhook 连接
   */
  async testWebhook(webhookId: string): Promise<{ success: boolean; message: string }> {
    const webhook = getWeChatWebhookById(webhookId);

    if (!webhook) {
      return {
        success: false,
        message: 'Webhook 未找到',
      };
    }

    try {
      const client = new WeChatClient(webhook.url);
      const message = formatTestMessage();
      const success = await client.sendMarkdown(message);

      if (success) {
        log.info({ webhookId, name: webhook.name }, 'WeChat webhook test successful');
        return {
          success: true,
          message: '连接测试成功！测试消息已发送。',
        };
      } else {
        return {
          success: false,
          message: '连接测试失败。请检查 Webhook URL 是否正确。',
        };
      }
    } catch (error) {
      log.error(
        { webhookId, name: webhook.name, error },
        'WeChat webhook test failed'
      );
      return {
        success: false,
        message: `连接测试失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 获取所有 webhooks（用于显示）
   */
  getWebhooks(): WeChatWebhook[] {
    return getWeChatWebhooks();
  }

  /**
   * 检查是否有配置的 webhook
   */
  hasAnyWebhooks(): boolean {
    return getWeChatWebhooks().length > 0;
  }
}

// 单例实例
let _instance: WeChatNotifier | null = null;

/**
 * 获取企业微信通知器实例
 */
export function getWeChatNotifier(): WeChatNotifier {
  if (!_instance) {
    _instance = new WeChatNotifier();
  }
  return _instance;
}
