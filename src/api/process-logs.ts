import {
  getDb,
  type ArticleProcessLogsSelection,
} from '../db.js';
import { logger } from '../logger.js';
import { normalizeDateFields } from '../utils/datetime.js';

const log = logger.child({ module: 'process-logs' });

export type ProcessStage = 'markdown' | 'translate' | 'vector' | 'related' | 'pipeline_complete';
export type ProcessStatus = 'processing' | 'completed' | 'failed' | 'skipped';

export interface CreateProcessLogInput {
  userId: number;
  articleId: number;
  stage: ProcessStage;
  status: ProcessStatus;
  durationMs?: number;
  errorMessage?: string | null;
  details?: Record<string, unknown> | null;
}

export async function createProcessLog(input: CreateProcessLogInput): Promise<void> {
  const db = getDb();

  try {
    await db
      .insertInto('article_process_logs')
      .values({
        user_id: input.userId,
        article_id: input.articleId,
        stage: input.stage,
        status: input.status,
        duration_ms: input.durationMs ?? null,
        error_message: input.errorMessage ?? null,
        details: input.details ? JSON.stringify(input.details).slice(0, 4000) : null,
      })
      .execute();
  } catch (error) {
    log.error({ error, articleId: input.articleId, stage: input.stage }, 'Failed to insert process log');
  }
}

export interface ProcessLogRecord extends ArticleProcessLogsSelection {
  article_title: string | null;
  source_origin: 'rss' | 'journal';
}

export interface ProcessLogQuery {
  userId: number;
  page?: number;
  limit?: number;
  stage?: ProcessStage;
  status?: ProcessStatus;
  articleId?: number;
  fromDate?: string;
  toDate?: string;
}

export interface ProcessLogResult {
  logs: ProcessLogRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function getProcessLogs(query: ProcessLogQuery): Promise<ProcessLogResult> {
  const db = getDb();
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const offset = (page - 1) * limit;

  let baseQuery = db
    .selectFrom('article_process_logs')
    .innerJoin('articles', 'articles.id', 'article_process_logs.article_id')
    .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('journals', 'journals.id', 'articles.journal_id')
    .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
    .where((eb) =>
      eb.or([
        eb.and([
          eb('articles.rss_source_id', 'is not', null),
          eb('rss_sources.user_id', '=', query.userId),
        ]),
        eb.and([
          eb('articles.journal_id', 'is not', null),
          eb('journals.user_id', '=', query.userId),
        ]),
        eb.and([
          eb('articles.keyword_id', 'is not', null),
          eb('keyword_subscriptions.user_id', '=', query.userId),
        ]),
      ])
    );

  if (query.stage) {
    baseQuery = baseQuery.where('article_process_logs.stage', '=', query.stage);
  }

  if (query.status) {
    baseQuery = baseQuery.where('article_process_logs.status', '=', query.status);
  }

  if (query.articleId) {
    baseQuery = baseQuery.where('article_process_logs.article_id', '=', query.articleId);
  }

  if (query.fromDate) {
    baseQuery = baseQuery.where('article_process_logs.created_at', '>=', query.fromDate);
  }

  if (query.toDate) {
    baseQuery = baseQuery.where('article_process_logs.created_at', '<=', query.toDate);
  }

  const countRow = await baseQuery
    .select((eb) => eb.fn.count('article_process_logs.id').as('count'))
    .executeTakeFirst();
  const total = Number(countRow?.count ?? 0);

  const logs = await baseQuery
    .select([
      'article_process_logs.id',
      'article_process_logs.user_id',
      'article_process_logs.article_id',
      'article_process_logs.stage',
      'article_process_logs.status',
      'article_process_logs.duration_ms',
      'article_process_logs.error_message',
      'article_process_logs.details',
      'article_process_logs.created_at',
      'articles.title as article_title',
      'articles.source_origin',
    ])
    .orderBy('article_process_logs.created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  // 标准化时间字段为 UTC
  const normalizedLogs = (logs as ProcessLogRecord[]).map(log =>
    normalizeDateFields(log as Record<string, any>, ['created_at'])
  );

  return {
    logs: normalizedLogs,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
