/**
 * 企业微信 API Client
 *
 * HTTP client for WeChat Work Webhook API.
 */

import { logger } from '../logger.js';

const log = logger.child({ module: 'wechat-client' });

const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 2;

/**
 * 企业微信 API 响应接口
 */
interface WeChatApiResponse {
  errcode: number;
  errmsg: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 企业微信 Webhook Client
 */
export class WeChatClient {
  private webhookUrl: string;
  private abortController: AbortController | null = null;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  /**
   * 发送 HTTP 请求到企业微信
   */
  private async apiRequest(
    message: Record<string, any>
  ): Promise<WeChatApiResponse> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      this.abortController = new AbortController();
      const timer = setTimeout(() => this.abortController!.abort(), DEFAULT_TIMEOUT);

      try {
        log.debug({ attempt, messageType: message.msgtype }, 'WeChat API request');

        const response = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message),
          signal: this.abortController.signal,
        });

        const data = await response.json() as WeChatApiResponse;

        if (data.errcode === 0) {
          log.debug('WeChat API request successful');
          return data;
        }

        // 处理错误
        const retryable = attempt < MAX_RETRIES && data.errcode !== 40001;
        if (!retryable) {
          log.error({ errcode: data.errcode, errmsg: data.errmsg }, 'WeChat API request failed');
          throw new Error(`WeChat API error: ${data.errmsg} (errcode: ${data.errcode})`);
        }

        // 指数退避重试
        const delay = 500 * Math.pow(2, attempt);
        log.info({ attempt, delay, errcode: data.errcode }, 'Retrying WeChat API request');
        await sleep(delay);
        continue;

      } catch (error) {
        if (attempt >= MAX_RETRIES) {
          log.error({ error }, 'WeChat API request failed after retries');
          throw error;
        }

        const delay = 500 * Math.pow(2, attempt);
        log.info(
          { attempt, delay, error: error instanceof Error ? error.message : String(error) },
          'Retrying WeChat API request (network error)'
        );
        await sleep(delay);

      } finally {
        clearTimeout(timer);
        this.abortController = null;
      }
    }

    throw new Error('WeChat API request failed');
  }

  /**
   * 发送 Markdown 消息
   * @param content - Markdown 格式的内容，最长不超过 4096 个字节
   */
  async sendMarkdown(content: string): Promise<boolean> {
    try {
      const message = {
        msgtype: 'markdown',
        markdown: { content },
      };
      await this.apiRequest(message);
      return true;
    } catch (error) {
      log.error({ error }, 'Failed to send Markdown message');
      return false;
    }
  }

  /**
   * 发送文本消息
   * @param content - 文本内容，最长不超过 2048 个字节
   */
  async sendText(content: string): Promise<boolean> {
    try {
      const message = {
        msgtype: 'text',
        text: { content },
      };
      await this.apiRequest(message);
      return true;
    } catch (error) {
      log.error({ error }, 'Failed to send text message');
      return false;
    }
  }

  /**
   * 测试连接
   * 发送一条测试消息验证 webhook 是否有效
   */
  async testConnection(): Promise<boolean> {
    try {
      const success = await this.sendText('🔔 企业微信通知连接测试成功！');
      if (success) {
        log.info('WeChat connection test successful');
      }
      return success;
    } catch (error) {
      log.error({ error }, 'WeChat connection test failed');
      return false;
    }
  }

  /**
   * 中止待处理的请求
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
