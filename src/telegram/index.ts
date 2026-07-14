/**
 * Telegram Notification Module
 *
 * Main entry point for Telegram notifications.
 * Provides singleton TelegramNotifier class for sending notifications.
 * Supports multiple chat recipients with different permission levels.
 */

import { logger } from '../logger.js';
import { TelegramClient } from './client.js';
import { formatDailySummary, formatNewArticle, formatPdfSummary, createArticleKeyboard } from './formatters.js';
import type { TelegramConfig, DailySummaryData, PdfSummaryNotificationData, TelegramMessageResponse, InlineKeyboardMarkup } from './types.js';
import { getUserSettings } from '../api/settings.js';
import type { ArticleWithSource } from '../api/articles.js';
import {
  getDailySummaryJournalChats,
  getDailySummaryBlogNewsChats,
  getJournalAllChats,
  getNewArticlesChats,
  getInsightsChats,
  getPdfSummaryChats,
  getActiveTelegramChats,
  hasTelegramChats,
  type TelegramChatConfig
} from '../api/telegram-chats.js';

const log = logger.child({ module: 'telegram-notifier' });

// Settings keys for Telegram configuration (global settings)
const TELEGRAM_SETTINGS_KEYS = [
  'telegram_enabled',
  'telegram_bot_token',
] as const;

/**
 * Load global Telegram configuration (bot token, enabled status)
 */
async function loadTelegramConfig(userId: number): Promise<TelegramConfig | null> {
  try {
    const settings = await getUserSettings(userId, [...TELEGRAM_SETTINGS_KEYS]);

    const enabled = settings.telegram_enabled === 'true';
    const botToken = settings.telegram_bot_token || '';

    if (!enabled || !botToken) {
      log.debug({ userId, enabled: !!enabled, hasToken: !!botToken }, 'Telegram not configured');
      return null;
    }

    // Return config with placeholder chatId (chats are now managed separately)
    return {
      enabled,
      botToken,
      chatId: '', // Not used anymore, but kept for compatibility
      dailySummaryJournal: true, // 不再使用，仅保留兼容结构
      dailySummaryBlogNews: true, // 不再使用，仅保留兼容结构
      newArticles: true, // Not used anymore
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
  private sentCache = new Map<string, number>();
  private readonly CACHE_TTL = 60000;

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

  private async getDailySummaryChatsByType(userId: number, type: DailySummaryData['type']): Promise<TelegramChatConfig[]> {
    if (type === 'journal') {
      return getDailySummaryJournalChats(userId);
    }
    if (type === 'blog_news') {
      return getDailySummaryBlogNewsChats(userId);
    }
    if (type === 'all') {
      const [journalChats, blogNewsChats] = await Promise.all([
        getDailySummaryJournalChats(userId),
        getDailySummaryBlogNewsChats(userId),
      ]);
      const chatMap = new Map<number, TelegramChatConfig>();
      for (const chat of [...journalChats, ...blogNewsChats]) {
        chatMap.set(chat.id, chat);
      }
      return Array.from(chatMap.values());
    }
    return [];
  }

  /**
   * Send daily summary notification to all configured chats
   */
  async sendDailySummary(userId: number, data: DailySummaryData): Promise<boolean> {
    const cacheKey = this.getCacheKey(userId, data.type, data.date);
    if (this.checkAndSetCache(cacheKey)) {
      log.info({ userId, type: data.type, date: data.date }, '[DEBUG] Skipping duplicate sendDailySummary');
      return false;
    }

    const config = await loadTelegramConfig(userId);
    if (!config) return false;

    const chats = await this.getDailySummaryChatsByType(userId, data.type);
    if (chats.length === 0) return false;

    const message = formatDailySummary(data);
    return this.sendToChats(userId, config, chats, message, {
      parseMode: 'HTML',
      logLabel: 'Daily summary',
      logContext: { date: data.date, type: data.type, articleCount: data.totalArticles },
    });
  }

  /**
   * Send journal all summary notification to all configured chats
   */
  async sendJournalAllSummary(userId: number, data: DailySummaryData): Promise<boolean> {
    const cacheKey = this.getCacheKey(userId, 'journal_all', data.date);
    if (this.checkAndSetCache(cacheKey)) {
      log.info({ userId, date: data.date }, 'Skipping duplicate sendJournalAllSummary');
      return false;
    }

    const config = await loadTelegramConfig(userId);
    if (!config) return false;

    const chats = await getJournalAllChats(userId);
    if (chats.length === 0) return false;

    const message = formatDailySummary({
      date: data.date,
      type: 'journal_all',
      totalArticles: data.totalArticles,
      summary: data.summary,
      articlesByType: data.articlesByType,
    });

    return this.sendToChats(userId, config, chats, message, {
      parseMode: 'HTML',
      logLabel: 'Journal all summary',
      logContext: { date: data.date, articleCount: data.totalArticles },
    });
  }

  /**
   * Send insights summary notification to all configured chats
   */
  async sendInsightsSummary(userId: number, data: DailySummaryData): Promise<boolean> {
    const cacheKey = this.getCacheKey(userId, 'insights', data.date);
    if (this.checkAndSetCache(cacheKey)) {
      log.info({ userId, date: data.date }, 'Skipping duplicate sendInsightsSummary');
      return false;
    }

    const config = await loadTelegramConfig(userId);
    if (!config) return false;

    const chats = await getInsightsChats(userId);
    if (chats.length === 0) return false;

    const message = formatDailySummary({
      date: data.date,
      type: 'insights',
      totalArticles: data.totalArticles,
      summary: data.summary,
      articlesByType: data.articlesByType,
    });

    return this.sendToChats(userId, config, chats, message, {
      parseMode: 'HTML',
      logLabel: 'Insights summary',
      logContext: { date: data.date, articleCount: data.totalArticles },
    });
  }

  /**
   * Test Telegram connection
   * @param userId - User ID
   * @param chatId - Optional specific chat ID to test. If not provided, tests all active chats.
   */
  async testConnection(userId: number, chatId?: string): Promise<{ success: boolean; message: string }> {
    const config = await loadTelegramConfig(userId);

    if (!config) {
      return {
        success: false,
        message: 'Telegram 未配置或未启用',
      };
    }

    try {
      const client = new TelegramClient(config.botToken);

      if (chatId) {
        // Test specific chat
        const success = await client.testConnection(chatId);
        if (success) {
          log.info({ userId, chatId }, 'Telegram connection test successful');
          return {
            success: true,
            message: '连接测试成功！测试消息已发送。',
          };
        } else {
          return {
            success: false,
            message: '连接测试失败。请检查 Bot Token 和 Chat ID 是否正确。',
          };
        }
      } else {
        // Get all active chats to test
        const chats = await getActiveTelegramChats(userId);

        if (chats.length === 0) {
          return {
            success: false,
            message: '未配置任何接收者',
          };
        }

        // Test with the first chat
        const firstChat = chats[0];
        const success = await client.testConnection(firstChat.chatId);

        if (success) {
          log.info({ userId, chatId: firstChat.chatId }, 'Telegram connection test successful');
          return {
            success: true,
            message: `连接测试成功！已发送测试消息到 ${chats.length} 个接收者。`,
          };
        } else {
          return {
            success: false,
            message: '连接测试失败。请检查 Bot Token 和 Chat ID 是否正确。',
          };
        }
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
   * Send new article notification to all configured chats
   */
  async sendNewArticle(userId: number, article: ArticleWithSource): Promise<boolean> {
    const config = await loadTelegramConfig(userId);
    if (!config) return false;

    const chats = await getNewArticlesChats(userId);
    if (chats.length === 0) return false;

    // Build summary from article
    let summary = article.summary_zh || article.summary || undefined;
    if (!summary && (article.markdown_content || article.content)) {
      summary = article.markdown_content || article.content || undefined;
      if (summary && summary.length > 500) {
        summary = summary.substring(0, 500) + '...';
      }
    }

    const message = formatNewArticle({
      id: article.id,
      title: article.title,
      url: article.url,
      sourceName: article.source_name || article.rss_source_name || article.journal_name || 'Unknown',
      sourceType: article.source_origin === 'journal' ? '期刊文章' :
                  article.source_origin === 'keyword' ? '关键词订阅' :
                  article.source_origin === 'email' ? '邮件订阅' : 'RSS订阅',
      summary,
    });

    const keyboard = createArticleKeyboard(article.id, article.is_read === 1, article.rating);

    return this.sendToChats(userId, config, chats, message, {
      parseMode: 'HTML',
      keyboard,
      logLabel: 'New article',
      logContext: { articleId: article.id, title: article.title },
    });
  }

  /**
   * Send PDF summary notification to all configured chats
   */
  async sendPdfSummary(userId: number, data: PdfSummaryNotificationData): Promise<boolean> {
    const config = await loadTelegramConfig(userId);
    if (!config) return false;

    const chats = await getPdfSummaryChats(userId);
    if (chats.length === 0) return false;

    const message = formatPdfSummary(data);
    return this.sendToChats(userId, config, chats, message, {
      logLabel: 'PDF summary',
      logContext: { articleId: data.articleId, title: data.title },
    });
  }

  /**
   * Send a formatted message to multiple Telegram chats.
   * Extracted to deduplicate the send-loop pattern across all send* methods.
   */
  private async sendToChats(
    userId: number,
    config: TelegramConfig,
    chats: TelegramChatConfig[],
    message: string,
    options?: {
      keyboard?: InlineKeyboardMarkup;
      parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
      logLabel?: string;
      logContext?: Record<string, any>;
    }
  ): Promise<boolean> {
    const client = new TelegramClient(config.botToken);
    let successCount = 0;
    let failCount = 0;

    for (const chat of chats) {
      try {
        let result: TelegramMessageResponse;
        if (options?.keyboard) {
          result = await client.sendMessageWithKeyboard(chat.chatId, message, options.keyboard, options.parseMode as 'HTML' | undefined);
        } else {
          result = await client.sendMessage(chat.chatId, message, options?.parseMode);
        }

        if (result.ok) {
          successCount++;
          log.info({
            userId,
            chatId: chat.chatId,
            chatName: chat.chatName,
            ...options?.logContext,
            messageId: result.result?.message_id,
          }, `${options?.logLabel || 'Message'} sent to Telegram`);
        } else {
          failCount++;
          log.warn({
            userId,
            chatId: chat.chatId,
            error: result.description,
            ...options?.logContext,
          }, `Failed to send ${options?.logLabel || 'message'} to Telegram`);
        }
      } catch (error) {
        failCount++;
        log.error({
          userId,
          chatId: chat.chatId,
          error: error instanceof Error ? error.message : String(error),
          ...options?.logContext,
        }, `Failed to send ${options?.logLabel || 'message'} to Telegram`);
      }
    }

    return successCount > 0;
  }

  /**
   * Get Telegram configuration (for display purposes, token is masked)
   */
  async getMaskedConfig(userId: number): Promise<{
    enabled: boolean;
    botToken: string;
    hasChats: boolean;
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

    // Check if any chats are configured
    const hasChats = await hasTelegramChats(userId);

    return {
      enabled: config.enabled,
      botToken: maskedToken,
      hasChats,
    };
  }

  /**
   * Check if Telegram is enabled and configured for a user
   */
  async isEnabled(userId: number): Promise<boolean> {
    const config = await loadTelegramConfig(userId);
    if (!config) return false;
    return hasTelegramChats(userId);
  }

  /**
   * Get active chats for a user
   */
  async getActiveChats(userId: number): Promise<TelegramChatConfig[]> {
    return getActiveTelegramChats(userId);
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
