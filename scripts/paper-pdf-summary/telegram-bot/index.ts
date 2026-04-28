/**
 * Paper PDF Summary Telegram Bot
 *
 * Handles /start, /help, and /papers commands.
 * Uses long polling with undici ProxyAgent for proxy support.
 */

import { config } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env') });
import { ProxyAgent } from 'undici';
import { log } from './logger.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const DEFAULT_TIMEOUT = 300;
const POLL_TIMEOUT = 30;
const POLL_LIMIT = 100;

interface TelegramMessageResponse {
  ok: boolean;
  result?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
  description?: string;
}

interface GetUpdatesResponse {
  ok: boolean;
  result?: TelegramUpdate[];
  description?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    from?: { id: number };
    text?: string;
    date: number;
  };
}

interface ProcessApiResponse {
  success?: boolean;
  stages?: Record<string, string>;
  reason?: string;
  md_path?: string;
}

class TelegramClient {
  private botToken: string;
  private httpProxyAgent: ProxyAgent | null = null;
  private abortController: AbortController | null = null;

  constructor(botToken: string) {
    this.botToken = botToken;
    const httpProxy = process.env.HTTP_PROXY;
    if (httpProxy) {
      log.info('Telegram client configured with proxy', { proxy: httpProxy });
      this.httpProxyAgent = new ProxyAgent(httpProxy);
    } else {
      log.warn('No HTTP proxy configured (HTTP_PROXY not set)');
    }
  }

  private async apiRequest(
    method: string,
    params: Record<string, unknown>
  ): Promise<TelegramMessageResponse | GetUpdatesResponse> {
    const url = `${TELEGRAM_API_BASE}/bot${this.botToken}/${method}`;
    const timeout = DEFAULT_TIMEOUT * 1000;

    this.abortController = new AbortController();
    const timer = setTimeout(() => this.abortController!.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
        signal: this.abortController.signal,
        dispatcher: this.httpProxyAgent ?? undefined,
      } as RequestInit & { dispatcher?: ProxyAgent });

      const data = await response.json() as TelegramMessageResponse | GetUpdatesResponse;

      if (!response.ok) {
        const err = (data as TelegramMessageResponse).description || `HTTP ${response.status}`;
        log.error('Telegram API request failed', { method, status: response.status, error: err });
        throw new Error(`Telegram API error: ${err}`);
      }

      log.debug('Telegram API request successful', { method });
      return data;

    } finally {
      clearTimeout(timer);
      this.abortController = null;
    }
  }

  async sendMessage(chatId: number, text: string): Promise<TelegramMessageResponse> {
    return this.apiRequest('sendMessage', { chat_id: chatId, text }) as Promise<TelegramMessageResponse>;
  }

  async getUpdates(offset?: number): Promise<GetUpdatesResponse> {
    const params: Record<string, unknown> = {
      limit: POLL_LIMIT,
      timeout: POLL_TIMEOUT,
    };
    if (offset !== undefined) {
      params.offset = offset;
    }
    return this.apiRequest('getUpdates', params) as Promise<GetUpdatesResponse>;
  }

  async setCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
    try {
      await this.apiRequest('setMyCommands', { commands });
      log.info('Bot commands registered with BotFather');
    } catch (error) {
      log.warn('Failed to set bot commands', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}

interface ParsedCommand {
  title: string;
  articleId?: number;
  pushWechat?: boolean;
}

class PaperTelegramBot {
  private botToken: string;
  private allowedUserId: string | undefined;
  private apiBaseUrl: string;
  private apiTimeout: number;
  private httpProxyAgent: ProxyAgent | null = null;
  private client: TelegramClient;
  private isProcessing: boolean = false;
  private latestUpdateId: number = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    if (!this.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN environment variable is not set');
    }

    this.allowedUserId = process.env.TELEGRAM_USER_ID;
    this.apiBaseUrl = process.env.TELEGRAM_API_URL || 'http://localhost:8081';
    this.apiTimeout = parseInt(process.env.TELEGRAM_API_TIMEOUT || String(DEFAULT_TIMEOUT), 10);

    const httpProxy = process.env.HTTP_PROXY;
    if (httpProxy) {
      this.httpProxyAgent = new ProxyAgent(httpProxy);
    }

    this.client = new TelegramClient(this.botToken);
  }

  private checkUser(userId: number): boolean {
    if (!this.allowedUserId) return true;
    return String(userId) === this.allowedUserId;
  }

  private parseCommand(text: string): ParsedCommand | null {
    text = text.trim();

    let title: string;
    let articleId: number | undefined;
    let pushWechat = false;

    const wechatMatch = text.match(/--wechat/i);
    if (wechatMatch) {
      pushWechat = true;
      text = text.replace(/--wechat/gi, '').trim();
    }

    if (text.includes('@')) {
      const lastAt = text.lastIndexOf('@');
      const beforeAt = text.substring(0, lastAt).trim();
      const afterAt = text.substring(lastAt + 1).trim();

      if (!beforeAt) return null;

      title = beforeAt;

      if (afterAt) {
        const parsed = parseInt(afterAt, 10);
        if (!isNaN(parsed)) {
          articleId = parsed;
        }
      }
    } else {
      title = text;
    }

    return { title: title || '', articleId, pushWechat };
  }

  private async callApi(title: string, articleId?: number, pushWechat?: boolean): Promise<ProcessApiResponse> {
    const payload: Record<string, unknown> = { title };
    if (articleId !== undefined) {
      payload.id = articleId;
    }
    if (pushWechat) {
      payload.push_wechat = true;
    }

    log.info('Calling API', { url: `${this.apiBaseUrl}/process`, payload });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.apiTimeout * 1000);

    try {
      const response = await fetch(`${this.apiBaseUrl}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
        dispatcher: this.httpProxyAgent ?? undefined,
      } as RequestInit & { dispatcher?: ProxyAgent });

      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`API error ${response.status}: ${text}`);
      }

      return await response.json() as ProcessApiResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  private formatResponse(title: string, result: ProcessApiResponse): string {
    const success = result.success ?? false;
    const stages = result.stages ?? {};
    const reason = result.reason;
    const mdPath = result.md_path;

    const lines: string[] = [];
    lines.push(`📄 论文处理结果\n`);
    lines.push(`标题: ${title}\n`);

    if (success) {
      lines.push('\n✅ 成功\n');

      const pdfDownload = stages['pdf_download'] ?? '❓';
      const pdfValidate = stages['pdf_validate'] ?? '❓';
      const pdfSummary = stages['pdf_summary'] ?? '❓';

      lines.push(`📥 PDF下载: ${pdfDownload === 'success' ? '✅' : '❌'}`);
      lines.push(`📋 PDF验证: ${pdfValidate === 'success' ? '✅' : '❌'}`);
      lines.push(`📝 摘要生成: ${pdfSummary === 'success' ? '✅' : '❌'}`);

      const upload = (stages['upload'] as unknown) as Record<string, boolean> | undefined;
      if (upload) {
        lines.push('\n📤 上传:');
        lines.push(`   • HiAgent RAG: ${upload['hiagent_rag'] ? '✅' : '❌'}`);
        lines.push(`   • LIS-RSS: ${upload['lis_rss'] ? '✅' : '❌'}`);
        lines.push(`   • Memos: ${upload['memos'] ? '✅' : '❌'}`);
        lines.push(`   • Blinko: ${upload['blinko'] ? '✅' : '❌'}`);
        lines.push(`   • 企业微信: ${upload['wechat'] ? '✅' : '❌'}`);
      }

      if (mdPath) {
        lines.push(`\n📁 摘要文件: \`${mdPath}\``);
      }
    } else {
      lines.push('\n❌ 失败\n');
      if (reason) {
        lines.push(reason);
      }
    }

    return lines.join('\n');
  }

  private async handleMessage(chatId: number, userId: number, text: string): Promise<void> {
    if (!text || !text.startsWith('/')) return;

    const parts = text.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (command) {
      case '/start':
        await this.handleStart(chatId, userId);
        break;
      case '/help':
        await this.handleHelp(chatId, userId);
        break;
      case '/papers':
        await this.handlePapers(chatId, userId, args);
        break;
      default:
        log.debug('Unknown command', { command, chatId });
    }
  }

  private async handleStart(chatId: number, userId: number): Promise<void> {
    if (!this.checkUser(userId)) {
      await this.sendText(chatId, '❌ 无权限访问');
      return;
    }
    await this.sendText(chatId,
      '📚 论文PDF摘要机器人\n\n' +
      '欢迎使用！发送 /help 查看使用方法'
    );
  }

  private async handleHelp(chatId: number, userId: number): Promise<void> {
    if (!this.checkUser(userId)) {
      await this.sendText(chatId, '❌ 无权限访问');
      return;
    }
    await this.sendText(chatId,
      '📖 使用帮助\n\n' +
      '命令：/papers <标题> [@ID] [--wechat]\n\n' +
      '示例：\n' +
      '• /papers Attention Is All You Need\n' +
      '• /papers Attention Is All You Need @123\n' +
      '• /papers Attention Is All You Need --wechat\n' +
      '• /papers Attention Is All You Need @123 --wechat\n\n' +
      '说明：\n' +
      '• <标题> - 论文标题（必填）\n' +
      '• @ID - LIS-RSS系统ID（可选）\n' +
      '• --wechat - 强制启用企业微信推送（可选，默认按.env配置）\n' +
      '• 同时只能处理一个任务'
    );
  }

  private async handlePapers(chatId: number, userId: number, args: string): Promise<void> {
    log.info('User sent /papers command', { userId });

    if (!this.checkUser(userId)) {
      log.warn('Unauthorized user attempted access', { userId });
      await this.sendText(chatId, '❌ 无权限访问');
      return;
    }

    if (this.isProcessing) {
      log.info('User request ignored: already processing', { userId });
      await this.sendText(chatId, '⏳ 正在处理上一个任务，请稍后再试');
      return;
    }

    if (!args) {
      await this.sendText(chatId,
        '请提供论文标题\n' +
        '示例：/papers Attention Is All You Need'
      );
      return;
    }

    const parsed = this.parseCommand(args);
    if (!parsed || !parsed.title) {
      await this.sendText(chatId,
        '无法解析标题，请检查格式\n' +
        '示例：/papers Attention Is All You Need'
      );
      return;
    }

    log.info('Processing request', { title: parsed.title, articleId: parsed.articleId, pushWechat: parsed.pushWechat });
    this.isProcessing = true;

    try {
      await this.sendText(chatId, `📥 开始处理: ${parsed.title}\n⏳ 等待结果中...`);

      const result = await this.callApi(parsed.title, parsed.articleId, parsed.pushWechat);
      log.info('API returned result', { success: result.success, stages: result.stages });

      const responseText = this.formatResponse(parsed.title, result);
      await this.sendText(chatId, responseText);

    } catch (error) {
      log.error('Processing exception', { error: error instanceof Error ? error.message : String(error) });
      await this.sendText(chatId, `❌ 处理异常: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.isProcessing = false;
    }
  }

  private async sendText(chatId: number, text: string): Promise<void> {
    try {
      await this.client.sendMessage(chatId, text);
    } catch (error) {
      log.error('Failed to send message', { chatId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn('Bot already running');
      return;
    }

    log.info('Starting Telegram bot...');

    await this.client.setCommands([
      { command: 'start', description: '开始使用机器人' },
      { command: 'help', description: '查看帮助信息' },
      { command: 'papers', description: '处理论文PDF摘要' },
    ]);

    this.isRunning = true;
    this.poll();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.client.abort();
    log.info('Telegram bot stopped');
  }

  private poll(): void {
    if (!this.isRunning) return;

    this.fetchUpdates()
      .then((updates) => {
        if (updates.length > 0) {
          this.processUpdates(updates);
        }
      })
      .catch((error) => {
        log.error('Error polling for updates', { error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        if (this.isRunning) {
          this.pollTimer = setTimeout(() => this.poll(), 1000);
        }
      });
  }

  private async fetchUpdates(): Promise<TelegramUpdate[]> {
    try {
      const response = await this.client.getUpdates(
        this.latestUpdateId > 0 ? this.latestUpdateId + 1 : undefined
      );

      if (response.ok && response.result) {
        return response.result;
      }
      return [];
    } catch (error) {
      log.error('Error in getUpdates', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  private async processUpdates(updates: TelegramUpdate[]): Promise<void> {
    for (const update of updates) {
      this.latestUpdateId = update.update_id;

      if (update.message) {
        const { chat, from, text } = update.message;
        const chatId = chat.id;
        const userId = from?.id ?? 0;

        await this.handleMessage(chatId, userId, text ?? '');
      }
    }
  }
}

async function main(): Promise<void> {
  log.info('Paper PDF Summary Telegram Bot starting...');

  const bot = new PaperTelegramBot();

  process.on('SIGINT', async () => {
    log.info('Received SIGINT, shutting down...');
    await bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    log.info('Received SIGTERM, shutting down...');
    await bot.stop();
    process.exit(0);
  });

  await bot.start();
}

main().catch((error) => {
  log.error('Fatal error', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
