import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import { getDb } from '../../db.js';
import * as articleService from '../articles.js';
import { logger } from '../../logger.js';
import { deleteArticle as deleteVectorArticle } from '../../vector/indexer.js';
import { getActiveConfigByType } from '../llm-configs.js';
import { getClient } from '../../vector/chroma-client.js';
import { getChromaSettings } from '../settings.js';

const log = logger.child({ module: 'api-routes/articles' });

const router = express.Router();

function normalizeQueryIds(param: string | string[] | undefined): number[] | undefined {
  if (!param) return undefined;
  const values = Array.isArray(param) ? param : [param];
  const ids = values
    .map((value) => parseInt(value, 10))
    .filter((value) => !Number.isNaN(value));
  return ids.length > 0 ? ids : undefined;
}

function normalizeBodyIds(input: unknown): number[] | undefined {
  if (input === undefined || input === null) return undefined;
  const values = Array.isArray(input) ? input : [input];
  const ids = values
    .map((value) => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = parseInt(value, 10);
        return Number.isNaN(parsed) ? null : parsed;
      }
      return null;
    })
    .filter((value): value is number => typeof value === 'number' && !Number.isNaN(value));
  return ids.length > 0 ? ids : undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

// ============================================================================
// Articles Routes
// ============================================================================

/**
 * GET /api/articles
 * Get user articles with pagination
 */
router.get('/articles', requireAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const rssSourceId = req.query.rssSourceId
      ? parseInt(req.query.rssSourceId as string)
      : undefined;
    const journalId = req.query.journalId
      ? parseInt(req.query.journalId as string)
      : undefined;
    const filterStatus = req.query.filterStatus as
      | 'pending'
      | 'passed'
      | 'rejected'
      | undefined;
    const processStatus = req.query.processStatus as
      | 'pending'
      | 'processing'
      | 'completed'
      | 'failed'
      | undefined;
    const searchQuery = req.query.search as string | undefined;
    const daysAgo = req.query.daysAgo
      ? parseInt(req.query.daysAgo as string)
      : undefined;
    // 日期范围过滤
    const createdAfter = req.query.createdAfter as string | undefined;
    const createdBefore = req.query.createdBefore as string | undefined;
    // 搜索时跳过时间过滤，实现全量检索（但日期范围过滤仍然生效）
    const skipDaysFilterForSearch = searchQuery && searchQuery.trim() !== '' ? true : undefined;
    // 已读状态过滤
    const isReadParam = req.query.isRead as string | undefined;
    const isRead = isReadParam === 'true' ? true : isReadParam === 'false' ? false : undefined;
    const rssSourceIds = normalizeQueryIds(req.query.rssSourceIds as string | string[] | undefined);
    const journalIds = normalizeQueryIds(req.query.journalIds as string | string[] | undefined);

    const result = await articleService.getUserArticles(req.userId!, {
      page,
      limit,
      rssSourceId,
      rssSourceIds,
      journalId,
      journalIds,
      filterStatus,
      processStatus,
      search: searchQuery,
      daysAgo,
      createdAfter,
      createdBefore,
      skipDaysFilterForSearch,
      isRead,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get articles');
    res.status(500).json({ error: 'Failed to get articles' });
  }
});

/**
 * GET /api/articles/stats
 * Get article statistics for the homepage
 */
router.get('/articles/stats', requireAuth, async (req: AuthRequest, res) => {
  try {
    const db = getDb();

    // Get today's new articles count (using UTC to match database)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayCountResult = await db
      .selectFrom('articles')
      .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .leftJoin('journals', 'journals.id', 'articles.journal_id')
      .where((eb) => eb.or([
        eb.and([
          eb('articles.rss_source_id', 'is not', null),
          eb('rss_sources.user_id', '=', req.userId!),
        ]),
        eb.and([
          eb('articles.journal_id', 'is not', null),
          eb('journals.user_id', '=', req.userId!),
        ]),
      ]))
      .where('articles.created_at', '>=', today.toISOString())
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const todayNew = Number(todayCountResult?.count || 0);

    // Get pending articles count (filter_status=pending means waiting for AI analysis)
    const pendingResult = await db
      .selectFrom('articles')
      .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .leftJoin('journals', 'journals.id', 'articles.journal_id')
      .where((eb) => eb.or([
        eb.and([
          eb('articles.rss_source_id', 'is not', null),
          eb('rss_sources.user_id', '=', req.userId!),
        ]),
        eb.and([
          eb('articles.journal_id', 'is not', null),
          eb('journals.user_id', '=', req.userId!),
        ]),
      ]))
      .where('articles.filter_status', '=', 'pending')
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const pending = Number(pendingResult?.count || 0);

    // Get analyzed articles count
    const analyzedResult = await db
      .selectFrom('articles')
      .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .leftJoin('journals', 'journals.id', 'articles.journal_id')
      .where((eb) => eb.or([
        eb.and([
          eb('articles.rss_source_id', 'is not', null),
          eb('rss_sources.user_id', '=', req.userId!),
        ]),
        eb.and([
          eb('articles.journal_id', 'is not', null),
          eb('journals.user_id', '=', req.userId!),
        ]),
      ]))
      .where('articles.process_status', '=', 'completed')
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const analyzed = Number(analyzedResult?.count || 0);

    // Get pass rate
    const totalResult = await db
      .selectFrom('articles')
      .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .leftJoin('journals', 'journals.id', 'articles.journal_id')
      .where((eb) => eb.or([
        eb.and([
          eb('articles.rss_source_id', 'is not', null),
          eb('rss_sources.user_id', '=', req.userId!),
        ]),
        eb.and([
          eb('articles.journal_id', 'is not', null),
          eb('journals.user_id', '=', req.userId!),
        ]),
      ]))
      .where('articles.filter_status', '!=', 'pending')
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const passedResult = await db
      .selectFrom('articles')
      .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .leftJoin('journals', 'journals.id', 'articles.journal_id')
      .where((eb) => eb.or([
        eb.and([
          eb('articles.rss_source_id', 'is not', null),
          eb('rss_sources.user_id', '=', req.userId!),
        ]),
        eb.and([
          eb('articles.journal_id', 'is not', null),
          eb('journals.user_id', '=', req.userId!),
        ]),
      ]))
      .where('articles.filter_status', '=', 'passed')
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const total = Number(totalResult?.count || 0);
    const passed = Number(passedResult?.count || 0);
    const passRate = total > 0 ? passed / total : 0;

    // Get unread count for passed articles within 7 days
    const unreadCountResult = await db
      .selectFrom('articles')
      .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .leftJoin('journals', 'journals.id', 'articles.journal_id')
      .where((eb) => eb.or([
        eb.and([
          eb('articles.rss_source_id', 'is not', null),
          eb('rss_sources.user_id', '=', req.userId!),
        ]),
        eb.and([
          eb('articles.journal_id', 'is not', null),
          eb('journals.user_id', '=', req.userId!),
        ]),
      ]))
      .where('articles.filter_status', '=', 'passed')
      .where('articles.is_read', '=', 0)
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const unread = Number(unreadCountResult?.count || 0);

    res.json({
      todayNew,
      pending,
      analyzed,
      passRate,
      total,
      passed,
      unread,
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get article stats');
    res.status(500).json({ error: 'Failed to get article stats' });
  }
});

/**
 * GET /api/articles/vector-check
 * 检查向量化配置是否完整
 */
router.get('/articles/vector-check', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;

    // 检查 embedding 配置
    const embeddingConfig = await getActiveConfigByType(userId, 'embedding');
    const hasEmbedding = !!embeddingConfig;

    // 检查 Chroma 配置和服务
    const chromaSettings = await getChromaSettings(userId);
    let chromaStatus = 'unknown';
    try {
      const client = await getClient(userId);
      await client.heartbeat();
      chromaStatus = 'available';
    } catch {
      chromaStatus = 'unavailable';
    }

    const embeddingMessage = hasEmbedding
      ? 'Embedding 配置正常'
      : '缺少 Embedding 配置。请在"LLM 配置"中添加一个 config_type 为 "embedding" 的配置。';

    const chromaMessage = chromaStatus === 'available'
      ? 'Chroma 服务正常'
      : `Chroma 服务不可用 (${chromaSettings.host}:${chromaSettings.port})。请检查 Chroma 服务是否运行，或在"设置"中配置正确的 host 和 port。`;

    res.json({
      embedding: {
        configured: hasEmbedding,
        message: embeddingMessage,
      },
      chroma: {
        configured: true,
        status: chromaStatus,
        host: chromaSettings.host,
        port: chromaSettings.port,
        message: chromaMessage,
      },
      ready: hasEmbedding && chromaStatus === 'available',
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error({ error, userId: req.userId }, 'Failed to check vector config');
    res.status(500).json({ error: errMsg });
  }
});

/**
 * GET /api/articles/sources
 * Get merged sources list (RSS sources and journals combined by name)
 */
router.get('/articles/sources', requireAuth, async (req: AuthRequest, res) => {
  try {
    const sources = await articleService.getMergedSources(req.userId!);
    res.json({ sources });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get merged sources');
    res.status(500).json({ error: 'Failed to get merged sources' });
  }
});

/**
 * GET /api/articles/:id
 * Get single article by ID
 */
router.get('/articles/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (typeof idParam !== 'string') {
      return res.status(400).json({ error: 'Invalid article ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid article ID' });
    }

    const article = await articleService.getArticleById(id, req.userId!);

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const [translation, filterMatches] = await Promise.all([
      articleService.getArticleTranslation(id, req.userId!),
      articleService.getArticleFilterMatches(id, req.userId!),
    ]);

    res.json({
      ...article,
      translation,
      filter_matches: filterMatches,
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get article');
    res.status(500).json({ error: 'Failed to get article' });
  }
});

/**
 * DELETE /api/articles/:id
 * Delete article by ID
 */
router.delete('/articles/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (typeof idParam !== 'string') {
      return res.status(400).json({ error: 'Invalid article ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid article ID' });
    }

    await articleService.deleteArticle(id, req.userId!);
    deleteVectorArticle(id, req.userId!).catch((error) => {
      log.warn({ error, articleId: id }, '删除向量索引失败');
    });

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Article not found') {
      return res.status(404).json({ error: 'Article not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to delete article');
    res.status(500).json({ error: 'Failed to delete article' });
  }
});

/**
 * GET /api/articles/:id/related
 * 获取相关文章（缓存优先）
 */
router.get('/articles/:id/related', requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (typeof idParam !== 'string') {
      return res.status(400).json({ error: 'Invalid article ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid article ID' });
    }

    const related = await articleService.getRelatedArticles(id, req.userId!, 5);
    res.json(related);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get related articles');
    res.status(500).json({ error: 'Failed to get related articles' });
  }
});

/**
 * PATCH /api/articles/:id/read
 * Update article read status
 */
router.patch('/articles/:id/read', requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (typeof idParam !== 'string') {
      return res.status(400).json({ error: 'Invalid article ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid article ID' });
    }

    const { is_read } = req.body;
    if (typeof is_read !== 'boolean') {
      return res.status(400).json({ error: 'is_read must be a boolean' });
    }

    await articleService.updateArticleReadStatus(id, req.userId!, is_read);

    res.json({ success: true, is_read });
  } catch (error) {
    if (error instanceof Error && error.message === 'Article not found') {
      return res.status(404).json({ error: 'Article not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to update article read status');
    res.status(500).json({ error: 'Failed to update article read status' });
  }
});

/**
 * POST /api/articles/batch-read
 * Batch update article read status
 */
router.post('/articles/batch-read', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { articleIds, is_read } = req.body;

    if (!Array.isArray(articleIds) || articleIds.length === 0) {
      return res.status(400).json({ error: 'articleIds must be a non-empty array' });
    }

    if (typeof is_read !== 'boolean') {
      return res.status(400).json({ error: 'is_read must be a boolean' });
    }

    const count = await articleService.batchUpdateArticleReadStatus(
      req.userId!,
      articleIds,
      is_read
    );

    res.json({ success: true, count });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to batch update article read status');
    res.status(500).json({ error: 'Failed to batch update article read status' });
  }
});

/**
 * POST /api/articles/mark-all-read
 * Mark all filtered articles as read
 */
router.post('/articles/mark-all-read', requireAuth, async (req: AuthRequest, res) => {
  try {
    const {
      filterStatus,
      daysAgo,
      rssSourceId,
      rssSourceIds: bodyRssSourceIds,
      journalId,
      journalIds: bodyJournalIds,
      processStatus,
      isRead,
      search,
      createdAfter,
      createdBefore,
    } = req.body;

    const normalizedRssSourceIds = normalizeBodyIds(bodyRssSourceIds);
    const normalizedJournalIds = normalizeBodyIds(bodyJournalIds);
    const singleRssSourceId = parseOptionalNumber(rssSourceId);
    const singleJournalId = parseOptionalNumber(journalId);

    const count = await articleService.markAllAsRead(req.userId!, {
      filterStatus,
      daysAgo,
      rssSourceId: singleRssSourceId,
      rssSourceIds: normalizedRssSourceIds,
      journalId: singleJournalId,
      journalIds: normalizedJournalIds,
      processStatus,
      isRead,
      search,
      createdAfter,
      createdBefore,
    });

    res.json({ success: true, count });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to mark all articles as read');
    res.status(500).json({ error: 'Failed to mark all articles as read' });
  }
});

export default router;
