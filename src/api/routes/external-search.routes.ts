/**
 * 统一检索 外部 API 路由
 *
 * 供外部项目 / agent 调用统一检索，支持 4 种模式：
 * semantic / keyword / hybrid（兼容 mixed）/ related。
 *
 * 鉴权沿用既有 CLI 机制（user_id + api_key / x-api-key 对 CLI_API_KEY），
 * 不使用账号密码；具体校验复用 middleware/auth.ts 的 verifyCliAuth。
 *
 * 所有响应（含错误）都使用 src/api/external-api-response.ts 中的统一信封，
 * 每种情况对应一个稳定的 code，详见 docs/统一检索外部API调用说明.md。
 */

import express from 'express';
import type { NextFunction, Response } from 'express';
import { logger } from '../../logger.js';
import { verifyCliAuth, type AuthRequest, type CliAuthFailureReason } from '../../middleware/auth.js';
import { search, SearchMode, type SearchRequest } from '../../vector/search.js';
import {
  EXTERNAL_API_CODES,
  externalApiFailure,
  externalApiSuccess,
  type ExternalApiCode,
  type ExternalApiResponse,
} from '../external-api-response.js';

const log = logger.child({ module: 'api-routes/external-search' });

const router = express.Router();

/** 默认返回条数（不传 limit 时） */
const DEFAULT_LIMIT = 20;

/** CLI 鉴权失败原因 → 对外状态码 */
const CLI_AUTH_CODES: Record<CliAuthFailureReason, ExternalApiCode> = {
  cli_api_key_not_configured: EXTERNAL_API_CODES.CLI_API_KEY_NOT_CONFIGURED,
  missing_user_id: EXTERNAL_API_CODES.MISSING_USER_ID,
  invalid_user_id: EXTERNAL_API_CODES.INVALID_USER_ID,
  missing_api_key: EXTERNAL_API_CODES.MISSING_API_KEY,
  invalid_api_key: EXTERNAL_API_CODES.INVALID_API_KEY,
  user_not_found: EXTERNAL_API_CODES.USER_NOT_FOUND,
  database_error: EXTERNAL_API_CODES.INTERNAL_ERROR,
};

/** 构建检索请求的结果（避免用异常做流程控制） */
type BuildSearchResult =
  | { ok: true; request: SearchRequest }
  | { ok: false; status: number; code: ExternalApiCode; message: string };

type ExternalSearchBody = Partial<Omit<SearchRequest, 'userId'>> & {
  userId?: number | string;
  query?: string;
  articleId?: number | string;
  limit?: number | string;
  offset?: number | string;
  minScore?: number | string;
  semanticWeight?: number | string;
  keywordWeight?: number | string;
  normalizeScores?: boolean | string;
  useCache?: boolean | string;
  refreshCache?: boolean | string;
  fallbackEnabled?: boolean | string;
};

function sendJson(res: Response, status: number, body: ExternalApiResponse<unknown>): void {
  res.status(status).json(body);
}

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

/** 解析 minScore（0~1）：缺省返回 undefined，非法返回 null */
function parseOptionalMinScore(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;

  return parsed;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}

/** 校验并构建检索请求，返回明确的状态码而不是抛异常 */
function buildSearchRequest(req: AuthRequest): BuildSearchResult {
  const body = (req.body ?? {}) as ExternalSearchBody;
  const mode = parseMode(body.mode);

  if (!mode) {
    return {
      ok: false,
      status: 400,
      code: EXTERNAL_API_CODES.INVALID_MODE,
      message: 'mode must be one of: semantic, keyword, hybrid, related',
    };
  }

  const parsedLimit = parseOptionalInteger(body.limit);
  if (parsedLimit !== undefined && parsedLimit <= 0) {
    return {
      ok: false,
      status: 400,
      code: EXTERNAL_API_CODES.INVALID_LIMIT,
      message: 'limit must be a positive integer',
    };
  }
  const limit = parsedLimit ?? DEFAULT_LIMIT;

  const offset = parseOptionalInteger(body.offset);
  if (offset !== undefined && offset < 0) {
    return {
      ok: false,
      status: 400,
      code: EXTERNAL_API_CODES.INVALID_OFFSET,
      message: 'offset must be greater than or equal to 0',
    };
  }

  const articleId = parseOptionalInteger(body.articleId);
  if (mode === SearchMode.RELATED && articleId === undefined) {
    return {
      ok: false,
      status: 400,
      code: EXTERNAL_API_CODES.MISSING_ARTICLE_ID,
      message: 'articleId is required when mode is related',
    };
  }

  const query = typeof body.query === 'string' ? body.query.trim() : undefined;
  if (mode !== SearchMode.RELATED && !query) {
    return {
      ok: false,
      status: 400,
      code: EXTERNAL_API_CODES.MISSING_QUERY,
      message: 'query is required when mode is semantic, keyword, or hybrid',
    };
  }

  const minScore = parseOptionalMinScore(body.minScore);
  if (minScore === null) {
    return {
      ok: false,
      status: 400,
      code: EXTERNAL_API_CODES.INVALID_MIN_SCORE,
      message: 'minScore must be a number between 0 and 1',
    };
  }

  return {
    ok: true,
    request: {
      mode,
      userId: req.userId!,
      query,
      articleId,
      limit,
      offset,
      minScore,
      semanticWeight: parseOptionalNumber(body.semanticWeight),
      keywordWeight: parseOptionalNumber(body.keywordWeight),
      normalizeScores: parseOptionalBoolean(body.normalizeScores),
      useCache: parseOptionalBoolean(body.useCache),
      refreshCache: parseOptionalBoolean(body.refreshCache),
      fallbackEnabled: parseOptionalBoolean(body.fallbackEnabled),
    },
  };
}

/**
 * POST /api/external/search
 *
 * 鉴权（沿用既有 CLI 机制）：
 * - query: user_id=1
 * - header: x-api-key: <CLI_API_KEY>（也支持 query.api_key）
 *
 * 也支持在 body 中传 userId，路由会自动兼容到鉴权参数 user_id。
 *
 * Body（除 mode/query/articleId 等检索参数外）：
 * - limit: number    可选，返回条数，默认 20
 * - minScore: number 可选，0~1，按最终得分过滤（分页前生效）
 */
router.post('/external/search', injectUserIdFromBody, async (req: AuthRequest, res) => {
  try {
    const auth = await verifyCliAuth(req);
    if (!auth.ok) {
      const details = auth.reason === 'cli_api_key_not_configured'
        ? { requiredAction: 'configure_cli_api_key' }
        : auth.reason === 'user_not_found'
          ? { userId: req.query.user_id }
          : null;

      return sendJson(res, auth.status, externalApiFailure(CLI_AUTH_CODES[auth.reason], auth.message, {
        retryable: auth.reason === 'database_error',
        details,
      }));
    }

    req.userId = auth.userId;
    req.user = { id: auth.userId, username: auth.username };

    const built = buildSearchRequest(req);
    if (!built.ok) {
      return sendJson(res, built.status, externalApiFailure(built.code, built.message));
    }

    const response = await search(built.request);
    const total = response.total ?? response.results.length;

    sendJson(res, 200, externalApiSuccess(
      total > 0 ? EXTERNAL_API_CODES.SEARCH_COMPLETED : EXTERNAL_API_CODES.SEARCH_NO_RESULTS,
      total > 0 ? `检索完成，共 ${total} 条结果` : '检索完成，但没有匹配的结果',
      {
        mode: response.mode,
        query: response.query ?? null,
        total,
        page: response.page ?? null,
        limit: response.limit ?? null,
        cached: response.cached,
        fallback: response.fallback ?? false,
        rerank: response.rerank ?? null,
        results: response.results,
      }
    ));
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Failed to execute external search';
    log.error({ error, userId: req.userId }, 'Failed to execute external search');
    sendJson(res, 500, externalApiFailure(EXTERNAL_API_CODES.INTERNAL_ERROR, '服务端检索失败', {
      retryable: true,
      details: { reason },
    }));
  }
});

export default router;
