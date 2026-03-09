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
  formatTestMessage,
  type WeChatDailySummaryData,
  type JournalAllSummaryData,
  type NewArticleData,
} from './formatters.js';
import {
  getWebhooksForPushType,
  getWeChatWebhooks,
  getWeChatWebhookById,
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
  /**
   * 发送每日总结通知到所有配置了该类型的 webhook
   */
  async sendDailySummary(userId: number, data: WeChatDailySummaryData): Promise<boolean> {
    const webhooks = getWebhooksForPushType('daily_summary');

    if (webhooks.length === 0) {
      log.debug({ userId }, 'No WeChat webhooks configured for daily summary');
      return false;
    }

    const message = formatDailySummary(data);
    let successCount = 0;
    let failCount = 0;

    for (const webhook of webhooks) {
      try {
        const client = new WeChatClient(webhook.url);
        const success = await client.sendMarkdown(message);

        if (success) {
          successCount++;
          log.info(
            {
              userId,
              webhookId: webhook.id,
              webhookName: webhook.name,
              date: data.date,
              type: data.type,
              articleCount: data.totalArticles,
            },
            'Daily summary sent to WeChat'
          );
        } else {
          failCount++;
          log.warn(
            { userId, webhookId: webhook.id, webhookName: webhook.name },
            'Failed to send daily summary to WeChat'
          );
        }
      } catch (error) {
        failCount++;
        log.error(
          {
            userId,
            webhookId: webhook.id,
            webhookName: webhook.name,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to send daily summary to WeChat'
        );
      }
    }

    return successCount > 0;
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
    const webhooks = getWebhooksForPushType('journal_all');

    if (webhooks.length === 0) {
      log.debug({ userId }, 'No WeChat webhooks configured for journal all summary');
      return false;
    }

    const message = formatJournalAllSummary(data);
    let successCount = 0;
    let failCount = 0;

    for (const webhook of webhooks) {
      try {
        const client = new WeChatClient(webhook.url);
        const success = await client.sendMarkdown(message);

        if (success) {
          successCount++;
          log.info(
            {
              userId,
              webhookId: webhook.id,
              webhookName: webhook.name,
              date: data.date,
              articleCount: data.totalArticles,
            },
            'Journal all summary sent to WeChat'
          );
        } else {
          failCount++;
          log.warn(
            { userId, webhookId: webhook.id, webhookName: webhook.name },
            'Failed to send journal all summary to WeChat'
          );
        }
      } catch (error) {
        failCount++;
        log.error(
          {
            userId,
            webhookId: webhook.id,
            webhookName: webhook.name,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to send journal all summary to WeChat'
        );
      }
    }

    return successCount > 0;
  }

  /**
   * 发送新增文章通知到所有配置了该类型的 webhook
   */
  async sendNewArticle(
    userId: number,
    article: NewArticleData
  ): Promise<boolean> {
    const webhooks = getWebhooksForPushType('new_articles');

    if (webhooks.length === 0) {
      log.debug({ userId }, 'No WeChat webhooks configured for new articles');
      return false;
    }

    const message = formatNewArticle(article);
    let successCount = 0;
    let failCount = 0;

    for (const webhook of webhooks) {
      try {
        const client = new WeChatClient(webhook.url);
        const success = await client.sendMarkdown(message);

        if (success) {
          successCount++;
          log.info(
            {
              userId,
              webhookId: webhook.id,
              webhookName: webhook.name,
              articleId: article.id,
              title: article.title,
            },
            'New article sent to WeChat'
          );
        } else {
          failCount++;
          log.warn(
            { userId, webhookId: webhook.id, webhookName: webhook.name, articleId: article.id },
            'Failed to send new article to WeChat'
          );
        }
      } catch (error) {
        failCount++;
        log.error(
          {
            userId,
            webhookId: webhook.id,
            webhookName: webhook.name,
            articleId: article.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to send new article to WeChat'
        );
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
