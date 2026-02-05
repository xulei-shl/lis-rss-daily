import { logger } from '../logger.js';
import { decryptAPIKey } from '../utils/crypto.js';
import { config as appConfig } from '../config.js';
import { getActiveConfigByType } from '../api/llm-configs.js';

const log = logger.child({ module: 'vector-rerank' });

export interface RerankResult {
  index: number;
  score: number;
}

export async function rerank(
  query: string,
  documents: string[],
  userId: number,
  topN?: number
): Promise<RerankResult[] | null> {
  const dbConfig = await getActiveConfigByType(userId, 'rerank');
  if (!dbConfig || dbConfig.enabled !== 1) {
    return null;
  }

  const apiKey = decryptAPIKey(dbConfig.api_key_encrypted, appConfig.llmEncryptionKey);
  const url = `${dbConfig.base_url}/rerank`;
  const body = {
    model: dbConfig.model,
    query,
    documents,
    top_n: topN ?? documents.length,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(dbConfig.timeout ?? 30000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log.warn({ status: res.status, text }, 'Rerank 请求失败');
      return null;
    }

    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];

    return results
      .map((item: any) => ({
        index: Number(item.index),
        score: typeof item.relevance_score === 'number'
          ? item.relevance_score
          : typeof item.score === 'number'
            ? item.score
            : 0,
      }))
      .filter((item: RerankResult) => Number.isFinite(item.index));
  } catch (error) {
    log.warn({ error }, 'Rerank 请求异常');
    return null;
  }
}
