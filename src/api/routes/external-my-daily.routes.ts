/**
 * 「我的每日」外部 API 路由
 *
 * 供外部项目 / agent 查询指定用户的 JEV 每日评分：
 * - 账号密码鉴权：评分结果与用户绑定，不能用共享的 CLI API Key 代替用户身份
 * - 支持指定日期（默认用户时区下的当天）
 * - 支持按最低评分过滤（minScore，0~1，与 relevance_score 同口径）
 * - 已评分则直接返回结果，未评分则触发评分后再返回
 * - 用户未配置主题领域时返回 NO_TOPIC_CONFIGURED，不执行评分
 *
 * 所有响应（含错误）都使用 src/api/external-api-response.ts 中的统一信封，
 * 每种情况对应一个稳定的 code，详见 docs/我的每日外部API调用说明.md。
 */

import express from 'express';
import type { Response } from 'express';
import { authenticateUser } from '../../middleware/auth.js';
import { logger } from '../../logger.js';
import { getDb } from '../../db.js';
import { resolveJevConfig } from '../../jev.js';
import { getDailyArticles } from '../my-daily.js';
import { getUserLocalDate } from '../timezone.js';
import { scoreForUser, hasActiveTopics, ScoringQueueError } from '../../my-daily-scorer-scheduler.js';
import {
  EXTERNAL_API_CODES,
  externalApiFailure,
  externalApiSuccess,
  type ExternalApiCode,
  type ExternalApiResponse,
} from '../external-api-response.js';

const log = logger.child({ module: 'api-routes/external-my-daily' });

const router = express.Router();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 相关度分档阈值（与站内「我的每日」页面口径一致） */
const HIGH_SCORE_THRESHOLD = 0.7;
const MEDIUM_SCORE_THRESHOLD = 0.3;

const TOPIC_REQUIRED_ACTION = 'configure_topic_domain';
const JEV_REQUIRED_ACTION = 'configure_jev_api_key';

/** 评分执行情况，供 agent 判断是读缓存还是本次触发了评分 */
interface ExecutionInfo {
  triggered: boolean;
  reason: 'already_scored' | 'executed' | 'no_articles' | 'in_progress';
  scored: number | null;
  failed: number | null;
}

interface MyDailyArticleResponse {
  id: number;
  title: string;
  title_zh: string | null;
  summary: string | null;
  summary_zh: string | null;
  url: string | null;
  source_origin: string | null;
  filter_status: string | null;
  published_at: string | Date | null;
  created_at: string | Date | null;
  /** JEV 综合相关性评分，取值 0~1；failed 为 true 时为占位 0，不代表真实相关性 */
  relevance_score: number;
  /** 相关度分档：>=0.7 high，>=0.3 medium，其余 low；failed 为 true 时为 null */
  relevance_level: 'high' | 'medium' | 'low' | null;
  matched_domain: string | null;
  /** JEV 调用失败，评分不可用 */
  failed: boolean;
}

interface MyDailyData {
  userId: number;
  date: string;
  minScore: number | null;
  /** 该日期参与评分并被记录的文章总数（过滤前） */
  total: number;
  /** 本次实际返回的文章数（应用 minScore 后） */
  returned: number;
  articles: MyDailyArticleResponse[];
}

function sendJson(res: Response, status: number, body: ExternalApiResponse<unknown>): void {
  res.status(status).json(body);
}

/** 解析 minScore：缺省返回 undefined，非法返回 null */
function parseMinScore(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;

  return parsed;
}

/** 校验 YYYY-MM-DD 是真实存在的日历日期（拒绝 2026-13-45 之类的值） */
function isValidCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

/** 解析 date：缺省返回 undefined，非法返回 null */
function parseDate(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  return DATE_PATTERN.test(trimmed) && isValidCalendarDate(trimmed) ? trimmed : null;
}

/** 将评分记录转换为稳定的对外文章结构 */
function toArticleResponse(article: {
  id: number;
  title: string;
  title_zh: string | null;
  summary: string | null;
  summary_zh: string | null;
  url: string | null;
  source_origin: string | null;
  filter_status: string | null;
  published_at: string | Date | null;
  created_at: string | Date | null;
  relevance_score: number | null;
  matched_domain: string | null;
  failed: boolean;
}): MyDailyArticleResponse {
  const score = article.relevance_score ?? 0;
  const failed = Boolean(article.failed);

  return {
    id: article.id,
    title: article.title,
    title_zh: article.title_zh ?? null,
    summary: article.summary ?? null,
    summary_zh: article.summary_zh ?? null,
    url: article.url ?? null,
    source_origin: article.source_origin ?? null,
    filter_status: article.filter_status ?? null,
    published_at: article.published_at ?? null,
    created_at: article.created_at ?? null,
    relevance_score: score,
    relevance_level: failed
      ? null
      : score >= HIGH_SCORE_THRESHOLD
        ? 'high'
        : score >= MEDIUM_SCORE_THRESHOLD
          ? 'medium'
          : 'low',
    matched_domain: article.matched_domain ?? null,
    failed,
  };
}

/** 读取并组装返回给外部的评分结果 */
async function buildData(
  userId: number,
  date: string,
  minScore: number | undefined
): Promise<MyDailyData> {
  const daily = await getDailyArticles(userId, date);
  const rows = minScore === undefined
    ? daily.articles
    : daily.articles.filter((article) => (article.relevance_score ?? 0) >= minScore);

  return {
    userId,
    date: daily.date,
    minScore: minScore ?? null,
    total: daily.total,
    returned: rows.length,
    articles: rows.map(toArticleResponse),
  };
}

/**
 * POST /api/external/my-daily
 *
 * Body:
 * - username: string  必填，账号
 * - password: string  必填，密码
 * - date: string      可选，YYYY-MM-DD，默认用户时区下的当天
 * - minScore: number  可选，0~1，仅返回 relevance_score 不低于该值的文章
 */
router.post('/external/my-daily', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!username || !password) {
      return sendJson(res, 400, externalApiFailure(
        EXTERNAL_API_CODES.MISSING_CREDENTIALS,
        '请求体缺少 username 或 password'
      ));
    }

    const user = await authenticateUser(username, password);
    if (!user) {
      return sendJson(res, 401, externalApiFailure(
        EXTERNAL_API_CODES.INVALID_CREDENTIALS,
        '用户名或密码错误'
      ));
    }
    // 与站内 /api/my-daily 保持一致：仅 user / admin 可访问评分数据
    if (user.role !== 'user' && user.role !== 'admin') {
      return sendJson(res, 403, externalApiFailure(
        EXTERNAL_API_CODES.FORBIDDEN_ROLE,
        '该账号角色无权访问「我的每日」评分数据（仅 user / admin 可用）',
        { details: { userId: user.id, role: user.role } }
      ));
    }

    const userId = user.id;

    const date = parseDate(body.date);
    if (date === null) {
      return sendJson(res, 400, externalApiFailure(
        EXTERNAL_API_CODES.INVALID_DATE_FORMAT,
        'date 格式应为 YYYY-MM-DD',
        { details: { userId } }
      ));
    }

    const minScore = parseMinScore(body.minScore);
    if (minScore === null) {
      return sendJson(res, 400, externalApiFailure(
        EXTERNAL_API_CODES.INVALID_MIN_SCORE,
        'minScore 应为 0~1 之间的数值',
        { details: { userId } }
      ));
    }

    const targetDate = date ?? (await getUserLocalDate(userId));

    // 已评分则直接返回；未评分则触发评分
    const db = getDb();
    const existing = await db
      .selectFrom('user_daily_scores')
      .where('user_id', '=', userId)
      .where('score_date', '=', targetDate)
      .select('id')
      .limit(1)
      .executeTakeFirst();

    let code: ExternalApiCode;
    let message: string;
    let executionInfo: ExecutionInfo;

    if (existing) {
      code = EXTERNAL_API_CODES.RESULT_CACHED;
      message = `该日期（${targetDate}）已有评分结果，直接返回缓存`;
      executionInfo = { triggered: false, reason: 'already_scored', scored: null, failed: null };
    } else if (!(await hasActiveTopics(userId))) {
      // 没有主题领域无法评分，明确提示而不是返回空结果
      return sendJson(res, 400, externalApiFailure(
        EXTERNAL_API_CODES.NO_TOPIC_CONFIGURED,
        '该账号尚未配置主题领域，无法执行评分。请先在「主题」页面配置主题领域与关键词',
        {
          details: {
            userId,
            date: targetDate,
            requiredAction: TOPIC_REQUIRED_ACTION,
          },
        }
      ));
    } else {
      try {
        await resolveJevConfig();
      } catch {
        return sendJson(res, 503, externalApiFailure(
          EXTERNAL_API_CODES.JEV_NOT_CONFIGURED,
          '服务端未配置 JEV API 密钥，无法执行评分。请在「设置 -> LLM 配置」中添加 JEV 配置',
          { details: { userId, date: targetDate, requiredAction: JEV_REQUIRED_ACTION } }
        ));
      }

      try {
        const result = await scoreForUser(userId, user.username, targetDate);
        const reason = (result as any).reason as string | undefined;

        if (result.skipped && reason === 'no_topics') {
          return sendJson(res, 400, externalApiFailure(
            EXTERNAL_API_CODES.NO_TOPIC_CONFIGURED,
            '该账号尚未配置主题领域，无法执行评分。请先在「主题」页面配置主题领域与关键词',
            {
              details: {
                userId,
                date: targetDate,
                requiredAction: TOPIC_REQUIRED_ACTION,
              },
            }
          ));
        }

        if (reason === 'no_articles') {
          code = EXTERNAL_API_CODES.NO_ARTICLES_FOR_DATE;
          message = `该日期（${targetDate}）没有新增文章，无需评分`;
          executionInfo = { triggered: true, reason: 'no_articles', scored: 0, failed: 0 };
        } else if (reason === 'duplicate') {
          return sendJson(res, 409, externalApiFailure(
            EXTERNAL_API_CODES.SCORING_IN_PROGRESS,
            '该日期的评分正在进行中，请稍后重试',
            { retryable: true, details: { userId, date: targetDate } }
          ));
        } else {
          code = EXTERNAL_API_CODES.RESULT_SCORED;
          message = `已完成该日期（${targetDate}）的评分`;
          executionInfo = {
            triggered: true,
            reason: 'executed',
            scored: (result as any).scored ?? 0,
            failed: (result as any).failed ?? 0,
          };
        }
      } catch (error) {
        if (error instanceof ScoringQueueError) {
          const queueCode = error.reason === 'queue_full'
            ? EXTERNAL_API_CODES.SCORING_QUEUE_FULL
            : EXTERNAL_API_CODES.SCORING_QUEUE_TIMEOUT;
          return sendJson(res, 429, externalApiFailure(queueCode, error.message, {
            retryable: true,
            details: { userId, date: targetDate, reason: error.reason },
          }));
        }
        throw error;
      }
    }

    const data = await buildData(userId, targetDate, minScore);

    sendJson(res, 200, externalApiSuccess(code, message, data, {
      userId,
      date: targetDate,
      execution: executionInfo,
    }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : '未知错误';
    log.error({ error }, 'External my-daily request failed');
    sendJson(res, 500, externalApiFailure(
      EXTERNAL_API_CODES.INTERNAL_ERROR,
      '服务端处理请求时发生异常',
      { retryable: true, details: { reason } }
    ));
  }
});

export default router;
