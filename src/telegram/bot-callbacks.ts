/**
 * Telegram Bot — Callback Query Handler
 *
 * Handles all inline keyboard callback queries (mark read, rate, show rating, cancel).
 * Extracted from bot.ts for single-responsibility separation.
 */

import { logger } from '../logger.js';
import { TelegramClient } from './client.js';
import { getArticleById, updateArticleReadStatus, updateArticleRating } from '../api/articles.js';
import { decodeCallback, CallbackAction } from './callback-encoder.js';
import { createArticleKeyboard, createRatingKeyboard } from './formatters.js';
import type { CallbackQuery } from './types.js';
import type { TelegramChatConfig } from '../api/telegram-chats.js';
import { serializeError } from './utils.js';

const log = logger.child({ module: 'telegram-bot-callbacks' });

/**
 * Dependencies required by CallbackHandler
 */
export interface CallbackHandlerDeps {
  client: TelegramClient;
  userId: number;
  chats: TelegramChatConfig[];
  isAuthorizedChat(chatId: string): boolean;
  isAdminChat(chatId: string): boolean;
  getChatConfig(chatId: string): TelegramChatConfig | undefined;
}

/**
 * Callback Query Handler
 *
 * Handles inline keyboard interactions from Telegram messages:
 * - Mark as read/unread
 * - Rate article (1-5 stars)
 * - Show/hide rating keyboard
 * - Cancel operations
 */
export class CallbackHandler {
  private deps: CallbackHandlerDeps;

  constructor(deps: CallbackHandlerDeps) {
    this.deps = deps;
  }

  /**
   * Handle callback query with improved error handling and permission checking
   */
  async handleCallbackQuery(callbackQuery: CallbackQuery): Promise<void> {
    const { id: queryId, from, message, data } = callbackQuery;
    const { client, userId, chats } = this.deps;

    // Get chat ID from message
    const chatId = String(message?.chat.id);

    // Check if this chat is authorized
    if (!this.deps.isAuthorizedChat(chatId)) {
      log.warn({ queryId, from: from.id, chatId }, 'Unauthorized callback query');
      await client.answerCallbackQuery(queryId, '❌ 无权操作', true);
      return;
    }

    // Check if this chat has admin role
    const isAdmin = this.deps.isAdminChat(chatId);
    const chatConfig = this.deps.getChatConfig(chatId);

    // Decode callback data
    const decoded = decodeCallback(data);
    if (!decoded) {
      log.warn({ queryId, data }, 'Invalid callback data');
      await client.answerCallbackQuery(queryId, '❌ 无效的操作', true);
      return;
    }

    const { action, articleId, value } = decoded;
    const messageId = message?.message_id;

    // For viewer role, only allow viewing operations, not modifications
    if (!isAdmin) {
      if (action === CallbackAction.SHOW_RATING) {
        await client.answerCallbackQuery(queryId, 'ℹ️ 您是观察者，仅管理员可评分');
        if (messageId !== undefined) {
          try {
            const keyboard = createRatingKeyboard(articleId);
            await client.editMessageReplyMarkup(chatId, messageId, keyboard);
          } catch (error) {
            log.warn({ articleId, messageId, error }, 'Failed to show rating keyboard for viewer');
          }
        }
        return;
      }

      if (action === CallbackAction.CANCEL) {
        await client.answerCallbackQuery(queryId, '✅ 已取消');
        return;
      }

      log.info({ queryId, chatId, action, role: chatConfig?.role }, 'Viewer attempted admin action');
      await client.answerCallbackQuery(queryId, '❌ 无权限操作，仅管理员可交互', true);
      return;
    }

    try {
      // Route to appropriate handler (admin only)
      switch (action) {
        case CallbackAction.MARK_READ:
          await this.handleMarkRead(queryId, articleId, messageId, chatId);
          break;

        case CallbackAction.RATE:
          if (value) {
            await this.handleRate(queryId, articleId, parseInt(value, 10), messageId, chatId);
          }
          break;

        case CallbackAction.SHOW_RATING:
          await this.handleShowRating(queryId, articleId, messageId, chatId);
          break;

        case CallbackAction.CANCEL:
          await this.handleCancel(queryId, articleId, messageId, chatId);
          break;

        default:
          await client.answerCallbackQuery(queryId, '❌ 未知操作', true);
      }
    } catch (error) {
      const isArticleNotFound = error instanceof Error && error.message.includes('not found');
      const isNetworkError = error instanceof Error && (
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('fetch')
      );

      if (isArticleNotFound) {
        log.warn({ queryId, action, articleId }, 'Article not found in callback');
        await client.answerCallbackQuery(queryId, '❌ 文章不存在或已被删除', true);
      } else if (isNetworkError) {
        log.error({ queryId, action, articleId, error }, 'Network error in callback');
        await client.answerCallbackQuery(queryId, '❌ 网络错误，请稍后重试', true);
      } else {
        log.error({ queryId, action, articleId, error }, 'Error handling callback query');
        await client.answerCallbackQuery(queryId, '❌ 操作失败，请稍后重试', true);
      }
    }
  }

  /**
   * Handle mark read/unread toggle
   */
  private async handleMarkRead(
    queryId: string,
    articleId: number,
    messageId: number | undefined,
    chatId: string
  ): Promise<void> {
    const { client, userId } = this.deps;

    const article = await getArticleById(articleId, userId);
    if (!article) {
      await client.answerCallbackQuery(queryId, '❌ 文章不存在或已被删除', true);
      log.warn({ articleId, userId }, 'Article not found when marking read');
      return;
    }

    const newReadStatus = article.is_read === 0;

    try {
      await updateArticleReadStatus(articleId, userId, newReadStatus);
    } catch (error) {
      log.error({ articleId, userId, error }, 'Failed to update article read status');
      await client.answerCallbackQuery(queryId, '❌ 更新失败，请稍后重试', true);
      return;
    }

    const statusText = newReadStatus ? '✅ 已标记为已读' : '📖 已标记为未读';
    await client.answerCallbackQuery(queryId, statusText);

    if (messageId !== undefined) {
      try {
        const keyboard = createArticleKeyboard(articleId, newReadStatus, article.rating);
        await client.editMessageReplyMarkup(chatId, messageId, keyboard);
      } catch (error) {
        log.warn({ articleId, messageId, error }, 'Failed to update keyboard after marking read');
      }
    }

    log.info({ articleId, userId, isRead: newReadStatus, chatId }, 'Article read status toggled via Telegram');
  }

  /**
   * Handle rating submission
   */
  private async handleRate(
    queryId: string,
    articleId: number,
    rating: number,
    messageId: number | undefined,
    chatId: string
  ): Promise<void> {
    const { client, userId } = this.deps;

    if (rating < 1 || rating > 5) {
      await client.answerCallbackQuery(queryId, '❌ 无效的评分', true);
      return;
    }

    try {
      await updateArticleRating(articleId, userId, rating);
    } catch (error) {
      log.error({ articleId, userId, rating, error }, 'Failed to update article rating');
      await client.answerCallbackQuery(queryId, '❌ 评分失败，请稍后重试', true);
      return;
    }

    await client.answerCallbackQuery(queryId, `⭐ 已评为 ${rating} 星`);

    if (messageId !== undefined) {
      try {
        const keyboard = createArticleKeyboard(articleId, true, rating);
        await client.editMessageReplyMarkup(chatId, messageId, keyboard);
      } catch (error) {
        log.warn({ articleId, messageId, error }, 'Failed to update keyboard after rating');
      }
    }

    log.info({ articleId, userId, rating, chatId }, 'Article rated via Telegram');
  }

  /**
   * Handle show rating keyboard
   */
  private async handleShowRating(
    queryId: string,
    articleId: number,
    messageId: number | undefined,
    chatId: string
  ): Promise<void> {
    const { client, userId } = this.deps;

    const article = await getArticleById(articleId, userId);
    if (!article) {
      await client.answerCallbackQuery(queryId, '❌ 文章不存在或已被删除', true);
      log.warn({ articleId, userId }, 'Article not found when showing rating keyboard');
      return;
    }

    await client.answerCallbackQuery(queryId);

    if (messageId !== undefined) {
      try {
        const keyboard = createRatingKeyboard(articleId);
        await client.editMessageReplyMarkup(chatId, messageId, keyboard);
      } catch (error) {
        log.warn({ articleId, messageId, error }, 'Failed to show rating keyboard');
      }
    }

    log.debug({ articleId, userId, chatId }, 'Rating keyboard shown via Telegram');
  }

  /**
   * Handle cancel operation
   */
  private async handleCancel(
    queryId: string,
    articleId: number,
    messageId: number | undefined,
    chatId: string
  ): Promise<void> {
    const { client, userId } = this.deps;

    const article = await getArticleById(articleId, userId);
    if (!article) {
      await client.answerCallbackQuery(queryId, '❌ 文章不存在或已被删除', true);
      log.warn({ articleId, userId }, 'Article not found when cancelling');
      return;
    }

    await client.answerCallbackQuery(queryId, '✅ 已取消');

    if (messageId !== undefined) {
      try {
        const keyboard = createArticleKeyboard(articleId, article.is_read === 1, article.rating);
        await client.editMessageReplyMarkup(chatId, messageId, keyboard);
      } catch (error) {
        log.warn({ articleId, messageId, error }, 'Failed to restore keyboard after cancel');
      }
    }

    log.debug({ articleId, userId, chatId }, 'Rating keyboard cancelled via Telegram');
  }
}
