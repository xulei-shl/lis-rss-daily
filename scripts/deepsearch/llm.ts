import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions.js';
import { getLLMConfigs } from './database.js';
import { getConfig } from './config.js';

const DEFAULT_ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function decryptAPIKey(encryptedText: string, encryptionKey: string): string {
  if (!encryptedText) return '';
  if (encryptionKey === DEFAULT_ENCRYPTION_KEY) {
    return encryptedText;
  }
  const CryptoJS = require('crypto-js');
  const key = CryptoJS.enc.Hex.parse(encryptionKey.padEnd(64, '0').slice(0, 64));
  const iv = CryptoJS.enc.Hex.parse(encryptedText.slice(0, 32));
  const encrypted = encryptedText.slice(32);
  const decrypted = CryptoJS.AES.decrypt(encrypted, key, { iv: iv });
  return decrypted.toString(CryptoJS.enc.Utf8);
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  label?: string;
}

export interface LLMProvider {
  name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}

function getEncryptionKey(): string {
  return process.env.LLM_ENCRYPTION_KEY || DEFAULT_ENCRYPTION_KEY;
}

function createOpenAIProvider(
  apiKey: string,
  baseURL: string,
  model: string,
  configId?: number
): LLMProvider {
  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout: 180000,
    maxRetries: 3,
  });

  const provider: LLMProvider = {
    name: `openai/${model}`,
    async chat(messages, options = {}) {
      const requestConfig: ChatCompletionCreateParamsNonStreaming = {
        model,
        temperature: options.temperature,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        ...(options.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
      };
      if (options.maxTokens !== undefined) {
        requestConfig.max_tokens = options.maxTokens;
      }
      const response = await client.chat.completions.create(requestConfig);
      return response.choices[0]?.message?.content || '';
    },
  };

  return provider;
}

function createGeminiProvider(
  apiKey: string,
  model: string,
  baseURL?: string
): LLMProvider {
  const provider: LLMProvider = {
    name: `gemini/${model}`,
    async chat(messages, options = {}) {
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

      const apiUrl = baseURL || GEMINI_API_BASE;
      const url = `${apiUrl}/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Gemini error (${res.status}): ${err}`);
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) {
        throw new Error('Gemini: empty response');
      }
      return text;
    },
  };

  return provider;
}

interface FailoverEntry {
  configId: number;
  provider: LLMProvider;
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
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('未知错误');
        }
      }
      throw lastError || new Error('All LLM configs failed');
    },
  };

  return provider;
}

export async function getUserLLMProvider(taskType?: string): Promise<LLMProvider> {
  const config = getConfig();
  const userId = config.user.userId;
  const dbConfigs = await getLLMConfigs(userId, taskType ?? null);

  const entries: FailoverEntry[] = [];
  for (const dbConfig of dbConfigs) {
    try {
      const apiKey = decryptAPIKey(dbConfig.api_key_encrypted, getEncryptionKey());
      let provider: LLMProvider;

      if (dbConfig.provider === 'gemini') {
        provider = createGeminiProvider(apiKey, dbConfig.model, dbConfig.base_url);
      } else {
        provider = createOpenAIProvider(apiKey, dbConfig.base_url, dbConfig.model, dbConfig.id);
      }

      entries.push({ configId: dbConfig.id, provider });
    } catch (error) {
      console.warn(`Failed to build LLM provider from config ${dbConfig.id}:`, error);
    }
  }

  if (entries.length === 0) {
    throw new Error(`未找到用户 ${userId} 的 LLM 配置。请在设置中添加并启用至少一个 LLM 配置。`);
  }

  if (entries.length === 1) {
    return entries[0].provider;
  }

  return createFailoverProvider(entries);
}