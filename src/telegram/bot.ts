/**
 * Telegram Bot for Interactive Callbacks
 *
 * Facade class that manages polling lifecycle and delegates to:
 * - CallbackHandler (bot-callbacks.ts) for inline keyboard interactions
 * - CommandHandler (bot-commands.ts) for /getarticles command processing
 *
 * Handles polling, state persistence, source matching, and authorization.
 */

import { logger } from '../logger.js';
import { TelegramClient } from './client.js';
import { getMergedSources, type MergedSourceOption } from '../api/articles.js';

import { CallbackHandler } from './bot-callbacks.js';
import { CommandHandler } from './bot-commands.js';
import type { CallbackQuery, TelegramUpdate, Message } from './types.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { TelegramChatConfig } from '../api/telegram-chats.js';

const log = logger.child({ module: 'telegram-bot' });

// Polling configuration
const POLL_TIMEOUT = 30; // seconds
const POLL_LIMIT = 100;
const POLL_ERROR_DELAY = 5000; // ms

// State persistence
const STATE_DIR = process.env.TELEGRAM_STATE_DIR || '/tmp/lis-rss-daily/telegram';

// Ensure state directory exists
async function ensureStateDir() {
  if (!existsSync(STATE_DIR)) {
    await mkdir(STATE_DIR, { recursive: true });
  }
}


export class TelegramBot {
  private client: TelegramClient;
  private botToken: string;
  private userId: number;
  private chats: TelegramChatConfig[];
  private isRunning: boolean = false;
  private latestUpdateId: number = 0;
  private pollTimeout: NodeJS.Timeout | null = null;

  // Handlers
  private callbackHandler: CallbackHandler;
  private commandHandler: CommandHandler;

  // Concurrency control
  private pendingCallbacks: Set<string> = new Set();
  // Dynamic polling
  private lastActivityTime: number = Date.now();
  private idlePollInterval: number = 10000;
  private activePollInterval: number = 1000;

  // State persistence
  private stateFilePath: string;

  // Source cache
  private sourcesCache: MergedSourceOption[] | null = null;
  private sourcesCacheTime: number = 0;
  private readonly SOURCES_CACHE_TTL = 5 * 60 * 1000;

  constructor(botToken: string, userId: number, chats: TelegramChatConfig[]) {
    this.botToken = botToken;
    this.userId = userId;
    this.chats = chats;
    this.client = new TelegramClient(botToken);
    this.stateFilePath = join(STATE_DIR, `bot-state-user-${userId}.json`);

    // Initialize handlers with dependency injection
    this.callbackHandler = new CallbackHandler({
      client: this.client,
      userId: this.userId,
      chats: this.chats,
      isAuthorizedChat: (chatId) => this.isAuthorizedChat(chatId),
      isAdminChat: (chatId) => this.isAdminChat(chatId),
      getChatConfig: (chatId) => this.getChatConfig(chatId),
    });

    this.commandHandler = new CommandHandler({
      client: this.client,
      userId: this.userId,
      getSources: () => this.getSources(),
      matchSourceName: (name, sources) => this.matchSourceName(name, sources),
      escapeHtml: (text) => this.escapeHtml(text),
      getTelegramAiSummary: (aiSummary) => this.getTelegramAiSummary(aiSummary),
    });
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
   */
  private matchSourceName(name: string, sources: MergedSourceOption[]): MergedSourceOption | null {
    let match = sources.find(s => s.name === name);
    if (match) return match;

    const lowerName = name.toLowerCase();
    match = sources.find(s => s.name.toLowerCase() === lowerName);
    if (match) return match;

    match = sources.find(s => s.name.includes(name));
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
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Get Telegram display-ready AI summary text
   */
  private getTelegramAiSummary(aiSummary: string | null | undefined): string {
    if (typeof aiSummary === 'string' && aiSummary.trim() !== '') {
      const marker = '二、核心逻辑图谱';
      const markerIndex = aiSummary.indexOf(marker);
      if (markerIndex !== -1) {
        return aiSummary.substring(0, markerIndex).trim();
      }
      return aiSummary;
    }

    return '未生成 AI 总结';
  }

  /**
   * Start polling for updates
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ userId: this.userId, chatCount: this.chats.length }, 'Bot already running');
      return;
    }

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
          const timeSinceActivity = Date.now() - this.lastActivityTime;
          const pollInterval = timeSinceActivity > 300000
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
   * Process updates with concurrency control
   */
  private async processUpdates(updates: TelegramUpdate[]): Promise<void> {
    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;

    for (const update of updates) {
      this.latestUpdateId = update.update_id;

      if (update.message) {
        const messageId = `${update.update_id}-msg`;

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
        continue;
      }

      if (update.callback_query) {
        const callbackId = `${update.callback_query.id}`;

        if (this.pendingCallbacks.has(callbackId)) {
          log.debug({ callbackId }, 'Callback already being processed, skipping');
          continue;
        }

        this.pendingCallbacks.add(callbackId);
        try {
          await this.callbackHandler.handleCallbackQuery(update.callback_query);
          successCount++;
        } catch (error) {
          errorCount++;
          throw error;
        } finally {
          this.pendingCallbacks.delete(callbackId);
        }
      }
    }

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

    if (updates.length > 0) {
      await this.saveState().catch((error) => {
        log.warn({ error }, 'Failed to save state after processing updates');
      });
    }
  }

  /**
   * Handle incoming message (commands) — route to CommandHandler
   */
  private async handleMessage(message: Message): Promise<void> {
    const { from, chat, text } = message;

    const chatId = String(chat.id);

    if (!this.isAuthorizedChat(chatId)) {
      log.warn({ from: from?.id, chatId }, 'Unauthorized message');
      await this.client.sendMessage(chatId, '❌ 无权操作');
      return;
    }

    if (!text || !text.startsWith('/')) {
      return;
    }

    const parts = text.trim().split(/\s+/);
    const command = parts[0]?.split('@')[0] || '';

    if (command === '/getarticles') {
      const args = parts.slice(1).join(' ');
      await this.commandHandler.handleGetArticlesCommand(args, chatId);
    } else {
      log.debug({ command, chatId }, 'Unknown command');
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
