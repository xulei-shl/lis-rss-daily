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

  // Reuse existing collection
  if (cache.collections.has(settings.collection)) {
    return {
      collection: cache.collections.get(settings.collection)!,
      settings,
    };
  }

  // Get or create collection
  const collection = await client.getOrCreateCollection({
    name: settings.collection,
    metadata: { 'hnsw:space': settings.distanceMetric },
  });

  cache.collections.set(settings.collection, collection);
  return { collection, settings };
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
