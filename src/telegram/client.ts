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
import { splitMessage, getByteLength, smartTruncate } from '../utils/message-splitter.js';

const log = logger.child({ module: 'telegram-client' });

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const TELEGRAM_MAX_LENGTH = 4096;
const CHUNK_SEND_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const cause = error.cause;
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: cause instanceof Error
        ? {
            name: cause.name,
            message: cause.message,
            stack: cause.stack,
          }
        : cause,
    };
  }

  if (typeof error === 'object' && error !== null) {
    return error as Record<string, unknown>;
  }

  return { value: String(error) };
}

/**
 * Telegram Bot API Client Client
 */
export class TelegramClient {
  private botToken: string;
  private abortController: AbortController | null = null;
  private httpProxyAgent: ProxyAgent | null = null;

  constructor(botToken: string) {
    this.botToken = botToken;
    // Initialize proxy agent in constructor to ensure .env is loaded
    const httpProxy = process.env.HTTP_PROXY;
    if (httpProxy) {
      log.info({ proxy: httpProxy }, 'Telegram client configured with proxy');
      this.httpProxyAgent = new ProxyAgent(httpProxy);
    } else {
      log.warn('No HTTP proxy configured (HTTP_PROXY not set)');
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

    // Build body for POST request
    const body = JSON.stringify(params);

    // Retry logic: retry on 5xx and 429. Avoid retrying aborted sendMessage requests
    // because Telegram may have already accepted the message, which can cause duplicates.
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
          dispatcher: this.httpProxyAgent,
        } as any);

        const data = await response.json() as TelegramMessageResponse;

        // Check for HTTP error status
        if (!response.ok) {
          const statusCode = response.status;
          const errorDesc = data.description || '';

          // Don't retry for "message is not modified" errors - this is expected when
          // new keyboard is the same as current one
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

          const retryAfterSeconds = data.parameters?.retry_after;
          const delay = statusCode === 429 && typeof retryAfterSeconds === 'number'
            ? retryAfterSeconds * 1000
            : 500 * Math.pow(2, attempt);
          log.info({ method, attempt, delay, statusCode, retryAfterSeconds }, 'Retrying Telegram API request');
          await sleep(delay);
          continue;
        }

        log.debug({ method, messageId: data.result?.message_id }, 'Telegram API request successful');
        return data;

      } catch (error) {
        if (isAbortError(error) && method === 'sendMessage') {
          log.error({ method, error: serializeError(error) }, 'Telegram API request aborted, skipping retry to avoid duplicate message');
          throw error;
        }

        if (attempt >= MAX_RETRIES) {
          log.error({ method, error: serializeError(error) }, 'Telegram API request failed after retries');
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
   * Send a text message (auto-split if too long)
   * @param chatId - Target chat ID
   * @param text - Message text
   * @param parseMode - Optional parse mode ('Markdown', 'MarkdownV2', or 'HTML')
   */
  async sendMessage(
    chatId: string,
    text: string,
    parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML'
  ): Promise<TelegramMessageResponse> {
    const byteLength = getByteLength(text);

    if (byteLength <= TELEGRAM_MAX_LENGTH) {
      return this.sendSingleMessage(chatId, text, parseMode);
    }

    log.info({ byteLength, maxLength: TELEGRAM_MAX_LENGTH }, 'Message too long, splitting into chunks');

    const reservedSpace = 20;
    const chunks = splitMessage(text, TELEGRAM_MAX_LENGTH - reservedSpace);
    log.info({ chunkCount: chunks.length }, 'Split message into chunks');

    return this.sendMessageChunks(chatId, chunks, async (chunkText) => {
      return this.sendSingleMessage(chatId, chunkText, parseMode);
    });
  }

  /**
   * Send a single message without chunking
   */
  private async sendSingleMessage(
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
   * Send a message with inline keyboard (auto-split if too long)
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
    const byteLength = getByteLength(text);

    if (byteLength <= TELEGRAM_MAX_LENGTH) {
      return this.sendSingleMessageWithKeyboard(chatId, text, keyboard, parseMode);
    }

    log.info({ byteLength, maxLength: TELEGRAM_MAX_LENGTH }, 'Message too long, splitting into chunks');

    const reservedSpace = 20;
    const chunks = splitMessage(text, TELEGRAM_MAX_LENGTH - reservedSpace);
    log.info({ chunkCount: chunks.length }, 'Split message with keyboard into chunks');

    return this.sendMessageChunks(chatId, chunks, async (chunkText) => {
      return this.sendSingleMessageWithKeyboard(chatId, chunkText, keyboard, parseMode);
    });
  }

  private async sendMessageChunks(
    chatId: string,
    chunks: string[],
    sender: (chunkText: string) => Promise<TelegramMessageResponse>
  ): Promise<TelegramMessageResponse> {
    let lastResult: TelegramMessageResponse | null = null;

    for (let i = 0; i < chunks.length; i++) {
      const chunkIndex = i + 1;
      const chunkCount = chunks.length;
      const marker = chunkCount > 1 ? `[${chunkIndex}/${chunkCount}]\n\n` : '';
      const finalChunk = this.buildChunkText(marker, chunks[i]);

      log.debug({ chatId, chunkIndex, chunkCount }, 'Sending Telegram message chunk');
      lastResult = await sender(finalChunk);

      if (i < chunks.length - 1) {
        await sleep(CHUNK_SEND_DELAY_MS);
      }
    }

    return lastResult!;
  }

  private buildChunkText(marker: string, chunk: string): string {
    if (!marker) {
      return chunk;
    }

    const markedChunk = marker + chunk;
    if (getByteLength(markedChunk) <= TELEGRAM_MAX_LENGTH) {
      return markedChunk;
    }

    const markerBytes = getByteLength(marker);
    const maxContentBytes = TELEGRAM_MAX_LENGTH - markerBytes;

    const { truncated, remaining } = smartTruncate(chunk, maxContentBytes);

    if (remaining.length > 0 && getByteLength(marker + truncated) <= TELEGRAM_MAX_LENGTH) {
      return marker + truncated;
    }

    if (truncated.length > 0) {
      return marker + truncated;
    }

    const encoder = new TextEncoder();
    let len = 1;
    while (len < chunk.length && encoder.encode(chunk.substring(0, len + 1)).length <= maxContentBytes) {
      len++;
    }
    return marker + chunk.substring(0, len);
  }

  /**
   * Send a single message with keyboard without chunking
   */
  private async sendSingleMessageWithKeyboard(
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
   * Test connection by sending a simple message
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
