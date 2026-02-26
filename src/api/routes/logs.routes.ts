import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import { getFilterLogs } from '../filter-logs.js';
import {
  getCrawlLogs,
  type CrawlLogQueryOptions,
} from '../journals.js';
import {
  getRssFetchLogs,
  type RssFetchStatus,
} from '../rss-fetch-logs.js';
import {
  getProcessLogs,
  type ProcessStage,
  type ProcessStatus,
} from '../process-logs.js';
import { getUnifiedLogs, type UnifiedLogType } from '../unified-logs.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'api-routes/logs' });
const DEFAULT_RANGE_DAYS = 30;

const router = express.Router();

/**
 * GET /api/logs/filter
 * 过滤日志分页
 */
router.get(['/logs/filter', '/filter/logs'], requireAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { fromDate, toDate } = getDateRangeFromQuery(req);

    const domainId = parseOptionalInt(req.query.domainId);
    const isPassed = parseBooleanParam(req.query.isPassed);

    const result = await getFilterLogs({
      userId: req.effectiveUserId!,
      page,
      limit,
      domainId,
      isPassed,
      fromDate,
      toDate,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get filter logs');
    res.status(500).json({ error: 'Failed to get filter logs' });
  }
});

/**
 * GET /api/logs/crawl
 * 爬取日志分页
 */
router.get(['/logs/crawl', '/journals/logs'], requireAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const { fromDate, toDate } = getDateRangeFromQuery(req);
    const status = parseCrawlStatus(req.query.result);

    const result = await getCrawlLogs(req.effectiveUserId!, undefined, page, limit, {
      status,
      fromDate,
      toDate,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get crawl logs');
    res.status(500).json({ error: 'Failed to get crawl logs' });
  }
});

/**
 * GET /api/logs/journals/:id
 * 单个期刊爬取日志
 */
router.get(['/logs/journals/:id', '/journals/:id/logs'], requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (Array.isArray(idParam)) {
      return res.status(400).json({ error: 'Invalid journal ID' });
    }
    const id = parseInt(idParam, 10);

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid journal ID' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const { fromDate, toDate } = getDateRangeFromQuery(req);
    const status = parseCrawlStatus(req.query.result);

    const result = await getCrawlLogs(req.effectiveUserId!, id, page, limit, {
      status,
      fromDate,
      toDate,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get crawl logs for journal');
    res.status(500).json({ error: 'Failed to get crawl logs' });
  }
});

/**
 * GET /api/logs/rss-fetch
 * RSS 抓取日志
 */
router.get('/logs/rss-fetch', requireAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { fromDate, toDate } = getDateRangeFromQuery(req, DEFAULT_RANGE_DAYS);

    const status = parseRssStatus(req.query.status);
    const rssSourceId = parseOptionalInt(req.query.rssSourceId);
    const isScheduled = parseBooleanParam(req.query.isScheduled);

    const result = await getRssFetchLogs({
      userId: req.effectiveUserId!,
      page,
      limit,
      status: status ?? undefined,
      rssSourceId: rssSourceId ?? undefined,
      fromDate,
      toDate,
      isScheduled: isScheduled ?? undefined,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get RSS fetch logs');
    res.status(500).json({ error: 'Failed to get RSS fetch logs' });
  }
});

/**
 * GET /api/logs/process
 * 后处理日志
 */
router.get('/logs/process', requireAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { fromDate, toDate } = getDateRangeFromQuery(req, DEFAULT_RANGE_DAYS);

    const stage = parseProcessStage(req.query.stage);
    const status = parseProcessStatus(req.query.status);
    const articleId = parseOptionalInt(req.query.articleId);

    const result = await getProcessLogs({
      userId: req.effectiveUserId!,
      page,
      limit,
      stage: stage ?? undefined,
      status: status ?? undefined,
      articleId: articleId ?? undefined,
      fromDate,
      toDate,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get process logs');
    res.status(500).json({ error: 'Failed to get process logs' });
  }
});

/**
 * GET /api/logs/unified
 * 综合日志面板
 */
router.get('/logs/unified', requireAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { fromDate, toDate } = getDateRangeFromQuery(req, DEFAULT_RANGE_DAYS);
    const types = parseUnifiedTypes(req.query.types);

    const result = await getUnifiedLogs({
      userId: req.effectiveUserId!,
      page,
      limit,
      fromDate,
      toDate,
      types,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get unified logs');
    res.status(500).json({ error: 'Failed to get unified logs' });
  }
});

export default router;

function parseOptionalInt(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseBooleanParam(value: unknown): boolean | undefined {
  if (typeof value !== 'string') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function parseCrawlStatus(value: unknown): CrawlLogQueryOptions['status'] | undefined {
  if (typeof value !== 'string') return undefined;
  const allowed: CrawlLogQueryOptions['status'][] = ['success', 'failed', 'partial'];
  return allowed.includes(value as any) ? (value as CrawlLogQueryOptions['status']) : undefined;
}

function parseRssStatus(value: unknown): RssFetchStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const allowed: RssFetchStatus[] = ['success', 'failed', 'partial'];
  return allowed.includes(value as RssFetchStatus) ? (value as RssFetchStatus) : undefined;
}

function parseProcessStage(value: unknown): ProcessStage | undefined {
  if (typeof value !== 'string') return undefined;
  const allowed: ProcessStage[] = ['markdown', 'translate', 'vector', 'related', 'pipeline_complete'];
  return allowed.includes(value as ProcessStage) ? (value as ProcessStage) : undefined;
}

function parseProcessStatus(value: unknown): ProcessStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const allowed: ProcessStatus[] = ['processing', 'completed', 'failed', 'skipped'];
  return allowed.includes(value as ProcessStatus) ? (value as ProcessStatus) : undefined;
}

function parseUnifiedTypes(value: unknown): UnifiedLogType[] | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const requested = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const allowedSet = new Set<UnifiedLogType>(['filter', 'rss_fetch', 'journal_crawl', 'process']);
  const normalized = requested
    .map((type) => {
      if (type === 'rss') return 'rss_fetch';
      if (type === 'crawl') return 'journal_crawl';
      return type as UnifiedLogType;
    })
    .filter((type): type is UnifiedLogType => allowedSet.has(type as UnifiedLogType));

  return normalized.length > 0 ? normalized : undefined;
}

function getDateRangeFromQuery(
  req: AuthRequest,
  defaultDays?: number
): { fromDate?: string; toDate?: string } {
  const fromRaw = typeof req.query.fromDate === 'string' ? req.query.fromDate : undefined;
  const toRaw = typeof req.query.toDate === 'string' ? req.query.toDate : undefined;
  return normalizeDateRange(fromRaw, toRaw, defaultDays);
}

function normalizeDateRange(
  from?: string,
  to?: string,
  defaultDays?: number
): { fromDate?: string; toDate?: string } {
  const normalizedFrom = parseDateParam(from);
  const normalizedTo = parseDateParam(to);

  if (!normalizedFrom && !normalizedTo && defaultDays) {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - defaultDays);
    return { fromDate: fromDate.toISOString(), toDate: toDate.toISOString() };
  }

  return {
    fromDate: normalizedFrom ?? undefined,
    toDate: normalizedTo ?? undefined,
  };
}

function parseDateParam(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}