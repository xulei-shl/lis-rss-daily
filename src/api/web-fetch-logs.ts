/**
 * Web Fetch Logs Service
 *
 * Query web scraper fetch logs with pagination and filtering.
 */

import { getDb, type WebFetchLogsSelection } from '../db.js';
import { normalizeDateFields } from '../utils/datetime.js';

export type WebFetchStatus = 'success' | 'failed' | 'partial';

export interface WebFetchLogRecord extends WebFetchLogsSelection {
  web_source_name: string | null;
}

export interface WebFetchLogQuery {
  page?: number;
  limit?: number;
  status?: WebFetchStatus;
  webSourceId?: number;
  fromDate?: string;
  toDate?: string;
  isScheduled?: boolean;
}

export interface WebFetchLogResult {
  logs: WebFetchLogRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function getWebFetchLogs(query: WebFetchLogQuery): Promise<WebFetchLogResult> {
  const db = getDb();
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const offset = (page - 1) * limit;

  let baseQuery = db
    .selectFrom('web_fetch_logs')
    .innerJoin('web_sources', 'web_sources.id', 'web_fetch_logs.web_source_id');

  if (query.status) {
    baseQuery = baseQuery.where('web_fetch_logs.status', '=', query.status);
  }

  if (query.webSourceId) {
    baseQuery = baseQuery.where('web_fetch_logs.web_source_id', '=', query.webSourceId);
  }

  if (query.fromDate) {
    baseQuery = baseQuery.where('web_fetch_logs.created_at', '>=', query.fromDate);
  }

  if (query.toDate) {
    baseQuery = baseQuery.where('web_fetch_logs.created_at', '<=', query.toDate);
  }

  if (query.isScheduled !== undefined) {
    baseQuery = baseQuery.where('web_fetch_logs.is_scheduled', '=', query.isScheduled ? 1 : 0);
  }

  const countRow = await baseQuery
    .select((eb) => eb.fn.count('web_fetch_logs.id').as('count'))
    .executeTakeFirst();
  const total = Number(countRow?.count ?? 0);

  const logs = await baseQuery
    .select([
      'web_fetch_logs.id',
      'web_fetch_logs.web_source_id',
      'web_fetch_logs.status',
      'web_fetch_logs.articles_count',
      'web_fetch_logs.new_articles_count',
      'web_fetch_logs.error_message',
      'web_fetch_logs.duration_ms',
      'web_fetch_logs.is_scheduled',
      'web_fetch_logs.created_at',
      'web_sources.name as web_source_name',
    ])
    .orderBy('web_fetch_logs.created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  const normalizedLogs = (logs as WebFetchLogRecord[]).map(log =>
    normalizeDateFields(log as Record<string, any>, ['created_at'])
  ) as WebFetchLogRecord[];

  return {
    logs: normalizedLogs,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
