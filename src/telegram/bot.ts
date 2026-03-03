/**
 * Telegram Bot for Interactive Callbacks
 *
 * Handles polling and processing of callback queries from Telegram inline keyboards.
 * Provides article management features: mark as read/unread, rate articles.
 */

import { logger } from '../logger.js';
import { TelegramClient } from './client.js';
import { getArticleById, updateArticleReadStatus, updateArticleRating, getUserArticles } from '../api/articles.js';
import { decodeCallback, CallbackAction } from './callback-encoder.js';
import { createArticleKeyboard, createRatingKeyboard, createEmptyKeyboard, formatNewArticle } from './formatters.js';
import type { CallbackQuery, TelegramUpdate, InlineKeyboardMarkup, Message } from './types.js';
import { parseGetArticlesCommand } from './command-parser.js';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getUserLocalDate } from '../api/timezone.js';

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

      // Process message commands
      if (update.message) {
        const messageId = `${update.update_id}-msg`;

        // Skip if already processing this message
        if (this.pendingCallbacks.has(messageId)) {
          log.debug({ messageId }, 'Message already being processed, skipping');
          continue;
        }

        this.pendingCallbacks.add(messageId);
        try {
          await this.handleMessage(update.message);
          successCount++;
        } catch (error) {
          errorCount++;
          throw error;
        } finally {
          this.pendingCallbacks.delete(messageId);
        }
        continue; // Skip callback processing for this update
      }

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

  /**
   * Handle incoming message (commands)
   */
  private async handleMessage(message: Message): Promise<void> {
    const { from, chat, text } = message;

    // Validate user (only allow configured user)
    const chatId = String(chat.id);
    if (chatId !== this.chatId) {
      log.warn({ from: from?.id, chatId }, 'Unauthorized message');
      await this.client.sendMessage(chatId, '❌ 无权操作');
      return;
    }

    // Parse command
    if (!text || !text.startsWith('/')) {
      return; // Ignore non-command messages
    }

    const parts = text.trim().split(/\s+/);
    const command = parts[0];

    switch (command) {
      case '/getarticles':
        await this.handleGetArticlesCommandWrapper(parts.slice(1).join(' '));
        break;

      default:
        log.debug({ command }, 'Unknown command');
    }
  }

  /**
   * Wrapper for getarticles command with error handling
   */
  private async handleGetArticlesCommandWrapper(args: string): Promise<void> {
    try {
      const parsed = parseGetArticlesCommand(args);
      if (!parsed) {
        await this.client.sendMessage(this.chatId,
          '❌ 格式错误。正确格式：/getarticles YYYY-MM-DD 或 YYYYMMDD\n例如：/getarticles 2026-3-1 或 /getarticles 20260301');
        return;
      }

      const { year, month, day } = parsed;

      // Validate not in future (use user's timezone)
      const todayStr = await getUserLocalDate(this.userId);
      const cmdDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (cmdDateStr > todayStr) {
        await this.client.sendMessage(this.chatId, '❌ 日期不能是未来时间');
        return;
      }

      await this.handleGetArticlesCommand(year, month, day);
    } catch (error) {
      log.error({ error, args }, 'Error in getarticles command');
      await this.client.sendMessage(this.chatId, '❌ 查询失败，请稍后重试');
    }
  }

  /**
   * Handle /getarticles command
   */
  private async handleGetArticlesCommand(year: number, month: number, day: number): Promise<void> {
    // Format date string (YYYY-MM-DD)
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Query articles for the specific date
    const result = await getUserArticles(this.userId, {
      createdAfter: dateStr,
      createdBefore: dateStr,
      isRead: false,
      filterStatus: 'passed',
      limit: 5,
      page: 1,
      randomOrder: true,
    });

    const articles = result.articles;

    if (articles.length === 0) {
      await this.client.sendMessage(this.chatId,
        `📭 ${year}年${month}月${day}日没有符合条件的未读文章`);
      return;
    }

    // Send summary
    await this.client.sendMessage(this.chatId,
      `📚 找到 ${articles.length} 篇${year}年${month}月${day}日的未读文章：`);

    let sentCount = 0;
    let failedCount = 0;

    // Send articles with delay to avoid rate limits
    for (const article of articles) {
      try {
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

        const keyboard = createArticleKeyboard(
          article.id,
          article.is_read === 1,
          article.rating
        );

        await this.client.sendMessageWithKeyboard(this.chatId, message, keyboard, 'HTML');
        sentCount++;

        // Rate limiting: 1 second between messages
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        failedCount++;
        log.error({ error, articleId: article.id, title: article.title }, 'Failed to send article via /getarticles');
        // Continue with next article instead of stopping
      }
    }

    // Log result
    log.info({ userId: this.userId, year, month, day, sentCount, failedCount },
      'Sent articles via /getarticles command');

    // Notify user if some articles failed to send
    if (failedCount > 0) {
      await this.client.sendMessage(this.chatId,
        `⚠️ ${failedCount} 篇文章发送失败，请查看日志了解详情`);
    }
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
