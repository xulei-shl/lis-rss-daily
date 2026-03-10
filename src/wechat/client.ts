/**
 * 企业微信 API Client
 *
 * HTTP client for WeChat Work Webhook API.
 * 使用 Node.js 内置 fetch，不使用代理（企业微信不需要代理）。
 */

import { logger } from '../logger.js';

const log = logger.child({ module: 'wechat-client' });

const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 2;
const MAX_MESSAGE_LENGTH = 4096; // 企业微信 Markdown 消息最大字节数

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
 * 计算 UTF-8 字节长度
 */
function getByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

/**
 * 在合适的位置截断字符串（避免在单词或 Markdown 标记中间截断）
 * 返回截断后的字符串和实际截断位置
 */
function smartTruncate(str: string, maxBytes: number): { truncated: string; remaining: string } {
  const encoder = new TextEncoder();
  const totalBytes = getByteLength(str);

  if (totalBytes <= maxBytes) {
    return { truncated: str, remaining: '' };
  }

  // 二分查找找到最大安全截断点
  let low = 0;
  let high = str.length;
  let bestLen = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const sliced = str.substring(0, mid);
    const bytes = encoder.encode(sliced).length;

    if (bytes <= maxBytes) {
      bestLen = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  // 尝试在换行、标点符号或空格处截断
  let truncateLen = bestLen;
  const slice = str.substring(0, bestLen);

  // 优先在换行处截断
  const lastNewline = slice.lastIndexOf('\n');
  if (lastNewline > bestLen * 0.5) {
    truncateLen = lastNewline + 1;
  } else {
    // 其次在句号、感叹号等标点处
    const lastPunc = Math.max(
      slice.lastIndexOf('。'),
      slice.lastIndexOf('！'),
      slice.lastIndexOf('？'),
      slice.lastIndexOf('. '),
      slice.lastIndexOf('! '),
      slice.lastIndexOf('? ')
    );
    if (lastPunc > bestLen * 0.5) {
      truncateLen = lastPunc + 1;
    } else {
      // 最后在空格处
      const lastSpace = slice.lastIndexOf(' ');
      if (lastSpace > bestLen * 0.7) {
        truncateLen = lastSpace + 1;
      }
    }
  }

  return {
    truncated: str.substring(0, truncateLen),
    remaining: str.substring(truncateLen)
  };
}

/**
 * 将长消息拆分为多条消息
 * 每条消息都在合适的位置截断，避免破坏 Markdown 格式
 */
function splitMessage(content: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let remaining = content;

  // 防止无限循环的计数器
  let loopCount = 0;
  const MAX_LOOPS = content.length; // 最多循环字符数次

  while (remaining.length > 0 && loopCount < MAX_LOOPS) {
    loopCount++;

    const { truncated, remaining: newRemaining } = smartTruncate(remaining, maxBytes);

    // 只有当截断部分包含实际内容时才添加到块中
    if (truncated.trim().length > 0) {
      chunks.push(truncated);
    }

    // 如果截断后剩余部分和原来一样，说明无法截断，需要强制截断
    if (newRemaining === remaining) {
      const encoder = new TextEncoder();
      let len = 1;
      while (len < remaining.length && encoder.encode(remaining.substring(0, len + 1)).length <= maxBytes) {
        len++;
      }
      const forceChunk = remaining.substring(0, len);
      if (forceChunk.trim().length > 0) {
        chunks.push(forceChunk);
      }
      remaining = remaining.substring(len);
    } else {
      remaining = newRemaining;
    }
  }

  return chunks;
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
        } as any);

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
   * 发送单条 Markdown 消息（不自动拆分）
   * @param content - Markdown 格式的内容，最长不超过 4096 个字节
   */
  private async sendSingleMarkdown(content: string): Promise<boolean> {
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
   * 发送 Markdown 消息（自动拆分超长消息）
   * @param content - Markdown 格式的内容，超长时自动拆分为多条发送
   */
  async sendMarkdown(content: string): Promise<boolean> {
    const byteLength = getByteLength(content);

    if (byteLength <= MAX_MESSAGE_LENGTH) {
      return await this.sendSingleMarkdown(content);
    }

    log.info({ byteLength, maxLength: MAX_MESSAGE_LENGTH }, 'Message too long, splitting into chunks');

    // 预留标记空间：**[X/Y]**\n\n 最多约 15 字节（考虑数字）
    // 先按预留空间拆分
    const reservedSpace = 20;
    const initialChunks = splitMessage(content, MAX_MESSAGE_LENGTH - reservedSpace);
    log.info({ chunkCount: initialChunks.length }, 'Split message into chunks');

    let allSuccess = true;
    for (let i = 0; i < initialChunks.length; i++) {
      let chunk = initialChunks[i];

      // 添加序号标记
      const marker = `**[${i + 1}/${initialChunks.length}]**\n\n`;
      const markedChunk = initialChunks.length > 1
        ? marker + chunk
        : chunk;

      // 再次检查：如果添加标记后仍然超长，需要进一步截断
      if (getByteLength(markedChunk) > MAX_MESSAGE_LENGTH) {
        log.warn(
          { chunkIndex: i + 1, byteLength: getByteLength(markedChunk) },
          'Chunk still too long after adding marker, truncating further'
        );
        // 计算可以保留的长度
        const markerBytes = getByteLength(marker);
        const maxContentBytes = MAX_MESSAGE_LENGTH - markerBytes;
        const { truncated } = smartTruncate(chunk, maxContentBytes);
        const finalChunk = marker + truncated;
        const success = await this.sendSingleMarkdown(finalChunk);
        if (!success) {
          allSuccess = false;
          log.error({ chunkIndex: i + 1 }, 'Failed to send message chunk');
        }
      } else {
        const success = await this.sendSingleMarkdown(markedChunk);
        if (!success) {
          allSuccess = false;
          log.error({ chunkIndex: i + 1 }, 'Failed to send message chunk');
        }
      }

      // 多条消息之间添加短暂延迟，避免触发频率限制
      if (i < initialChunks.length - 1) {
        await sleep(300);
      }
    }

    return allSuccess;
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
