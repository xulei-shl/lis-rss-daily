/**
 * LLM abstraction layer.
 *
 * Provides a unified interface for chat completions across providers.
 * Supports both environment variable configuration and database-stored user configs.
 */

import OpenAI from 'openai';
import { logger } from './logger.js';
import { getActiveConfigListByType, getActiveConfigListByTypeAndTask, type LLMConfigRecord } from './api/llm-configs.js';
import { decryptAPIKey } from './utils/crypto.js';
import { config } from './config.js';
import { LLMLogger, type LLMCallContext } from './llm-logger.js';
import { initGlobalRateLimiter, getGlobalRateLimiter, type RateLimiterConfig } from './utils/rate-limiter.js';

const log = logger.child({ module: 'llm' });

/* ── Public types ── */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  /** Label for logging (e.g. "summary", "insight") */
  label?: string;
}

export interface LLMProvider {
  name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}

export interface LLMConfigOptions {
  provider: 'openai' | 'gemini' | 'custom';
  baseURL: string;
  apiKey: string;
  model: string;
  timeout?: number;
  maxRetries?: number;
  source?: 'env' | 'db' | 'explicit' | 'unknown';
}

interface FailoverEntry {
  configId: number;
  provider: LLMProvider;
}

/* ── Rate Limiter Integration ── */

/**
 * Initialize the global rate limiter if enabled
 */
function ensureRateLimiterInitialized(): void {
  if (!getGlobalRateLimiter() && config.llmRateLimitEnabled) {
    const rateLimiterConfig: RateLimiterConfig = {
      requestsPerMinute: config.llmRateLimitRequestsPerMinute,
      burstCapacity: config.llmRateLimitBurstCapacity,
      queueTimeout: config.llmRateLimitQueueTimeout,
    };
    initGlobalRateLimiter(rateLimiterConfig);
  }
}

/**
 * Wrap an LLMProvider with rate limiting
 * If rate limiting is disabled, returns the original provider
 */
function withRateLimit(provider: LLMProvider): LLMProvider {
  if (!config.llmRateLimitEnabled) {
    return provider;
  }

  ensureRateLimiterInitialized();
  const rateLimiter = getGlobalRateLimiter();

  return {
    name: `${provider.name} (rate-limited)`,
    async chat(messages, options = {}) {
      const label = options.label || 'chat';

      if (!rateLimiter) {
        // Rate limiter not available, proceed without limiting
        return provider.chat(messages, options);
      }

      // Wait for rate limiter token
      try {
        await rateLimiter.waitForToken(label);
      } catch (error) {
        // Queue timeout - still allow the request to proceed
        // This is better than failing the request
        log.warn(
          { label, provider: provider.name },
          'Rate limit queue timeout, proceeding anyway'
        );
      }

      // Proceed with actual LLM call
      return provider.chat(messages, options);
    },
  };
}

/* ── Provider: OpenAI-compatible (Qwen via dashscope, etc.) ── */

function createOpenAIProvider(llmConfig: LLMConfigOptions, configId?: number): LLMProvider {
  const client = new OpenAI({
    apiKey: llmConfig.apiKey,
    baseURL: llmConfig.baseURL,
    timeout: llmConfig.timeout ?? 30000,
    maxRetries: llmConfig.maxRetries ?? 3,
  });
  const model = llmConfig.model;

  const source = llmConfig.source ?? 'unknown';
  const provider: LLMProvider = {
    name: `openai/${model}`,
    async chat(messages, options = {}) {
      const label = options.label || 'chat';

      // 创建日志上下文
      const callContext: LLMCallContext = {
        provider: 'openai',
        model,
        apiKey: llmConfig.apiKey,
        baseUrl: llmConfig.baseURL,
        apiKeySource: source,
        baseUrlSource: source,
        modelSource: source,
        label,
        configId,
      };

      const session = LLMLogger.start(callContext);
      session.logRequest({
        messages,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        jsonMode: options.jsonMode,
      });

      try {
        const requestConfig: Record<string, any> = {
          model,
          temperature: options.temperature,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          ...(options.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
        };
        // 只有明确指定 maxTokens 时才添加限制
        if (options.maxTokens !== undefined) {
          requestConfig.max_tokens = options.maxTokens;
        }
        const response = await client.chat.completions.create(requestConfig);

        const text = response.choices[0]?.message?.content || '';

        session.logResponse({
          success: true,
          response: text,
          responseLength: text.length,
          elapsedMs: 0,
        });

        return text;
      } catch (error) {
        session.logResponse({
          success: false,
          error: error instanceof Error ? error : new Error('Unknown error'),
          elapsedMs: 0,
        });
        throw error;
      }
    },
  };

  return withRateLimit(provider);
}

/* ── Provider: Gemini (direct REST API) ── */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function createGeminiProvider(llmConfig: LLMConfigOptions, configId?: number): LLMProvider {
  const apiKey = llmConfig.apiKey;
  const model = llmConfig.model;
  const baseURL = llmConfig.baseURL;
  const source = llmConfig.source ?? 'unknown';

  const provider: LLMProvider = {
    name: `gemini/${model}`,
    async chat(messages, options = {}) {
      const label = options.label || 'chat';

      // 创建日志上下文
      const callContext: LLMCallContext = {
        provider: 'gemini',
        model,
        apiKey,
        baseUrl: baseURL || GEMINI_API_BASE,
        apiKeySource: source,
        baseUrlSource: source,
        modelSource: source,
        label,
        configId,
      };

      const session = LLMLogger.start(callContext);
      session.logRequest({
        messages,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        jsonMode: options.jsonMode,
      });

      try {
        // Convert ChatMessage[] to Gemini format
        // Gemini uses "contents" with "role" (user/model) and system instruction separately
        const systemParts: string[] = [];
        const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

        for (const msg of messages) {
          if (msg.role === 'system') {
            systemParts.push(msg.content);
          } else {
            contents.push({
              role: msg.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: msg.content }],
            });
          }
        }

        const generationConfig: Record<string, any> = {
          temperature: options.temperature ?? 0.3,
          ...(options.jsonMode ? { responseMimeType: 'application/json' } : {}),
        };
        // 只有明确指定 maxTokens 时才添加限制
        if (options.maxTokens !== undefined) {
          generationConfig.maxOutputTokens = options.maxTokens;
        }
        const body: Record<string, any> = {
          contents,
          generationConfig,
        };

        if (systemParts.length > 0) {
          body.systemInstruction = {
            parts: systemParts.map((text) => ({ text })),
          };
        }

        // Use custom base URL if provided, otherwise use default
        const apiUrl = baseURL || GEMINI_API_BASE;
        const url = `${apiUrl}/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Gemini ${label} error (${res.status}): ${err}`);
        }

        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        if (!text) {
          throw new Error(`Gemini ${label}: empty response`);
        }

        session.logResponse({
          success: true,
          response: text,
          responseLength: text.length,
          elapsedMs: 0,
        });

        return text;
      } catch (error) {
        session.logResponse({
          success: false,
          error: error instanceof Error ? error : new Error('Unknown error'),
          elapsedMs: 0,
        });
        throw error;
      }
    },
  };

  return withRateLimit(provider);
}

/* ── Provider from environment variables (fallback) ── */

function createProviderFromEnv(): LLMProvider {
  const providerName = process.env.LLM_PROVIDER ?? 'openai';

  switch (providerName) {
    case 'gemini':
      return createGeminiProvider({
        provider: 'gemini',
        apiKey: process.env.GEMINI_API_KEY || '',
        baseURL: GEMINI_API_BASE,
        model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
        source: 'env',
      });
    case 'openai':
    default:
      return createOpenAIProvider({
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY || '',
        baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        model: process.env.OPENAI_DEFAULT_MODEL ?? 'gpt-4o-mini',
        source: 'env',
      });
  }
}

/* ── Factory functions ── */

/**
 * Get LLM provider from environment variables (fallback)
 * This is used when no user context is available or config is not found
 */
let _envProvider: LLMProvider | null = null;

export function getLLM(): LLMProvider {
  if (_envProvider) return _envProvider;
  _envProvider = createProviderFromEnv();
  log.info({ provider: _envProvider.name }, 'LLM provider initialized from environment');
  return _envProvider;
}

/**
 * Get LLM provider for a specific user from database configuration
 * Throws error if no config is found (no fallback to environment variables)
 *
 * @param userId - User ID to get LLM config for
 * @param taskType - Optional task type (filter, translation, daily_summary, etc.)
 * @returns LLM provider instance
 * @throws Error if no LLM config found for user
 */
export async function getUserLLMProvider(userId: number, taskType?: string): Promise<LLMProvider> {
  const dbConfigs = taskType
    ? await getActiveConfigListByTypeAndTask(userId, 'llm', taskType)
    : await getActiveConfigListByType(userId, 'llm');

  if (!dbConfigs || dbConfigs.length === 0) {
    throw new Error(
      `未找到用户 ${userId}${taskType ? ` 的 ${taskType} 任务类型` : ''} 的 LLM 配置。` +
      `请在设置中添加并启用至少一个 LLM 配置。`
    );
  }

  const entries: FailoverEntry[] = [];
  for (const dbConfig of dbConfigs) {
    const provider = buildProviderFromDbConfig(dbConfig);
    if (provider) {
      entries.push({ configId: dbConfig.id, provider });
    }
  }

  if (entries.length === 0) {
    throw new Error(
      `用户 ${userId}${taskType ? ` 的 ${taskType} 任务类型` : ''} 的所有 LLM 配置均无效。` +
      `请检查配置是否正确。`
    );
  }

  if (entries.length === 1) {
    log.info({ userId, taskType, provider: entries[0].provider.name }, 'LLM provider initialized from database');
    return entries[0].provider;
  }

  const failoverProvider = createFailoverProvider(entries);
  log.info(
    { userId, taskType, provider: failoverProvider.name, count: entries.length },
    'LLM provider initialized with failover'
  );
  return failoverProvider;
}

/**
 * Create LLM provider from explicit config options
 * Useful for testing or temporary providers
 *
 * @param llmConfig - LLM configuration options
 * @param configId - Optional config ID for logging
 * @returns LLM provider instance
 */
export function createLLMProvider(llmConfig: LLMConfigOptions, configId?: number): LLMProvider {
  const normalizedConfig: LLMConfigOptions = {
    ...llmConfig,
    source: llmConfig.source ?? 'explicit',
  };
  switch (llmConfig.provider) {
    case 'gemini':
      return createGeminiProvider(normalizedConfig, configId);
    case 'openai':
    case 'custom':
    default:
      return createOpenAIProvider(normalizedConfig, configId);
  }
}

function buildProviderFromDbConfig(dbConfig: LLMConfigRecord): LLMProvider | null {
  try {
    const llmConfig: LLMConfigOptions = {
      provider: dbConfig.provider as 'openai' | 'gemini' | 'custom',
      baseURL: dbConfig.base_url,
      apiKey: decryptAPIKey(dbConfig.api_key_encrypted, config.llmEncryptionKey),
      model: dbConfig.model,
      timeout: dbConfig.timeout,
      maxRetries: dbConfig.max_retries,
      source: 'db',
    };
    return createLLMProvider(llmConfig, dbConfig.id);
  } catch (error) {
    log.warn({ error, configId: dbConfig.id }, 'Failed to build LLM provider from config');
    return null;
  }
}

function createFailoverProvider(entries: FailoverEntry[]): LLMProvider {
  const names = entries.map((entry) => entry.provider.name).join(' -> ');
  const provider: LLMProvider = {
    name: `failover(${names})`,
    async chat(messages, options = {}) {
      let lastError: Error | null = null;
      for (const entry of entries) {
        try {
          const text = await entry.provider.chat(messages, options);
          if (text && text.trim().length > 0) {
            return text;
          }
          const emptyError = new Error('空响应');
          lastError = emptyError;
          log.warn(
            { configId: entry.configId, provider: entry.provider.name, label: options.label },
            'LLM 空响应，尝试下一个配置'
          );
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('未知错误');
          log.warn(
            { error: lastError, configId: entry.configId, provider: entry.provider.name, label: options.label },
            'LLM 调用失败，尝试下一个配置'
          );
        }
      }

      throw lastError ?? new Error('全部 LLM 配置均失败');
    },
  };

  return withRateLimit(provider);
}
