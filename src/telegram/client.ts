/**
 * Telegram API Client
 *
 * HTTP client for Telegram Bot API with proxy support.
 * Uses undici for better control over proxy configuration and retries.
 */

import { request } from 'undici';
import { ProxyAgent } from 'undici';
import { logger } from '../logger.js';
import type { TelegramMessageResponse } from './types.js';

const log = logger.child({ module: 'telegram-client' });

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;

// Read proxy from environment variable
const TELEGRAM_PROXY = process.env.TELEGRAM_PROXY || null;

if (TELEGRAM_PROXY) {
  log.info({ proxy: TELEGRAM_PROXY }, 'Telegram client configured with proxy');
} else {
  log.warn('No Telegram proxy configured (TELEGRAM_PROXY not set)');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Telegram Bot API Client
 */
export class TelegramClient {
  private botToken: string;
  private proxyAgent: ProxyAgent | undefined;
  private abortController: AbortController | null = null;

  constructor(botToken: string) {
    this.botToken = botToken;

    if (TELEGRAM_PROXY) {
      this.proxyAgent = new ProxyAgent(TELEGRAM_PROXY);
    }
  }

  /**
   * Make an API request to Telegram
   */
  private async apiRequest(
    method: string,
    params: Record<string, any>
  ): Promise<TelegramMessageResponse> {
    const url = `${TELEGRAM_API_BASE}/bot${this.botToken}/${method}`;

    // Build query string for GET requests
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        queryParams.append(key, String(value));
      }
    }

    const fullUrl = `${url}?${queryParams.toString()}`;

    // Retry logic: only retry on 5xx or 429 (rate limit)
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      this.abortController = new AbortController();
      const timer = setTimeout(() => this.abortController!.abort(), DEFAULT_TIMEOUT);

      try {
        log.debug({ method, attempt }, 'Telegram API request');

        const response = await request(fullUrl, {
          method: 'GET',
          dispatcher: this.proxyAgent,
          headers: {
            'Accept': 'application/json',
          },
          signal: this.abortController.signal,
        });

        const data = await response.body.json() as TelegramMessageResponse;

        // Check for HTTP error status (undici uses statusCode, not ok)
        const statusCode = response.statusCode;
        const isSuccess = statusCode >= 200 && statusCode < 300;

        if (!isSuccess) {
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
        log.info({ method, attempt, delay }, 'Retrying Telegram API request (network error)');
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
   * @param parseMode - Optional parse mode ('Markdown' or 'MarkdownV2')
   */
  async sendMessage(
    chatId: string,
    text: string,
    parseMode?: 'Markdown' | 'MarkdownV2'
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
