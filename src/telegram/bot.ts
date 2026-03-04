/**
 * Telegram Bot for Interactive Callbacks
 *
 * Handles polling and processing of callback queries from Telegram inline keyboards.
 * Provides article management features: mark as read/unread, rate articles.
 * Supports multiple chat IDs with different permission levels (admin/viewer).
 */

import { logger } from '../logger.js';
import { TelegramClient } from './client.js';
import { getArticleById, updateArticleReadStatus, updateArticleRating, getUserArticles, getMergedSources, type MergedSourceOption } from '../api/articles.js';
import { decodeCallback, CallbackAction } from './callback-encoder.js';
import { createArticleKeyboard, createRatingKeyboard, createEmptyKeyboard, formatNewArticle } from './formatters.js';
import type { CallbackQuery, TelegramUpdate, InlineKeyboardMarkup, Message } from './types.js';
import { parseGetArticlesCommand, type GetArticlesCommand, type GetArticlesDateCommand, type GetArticlesSourceCommand } from './command-parser.js';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getUserLocalDate } from '../api/timezone.js';
import { isChatAdmin, type TelegramChatConfig } from '../api/telegram-chats.js';

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
  private chats: TelegramChatConfig[]; // All configured chats
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

  // Source cache for matching
  private sourcesCache: MergedSourceOption[] | null = null;
  private sourcesCacheTime: number = 0;
  private readonly SOURCES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(botToken: string, userId: number, chats: TelegramChatConfig[]) {
    this.botToken = botToken;
    this.userId = userId;
    this.chats = chats;
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
        chatCount: this.chats.length,
        savedAt: new Date().toISOString(),
      };
      await writeFile(statePath, JSON.stringify(state, null, 2));
    } catch (error) {
      log.error({ userId: this.userId, error }, 'Failed to save bot state');
    }
  }

  /**
   * Check if a chat ID is in the configured chats list
   */
  private isAuthorizedChat(chatId: string): boolean {
    return this.chats.some(chat => chat.chatId === chatId);
  }

  /**
   * Check if a chat ID has admin role
   */
  private isAdminChat(chatId: string): boolean {
    const chat = this.chats.find(c => c.chatId === chatId);
    return chat?.role === 'admin';
  }

  /**
   * Get chat config by chat ID
   */
  private getChatConfig(chatId: string): TelegramChatConfig | undefined {
    return this.chats.find(c => c.chatId === chatId);
  }

  /**
   * Get sources list with caching
   */
  private async getSources(): Promise<MergedSourceOption[]> {
    const now = Date.now();
    if (this.sourcesCache && (now - this.sourcesCacheTime) < this.SOURCES_CACHE_TTL) {
      return this.sourcesCache;
    }

    this.sourcesCache = await getMergedSources(this.userId);
    this.sourcesCacheTime = now;
    return this.sourcesCache;
  }

  /**
   * Match source name with fuzzy matching
   * @param name - User input source name
   * @param sources - List of available sources
   * @returns Matched source or null
   */
  private matchSourceName(name: string, sources: MergedSourceOption[]): MergedSourceOption | null {
    // 1. Exact match
    let match = sources.find(s => s.name === name);
    if (match) return match;

    // 2. Case-insensitive match
    const lowerName = name.toLowerCase();
    match = sources.find(s => s.name.toLowerCase() === lowerName);
    if (match) return match;

    // 3. Source name contains input (e.g., "MIT" matches "MIT Technology Review")
    match = sources.find(s => s.name.includes(name));
    if (match) return match;

    // 4. Input contains source name (e.g., "Technology Review" matches "MIT Technology Review")
    match = sources.find(s => name.includes(s.name));
    if (match) return match;

    return null;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Start polling for updates
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ userId: this.userId, chatCount: this.chats.length }, 'Bot already running');
      return;
    }

    // Load persisted state before starting
    await this.loadState();

    this.isRunning = true;
    log.info({
      userId: this.userId,
      chatCount: this.chats.length,
      chats: this.chats.map(c => ({ chatId: c.chatId, role: c.role })),
      latestUpdateId: this.latestUpdateId
    }, 'Starting Telegram bot polling');

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

    log.info({ userId: this.userId, chatCount: this.chats.length }, 'Telegram bot stopped');
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
   * Handle callback query with improved error handling and permission checking
   */
  private async handleCallbackQuery(callbackQuery: CallbackQuery): Promise<void> {
    const { id: queryId, from, message, data } = callbackQuery;

    // Get chat ID from message
    const chatId = String(message?.chat.id);

    // Check if this chat is authorized
    if (!this.isAuthorizedChat(chatId)) {
      log.warn({ queryId, from: from.id, chatId }, 'Unauthorized callback query');
      await this.client.answerCallbackQuery(queryId, '❌ 无权操作', true);
      return;
    }

    // Check if this chat has admin role
    const isAdmin = this.isAdminChat(chatId);
    const chatConfig = this.getChatConfig(chatId);

    // Decode callback data
    const decoded = decodeCallback(data);
    if (!decoded) {
      log.warn({ queryId, data }, 'Invalid callback data');
      await this.client.answerCallbackQuery(queryId, '❌ 无效的操作', true);
      return;
    }

    const { action, articleId, value } = decoded;
    const messageId = message?.message_id;

    // For viewer role, only allow viewing operations, not modifications
    if (!isAdmin) {
      // Viewer can only view rating options, but cannot rate or mark as read
      if (action === CallbackAction.SHOW_RATING) {
        // Allow showing rating keyboard for viewer, but show a notice
        await this.client.answerCallbackQuery(queryId, 'ℹ️ 您是观察者，仅管理员可评分');
        // Still show the rating keyboard but with a visual indication
        if (messageId !== undefined) {
          try {
            const keyboard = createRatingKeyboard(articleId);
            await this.client.editMessageReplyMarkup(chatId, messageId, keyboard);
          } catch (error) {
            log.warn({ articleId, messageId, error }, 'Failed to show rating keyboard for viewer');
          }
        }
        return;
      }

      if (action === CallbackAction.CANCEL) {
        // Allow cancel for viewer
        await this.client.answerCallbackQuery(queryId, '✅ 已取消');
        return;
      }

      // All other actions require admin role
      log.info({ queryId, chatId, action, role: chatConfig?.role }, 'Viewer attempted admin action');
      await this.client.answerCallbackQuery(queryId, '❌ 无权限操作，仅管理员可交互', true);
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
    messageId: number | undefined,
    chatId: string
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
        await this.client.editMessageReplyMarkup(chatId, messageId, keyboard);
      } catch (error) {
        // Don't fail the operation if keyboard update fails
        log.warn({ articleId, messageId, error }, 'Failed to update keyboard after marking read');
      }
    }

    log.info({ articleId, userId: this.userId, isRead: newReadStatus, chatId }, 'Article read status toggled via Telegram');
  }

  /**
   * Handle rating submission with robust error handling
   */
  private async handleRate(
    queryId: string,
    articleId: number,
    rating: number,
    messageId: number | undefined,
    chatId: string
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
        await this.client.editMessageReplyMarkup(chatId, messageId, keyboard);
      } catch (error) {
        // Don't fail the operation if keyboard update fails
        log.warn({ articleId, messageId, error }, 'Failed to update keyboard after rating');
      }
    }

    log.info({ articleId, userId: this.userId, rating, chatId }, 'Article rated via Telegram');
  }

  /**
   * Handle show rating keyboard with robust error handling
   */
  private async handleShowRating(
    queryId: string,
    articleId: number,
    messageId: number | undefined,
    chatId: string
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
        await this.client.editMessageReplyMarkup(chatId, messageId, keyboard);
      } catch (error) {
        log.warn({ articleId, messageId, error }, 'Failed to show rating keyboard');
      }
    }

    log.debug({ articleId, userId: this.userId, chatId }, 'Rating keyboard shown via Telegram');
  }

  /**
   * Handle cancel operation with robust error handling
   */
  private async handleCancel(
    queryId: string,
    articleId: number,
    messageId: number | undefined,
    chatId: string
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
        await this.client.editMessageReplyMarkup(chatId, messageId, keyboard);
      } catch (error) {
        log.warn({ articleId, messageId, error }, 'Failed to restore keyboard after cancel');
      }
    }

    log.debug({ articleId, userId: this.userId, chatId }, 'Rating keyboard cancelled via Telegram');
  }

  /**
   * Handle incoming message (commands)
   */
  private async handleMessage(message: Message): Promise<void> {
    const { from, chat, text } = message;

    // Get chat ID
    const chatId = String(chat.id);

    // Check if this chat is authorized
    if (!this.isAuthorizedChat(chatId)) {
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

    // Check if this chat has admin role for write operations
    const isAdmin = this.isAdminChat(chatId);

    switch (command) {
      case '/getarticles':
        // This is a read-only command, allowed for all authorized chats
        await this.handleGetArticlesCommandWrapper(parts.slice(1).join(' '), chatId);
        break;

      default:
        log.debug({ command, chatId }, 'Unknown command');
    }
  }

  /**
   * Wrapper for getarticles command with error handling
   */
  private async handleGetArticlesCommandWrapper(args: string, chatId: string): Promise<void> {
    try {
      const parsed = parseGetArticlesCommand(args);
      if (!parsed) {
        await this.client.sendMessage(chatId,
          '❌ 格式错误。\n' +
          '按日期：/getarticles YYYY-MM-DD 或 YYYYMMDD\n' +
          '按来源：/getarticles 来源名称\n' +
          '例如：/getarticles 2026-3-1 或 /getarticles MIT Technology Review');
        return;
      }

      if (parsed.type === 'date') {
        await this.handleGetArticlesByDate(parsed, chatId);
      } else {
        await this.handleGetArticlesBySource(parsed, chatId);
      }
    } catch (error) {
      log.error({ error, args }, 'Error in getarticles command');
      await this.client.sendMessage(chatId, '❌ 查询失败，请稍后重试');
    }
  }

  /**
   * Handle /getarticles command by date
   */
  private async handleGetArticlesByDate(command: GetArticlesDateCommand, chatId: string): Promise<void> {
    const { year, month, day } = command;
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
      await this.client.sendMessage(chatId,
        `📭 ${year}年${month}月${day}日没有符合条件的未读文章`);
      return;
    }

    // Send summary
    await this.client.sendMessage(chatId,
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

        await this.client.sendMessageWithKeyboard(chatId, message, keyboard, 'HTML');
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
    log.info({ userId: this.userId, year, month, day, sentCount, failedCount, chatId },
      'Sent articles via /getarticles command');

    // Notify user if some articles failed to send
    if (failedCount > 0) {
      await this.client.sendMessage(chatId,
        `⚠️ ${failedCount} 篇文章发送失败，请查看日志了解详情`);
    }
  }

  /**
   * Handle /getarticles command by source name
   */
  private async handleGetArticlesBySource(command: GetArticlesSourceCommand, chatId: string): Promise<void> {
    const sources = await this.getSources();
    const matchedSource = this.matchSourceName(command.name, sources);

    if (!matchedSource) {
      await this.client.sendMessage(chatId,
        `❌ 未找到来源 "${this.escapeHtml(command.name)}"\n` +
        `提示：可以使用完整的来源名称，例如 "MIT Technology Review"`);
      return;
    }

    // Build query parameters
    const queryParams: any = {
      isRead: false,
      filterStatus: 'passed',
      limit: 5,
      page: 1,
      randomOrder: true,
    };

    if (matchedSource.rssIds) queryParams.rssSourceIds = matchedSource.rssIds;
    if (matchedSource.journalIds) queryParams.journalIds = matchedSource.journalIds;
    if (matchedSource.keywordIds) queryParams.keywordIds = matchedSource.keywordIds;

    const result = await getUserArticles(this.userId, queryParams);

    if (result.articles.length === 0) {
      await this.client.sendMessage(chatId,
        `📭 来源 "${this.escapeHtml(matchedSource.name)}" 没有符合条件的未读文章`);
      return;
    }

    await this.client.sendMessage(chatId,
      `📚 找到 ${result.articles.length} 篇来自 "${this.escapeHtml(matchedSource.name)}" 的未读文章：`);

    let sentCount = 0;
    let failedCount = 0;

    // Send articles with delay to avoid rate limits
    for (const article of result.articles) {
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

        await this.client.sendMessageWithKeyboard(chatId, message, keyboard, 'HTML');
        sentCount++;

        // Rate limiting: 1 second between messages
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        failedCount++;
        log.error({ error, articleId: article.id, title: article.title }, 'Failed to send article via /getarticles by source');
        // Continue with next article instead of stopping
      }
    }

    // Log result
    log.info({ userId: this.userId, sourceName: matchedSource.name, sentCount, failedCount, chatId },
      'Sent articles via /getarticles command by source');

    // Notify user if some articles failed to send
    if (failedCount > 0) {
      await this.client.sendMessage(chatId,
        `⚠️ ${failedCount} 篇文章发送失败，请查看日志了解详情`);
    }
  }
}

/**
 * Initialize Telegram Bot for a user
 */
export function initUserBot(botToken: string, userId: number, chats: TelegramChatConfig[]): TelegramBot | null {
  if (!botToken || chats.length === 0) {
    return null;
  }

  return new TelegramBot(botToken, userId, chats);
}
