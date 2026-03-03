/**
 * Telegram Notification Module
 *
 * Main entry point for Telegram notifications.
 * Provides singleton TelegramNotifier class for sending notifications.
 */

import { logger } from '../logger.js';
import { TelegramClient } from './client.js';
import { formatDailySummary, formatNewArticle, createArticleKeyboard } from './formatters.js';
import type { TelegramConfig, DailySummaryData } from './types.js';
import { getUserSettings } from '../api/settings.js';
import type { ArticleWithSource } from '../api/articles.js';

const log = logger.child({ module: 'telegram-notifier' });

// Settings keys for Telegram configuration
const TELEGRAM_SETTINGS_KEYS = [
  'telegram_enabled',
  'telegram_bot_token',
  'telegram_chat_id',
  'telegram_daily_summary',
  'telegram_new_articles',
] as const;

/**
 * Load Telegram configuration from database
 */
async function loadTelegramConfig(userId: number): Promise<TelegramConfig | null> {
  try {
    const settings = await getUserSettings(userId, [...TELEGRAM_SETTINGS_KEYS]);

    const enabled = settings.telegram_enabled === 'true';
    const botToken = settings.telegram_bot_token || '';
    const chatId = settings.telegram_chat_id || '';
    const dailySummary = settings.telegram_daily_summary === 'true';
    const newArticles = settings.telegram_new_articles === 'true';

    if (!enabled || !botToken || !chatId) {
      log.debug({ userId, enabled: !!enabled, hasToken: !!botToken, hasChatId: !!chatId }, 'Telegram not configured');
      return null;
    }

    return {
      enabled,
      botToken,
      chatId,
      dailySummary,
      newArticles,
    };
  } catch (error) {
    log.error({ userId, error }, 'Failed to load Telegram settings');
    return null;
  }
}

/**
 * Telegram Notifier
 *
 * Singleton class for sending Telegram notifications.
 */
class TelegramNotifier {
  /**
   * Send daily summary notification
   */
  async sendDailySummary(userId: number, data: DailySummaryData): Promise<boolean> {
    const config = await loadTelegramConfig(userId);

    if (!config) {
      log.debug({ userId }, 'Telegram not configured, skipping daily summary');
      return false;
    }

    if (!config.dailySummary) {
      log.debug({ userId }, 'Daily summary notifications disabled');
      return false;
    }

    try {
      const client = new TelegramClient(config.botToken);
      const message = formatDailySummary(data);

      const result = await client.sendMessage(config.chatId, message, 'HTML');

      if (result.ok) {
        log.info({
          userId,
          date: data.date,
          type: data.type,
          articleCount: data.totalArticles,
          messageId: result.result?.message_id,
        }, 'Daily summary sent to Telegram');
        return true;
      } else {
        log.warn({
          userId,
          error: result.description,
        }, 'Failed to send daily summary to Telegram');
        return false;
      }
    } catch (error) {
      log.error({
        userId,
        error: error instanceof Error ? error.message : String(error),
      }, 'Failed to send daily summary to Telegram');
      return false;
    }
  }

  /**
   * Test Telegram connection
   */
  async testConnection(userId: number): Promise<{ success: boolean; message: string }> {
    const config = await loadTelegramConfig(userId);

    if (!config) {
      return {
        success: false,
        message: 'Telegram 未配置或未启用',
      };
    }

    try {
      const client = new TelegramClient(config.botToken);
      const success = await client.testConnection(config.chatId);

      if (success) {
        log.info({ userId, chatId: config.chatId }, 'Telegram connection test successful');
        return {
          success: true,
          message: '连接测试成功！请检查 Telegram 是否收到测试消息。',
        };
      } else {
        return {
          success: false,
          message: '连接测试失败。请检查 Bot Token 和 Chat ID 是否正确。',
        };
      }
    } catch (error) {
      log.error({
        userId,
        error: error instanceof Error ? error.message : String(error),
      }, 'Telegram connection test failed');
      return {
        success: false,
        message: `连接测试失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Send new article notification
   */
  async sendNewArticle(userId: number, article: ArticleWithSource): Promise<boolean> {
    const config = await loadTelegramConfig(userId);

    if (!config) {
      log.debug({ userId }, 'Telegram not configured, skipping new article notification');
      return false;
    }

    if (!config.newArticles) {
      log.debug({ userId }, 'New article notifications disabled');
      return false;
    }

    try {
      const client = new TelegramClient(config.botToken);

      // Use translated summary if available, otherwise use original summary or content
      // Priority: summary_zh > summary > markdown_content > content
      let summary = article.summary_zh || article.summary || undefined;
      if (!summary && (article.markdown_content || article.content)) {
        summary = article.markdown_content || article.content || undefined;
        // Truncate content if too long (max 500 chars for preview)
        if (summary && summary.length > 500) {
          summary = summary.substring(0, 500) + '...';
        }
      }

      const message = formatNewArticle({
        title: article.title,
        url: article.url,
        sourceName: article.source_name || article.rss_source_name || article.journal_name || 'Unknown',
        sourceType: article.source_origin === 'journal' ? '期刊文章' :
                    article.source_origin === 'keyword' ? '关键词订阅' : 'RSS订阅',
        summary,
      });

      // Create inline keyboard for article actions
      const keyboard = createArticleKeyboard(
        article.id,
        article.is_read === 1,
        article.rating
      );

      const result = await client.sendMessageWithKeyboard(config.chatId, message, keyboard, 'HTML');

      if (result.ok) {
        log.info({
          userId,
          articleId: article.id,
          title: article.title,
          messageId: result.result?.message_id,
        }, 'New article sent to Telegram');
        return true;
      } else {
        log.warn({
          userId,
          articleId: article.id,
          error: result.description,
        }, 'Failed to send new article to Telegram');
        return false;
      }
    } catch (error) {
      log.error({
        userId,
        articleId: article.id,
        error: error instanceof Error ? error.message : String(error),
      }, 'Failed to send new article to Telegram');
      return false;
    }
  }

  /**
   * Get Telegram configuration (for display purposes, token is masked)
   */
  async getMaskedConfig(userId: number): Promise<{
    enabled: boolean;
    botToken: string;
    chatId: string;
    dailySummary: boolean;
    newArticles: boolean;
  } | null> {
    const config = await loadTelegramConfig(userId);

    if (!config) {
      return null;
    }

    // Mask bot token for security
    const tokenParts = config.botToken.split(':');
    const maskedToken = tokenParts.length > 1
      ? `${tokenParts[0].substring(0, 4)}***:${tokenParts[1].substring(0, 4)}***`
      : '****';

    return {
      enabled: config.enabled,
      botToken: maskedToken,
      chatId: config.chatId,
      dailySummary: config.dailySummary,
      newArticles: config.newArticles,
    };
  }
}

// Singleton instance
let _instance: TelegramNotifier | null = null;

/**
 * Get Telegram notifier instance
 */
export function getTelegramNotifier(): TelegramNotifier {
  if (!_instance) {
    _instance = new TelegramNotifier();
  }
  return _instance;
}
