import express from 'express';
import type { NextFunction, Response } from 'express';
import { logger } from '../../logger.js';
import { requireCliAuth, type AuthRequest } from '../../middleware/auth.js';
import { search, SearchMode, type SearchRequest } from '../../vector/search.js';

const log = logger.child({ module: 'api-routes/external-search' });

const router = express.Router();

type ExternalSearchBody = Partial<Omit<SearchRequest, 'userId'>> & {
  userId?: number | string;
  query?: string;
  articleId?: number | string;
  limit?: number | string;
  offset?: number | string;
  semanticWeight?: number | string;
  keywordWeight?: number | string;
  normalizeScores?: boolean | string;
  useCache?: boolean | string;
  refreshCache?: boolean | string;
  fallbackEnabled?: boolean | string;
};

function injectUserIdFromBody(req: AuthRequest, _res: Response, next: NextFunction): void {
  if (req.query.user_id) {
    next();
    return;
  }

  const body = req.body as ExternalSearchBody | undefined;
  if (!body || body.userId === undefined || body.userId === null) {
    next();
    return;
  }

  const rawUserId = body.userId;
  const userId = typeof rawUserId === 'number' ? rawUserId : parseInt(String(rawUserId), 10);
  if (!Number.isFinite(userId)) {
    next();
    return;
  }

  (req.query as Record<string, unknown>).user_id = String(userId);
  next();
}

function parseMode(value: unknown): SearchMode | undefined {
  if (typeof value !== 'string') return undefined;

  switch (value.trim().toLowerCase()) {
    case SearchMode.SEMANTIC:
      return SearchMode.SEMANTIC;
    case SearchMode.KEYWORD:
      return SearchMode.KEYWORD;
    case SearchMode.HYBRID:
    case 'mixed':
      return SearchMode.HYBRID;
    case SearchMode.RELATED:
      return SearchMode.RELATED;
    default:
      return undefined;
  }
}

function parseOptionalInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}

function buildSearchRequest(req: AuthRequest): SearchRequest {
  const body = (req.body ?? {}) as ExternalSearchBody;
  const mode = parseMode(body.mode);

  if (!mode) {
    throw new Error('mode must be one of: semantic, keyword, hybrid, related');
  }

  const limit = parseOptionalInteger(body.limit);
  if (limit !== undefined && limit <= 0) {
    throw new Error('limit must be a positive integer');
  }

  const offset = parseOptionalInteger(body.offset);
  if (offset !== undefined && offset < 0) {
    throw new Error('offset must be greater than or equal to 0');
  }

  const articleId = parseOptionalInteger(body.articleId);
  if (mode === SearchMode.RELATED && articleId === undefined) {
    throw new Error('articleId is required when mode is related');
  }

  const query = typeof body.query === 'string' ? body.query.trim() : undefined;
  if (mode !== SearchMode.RELATED && !query) {
    throw new Error('query is required when mode is semantic, keyword, or hybrid');
  }

  return {
    mode,
    userId: req.userId!,
    query,
    articleId,
    limit,
    offset,
    semanticWeight: parseOptionalNumber(body.semanticWeight),
    keywordWeight: parseOptionalNumber(body.keywordWeight),
    normalizeScores: parseOptionalBoolean(body.normalizeScores),
    useCache: parseOptionalBoolean(body.useCache),
    refreshCache: parseOptionalBoolean(body.refreshCache),
    fallbackEnabled: parseOptionalBoolean(body.fallbackEnabled),
  };
}

/**
 * POST /api/external/search
 * 供外部项目调用的统一检索接口
 *
 * 鉴权方式：
 * - query: user_id=1
 * - header: x-api-key: <CLI_API_KEY>
 *
 * 也支持在 body 中传 userId，路由会自动兼容到 requireCliAuth
 */
router.post('/external/search', injectUserIdFromBody, requireCliAuth, async (req: AuthRequest, res) => {
  try {
    const request = buildSearchRequest(req);
    const response = await search(request);

    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to execute external search';
    const statusCode = message.includes('required') || message.includes('must be') ? 400 : 500;

    log.error({ error, userId: req.userId }, 'Failed to execute external search');
    res.status(statusCode).json({ error: message });
  }
});

export default router;
