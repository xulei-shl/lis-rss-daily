/**
 * 统一检索 外部 API 路由
 *
 * 供外部项目 / agent 调用统一检索，支持 4 种模式：
 * semantic / keyword / hybrid（兼容 mixed）/ related。
 *
 * 鉴权：
 * - Header: x-api-key: <CLI_API_KEY>（或 query.api_key）
 * - 支持 username（用户名）与 userId 双轨兼容输入
 *
 * 特性：
 * - 默认返回 limit: 5 条最相关文献（双轨分离：默认轻量感知轨，体积严格 < 1KB）
 * - 默认 fields: "core"，排除长摘要与无效占位，保持语义纯净
 * - 所有响应都使用 src/api/external-api-response.ts 中的统一信封
 *
 * 详见 docs/统一检索外部API调用说明.md。
 */

import express from 'express';
import type { Response } from 'express';
import { logger } from '../../logger.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { search, SearchMode, type SearchRequest } from '../../vector/search.js';
import { verifyExternalApiAuth } from '../external-auth.js';
import {
  EXTERNAL_API_CODES,
  externalApiFailure,
  externalApiSuccess,
  type ExternalApiCode,
  type ExternalApiResponse,
} from '../external-api-response.js';

const log = logger.child({ module: 'api-routes/external-search' });

const router = express.Router();

/** 默认返回条数与上限 */
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 100;

/** 构建检索请求的结果（避免用异常做流程控制） */
type BuildSearchResult =
  | { ok: true; request: SearchRequest; fields: 'core' | 'full' }
  | { ok: false; status: number; code: ExternalApiCode; message: string };

type ExternalSearchBody = Partial<Omit<SearchRequest, 'userId'>> & {
  username?: string;
  userId?: number | string;
  query?: string;
  articleId?: number | string;
  limit?: number | string;
  offset?: number | string;
  minScore?: number | string;
  fields?: string;
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
function buildSearchRequest(userId: number, body: ExternalSearchBody, queryParams: Record<string, unknown>): BuildSearchResult {
  const modeVal = body.mode ?? queryParams.mode;
  const mode = parseMode(modeVal);

  if (!mode) {
    return {
      ok: false,
      status: 400,
      code: EXTERNAL_API_CODES.INVALID_MODE,
      message: 'mode must be one of: semantic, keyword, hybrid, related',
    };
  }

  const limitVal = body.limit ?? queryParams.limit;
  const parsedLimit = parseOptionalInteger(limitVal);
  if (parsedLimit !== undefined && parsedLimit <= 0) {
    return {
      ok: false,
      status: 400,
      code: EXTERNAL_API_CODES.INVALID_LIMIT,
      message: 'limit must be a positive integer',
    };
  }
  const limit = Math.min(parsedLimit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const offsetVal = body.offset ?? queryParams.offset;
  const parsedOffset = parseOptionalInteger(offsetVal);
  if (parsedOffset !== undefined && parsedOffset < 0) {
    return {
      ok: false,
      status: 400,
      code: EXTERNAL_API_CODES.INVALID_OFFSET,
      message: 'offset must be greater than or equal to 0',
    };
  }
  const offset = parsedOffset ?? 0;

  const articleIdVal = body.articleId ?? queryParams.articleId;
  const articleId = parseOptionalInteger(articleIdVal);
  if (mode === SearchMode.RELATED && articleId === undefined) {
    return {
      ok: false,
      status: 400,
      code: EXTERNAL_API_CODES.MISSING_ARTICLE_ID,
      message: 'articleId is required when mode is related',
    };
  }

  const rawQuery = body.query ?? queryParams.query;
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : undefined;
  if (mode !== SearchMode.RELATED && !query) {
    return {
      ok: false,
      status: 400,
      code: EXTERNAL_API_CODES.MISSING_QUERY,
      message: 'query is required when mode is semantic, keyword, or hybrid',
    };
  }

  const minScoreVal = body.minScore ?? queryParams.minScore;
  const minScore = parseOptionalMinScore(minScoreVal);
  if (minScore === null) {
    return {
      ok: false,
      status: 400,
      code: EXTERNAL_API_CODES.INVALID_MIN_SCORE,
      message: 'minScore must be a number between 0 and 1',
    };
  }

  const fieldsVal = String(body.fields ?? queryParams.fields ?? 'core').toLowerCase();
  const fields: 'core' | 'full' = fieldsVal === 'full' ? 'full' : 'core';

  return {
    ok: true,
    fields,
    request: {
      mode,
      userId,
      query,
      articleId,
      limit,
      offset,
      minScore,
      semanticWeight: parseOptionalNumber(body.semanticWeight ?? queryParams.semanticWeight),
      keywordWeight: parseOptionalNumber(body.keywordWeight ?? queryParams.keywordWeight),
      normalizeScores: parseOptionalBoolean(body.normalizeScores ?? queryParams.normalizeScores),
      useCache: parseOptionalBoolean(body.useCache ?? queryParams.useCache),
      refreshCache: parseOptionalBoolean(body.refreshCache ?? queryParams.refreshCache),
      fallbackEnabled: parseOptionalBoolean(body.fallbackEnabled ?? queryParams.fallbackEnabled),
    },
  };
}

/** 裁剪结果以符合 core 或 full 规范 */
function sanitizeResults(results: any[], fields: 'core' | 'full') {
  return results.map((r) => {
    const meta = r.metadata || {};
    if (fields === 'core') {
      return {
        articleId: r.articleId,
        score: r.score,
        semanticScore: r.semanticScore,
        keywordScore: r.keywordScore,
        jevScore: r.jevScore,
        relevanceLevel: r.relevanceLevel,
        ranked: r.ranked,
        metadata: {
          title: meta.title,
          url: meta.url,
          published_at: meta.published_at ?? null,
          source_origin: meta.source_origin ?? null,
          journal_name: meta.journal_name ?? undefined,
          rss_source_name: meta.rss_source_name ?? undefined,
          keyword_name: meta.keyword_name ?? undefined,
        },
      };
    }

    return r;
  });
}

/**
 * POST /api/external/search
 *
 * 鉴权：
 * - Header: x-api-key: <CLI_API_KEY>（或 query.api_key）
 *
 * Body 参数：
 * - username: string   可选，用户名（与 userId 二选一）
 * - userId: number     可选，用户 ID（与 username 二选一）
 * - mode: string       必填，semantic | keyword | hybrid | related
 * - query: string      semantic / keyword / hybrid 必填
 * - articleId: number  related 必填
 * - limit: number      可选，返回条数，默认 5，最大 100
 * - offset: number     可选，偏移量，默认 0
 * - fields: string     可选，"core" | "full"，默认 "core"
 * - minScore: number   可选，0~1，最终得分过滤
 */
router.post('/external/search', async (req: AuthRequest, res) => {
  try {
    const auth = await verifyExternalApiAuth(req);
    if (!auth.ok) {
      return sendJson(res, auth.status, auth.response);
    }
    const user = auth.user;

    const body = (req.body ?? {}) as ExternalSearchBody;
    const queryParams = (req.query ?? {}) as Record<string, unknown>;

    const built = buildSearchRequest(user.id, body, queryParams);
    if (!built.ok) {
      return sendJson(res, built.status, externalApiFailure(built.code, built.message));
    }

    const response = await search(built.request);
    const total = response.total ?? response.results.length;
    const returnedResults = sanitizeResults(response.results, built.fields);

    sendJson(
      res,
      200,
      externalApiSuccess(
        total > 0 ? EXTERNAL_API_CODES.SEARCH_COMPLETED : EXTERNAL_API_CODES.SEARCH_NO_RESULTS,
        total > 0 ? `检索完成，共 ${total} 条结果` : '检索完成，但没有匹配的结果',
        {
          userId: user.id,
          username: user.username,
          mode: response.mode,
          query: response.query ?? null,
          total,
          limit: built.request.limit ?? DEFAULT_LIMIT,
          offset: built.request.offset ?? 0,
          returned: returnedResults.length,
          cached: response.cached,
          fallback: response.fallback ?? false,
          rerank: response.rerank ?? null,
          results: returnedResults,
        }
      )
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Failed to execute external search';
    log.error({ error, userId: req.userId }, 'Failed to execute external search');
    sendJson(
      res,
      500,
      externalApiFailure(EXTERNAL_API_CODES.INTERNAL_ERROR, '服务端检索失败', {
        retryable: true,
        details: { reason },
      })
    );
  }
});

export default router;
