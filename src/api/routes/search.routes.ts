import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import { getDb } from '../../db.js';
import { logger } from '../../logger.js';
import { semanticSearch } from '../../vector/search.js';

const log = logger.child({ module: 'api-routes/search' });

const router = express.Router();

/**
 * GET /api/search
 * Search articles by title or content
 *
 * Query parameters:
 * - q: search query (required)
 * - mode: 'semantic' | 'keyword' | 'mixed' (default: 'mixed')
 * - page: page number (default: 1)
 * - limit: results per page (default: 10)
 *
 * Phase 8: 向量语义搜索
 */
router.get('/search', requireAuth, async (req: AuthRequest, res) => {
  try {
    const query = req.query.q as string;
    const mode = (req.query.mode as string) || 'mixed';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const normalizedQuery = query.trim();
    const lowerQuery = normalizedQuery.toLowerCase();

    const calcRelevance = (title: string, summary: string | null | undefined): number => {
      let score = 0;
      const safeTitle = title.toLowerCase();
      const safeSummary = (summary || '').toLowerCase();

      if (safeTitle.includes(lowerQuery)) score += 0.5;
      if (safeTitle.startsWith(lowerQuery)) score += 0.3;
      if (safeSummary.includes(lowerQuery)) score += 0.2;

      return Math.min(score, 1);
    };
    const semanticWeight = 0.7;
    const keywordWeight = 0.3;

    const db = getDb();
    const loadDetailsByIds = async (ids: number[]) => {
      if (ids.length === 0) return [];
      return await db
        .selectFrom('articles')
        .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
        .where('rss_sources.user_id', '=', req.userId!)
        .where('articles.filter_status', '=', 'passed')
        .where('articles.id', 'in', ids)
        .select([
          'articles.id',
          'articles.title',
          'articles.url',
          'articles.summary',
          'articles.published_at',
          'rss_sources.name as rss_source_name',
        ])
        .execute();
    };

    // 语义搜索
    if (mode === 'semantic') {
      const semanticResults = await semanticSearch(normalizedQuery, limit, req.userId!);
      const ids = semanticResults.map((item) => item.articleId).filter((id) => id > 0);
      const details = await loadDetailsByIds(ids);
      const detailMap = new Map(details.map((item) => [item.id, item]));
      const scores = semanticResults.map((item) => item.score || 0);
      const maxScore = scores.length > 0 ? Math.max(...scores, 0) : 0;

      const results = semanticResults
        .map((item) => {
          const detail = detailMap.get(item.articleId);
          if (!detail) return null;
          const normalized = maxScore > 0 ? item.score / maxScore : 0;
          return {
            ...detail,
            relevance: normalized,
            excerpt: detail.summary || '',
          };
        })
        .filter(Boolean);

      res.json({
        results,
        mode: 'semantic',
        query: normalizedQuery,
        total: results.length,
        page: 1,
        limit,
        totalPages: 1,
      });
      return;
    }

    // Keyword search（现有实现）
    const offset = (page - 1) * limit;
    const terms = normalizedQuery
      .split(/\s+/)
      .filter((term) => term.length > 0);

    // 获取总数
    const countResult = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.filter_status', '=', 'passed')
      .where((eb) =>
        eb.and(
          terms.map((term) => {
            const pattern = `%${term}%`;
            return eb.or([
              eb('articles.title', 'like', pattern),
              eb('articles.summary', 'like', pattern),
              eb('articles.markdown_content', 'like', pattern),
            ]);
          })
        )
      )
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const total = Number(countResult?.count || 0);

    // 获取关键词结果
    const results = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.filter_status', '=', 'passed')
      .where((eb) =>
        eb.and(
          terms.map((term) => {
            const pattern = `%${term}%`;
            return eb.or([
              eb('articles.title', 'like', pattern),
              eb('articles.summary', 'like', pattern),
              eb('articles.markdown_content', 'like', pattern),
            ]);
          })
        )
      )
      .select([
        'articles.id',
        'articles.title',
        'articles.url',
        'articles.summary',
        'articles.markdown_content',
        'articles.published_at',
        'rss_sources.name as rss_source_name',
      ])
      .orderBy('articles.published_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    // 计算关键词相关度
    const resultsWithScore = results.map((article) => ({
      ...article,
      relevance: calcRelevance(article.title, article.summary),
      excerpt: article.summary || article.markdown_content?.substring(0, 300) || '',
    }));

    // 按相关度排序
    resultsWithScore.sort((a, b) => b.relevance - a.relevance);

    // 混合检索：关键词 + 语义
    if (mode === 'mixed') {
      try {
        const semanticResults = await semanticSearch(normalizedQuery, limit, req.userId!);
        const semanticIds = semanticResults
          .map((item) => item.articleId)
          .filter((id) => Number.isFinite(id) && id > 0);

        let semanticDetails: Array<{
          id: number;
          title: string;
          url: string;
          summary: string | null;
          published_at: string | null;
          rss_source_name: string;
        }> = [];

        if (semanticIds.length > 0) {
          semanticDetails = await loadDetailsByIds(semanticIds);
        }

        const detailsById = new Map(semanticDetails.map((item) => [item.id, item]));
        const semanticScores = semanticResults.map((item) => (typeof item.score === 'number' ? item.score : 0));
        const maxSemanticScore = semanticScores.length > 0 ? Math.max(...semanticScores, 0) : 0;

        const mergedById = new Map<number, any>();

        for (const item of resultsWithScore) {
          mergedById.set(item.id, {
            ...item,
            semanticScore: 0,
          });
        }

        for (const item of semanticResults) {
          const detail = detailsById.get(item.articleId);
          if (!detail) continue;

          const existing = mergedById.get(detail.id);
          const base = existing || {
            id: detail.id,
            title: detail.title,
            url: detail.url,
            summary: detail.summary,
            published_at: detail.published_at,
            rss_source_name: detail.rss_source_name,
            relevance: calcRelevance(detail.title, detail.summary),
            excerpt: detail.summary || '',
          };

          mergedById.set(detail.id, {
            ...base,
            semanticScore: typeof item.score === 'number' ? item.score : 0,
            excerpt: base.excerpt,
          });
        }

        const merged = Array.from(mergedById.values()).map((item) => {
          const normalizedSemantic = maxSemanticScore > 0 ? item.semanticScore / maxSemanticScore : 0;
          const combinedScore = normalizedSemantic * semanticWeight + item.relevance * keywordWeight;

          return {
            ...item,
            combinedScore,
            relevance: combinedScore,
          };
        });

        merged.sort((a, b) => b.combinedScore - a.combinedScore);

        log.info(
          {
            query: normalizedQuery,
            mode: 'mixed',
            keywordCount: resultsWithScore.length,
            semanticCount: semanticResults.length,
            mergedCount: merged.length,
          },
          'Mixed search completed'
        );

        res.json({
          results: merged.slice(0, limit),
          mode: 'mixed',
          query: normalizedQuery,
          total: merged.length,
          page: 1,
          limit,
          totalPages: 1,
        });
        return;
      } catch (error) {
        log.warn({ error, query: normalizedQuery }, 'Mixed search failed, falling back to keyword search');
      }
    }

    log.info(
      {
        query: normalizedQuery,
        mode: 'keyword',
        keywordCount: resultsWithScore.length,
        total,
        page,
        limit,
      },
      'Keyword search completed'
    );

    res.json({
      results: resultsWithScore,
      mode: 'keyword',
      query: normalizedQuery,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to search articles');
    res.status(500).json({ error: 'Failed to search articles' });
  }
});

export default router;
