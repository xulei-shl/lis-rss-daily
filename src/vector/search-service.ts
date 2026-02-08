/**
 * Unified Search Service
 *
 * Provides a single entry point for all search operations:
 * - Semantic search (vector similarity)
 * - Keyword search (SQL LIKE)
 * - Hybrid search (semantic + keyword fusion)
 * - Related articles (with caching)
 *
 * Includes automatic fallback to keyword search when semantic search fails.
 */

import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { getEmbedding } from './embedding-client.js';
import { query as queryVector } from './vector-store.js';
import { rerank } from './reranker.js';
import { buildVectorText } from './text-builder.js';

const log = logger.child({ module: 'search-service' });

type Candidate = {
  articleId: number;
  score: number;
  document: string;
};

/* ── Public Types ── */

export enum SearchMode {
  SEMANTIC = 'semantic',
  KEYWORD = 'keyword',
  HYBRID = 'hybrid',
  RELATED = 'related',
}

export interface SearchRequest {
  mode: SearchMode;
  userId: number;

  // Query input
  query?: string;
  articleId?: number;

  // Search parameters
  limit?: number;
  offset?: number;

  // Fusion parameters
  semanticWeight?: number;
  keywordWeight?: number;
  normalizeScores?: boolean;

  // Cache parameters (RELATED mode only)
  useCache?: boolean;
  refreshCache?: boolean;

  // Fallback
  fallbackEnabled?: boolean;
}

export interface SearchResult {
  articleId: number;
  score: number;
  semanticScore?: number;
  keywordScore?: number;
  metadata?: {
    title: string;
    url: string;
    summary: string | null;
    published_at: string | null;
    rss_source_name?: string;
  };
}

export interface SearchResponse {
  results: SearchResult[];
  mode: SearchMode;
  query?: string;
  total: number;
  page?: number;
  limit?: number;
  cached: boolean;
  fallback?: boolean;
}

/* ── Configuration ── */

const DEFAULT_LIMIT = 10;
const DEFAULT_SEMANTIC_WEIGHT = 0.7;
const DEFAULT_KEYWORD_WEIGHT = 0.3;

/* ── Main Search Entry ── */

/**
 * Unified search entry point.
 */
export async function search(request: SearchRequest): Promise<SearchResponse> {
  const {
    mode,
    userId,
    query,
    articleId,
    limit = DEFAULT_LIMIT,
    offset = 0,
    semanticWeight = DEFAULT_SEMANTIC_WEIGHT,
    keywordWeight = DEFAULT_KEYWORD_WEIGHT,
    normalizeScores = true,
    useCache = true,
    refreshCache = false,
    fallbackEnabled = true,
  } = request;

  // Validate parameters
  if (mode === SearchMode.RELATED && !articleId) {
    throw new Error('articleId is required for RELATED mode');
  }
  if ((mode === SearchMode.SEMANTIC || mode === SearchMode.HYBRID || mode === SearchMode.KEYWORD) && !query) {
    throw new Error('query is required for search modes');
  }

  // Related articles with cache
  if (mode === SearchMode.RELATED) {
    return searchRelated(
      userId,
      articleId!,
      limit,
      useCache && !refreshCache
    );
  }

  // Text search modes
  const effectiveQuery = query!.trim();
  const startTime = Date.now();

  try {
    let results: SearchResult[];
    let fallback = false;

    switch (mode) {
      case SearchMode.SEMANTIC:
        results = await semanticSearchOnly(userId, effectiveQuery, limit);
        break;
      case SearchMode.KEYWORD:
        results = await keywordSearchOnly(userId, effectiveQuery, limit);
        break;
      case SearchMode.HYBRID:
        const hybridResult = await hybridSearch(
          userId,
          effectiveQuery,
          limit,
          semanticWeight,
          keywordWeight,
          normalizeScores,
          fallbackEnabled
        );
        results = hybridResult.results;
        fallback = hybridResult.fallback;
        break;
      default:
        throw new Error(`Unsupported search mode: ${mode}`);
    }

    const duration = Date.now() - startTime;
    log.info(
      { userId, mode, query: effectiveQuery, resultCount: results.length, duration, fallback },
      'Search completed'
    );

    return {
      results: results.slice(offset, offset + limit),
      mode,
      query: effectiveQuery,
      total: results.length,
      page: Math.floor(offset / limit) + 1,
      limit,
      cached: false,
      fallback,
    };
  } catch (error) {
    log.warn({ error, userId, mode, query: effectiveQuery }, 'Search failed, returning empty results');
    return {
      results: [],
      mode,
      query: effectiveQuery,
      total: 0,
      page: 1,
      limit,
      cached: false,
      fallback: false,
    };
  }
}

/* ── Semantic Search Only ── */

async function semanticSearchOnly(
  userId: number,
  query: string,
  limit: number
): Promise<SearchResult[]> {
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

  // Rerank
  let finalList = candidates.slice(0, limit);
  if (candidates.length > 0) {
    const rerankResults = await rerank(
      query,
      candidates.map((c) => c.document),
      userId,
      Math.min(limit, candidates.length)
    );
    if (rerankResults) {
      finalList = applyRerank(candidates, rerankResults, limit);
    }
  }

  return await enrichWithMetadata(userId, finalList);
}

/* ── Keyword Search Only ── */

async function keywordSearchOnly(
  userId: number,
  query: string,
  limit: number
): Promise<SearchResult[]> {
  const db = getDb();
  const lowerQuery = query.toLowerCase();
  const terms = query.trim().split(/\s+/).filter((t) => t.length > 0);

  const calcRelevance = (title: string): number => {
    let score = 0;
    const safeTitle = title.toLowerCase();

    if (safeTitle.includes(lowerQuery)) score += 0.7;
    if (safeTitle.startsWith(lowerQuery)) score += 0.3;

    return Math.min(score, 1);
  };

  let queryBuilder = db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('rss_sources.user_id', '=', userId)
    .where('articles.filter_status', '=', 'passed');

  if (terms.length > 0) {
    queryBuilder = queryBuilder.where((eb) =>
      eb.and(
        terms.map((term) => {
          const pattern = `%${term}%`;
          return eb.or([
            eb('articles.title', 'like', pattern),
            eb('articles.markdown_content', 'like', pattern),
          ]);
        })
      )
    );
  }

  const articles = await queryBuilder
    .select([
      'articles.id',
      'articles.title',
      'articles.url',
      'articles.published_at',
      'rss_sources.name as rss_source_name',
    ])
    .orderBy('articles.published_at', 'desc')
    .limit(limit * 3)
    .execute();

  return articles
    .map((article) => ({
      articleId: article.id,
      score: calcRelevance(article.title),
      keywordScore: calcRelevance(article.title),
      metadata: {
        title: article.title,
        url: article.url,
        summary: null,
        published_at: article.published_at,
        rss_source_name: article.rss_source_name ?? undefined,
      },
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* ── Hybrid Search ── */

interface HybridResult {
  results: SearchResult[];
  fallback: boolean;
}

async function hybridSearch(
  userId: number,
  query: string,
  limit: number,
  semanticWeight: number,
  keywordWeight: number,
  normalizeScores: boolean,
  fallbackEnabled: boolean
): Promise<HybridResult> {
  // Try semantic search
  let semanticResults: SearchResult[] = [];
  let semanticFailed = false;

  try {
    semanticResults = await semanticSearchOnly(userId, query, limit);
  } catch (error) {
    semanticFailed = true;
    log.warn({ error, query }, 'Semantic search failed in hybrid mode');
  }

  // Keyword search (always succeeds)
  const keywordResults = await keywordSearchOnly(userId, query, limit);

  // Fallback: if semantic failed and fallback enabled, return keyword-only
  if (semanticFailed && semanticResults.length === 0) {
    if (fallbackEnabled) {
      log.info({ query, count: keywordResults.length }, 'Using keyword-only results (fallback)');
      return { results: keywordResults, fallback: true };
    }
    // If fallback disabled, throw the original error
    throw new Error('Semantic search failed and fallback is disabled');
  }

  // Merge results
  const mergedByArticleId = new Map<number, SearchResult>();

  // Add semantic results
  for (const result of semanticResults) {
    mergedByArticleId.set(result.articleId, {
      ...result,
      semanticScore: result.score,
    });
  }

  // Merge keyword results
  for (const result of keywordResults) {
    const existing = mergedByArticleId.get(result.articleId);
    if (existing) {
      // Merge scores
      const kwScore = result.keywordScore ?? result.score;
      const semScore = existing.semanticScore ?? existing.score;

      let finalScore: number;
      if (normalizeScores) {
        // Normalize semantic scores (search page behavior)
        const maxSemScore = Math.max(
          ...semanticResults.map((r) => r.semanticScore ?? r.score),
          0.01
        );
        const normalizedSem = semScore / maxSemScore;
        finalScore = normalizedSem * semanticWeight + kwScore * keywordWeight;
      } else {
        // No normalization (related articles behavior)
        finalScore = semScore * semanticWeight + kwScore * keywordWeight;
      }

      mergedByArticleId.set(result.articleId, {
        ...existing,
        score: finalScore,
        keywordScore: kwScore,
      });
    } else {
      // Keyword-only result
      mergedByArticleId.set(result.articleId, {
        ...result,
        keywordScore: result.score,
      });
    }
  }

  const results = Array.from(mergedByArticleId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { results, fallback: false };
}

/* ── Related Articles Search ── */

async function searchRelated(
  userId: number,
  articleId: number,
  limit: number,
  useCache: boolean
): Promise<SearchResponse> {
  // Try cache first if enabled
  if (useCache) {
    const cached = await getRelatedFromCache(userId, articleId, limit);
    if (cached.length > 0) {
      return {
        results: cached,
        mode: SearchMode.RELATED,
        total: cached.length,
        limit,
        cached: true,
      };
    }
  }

  // Compute related articles
  const computed = await computeRelated(
    userId,
    articleId,
    limit
  );

  // Save cache asynchronously
  saveRelatedToCache(articleId, computed).catch((error) => {
    log.warn({ error, articleId }, 'Failed to save related articles cache');
  });

  return {
    results: computed,
    mode: SearchMode.RELATED,
    total: computed.length,
    limit,
    cached: false,
  };
}

async function computeRelated(
  userId: number,
  articleId: number,
  limit: number
): Promise<SearchResult[]> {
  const db = getDb();

  // Get source article
  const article = await db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('articles.id', '=', articleId)
    .where('rss_sources.user_id', '=', userId)
    .select([
      'articles.id',
      'articles.title',
      'articles.content',
      'articles.markdown_content',
    ])
    .executeTakeFirst();

  if (!article) return [];

  // Build query text
  const text = buildVectorText(article as any);
  if (!text) return [];

  // Semantic search only (keyword search removed)
  const embedding = await getEmbedding(text, userId);
  const semanticHits = await queryVector(userId, embedding, Math.max(limit * 3, limit), {
    user_id: userId,
  });

  const semanticResults = semanticHits
    .filter((hit) => hit.articleId && hit.articleId !== articleId)
    .map((hit) => ({
      articleId: hit.articleId,
      finalScore: hit.score,
      semanticScore: hit.score,
    }));

  if (semanticResults.length === 0) return [];

  // Sort by score descending
  semanticResults.sort((a, b) => b.finalScore - a.finalScore);

  // Apply score threshold logic:
  // - Prioritize articles with score > 0.5, max 5 articles
  // - If insufficient high-score articles, return max 3 articles by score
  const highScoreArticles = semanticResults.filter((r) => r.finalScore > 0.5);
  const effectiveLimit = highScoreArticles.length >= 3 ? Math.min(limit, 5) : Math.min(limit, 3);
  const topResults = highScoreArticles.length >= effectiveLimit
    ? highScoreArticles.slice(0, effectiveLimit)
    : semanticResults.slice(0, effectiveLimit);

  // Load details
  const topIds = topResults.map((item) => item.articleId);
  if (topIds.length === 0) return [];

  const rows = await db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('rss_sources.user_id', '=', userId)
    .where('articles.filter_status', '=', 'passed')
    .where('articles.process_status', '=', 'completed')
    .where('articles.id', 'in', topIds)
    .select([
      'articles.id',
      'articles.title',
      'articles.url',
      'articles.published_at',
      'rss_sources.name as rss_source_name',
    ])
    .execute();

  const scoreLookup = new Map(topResults.map((item) => [item.articleId, item.finalScore]));
  const semScoreLookup = new Map(topResults.map((item) => [item.articleId, item.semanticScore]));

  return rows
    .map((row) => ({
      articleId: row.id,
      score: Number(scoreLookup.get(row.id) ?? 0),
      semanticScore: semScoreLookup.get(row.id),
      keywordScore: undefined,
      metadata: {
        title: row.title,
        url: row.url,
        summary: null,
        published_at: row.published_at,
        rss_source_name: row.rss_source_name ?? undefined,
      },
    }))
    .filter((row) => row.articleId !== articleId)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aTime = a.metadata?.published_at ? Date.parse(a.metadata.published_at) : 0;
      const bTime = b.metadata?.published_at ? Date.parse(b.metadata.published_at) : 0;
      return bTime - aTime;
    })
    .slice(0, effectiveLimit);
}

async function getRelatedFromCache(
  userId: number,
  articleId: number,
  limit: number
): Promise<SearchResult[]> {
  const db = getDb();

  const rows = await db
    .selectFrom('article_related as ar')
    .innerJoin('articles', 'articles.id', 'ar.related_article_id')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('ar.article_id', '=', articleId)
    .where('rss_sources.user_id', '=', userId)
    .where('articles.filter_status', '=', 'passed')
    .where('articles.process_status', '=', 'completed')
    .select([
      'articles.id',
      'articles.title',
      'articles.url',
      'articles.published_at',
      'rss_sources.name as rss_source_name',
      'ar.score as score',
    ])
    .orderBy('ar.score', 'desc')
    .orderBy('articles.published_at', 'desc')
    .limit(limit)
    .execute();

  return rows.map((row) => ({
    articleId: row.id,
    score: Number(row.score ?? 0),
    metadata: {
      title: row.title,
      url: row.url,
      summary: null,
      published_at: row.published_at,
      rss_source_name: row.rss_source_name ?? undefined,
    },
  }));
}

async function saveRelatedToCache(articleId: number, results: SearchResult[]): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('article_related').where('article_id', '=', articleId).execute();

    if (results.length === 0) return;

    await trx
      .insertInto('article_related')
      .values(
        results.map((item) => ({
          article_id: articleId,
          related_article_id: item.articleId,
          score: item.score,
          created_at: now,
        }))
      )
      .execute();
  });
}

/* ── Utility Functions ── */

async function enrichWithMetadata(
  userId: number,
  results: Array<{ articleId: number; score: number }>
): Promise<SearchResult[]> {
  if (results.length === 0) return [];

  const ids = results.map((r) => r.articleId);
  const db = getDb();

  const articles = await db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('rss_sources.user_id', '=', userId)
    .where('articles.filter_status', '=', 'passed')
    .where('articles.id', 'in', ids)
    .select([
      'articles.id',
      'articles.title',
      'articles.url',
      'articles.published_at',
      'rss_sources.name as rss_source_name',
    ])
    .execute();

  const articleMap = new Map(articles.map((a) => [a.id, a]));

  return results
    .filter((r) => articleMap.has(r.articleId))
    .map((r) => {
      const article = articleMap.get(r.articleId)!;
      return {
        articleId: r.articleId,
        score: r.score,
        metadata: {
          title: article.title,
          url: article.url,
          summary: null,
          published_at: article.published_at,
          rss_source_name: article.rss_source_name ?? undefined,
        },
      };
    });
}

function applyRerank(
  candidates: Array<{ articleId: number; score: number; document: string }>,
  rerankResults: Array<{ index: number; score: number }>,
  limit: number
): Array<{ articleId: number; score: number; document: string }> {
  if (rerankResults.length === 0) return candidates.slice(0, limit);

  const picked = new Set<number>();
  const reordered: typeof candidates = [];

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
