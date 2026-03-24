import { search, SearchMode, type SearchRequest, type SearchResult } from '../../src/vector/search-service.js';
import { getConfig } from './config.js';
import type { CandidateArticle } from './types.js';

export async function semanticSearch(query: string, limit: number): Promise<CandidateArticle[]> {
  const config = getConfig();
  const userId = config.user.userId;

  const request: SearchRequest = {
    mode: SearchMode.SEMANTIC,
    userId,
    query,
    limit,
    fallbackEnabled: true,
  };

  try {
    const response = await search(request);
    return response.results.map((r) => ({
      articleId: r.articleId,
      title: r.metadata?.title || '',
      score: r.score,
      source: 'semantic' as const,
    }));
  } catch (error) {
    console.error('Semantic search failed:', error);
    return [];
  }
}

export async function hybridSearch(
  query: string,
  limit: number,
  semanticWeight?: number,
  keywordWeight?: number
): Promise<CandidateArticle[]> {
  const config = getConfig();
  const userId = config.user.userId;
  const semWeight = semanticWeight ?? config.search.semantic_weight;
  const kwWeight = keywordWeight ?? config.search.keyword_weight;

  const request: SearchRequest = {
    mode: SearchMode.HYBRID,
    userId,
    query,
    limit,
    semanticWeight: semWeight,
    keywordWeight: kwWeight,
    normalizeScores: false,
    fallbackEnabled: true,
  };

  try {
    const response = await search(request);
    return response.results.map((r) => ({
      articleId: r.articleId,
      title: r.metadata?.title || '',
      score: r.score,
      source: 'semantic' as const,
    }));
  } catch (error) {
    console.error('Hybrid search failed:', error);
    return [];
  }
}

export async function relatedSearch(articleId: number, limit: number): Promise<CandidateArticle[]> {
  const config = getConfig();
  const userId = config.user.userId;

  const request: SearchRequest = {
    mode: SearchMode.RELATED,
    userId,
    articleId,
    limit,
    useCache: true,
  };

  try {
    const response = await search(request);
    return response.results.map((r) => ({
      articleId: r.articleId,
      title: r.metadata?.title || '',
      score: r.score,
      source: 'related' as const,
    }));
  } catch (error) {
    console.error('Related search failed:', error);
    return [];
  }
}

export function filterByScore(candidates: CandidateArticle[], threshold: number): CandidateArticle[] {
  return candidates.filter((c) => c.score >= threshold);
}

export function mergeResults(
  relatedResults: CandidateArticle[],
  semanticResults: CandidateArticle[]
): CandidateArticle[] {
  const map = new Map<number, CandidateArticle>();

  for (const result of relatedResults) {
    const key = result.articleId!;
    if (!map.has(key)) {
      map.set(key, result);
    } else {
      const existing = map.get(key)!;
      existing.score = Math.max(existing.score, result.score);
    }
  }

  for (const result of semanticResults) {
    const key = result.articleId!;
    if (!map.has(key)) {
      map.set(key, result);
    } else {
      const existing = map.get(key)!;
      existing.score = Math.max(existing.score, result.score);
      existing.source = 'semantic';
    }
  }

  return Array.from(map.values()).sort((a, b) => b.score - a.score);
}