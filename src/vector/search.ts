import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { getEmbedding } from './embedding-client.js';
import { query as queryVector } from './vector-store.js';
import { rerank } from './reranker.js';
import { buildVectorText } from './text-builder.js';

const log = logger.child({ module: 'vector-search' });

type Candidate = {
  articleId: number;
  score: number;
  document: string;
};

function applyRerank(
  candidates: Candidate[],
  rerankResults: Array<{ index: number; score: number }>,
  limit: number
): Candidate[] {
  if (rerankResults.length === 0) return candidates.slice(0, limit);

  const picked = new Set<number>();
  const reordered: Candidate[] = [];

  for (const item of rerankResults) {
    const idx = item.index;
    if (!Number.isFinite(idx) || idx < 0 || idx >= candidates.length) continue;
    picked.add(idx);
    reordered.push({
      ...candidates[idx],
      score: item.score,
    });
  }

  for (let i = 0; i < candidates.length; i++) {
    if (picked.has(i)) continue;
    reordered.push(candidates[i]);
  }

  return reordered.slice(0, limit);
}

export async function semanticSearch(
  query: string,
  limit: number,
  userId: number
): Promise<Array<{ articleId: number; score: number }>> {
  if (!query.trim()) return [];

  try {
    const embedding = await getEmbedding(query, userId);
    const hits = await queryVector(userId, embedding, Math.max(limit * 3, limit), {
      user_id: userId,
    });

    const candidates: Candidate[] = hits
      .filter((hit) => Number.isFinite(hit.articleId) && hit.articleId > 0)
      .map((hit) => ({
        articleId: hit.articleId,
        score: hit.score,
        document: hit.document,
      }));

    let finalList = candidates.slice(0, limit);
    if (candidates.length > 0) {
      const rerankResults = await rerank(
        query,
        candidates.map((c) => c.document),
        userId,
        Math.min(limit, candidates.length)
      );
      finalList = rerankResults
        ? applyRerank(candidates, rerankResults, limit)
        : candidates.slice(0, limit);
    }

    return finalList.map((item) => ({
      articleId: item.articleId,
      score: item.score,
    }));
  } catch (error) {
    log.warn({ error, query }, '语义检索失败，返回空结果');
    return [];
  }
}

export async function relatedByArticle(
  articleId: number,
  limit: number,
  userId: number
): Promise<Array<{ articleId: number; score: number }>> {
  const db = getDb();
  const article = await db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('articles.id', '=', articleId)
    .where('rss_sources.user_id', '=', userId)
    .select([
      'articles.id',
      'articles.title',
      'articles.summary',
      'articles.content',
      'articles.markdown_content',
    ])
    .executeTakeFirst();

  if (!article) return [];

  const text = buildVectorText(article as any);
  if (!text) return [];

  try {
    const embedding = await getEmbedding(text, userId);
    const hits = await queryVector(userId, embedding, Math.max(limit * 3, limit), {
      user_id: userId,
    });

    const filtered = hits
      .filter((hit) => hit.articleId && hit.articleId !== articleId)
      .slice(0, limit)
      .map((hit) => ({
        articleId: hit.articleId,
        score: hit.score,
      }));

    return filtered;
  } catch (error) {
    log.warn({ error, articleId }, '相关文章检索失败，返回空结果');
    return [];
  }
}
