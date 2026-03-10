/**
 * Telegram API Client
 *
 * HTTP client for Telegram Bot API with proxy support.
 * Uses undici ProxyAgent for proxy support (per-request, not global).
 */

import { logger } from '../logger.js';
import type {
  TelegramMessageResponse,
  InlineKeyboardMarkup,
  GetUpdatesResponse,
} from './types.js';
import { ProxyAgent } from 'undici';

const log = logger.child({ module: 'telegram-client' });

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;

// Read proxy from environment variable
const HTTP_PROXY = process.env.HTTP_PROXY || null;

// Create proxy agent only for Telegram requests (not global)
let httpProxyAgent: ProxyAgent | null = null;

if (HTTP_PROXY) {
  log.info({ proxy: HTTP_PROXY }, 'Telegram client configured with proxy');
  httpProxyAgent = new ProxyAgent(HTTP_PROXY);
} else {
  log.warn('No HTTP proxy configured (HTTP_PROXY not set)');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Telegram Bot API Client
 */
export class TelegramClient {
  private botToken: string;
  private abortController: AbortController | null = null;

  constructor(botToken: string) {
    this.botToken = botToken;
  }

  /**
   * Make an API request to Telegram
   */
  private async apiRequest(
    method: string,
    params: Record<string, any>
  ): Promise<TelegramMessageResponse> {
    const url = `${TELEGRAM_API_BASE}/bot${this.botToken}/${method}`;

    // Build body for POST request
    const body = JSON.stringify(params);

    // Retry logic: only retry on 5xx or 429 (rate limit)
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      this.abortController = new AbortController();
      const timer = setTimeout(() => this.abortController!.abort(), DEFAULT_TIMEOUT);

      try {
        log.debug({ method, attempt, params }, 'Telegram API request');

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body,
          signal: this.abortController.signal,
          // Only use proxy for Telegram requests (not global)
          dispatcher: httpProxyAgent,
        } as any);

        const data = await response.json() as TelegramMessageResponse;

        // Check for HTTP error status
        if (!response.ok) {
          const statusCode = response.status;
          const errorDesc = data.description || '';

          // Don't retry for "message is not modified" errors - this is expected when
          // the new keyboard is the same as the current one
          if (statusCode === 400 && errorDesc.includes('message is not modified')) {
            log.debug({ method, statusCode }, 'Message not modified, skipping update');
            return data;
          }

          const retryable = statusCode >= 500 || statusCode === 429;

          if (!retryable || attempt === MAX_RETRIES) {
            const error = data.description || `HTTP ${statusCode}`;
            log.error({ method, statusCode, error }, 'Telegram API request failed');
            throw new Error(`Telegram API error: ${error}`);
          }

          // Exponential backoff: 500ms * 2^attempt
          const delay = 500 * Math.pow(2, attempt);
          log.info({ method, attempt, delay }, 'Retrying Telegram API request');
          await sleep(delay);
          continue;
        }

        log.debug({ method, messageId: data.result?.message_id }, 'Telegram API request successful');
        return data;

      } catch (error) {
        if (attempt >= MAX_RETRIES) {
          log.error({ method, error }, 'Telegram API request failed after retries');
          throw error;
        }

        // Retry on network errors
        const delay = 500 * Math.pow(2, attempt);
        log.info({ method, attempt, delay, error: error instanceof Error ? error.message : String(error) }, 'Retrying Telegram API request (network error)');
        await sleep(delay);

      } finally {
        clearTimeout(timer);
        this.abortController = null;
      }
    }

    throw new Error('Telegram API request failed');
  }

  /**
   * Send a text message
   * @param chatId - Target chat ID
   * @param text - Message text
   * @param parseMode - Optional parse mode ('Markdown', 'MarkdownV2', or 'HTML')
   */
  async sendMessage(
    chatId: string,
    text: string,
    parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML'
  ): Promise<TelegramMessageResponse> {
    const params: Record<string, any> = {
      chat_id: chatId,
      text: text,
    };

    if (parseMode) {
      params.parse_mode = parseMode;
    }

    return this.apiRequest('sendMessage', params);
  }

  /**
   * Send a message with inline keyboard
   * @param chatId - Target chat ID
   * @param text - Message text
   * @param keyboard - Inline keyboard markup
   * @param parseMode - Optional parse mode
   */
  async sendMessageWithKeyboard(
    chatId: string,
    text: string,
    keyboard: InlineKeyboardMarkup,
    parseMode?: 'HTML'
  ): Promise<TelegramMessageResponse> {
    const params: Record<string, any> = {
      chat_id: chatId,
      text: text,
      reply_markup: keyboard,
    };

    if (parseMode) {
      params.parse_mode = parseMode;
    }

    return this.apiRequest('sendMessage', params);
  }

  /**
   * Edit message reply markup (inline keyboard)
   * @param chatId - Chat ID
   * @param messageId - Message ID to edit
   * @param keyboard - New inline keyboard markup (or empty to remove)
   */
  async editMessageReplyMarkup(
    chatId: string,
    messageId: number,
    keyboard: InlineKeyboardMarkup
  ): Promise<TelegramMessageResponse> {
    const params: Record<string, any> = {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard,
    };

    return this.apiRequest('editMessageReplyMarkup', params);
  }

  /**
   * Answer callback query (removes loading state)
   * @param queryId - Callback query ID
   * @param text - Optional notification text
   * @param showAlert - Whether to show as alert (true) or toast (false)
   */
  async answerCallbackQuery(
    queryId: string,
    text?: string,
    showAlert?: boolean
  ): Promise<{ ok: boolean }> {
    const params: Record<string, any> = {
      callback_query_id: queryId,
    };

    if (text !== undefined) {
      params.text = text;
    }
    if (showAlert !== undefined) {
      params.show_alert = showAlert;
    }

    return this.apiRequest('answerCallbackQuery', params) as Promise<{ ok: boolean }>;
  }

  /**
   * Get updates (polling)
   * @param offset - Offset for pagination (use highest update_id + 1)
   * @param limit - Limit number of updates (1-100, default 100)
   * @param timeout - Long polling timeout in seconds (0 for short polling)
   */
  async getUpdates(
    offset?: number,
    limit: number = 100,
    timeout: number = 30
  ): Promise<GetUpdatesResponse> {
    const params: Record<string, any> = {
      limit: Math.min(limit, 100),
      timeout: Math.max(timeout, 0),
    };

    if (offset !== undefined) {
      params.offset = offset;
    }

    return this.apiRequest('getUpdates', params) as unknown as Promise<GetUpdatesResponse>;
  }

  /**
   * Test the connection by sending a simple message
   */
  async testConnection(chatId: string): Promise<boolean> {
    try {
      const result = await this.sendMessage(chatId, '🔔 Telegram 通知连接测试成功！', 'Markdown');
      return result.ok;
    } catch (error) {
      log.error({ error }, 'Telegram connection test failed');
      return false;
    }
  }

  /**
   * Abort any pending requests
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
