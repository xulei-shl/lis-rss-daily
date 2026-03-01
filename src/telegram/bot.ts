/**
 * Telegram Bot for Interactive Callbacks
 *
 * Handles polling and processing of callback queries from Telegram inline keyboards.
 * Provides article management features: mark as read/unread, rate articles.
 */

import { logger } from '../logger.js';
import { TelegramClient } from './client.js';
import { getArticleById, updateArticleReadStatus, updateArticleRating } from '../api/articles.js';
import { decodeCallback, CallbackAction } from './callback-encoder.js';
import { createArticleKeyboard, createRatingKeyboard, createEmptyKeyboard } from './formatters.js';
import type { CallbackQuery, TelegramUpdate, InlineKeyboardMarkup } from './types.js';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const log = logger.child({ module: 'telegram-bot' });

// Polling configuration
const POLL_TIMEOUT = 30; // seconds
const POLL_LIMIT = 100;
const POLL_ERROR_DELAY = 5000; // ms

// State persistence
const STATE_DIR = process.env.TELEGRAM_STATE_DIR || '/tmp/lis-rss-daily/telegram';

// Ensure state directory exists
import { mkdir } from 'fs/promises';
async function ensureStateDir() {
  if (!existsSync(STATE_DIR)) {
    await mkdir(STATE_DIR, { recursive: true });
  }
}

export class TelegramBot {
  private client: TelegramClient;
  private botToken: string;
  private userId: number;
  private chatId: string;
  private isRunning: boolean = false;
  private latestUpdateId: number = 0;
  private pollTimeout: NodeJS.Timeout | null = null;

  // Concurrency control: prevent duplicate callback processing
  private pendingCallbacks: Set<string> = new Set();
  // Dynamic polling: adjust interval based on activity
  private lastActivityTime: number = Date.now();
  private idlePollInterval: number = 10000; // 10s when idle
  private activePollInterval: number = 1000; // 1s when active

  // State file path for persistence
  private stateFilePath: string;

  constructor(botToken: string, userId: number, chatId: string) {
    this.botToken = botToken;
    this.userId = userId;
    this.chatId = chatId;
    this.client = new TelegramClient(botToken);
    this.stateFilePath = join(STATE_DIR, `bot-state-user-${userId}.json`);
  }

  /**
   * Get the state file path for this bot instance
   */
  private getStateFilePath(): string {
    return this.stateFilePath;
  }

  /**
   * Load persisted state from disk
   */
  private async loadState(): Promise<void> {
    try {
      await ensureStateDir();
      const statePath = this.getStateFilePath();

      if (existsSync(statePath)) {
        const data = await readFile(statePath, 'utf-8');
        const state = JSON.parse(data);
        if (typeof state.latestUpdateId === 'number') {
          this.latestUpdateId = state.latestUpdateId;
          log.info({ userId: this.userId, latestUpdateId: this.latestUpdateId }, 'Loaded bot state from disk');
        }
      }
    } catch (error) {
      log.warn({ userId: this.userId, error }, 'Failed to load bot state, starting fresh');
    }
  }

  /**
   * Persist current state to disk
   */
  private async saveState(): Promise<void> {
    try {
      await ensureStateDir();
      const statePath = this.getStateFilePath();
      const state = {
        latestUpdateId: this.latestUpdateId,
        userId: this.userId,
        chatId: this.chatId,
        savedAt: new Date().toISOString(),
      };
      await writeFile(statePath, JSON.stringify(state, null, 2));
    } catch (error) {
      log.error({ userId: this.userId, error }, 'Failed to save bot state');
    }
  }

  /**
   * Start polling for updates
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ userId: this.userId, chatId: this.chatId }, 'Bot already running');
      return;
    }

    // Load persisted state before starting
    await this.loadState();

    this.isRunning = true;
    log.info({ userId: this.userId, chatId: this.chatId, latestUpdateId: this.latestUpdateId }, 'Starting Telegram bot polling');

    this.poll();
  }

  /**
   * Stop polling
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }

    // Abort any pending requests
    this.client.abort();

    log.info({ userId: this.userId, chatId: this.chatId }, 'Telegram bot stopped');
  }

  /**
   * Poll for updates with dynamic interval based on activity
   */
  private poll(): void {
    if (!this.isRunning) {
      return;
    }

    this.getUpdates()
      .then((updates) => {
        if (updates.length > 0) {
          this.lastActivityTime = Date.now();
          this.processUpdates(updates).catch((error) => {
            log.error({ error }, 'Error processing updates');
          });
        }
      })
      .catch((error) => {
        log.error({ error }, 'Error polling for updates');
      })
      .finally(() => {
        if (this.isRunning) {
          // Dynamic polling: use longer interval when idle
          const timeSinceActivity = Date.now() - this.lastActivityTime;
          const pollInterval = timeSinceActivity > 300000 // 5 minutes idle
            ? this.idlePollInterval
            : this.activePollInterval;

          this.pollTimeout = setTimeout(() => this.poll(), pollInterval);
        }
      });
  }

  /**
   * Get updates from Telegram
   */
  private async getUpdates(): Promise<TelegramUpdate[]> {
    try {
      const response = await this.client.getUpdates(
        this.latestUpdateId > 0 ? this.latestUpdateId + 1 : undefined,
        POLL_LIMIT,
        POLL_TIMEOUT
      );

      if (response.ok && response.result) {
        return response.result;
      }

      return [];
    } catch (error) {
      log.error({ error }, 'Error in getUpdates');
      return [];
    }
  }

  /**
   * Process updates with concurrency control and performance monitoring
   */
  private async processUpdates(updates: TelegramUpdate[]): Promise<void> {
    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;

    for (const update of updates) {
      // Update latest update_id for pagination
      this.latestUpdateId = update.update_id;

      // Process callback query with duplicate prevention
      if (update.callback_query) {
        const callbackId = `${update.callback_query.id}`;

        // Skip if already processing this callback
        if (this.pendingCallbacks.has(callbackId)) {
          log.debug({ callbackId }, 'Callback already being processed, skipping');
          continue;
        }

        this.pendingCallbacks.add(callbackId);
        try {
          await this.handleCallbackQuery(update.callback_query);
          successCount++;
        } catch (error) {
          errorCount++;
          throw error;
        } finally {
          this.pendingCallbacks.delete(callbackId);
        }
      }
    }

    // Log performance metrics
    const duration = Date.now() - startTime;
    if (updates.length > 0) {
      log.info({
        userId: this.userId,
        updateCount: updates.length,
        successCount,
        errorCount,
        duration,
        avgDuration: duration / updates.length,
      }, 'Processed Telegram updates');
    }

    // Save state after processing all updates
    if (updates.length > 0) {
      await this.saveState().catch((error) => {
        log.warn({ error }, 'Failed to save state after processing updates');
      });
    }
  }

  /**
   * Handle callback query with improved error handling
   */
  private async handleCallbackQuery(callbackQuery: CallbackQuery): Promise<void> {
    const { id: queryId, from, message, data } = callbackQuery;

    // Validate user (only allow configured user)
    const chatId = String(message?.chat.id || this.chatId);
    if (chatId !== this.chatId) {
      log.warn({ queryId, from: from.id, chatId }, 'Unauthorized callback query');
      await this.client.answerCallbackQuery(queryId, '❌ 无权操作', true);
      return;
    }

    // Decode callback data
    const decoded = decodeCallback(data);
    if (!decoded) {
      log.warn({ queryId, data }, 'Invalid callback data');
      await this.client.answerCallbackQuery(queryId, '❌ 无效的操作', true);
      return;
    }

    const { action, articleId, value } = decoded;
    const messageId = message?.message_id;

    try {
      // Route to appropriate handler
      switch (action) {
        case CallbackAction.MARK_READ:
          await this.handleMarkRead(queryId, articleId, messageId);
          break;

        case CallbackAction.RATE:
          if (value) {
            await this.handleRate(queryId, articleId, parseInt(value, 10), messageId);
          }
          break;

        case CallbackAction.SHOW_RATING:
          await this.handleShowRating(queryId, articleId, messageId);
          break;

        case CallbackAction.CANCEL:
          await this.handleCancel(queryId, articleId, messageId);
          break;

        default:
          await this.client.answerCallbackQuery(queryId, '❌ 未知操作', true);
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
        await this.client.answerCallbackQuery(queryId, '❌ 文章不存在或已被删除', true);
      } else if (isNetworkError) {
        log.error({ queryId, action, articleId, error }, 'Network error in callback');
        await this.client.answerCallbackQuery(queryId, '❌ 网络错误，请稍后重试', true);
      } else {
        log.error({ queryId, action, articleId, error }, 'Error handling callback query');
        await this.client.answerCallbackQuery(queryId, '❌ 操作失败，请稍后重试', true);
      }
    }
  }

  /**
   * Handle mark read/unread toggle with robust error handling
   */
  private async handleMarkRead(
    queryId: string,
    articleId: number,
    messageId: number | undefined
  ): Promise<void> {
    // Get current article state
    const article = await getArticleById(articleId, this.userId);
    if (!article) {
      await this.client.answerCallbackQuery(queryId, '❌ 文章不存在或已被删除', true);
      log.warn({ articleId, userId: this.userId }, 'Article not found when marking read');
      return;
    }

    // Toggle read status
    const newReadStatus = article.is_read === 0;

    try {
      await updateArticleReadStatus(articleId, this.userId, newReadStatus);
    } catch (error) {
      log.error({ articleId, userId: this.userId, error }, 'Failed to update article read status');
      await this.client.answerCallbackQuery(queryId, '❌ 更新失败，请稍后重试', true);
      return;
    }

    // Answer callback query
    const statusText = newReadStatus ? '✅ 已标记为已读' : '📖 已标记为未读';
    await this.client.answerCallbackQuery(queryId, statusText);

    // Update keyboard if messageId is available
    if (messageId !== undefined) {
      try {
        const keyboard = createArticleKeyboard(articleId, newReadStatus, article.rating);
        await this.client.editMessageReplyMarkup(this.chatId, messageId, keyboard);
      } catch (error) {
        // Don't fail the operation if keyboard update fails
        log.warn({ articleId, messageId, error }, 'Failed to update keyboard after marking read');
      }
    }

    log.info({ articleId, userId: this.userId, isRead: newReadStatus }, 'Article read status toggled via Telegram');
  }

  /**
   * Handle rating submission with robust error handling
   */
  private async handleRate(
    queryId: string,
    articleId: number,
    rating: number,
    messageId: number | undefined
  ): Promise<void> {
    // Validate rating
    if (rating < 1 || rating > 5) {
      await this.client.answerCallbackQuery(queryId, '❌ 无效的评分', true);
      return;
    }

    // Update article rating
    try {
      await updateArticleRating(articleId, this.userId, rating);
    } catch (error) {
      log.error({ articleId, userId: this.userId, rating, error }, 'Failed to update article rating');
      await this.client.answerCallbackQuery(queryId, '❌ 评分失败，请稍后重试', true);
      return;
    }

    // Answer callback query
    await this.client.answerCallbackQuery(queryId, `⭐ 已评为 ${rating} 星`);

    // Update keyboard if messageId is available
    if (messageId !== undefined) {
      try {
        const keyboard = createArticleKeyboard(articleId, true, rating);
        await this.client.editMessageReplyMarkup(this.chatId, messageId, keyboard);
      } catch (error) {
        // Don't fail the operation if keyboard update fails
        log.warn({ articleId, messageId, error }, 'Failed to update keyboard after rating');
      }
    }

    log.info({ articleId, userId: this.userId, rating }, 'Article rated via Telegram');
  }

  /**
   * Handle show rating keyboard with robust error handling
   */
  private async handleShowRating(
    queryId: string,
    articleId: number,
    messageId: number | undefined
  ): Promise<void> {
    // Get article to verify ownership
    const article = await getArticleById(articleId, this.userId);
    if (!article) {
      await this.client.answerCallbackQuery(queryId, '❌ 文章不存在或已被删除', true);
      log.warn({ articleId, userId: this.userId }, 'Article not found when showing rating keyboard');
      return;
    }

    // Answer callback query without notification
    await this.client.answerCallbackQuery(queryId);

    // Update keyboard to show rating selection
    if (messageId !== undefined) {
      try {
        const keyboard = createRatingKeyboard(articleId);
        await this.client.editMessageReplyMarkup(this.chatId, messageId, keyboard);
      } catch (error) {
        log.warn({ articleId, messageId, error }, 'Failed to show rating keyboard');
      }
    }

    log.debug({ articleId, userId: this.userId }, 'Rating keyboard shown via Telegram');
  }

  /**
   * Handle cancel operation with robust error handling
   */
  private async handleCancel(
    queryId: string,
    articleId: number,
    messageId: number | undefined
  ): Promise<void> {
    // Get article to verify ownership
    const article = await getArticleById(articleId, this.userId);
    if (!article) {
      await this.client.answerCallbackQuery(queryId, '❌ 文章不存在或已被删除', true);
      log.warn({ articleId, userId: this.userId }, 'Article not found when cancelling');
      return;
    }

    // Answer callback query
    await this.client.answerCallbackQuery(queryId, '✅ 已取消');

    // Restore original keyboard
    if (messageId !== undefined) {
      try {
        const keyboard = createArticleKeyboard(articleId, article.is_read === 1, article.rating);
        await this.client.editMessageReplyMarkup(this.chatId, messageId, keyboard);
      } catch (error) {
        log.warn({ articleId, messageId, error }, 'Failed to restore keyboard after cancel');
      }
    }

    log.debug({ articleId, userId: this.userId }, 'Rating keyboard cancelled via Telegram');
  }
}

/**
 * Initialize Telegram Bot for a user
 */
export function initUserBot(botToken: string, userId: number, chatId: string): TelegramBot | null {
  if (!botToken || !chatId) {
    return null;
  }

  return new TelegramBot(botToken, userId, chatId);
}
