import { logger } from '../logger.js';
import { decryptAPIKey } from '../utils/crypto.js';
import { config as appConfig } from '../config.js';
import { getActiveConfigByType } from '../api/llm-configs.js';

const log = logger.child({ module: 'vector-embedding' });

/**
 * Embedding 配置错误
 * 提供清晰的配置缺失提示
 */
export class EmbeddingConfigError extends Error {
  constructor(missingType: 'embedding' | 'chroma') {
    const messages = {
      embedding: '缺少 Embedding 配置。请在"LLM 配置"中添加一个 config_type 为 "embedding" 的配置。',
      chroma: 'Chroma 服务不可用。请检查 Chroma 服务是否运行，或在"设置"中配置正确的 host 和 port。',
    };
    super(messages[missingType]);
    this.name = 'EmbeddingConfigError';
  }
}

interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeout: number;
  maxRetries: number;
}

async function loadEmbeddingConfig(userId: number): Promise<EmbeddingConfig> {
  const dbConfig = await getActiveConfigByType(userId, 'embedding');
  if (!dbConfig) {
    throw new EmbeddingConfigError('embedding');
  }

  return {
    baseUrl: dbConfig.base_url,
    apiKey: decryptAPIKey(dbConfig.api_key_encrypted, appConfig.llmEncryptionKey),
    model: dbConfig.model,
    timeout: dbConfig.timeout ?? 30000,
    maxRetries: dbConfig.max_retries ?? 3,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestEmbeddings(
  cfg: EmbeddingConfig,
  inputs: string[]
): Promise<number[][]> {
  const url = `${cfg.baseUrl}/embeddings`;
  const body = {
    model: cfg.model,
    input: inputs,
  };

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeout);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const retryable = res.status >= 500 || res.status === 429;
        if (!retryable || attempt === cfg.maxRetries) {
          throw new Error(`Embedding 请求失败: HTTP ${res.status} ${text}`);
        }
        await sleep(500 * (attempt + 1));
        continue;
      }

      const data = await res.json();
      const vectors = Array.isArray(data?.data)
        ? data.data.map((item: any) => item.embedding).filter((v: any) => Array.isArray(v))
        : [];

      if (vectors.length !== inputs.length) {
        throw new Error('Embedding 返回数量不匹配');
      }

      return vectors as number[][];
    } catch (error) {
      if (attempt >= cfg.maxRetries) {
        throw error;
      }
      await sleep(500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('Embedding 请求失败');
}

export async function getEmbedding(text: string, userId: number): Promise<number[]> {
  const cfg = await loadEmbeddingConfig(userId);
  const vectors = await requestEmbeddings(cfg, [text]);
  return vectors[0] || [];
}

export async function getEmbeddingsBatch(texts: string[], userId: number): Promise<number[][]> {
  const cfg = await loadEmbeddingConfig(userId);
  if (texts.length === 0) return [];
  const vectors = await requestEmbeddings(cfg, texts);
  log.debug({ count: vectors.length }, 'Embedding batch done');
  return vectors;
}
