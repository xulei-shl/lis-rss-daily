import { getDb, type RssFetchLogsSelection } from '../db.js';
import { logger } from '../logger.js';

const log = logger.child({ module: 'rss-fetch-logs' });

export type RssFetchStatus = 'success' | 'failed' | 'partial';

export interface CreateRssFetchLogInput {
  userId: number;
  rssSourceId: number;
  status: RssFetchStatus;
  articlesCount?: number;
  newArticlesCount?: number;
  durationMs?: number;
  isScheduled?: boolean;
  errorMessage?: string | null;
}

export async function createRssFetchLog(input: CreateRssFetchLogInput): Promise<void> {
  const db = getDb();
  try {
    await db
      .insertInto('rss_fetch_logs')
      .values({
        user_id: input.userId,
        rss_source_id: input.rssSourceId,
        status: input.status,
        articles_count: input.articlesCount ?? 0,
        new_articles_count: input.newArticlesCount ?? 0,
        duration_ms: input.durationMs ?? 0,
        is_scheduled: input.isScheduled ? 1 : 0,
        error_message: input.errorMessage || null,
      })
      .execute();
  } catch (error) {
    log.error(
      { error, rssSourceId: input.rssSourceId, status: input.status },
      'Failed to create RSS fetch log'
    );
  }
}

export interface RssFetchLogRecord extends RssFetchLogsSelection {
  rss_source_name: string | null;
}

export interface RssFetchLogQuery {
  userId: number;
  page?: number;
  limit?: number;
  status?: RssFetchStatus;
  rssSourceId?: number;
  fromDate?: string;
  toDate?: string;
  isScheduled?: boolean;
}

export interface RssFetchLogResult {
  logs: RssFetchLogRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function getRssFetchLogs(query: RssFetchLogQuery): Promise<RssFetchLogResult> {
  const db = getDb();
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const offset = (page - 1) * limit;

  let baseQuery = db
    .selectFrom('rss_fetch_logs')
    .innerJoin('rss_sources', 'rss_sources.id', 'rss_fetch_logs.rss_source_id')
    .where('rss_sources.user_id', '=', query.userId);

  if (query.status) {
    baseQuery = baseQuery.where('rss_fetch_logs.status', '=', query.status);
  }

  if (query.rssSourceId) {
    baseQuery = baseQuery.where('rss_fetch_logs.rss_source_id', '=', query.rssSourceId);
  }

  if (query.isScheduled !== undefined) {
    baseQuery = baseQuery.where('rss_fetch_logs.is_scheduled', '=', query.isScheduled ? 1 : 0);
  }

  if (query.fromDate) {
    baseQuery = baseQuery.where('rss_fetch_logs.created_at', '>=', query.fromDate);
  }

  if (query.toDate) {
    baseQuery = baseQuery.where('rss_fetch_logs.created_at', '<=', query.toDate);
  }

  const countRow = await baseQuery
    .select((eb) => eb.fn.count('rss_fetch_logs.id').as('count'))
    .executeTakeFirst();
  const total = Number(countRow?.count ?? 0);

  const logs = await baseQuery
    .select([
      'rss_fetch_logs.id',
      'rss_fetch_logs.user_id',
      'rss_fetch_logs.rss_source_id',
      'rss_fetch_logs.status',
      'rss_fetch_logs.articles_count',
      'rss_fetch_logs.new_articles_count',
      'rss_fetch_logs.duration_ms',
      'rss_fetch_logs.is_scheduled',
      'rss_fetch_logs.error_message',
      'rss_fetch_logs.created_at',
      'rss_sources.name as rss_source_name',
    ])
    .orderBy('rss_fetch_logs.created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  return {
    logs: logs as RssFetchLogRecord[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
