import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { getEmbeddingsBatch } from './embedding-client.js';
import { upsert, remove, buildVectorId } from './vector-store.js';
import { buildVectorText } from './text-builder.js';

const log = logger.child({ module: 'vector-indexer' });

const BATCH_SIZE = 32;

/**
 * 向量索引结果
 */
export interface IndexResult {
  articleId: number;
  success: boolean;
  error?: string;
}

class VectorIndexQueue {
  private running = Promise.resolve();

  enqueue(task: () => Promise<void>): void {
    this.running = this.running
      .then(task)
      .catch((error) => {
        log.error({ error }, '向量索引任务失败');
      });
  }
}

const queue = new VectorIndexQueue();

async function loadArticles(articleIds: number[], userId?: number) {
  if (articleIds.length === 0) return [];
  const db = getDb();
  let query = db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('articles.id', 'in', articleIds)
    .select([
      'articles.id',
      'articles.title',
      'articles.content',
      'articles.markdown_content',
      'rss_sources.user_id as user_id',
    ]);

  if (userId !== undefined) {
    query = query.where('rss_sources.user_id', '=', userId);
  }

  return await query.execute();
}

async function doIndexArticles(
  articleIds: number[],
  userId?: number,
  onComplete?: (result: IndexResult) => void
): Promise<void> {
  const rows = await loadArticles(articleIds, userId);
  if (rows.length === 0) return;

  const groups = new Map<number, any[]>();
  for (const row of rows as any[]) {
    const uid = Number(row.user_id);
    if (!groups.has(uid)) {
      groups.set(uid, []);
    }
    groups.get(uid)!.push(row);
  }

  let total = 0;

  for (const [uid, groupRows] of groups.entries()) {
    const documents: string[] = [];
    const ids: string[] = [];
    const metadatas: Array<Record<string, any>> = [];

    for (const row of groupRows) {
      const doc = buildVectorText(row);
      if (!doc) continue;
      ids.push(buildVectorId(row.id, uid));
      documents.push(doc);
      metadatas.push({
        article_id: row.id,
        user_id: uid,
      });
    }

    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      const sliceDocs = documents.slice(i, i + BATCH_SIZE);
      const sliceIds = ids.slice(i, i + BATCH_SIZE);
      const sliceMetas = metadatas.slice(i, i + BATCH_SIZE);

      try {
        const embeddings = await getEmbeddingsBatch(sliceDocs, uid);
        await upsert(uid, sliceIds, embeddings, sliceMetas, sliceDocs);
        total += sliceIds.length;

        // 报告成功
        sliceIds.forEach(id => {
          const articleId = parseInt(id.split(':')[1], 10);
          onComplete?.({ articleId, success: true });
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        log.warn({ error: errMsg, count: sliceIds.length }, '向量索引批次失败');

        // 报告失败
        sliceIds.forEach(id => {
          const articleId = parseInt(id.split(':')[1], 10);
          onComplete?.({
            articleId,
            success: false,
            error: errMsg
          });
        });
      }
    }
  }

  if (total > 0) {
    log.info({ count: total }, '向量索引完成');
  }
}

async function doDeleteArticle(articleId: number, userId?: number): Promise<void> {
  if (userId === undefined) {
    const rows = await loadArticles([articleId]);
    if (rows.length === 0) return;
    const uid = Number((rows[0] as any).user_id);
    await remove(uid, [buildVectorId(articleId, uid)]);
    return;
  }

  await remove(userId, [buildVectorId(articleId, userId)]);
}

/**
 * 索引单篇文章
 * @param articleId 文章 ID
 * @param userId 用户 ID（可选，会从数据库查询）
 * @param onComplete 完成回调，接收索引结果
 */
export async function indexArticle(
  articleId: number,
  userId?: number,
  onComplete?: (result: IndexResult) => void
): Promise<void> {
  queue.enqueue(() => doIndexArticles([articleId], userId, onComplete));
}

/**
 * 索引多篇文章
 * @param articleIds 文章 ID 列表
 * @param userId 用户 ID（可选，会从数据库查询）
 * @param onComplete 完成回调，每次索引完成时调用
 */
export async function indexArticles(
  articleIds: number[],
  userId?: number,
  onComplete?: (result: IndexResult) => void
): Promise<void> {
  queue.enqueue(() => doIndexArticles(articleIds, userId, onComplete));
}

/**
 * 删除文章的向量索引
 */
export async function deleteArticle(articleId: number, userId?: number): Promise<void> {
  queue.enqueue(() => doDeleteArticle(articleId, userId));
}
