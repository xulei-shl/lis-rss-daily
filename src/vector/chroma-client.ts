/**
 * Chroma Client Singleton
 *
 * Manages singleton Chroma client instances per user to avoid connection issues.
 * Each user gets their own cached client instance with collection caching.
 */

import { ChromaClient, Collection } from 'chromadb';
import { logger } from '../logger.js';
import { getChromaSettings } from '../api/settings.js';

const log = logger.child({ module: 'chroma-client' });

/**
 * Chroma 连接错误
 * 提供清晰的连接失败提示
 */
export class ChromaConnectionError extends Error {
  constructor(host: string, port: number) {
    super(
      `Chroma 服务不可用 (${host}:${port})。请检查 Chroma 服务是否运行，或在"设置"中配置正确的 host 和 port。`
    );
    this.name = 'ChromaConnectionError';
  }
}

interface ClientCache {
  client: ChromaClient;
  baseUrl: string;
  collections: Map<string, Collection>;
}

// User-level client cache
const clientCache = new Map<number, ClientCache>();

/**
 * Get or create a Chroma client for the user.
 */
export async function getClient(userId: number): Promise<ChromaClient> {
  const settings = await getChromaSettings(userId);
  const baseUrl = `http://${settings.host}:${settings.port}`;

  // Reuse existing client if config unchanged
  if (clientCache.has(userId)) {
    const cached = clientCache.get(userId)!;
    if (cached.baseUrl === baseUrl) {
      return cached.client;
    }
    // Config changed, clear old cache
    clientCache.delete(userId);
  }

  // Create new client
  const client = new ChromaClient({ path: baseUrl });
  clientCache.set(userId, {
    client,
    baseUrl,
    collections: new Map(),
  });

  log.debug({ userId, baseUrl }, 'Chroma client created');
  return client;
}

/**
 * Get or create a collection for the user.
 */
export async function getCollection(userId: number): Promise<{
  collection: Collection;
  settings: Awaited<ReturnType<typeof getChromaSettings>>;
}> {
  const client = await getClient(userId);
  const settings = await getChromaSettings(userId);
  const cache = clientCache.get(userId)!;

  // Cache key includes both collection name and distance metric
  const cacheKey = `${settings.collection}:${settings.distanceMetric}`;

  // Reuse existing collection
  if (cache.collections.has(cacheKey)) {
    return {
      collection: cache.collections.get(cacheKey)!,
      settings,
    };
  }

  // Get or create collection
  try {
    const collection = await client.getOrCreateCollection({
      name: settings.collection,
      metadata: { 'hnsw:space': settings.distanceMetric },
    });

    cache.collections.set(cacheKey, collection);
    return { collection, settings };
  } catch (error) {
    // 捕获连接错误，转换为更有用的错误信息
    throw new ChromaConnectionError(settings.host, settings.port);
  }
}

/**
 * Close and remove a user's Chroma client.
 */
export async function closeClient(userId: number): Promise<void> {
  if (clientCache.has(userId)) {
    clientCache.delete(userId);
    log.debug({ userId }, 'Chroma client closed');
  }
}

/**
 * Close all Chroma clients (useful for testing/shutdown).
 */
export async function closeAllClients(): Promise<void> {
  const count = clientCache.size;
  clientCache.clear();
  log.debug({ count }, 'All Chroma clients closed');
}
