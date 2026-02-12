/**
 * LLM Call Logger
 *
 * 专门用于记录大模型调用过程中的调试信息，包括：
 * - API Key（脱敏）
 * - 模型名
 * - Base URL
 * - 系统提示词
 * - 用户提示词
 * - 请求参数
 * - 响应结果
 * - 调用耗时
 */

import pino from 'pino';
import pinoPretty from 'pino-pretty';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * 创建独立的 LLM 日志记录器
 */
function createLLMLogger(): pino.Logger {
  const level = process.env.LOG_LEVEL || 'info';
  const llmLogFile = config.llmLogFile;

  // Pretty stream for stdout
  const prettyStream = pinoPretty({ colorize: true });

  if (!llmLogFile) {
    // 如果没有设置 LLM_LOG_FILE，使用主 logger 的 child
    return logger.child({ module: 'llm-call' });
  }

  // 创建独立的 LLM 日志文件
  const absPath = path.resolve(llmLogFile);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const fileStream = fs.createWriteStream(absPath, { flags: 'a' });

  const multistream = pino.multistream([
    { level: level as pino.Level, stream: prettyStream },
    { level: level as pino.Level, stream: fileStream },
  ]);

  return pino({ level }, multistream);
}

const llmLog = createLLMLogger();
let llmCallCounter = 0;

/**
 * 脱敏 API Key，只显示前 4 位和后 4 位
 */
function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length <= 8) {
    return '***';
  }
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

/**
 * 脱敏 Base URL 中的敏感信息
 */
function maskBaseUrl(baseUrl: string): string {
  // 如果 URL 中包含 api key，进行脱敏
  try {
    const url = new URL(baseUrl);
    if (url.searchParams.has('key')) {
      const key = url.searchParams.get('key')!;
      url.searchParams.set('key', maskApiKey(key));
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

/**
 * 截断过长的文本，避免日志过大
 */
function truncateText(text: string, maxLength: number = 500): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}... (truncated, total: ${text.length} chars)`;
}

/**
 * 是否记录完整提示词（支持采样）
 */
function shouldLogFullPrompt(): { enabled: boolean; sampleRate: number } {
  if (config.llmLogFullPrompt) {
    return { enabled: true, sampleRate: 1 };
  }

  const rawRate = config.llmLogFullSampleRate;
  const sampleRate = Number.isFinite(rawRate) && rawRate > 0 ? Math.floor(rawRate) : 20;

  if (sampleRate <= 1) {
    return { enabled: true, sampleRate: 1 };
  }

  const count = ++llmCallCounter;
  return { enabled: count % sampleRate === 0, sampleRate };
}

/**
 * 提取系统提示词
 */
function extractSystemPrompt(messages: Array<{ role: string; content: string }>): string {
  const systemMsg = messages.find((m) => m.role === 'system');
  return systemMsg?.content || '';
}

/**
 * 提取用户提示词
 */
function extractUserPrompt(messages: Array<{ role: string; content: string }>): string {
  const userMessages = messages.filter((m) => m.role === 'user');
  return userMessages.map((m) => m.content).join('\n\n');
}

/**
 * 大模型调用上下文
 */
export interface LLMCallContext {
  provider: string; // 'openai' | 'gemini' | 'custom'
  model: string;
  apiKey: string;
  baseUrl: string;
  apiKeySource?: string;
  baseUrlSource?: string;
  modelSource?: string;
  label?: string; // 用于标识调用的用途，如 'filter', 'translate'
  userId?: number;
  configId?: number;
}

/**
 * 大模型调用参数
 */
export interface LLMCallParams {
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  systemPromptSource?: string;
  userPromptSource?: string;
  [key: string]: any; // 其他参数
}

/**
 * 大模型调用结果
 */
export interface LLMCallResult {
  success: boolean;
  response?: string;
  error?: Error;
  responseLength?: number;
  elapsedMs: number;
}

/**
 * 大模型调用日志会话
 *
 * 使用方式：
 * ```typescript
 * const session = LLMLogger.start({ provider: 'openai', model: 'gpt-4', apiKey: 'sk-...', baseUrl: 'https://...', label: 'filter' });
 * session.logRequest({ messages: [...], temperature: 0.7 });
 * // ... 执行调用 ...
 * session.logResponse({ success: true, response: '...', elapsedMs: 1234 });
 * ```
 */
export class LLMLoggerSession {
  private startTime: number;
  private context: LLMCallContext;

  constructor(context: LLMCallContext) {
    this.startTime = Date.now();
    this.context = context;
  }

  /**
   * 记录请求开始
   */
  logRequest(params: LLMCallParams): void {
    const systemPrompt = extractSystemPrompt(params.messages);
    const userPrompt = extractUserPrompt(params.messages);
    const fullPromptState = shouldLogFullPrompt();
    const systemPromptLogged = fullPromptState.enabled ? systemPrompt : truncateText(systemPrompt);
    const userPromptLogged = fullPromptState.enabled ? userPrompt : truncateText(userPrompt);

    llmLog.debug(
      {
        provider: this.context.provider,
        model: this.context.model,
        apiKey: maskApiKey(this.context.apiKey),
        baseUrl: maskBaseUrl(this.context.baseUrl),
        apiKeySource: this.context.apiKeySource,
        baseUrlSource: this.context.baseUrlSource,
        modelSource: this.context.modelSource,
        label: this.context.label,
        userId: this.context.userId,
        configId: this.context.configId,
        systemPrompt: systemPromptLogged,
        userPrompt: userPromptLogged,
        systemPromptSource: params.systemPromptSource || 'messages',
        userPromptSource: params.userPromptSource || 'messages',
        fullPromptLogged: fullPromptState.enabled,
        fullPromptSampleRate: fullPromptState.sampleRate,
        messages: params.messages.map((m) => ({ role: m.role, contentLength: m.content.length })),
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        jsonMode: params.jsonMode,
        ...this.extractExtraParams(params),
      },
      `→ LLM Request: ${this.context.label || this.context.model}`
    );
  }

  /**
   * 记录响应结果
   */
  logResponse(result: LLMCallResult): void {
    const elapsed = Date.now() - this.startTime;

    if (result.success) {
      llmLog.info(
        {
          provider: this.context.provider,
          model: this.context.model,
          label: this.context.label,
          userId: this.context.userId,
          configId: this.context.configId,
          responseLength: result.responseLength || result.response?.length || 0,
          elapsed: `${elapsed}ms`,
          responsePreview: result.response ? truncateText(result.response, 200) : undefined,
        },
        `← LLM Response: ${this.context.label || this.context.model} done`
      );
    } else {
      llmLog.error(
        {
          provider: this.context.provider,
          model: this.context.model,
          label: this.context.label,
          userId: this.context.userId,
          configId: this.context.configId,
          error: result.error?.message || 'Unknown error',
          elapsed: `${elapsed}ms`,
        },
        `✗ LLM Error: ${this.context.label || this.context.model}`
      );
    }
  }

  /**
   * 提取额外参数（排除已知的标准参数）
   */
  private extractExtraParams(params: LLMCallParams): Record<string, any> {
    const { messages, temperature, maxTokens, jsonMode, ...extra } = params;
    return extra;
  }
}

/**
 * 大模型调用日志记录器
 */
export class LLMLogger {
  /**
   * 开始一个新的日志会话
   */
  static start(context: LLMCallContext): LLMLoggerSession {
    return new LLMLoggerSession(context);
  }

  /**
   * 快捷方式：一次性记录调用
   */
  static async log<T>(
    context: LLMCallContext,
    params: LLMCallParams,
    fn: () => Promise<T>
  ): Promise<T> {
    const session = this.start(context);
    session.logRequest(params);

    try {
      const result = await fn();
      const responseText = typeof result === 'string' ? result : JSON.stringify(result);
      session.logResponse({
        success: true,
        response: responseText,
        responseLength: responseText.length,
        elapsedMs: 0, // 会在 logResponse 中重新计算
      });
      return result;
    } catch (error) {
      session.logResponse({
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
        elapsedMs: 0,
      });
      throw error;
    }
  }

  /**
   * 记录速率限制统计信息
   * 用于监控和调试速率限制器的状态
   */
  static logRateLimitStats(stats: {
    availableTokens: number;
    queueLength: number;
    totalRequests: number;
    rejectedRequests: number;
    avgWaitTimeMs: number;
  }): void {
    llmLog.info(
      {
        availableTokens: stats.availableTokens,
        queueLength: stats.queueLength,
        totalRequests: stats.totalRequests,
        rejectedRequests: stats.rejectedRequests,
        avgWaitTimeMs: stats.avgWaitTimeMs,
      },
      'Rate Limiter Stats'
    );
  }
}
