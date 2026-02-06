/**
 * LLM abstraction layer.
 *
 * Provides a unified interface for chat completions across providers.
 * Supports both environment variable configuration and database-stored user configs.
 */

import OpenAI from 'openai';
import { logger } from './logger.js';
import { getActiveConfigListByType, type LLMConfigRecord } from './api/llm-configs.js';
import { decryptAPIKey } from './utils/crypto.js';
import { config } from './config.js';

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
}

interface FailoverEntry {
  configId: number;
  provider: LLMProvider;
}

/* ── Provider: OpenAI-compatible (Qwen via dashscope, etc.) ── */

function createOpenAIProvider(llmConfig: LLMConfigOptions): LLMProvider {
  const client = new OpenAI({
    apiKey: llmConfig.apiKey,
    baseURL: llmConfig.baseURL,
    timeout: llmConfig.timeout ?? 30000,
    maxRetries: llmConfig.maxRetries ?? 3,
  });
  const model = llmConfig.model;

  return {
    name: `openai/${model}`,
    async chat(messages, options = {}) {
      const startTime = Date.now();
      const label = options.label || 'chat';
      log.debug({ model, label, messages: messages.length }, `→ OpenAI: ${label}`);

      const response = await client.chat.completions.create({
        model,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        ...(options.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
      });

      const text = response.choices[0]?.message?.content || '';
      const elapsed = Date.now() - startTime;
      log.info({ model, label, elapsed: `${elapsed}ms`, responseLength: text.length }, `← OpenAI: ${label} done`);
      return text;
    },
  };
}

/* ── Provider: Gemini (direct REST API) ── */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function createGeminiProvider(llmConfig: LLMConfigOptions): LLMProvider {
  const apiKey = llmConfig.apiKey;
  const model = llmConfig.model;
  const baseURL = llmConfig.baseURL;

  return {
    name: `gemini/${model}`,
    async chat(messages, options = {}) {
      const startTime = Date.now();
      const label = options.label || 'chat';
      log.debug({ model, label, messages: messages.length }, `→ Gemini: ${label}`);

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

      const body: Record<string, any> = {
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.3,
          maxOutputTokens: options.maxTokens ?? 2048,
          ...(options.jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
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
        log.error({ status: res.status, label, error: err }, `← Gemini: ${label} error`);
        throw new Error(`Gemini ${label} error (${res.status}): ${err}`);
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      if (!text) {
        log.error({ label, response: data }, `← Gemini: ${label} empty response`);
        throw new Error(`Gemini ${label}: empty response`);
      }

      const elapsed = Date.now() - startTime;
      log.info({ model, label, elapsed: `${elapsed}ms`, responseLength: text.length }, `← Gemini: ${label} done`);
      return text;
    },
  };
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
      });
    case 'openai':
    default:
      return createOpenAIProvider({
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY || '',
        baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        model: process.env.OPENAI_DEFAULT_MODEL ?? 'gpt-4o-mini',
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
 * Falls back to environment variables if no config is found
 *
 * @param userId - User ID to get LLM config for
 * @returns LLM provider instance
 */
export async function getUserLLMProvider(userId: number): Promise<LLMProvider> {
  try {
    const dbConfigs = await getActiveConfigListByType(userId, 'llm');

    if (!dbConfigs || dbConfigs.length === 0) {
      log.warn({ userId }, 'No LLM config found for user, falling back to environment');
      return getLLM();
    }

    const entries: FailoverEntry[] = [];
    for (const dbConfig of dbConfigs) {
      const provider = buildProviderFromDbConfig(dbConfig);
      if (provider) {
        entries.push({ configId: dbConfig.id, provider });
      }
    }

    if (entries.length === 0) {
      log.warn({ userId }, 'No valid LLM config available, falling back to environment');
      return getLLM();
    }

    if (entries.length === 1) {
      log.info({ userId, provider: entries[0].provider.name }, 'LLM provider initialized from database');
      return entries[0].provider;
    }

    const failoverProvider = createFailoverProvider(entries);
    log.info(
      { userId, provider: failoverProvider.name, count: entries.length },
      'LLM provider initialized with failover'
    );
    return failoverProvider;
  } catch (error) {
    log.error({ error, userId }, 'Failed to get LLM config from database, falling back to environment');
    return getLLM();
  }
}

/**
 * Create LLM provider from explicit config options
 * Useful for testing or temporary providers
 *
 * @param llmConfig - LLM configuration options
 * @returns LLM provider instance
 */
export function createLLMProvider(llmConfig: LLMConfigOptions): LLMProvider {
  switch (llmConfig.provider) {
    case 'gemini':
      return createGeminiProvider(llmConfig);
    case 'openai':
    case 'custom':
    default:
      return createOpenAIProvider(llmConfig);
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
    };
    return createLLMProvider(llmConfig);
  } catch (error) {
    log.warn({ error, configId: dbConfig.id }, 'Failed to build LLM provider from config');
    return null;
  }
}

function createFailoverProvider(entries: FailoverEntry[]): LLMProvider {
  const names = entries.map((entry) => entry.provider.name).join(' -> ');
  return {
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
}
