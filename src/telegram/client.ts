/**
 * Telegram API Client
 *
 * HTTP client for Telegram Bot API with proxy support.
 * Uses undici ProxyAgent for proxy support.
 */

import { logger } from '../logger.js';
import type { TelegramMessageResponse } from './types.js';
import { setGlobalDispatcher, ProxyAgent } from 'undici';

const log = logger.child({ module: 'telegram-client' });

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;

// Read proxy from environment variable
const TELEGRAM_PROXY = process.env.TELEGRAM_PROXY || null;

if (TELEGRAM_PROXY) {
  log.info({ proxy: TELEGRAM_PROXY }, 'Telegram client configured with proxy');
  // Set global proxy dispatcher for undici (used by Node.js fetch)
  const agent = new ProxyAgent(TELEGRAM_PROXY);
  setGlobalDispatcher(agent);
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
        });

        const data = await response.json() as TelegramMessageResponse;

        // Check for HTTP error status
        if (!response.ok) {
          const statusCode = response.status;
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
