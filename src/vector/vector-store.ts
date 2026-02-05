import { logger } from '../logger.js';
import { getChromaSettings } from '../api/settings.js';
import { ChromaClient } from 'chromadb';

const log = logger.child({ module: 'vector-store' });

export interface VectorHit {
  id: string;
  articleId: number;
  score: number;
  document: string;
  metadata: Record<string, any>;
}

export function buildVectorId(articleId: number, userId: number): string {
  return `${userId}:${articleId}`;
}

async function getCollection(userId: number) {
  const settings = await getChromaSettings(userId);
  const baseUrl = `http://${settings.host}:${settings.port}`;
  const client = new ChromaClient({ path: baseUrl });

  try {
    const collection = await client.getCollection({ name: settings.collection });
    return { collection, settings };
  } catch {
    const collection = await client.createCollection({
      name: settings.collection,
      metadata: { 'hnsw:space': settings.distanceMetric },
    });
    return { collection, settings };
  }
}

export async function upsert(
  userId: number,
  ids: string[],
  embeddings: number[][],
  metadatas: Record<string, any>[],
  documents: string[]
): Promise<void> {
  if (ids.length === 0) return;
  const { collection } = await getCollection(userId);
  await collection.upsert({
    ids,
    embeddings,
    metadatas,
    documents,
  });
  log.debug({ count: ids.length }, 'Chroma upsert done');
}

export async function query(
  userId: number,
  embedding: number[],
  topK: number,
  filter?: Record<string, any>
): Promise<VectorHit[]> {
  const { collection, settings } = await getCollection(userId);
  const result = await collection.query({
    queryEmbeddings: [embedding],
    nResults: topK,
    where: filter,
    include: ['distances', 'metadatas', 'documents', 'ids'],
  });

  const ids = result.ids?.[0] || [];
  const distances = result.distances?.[0] || [];
  const metadatas = result.metadatas?.[0] || [];
  const documents = result.documents?.[0] || [];

  const hits: VectorHit[] = [];
  for (let i = 0; i < ids.length; i++) {
    const distance = typeof distances[i] === 'number' ? distances[i] : 1;
    const score = settings.distanceMetric === 'ip' ? distance : 1 - distance;
    const metadata = (metadatas[i] || {}) as Record<string, any>;
    const articleId = Number(metadata.article_id || 0);
    hits.push({
      id: String(ids[i]),
      articleId,
      score,
      document: typeof documents[i] === 'string' ? documents[i] : '',
      metadata,
    });
  }

  return hits;
}

export async function remove(userId: number, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { collection } = await getCollection(userId);
  await collection.delete({ ids });
  log.debug({ count: ids.length }, 'Chroma delete done');
}
