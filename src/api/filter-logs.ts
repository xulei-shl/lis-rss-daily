/**
 * 过滤日志查询服务
 */

import {
  getDb,
  type ArticleFilterLogsSelection,
} from '../db.js';
import { normalizeDateFields } from '../utils/datetime.js';

export interface FilterLogsQuery {
  userId: number;
  page?: number;
  limit?: number;
  domainId?: number;
  isPassed?: boolean;
  fromDate?: string;
  toDate?: string;
}

export interface FilterLogsResult {
  logs: FilterLogRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type FilterLogRecord = ArticleFilterLogsSelection & {
  article_title: string | null;
};

/**
 * 分页获取过滤日志
 */
export async function getFilterLogs(params: FilterLogsQuery): Promise<FilterLogsResult> {
  const db = getDb();
  const page = params.page ?? 1;
  const limit = params.limit ?? 20;
  const offset = (page - 1) * limit;

  let baseQuery = db
    .selectFrom('article_filter_logs')
    .innerJoin('articles', 'articles.id', 'article_filter_logs.article_id')
    .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('journals', 'journals.id', 'articles.journal_id')
    .where((eb) =>
      eb.or([
        eb('rss_sources.user_id', '=', params.userId),
        eb.and([eb('articles.journal_id', 'is not', null), eb('journals.user_id', '=', params.userId)]),
      ])
    );

  if (params.domainId !== undefined) {
    baseQuery = baseQuery.where('article_filter_logs.domain_id', '=', params.domainId);
  }

  if (params.isPassed !== undefined) {
    baseQuery = baseQuery.where('article_filter_logs.is_passed', '=', params.isPassed ? 1 : 0);
  }

  if (params.fromDate) {
    baseQuery = baseQuery.where('article_filter_logs.created_at', '>=', params.fromDate);
  }

  if (params.toDate) {
    baseQuery = baseQuery.where('article_filter_logs.created_at', '<=', params.toDate);
  }

  const totalRow = await baseQuery
    .select((eb) => eb.fn.count('article_filter_logs.id').as('count'))
    .executeTakeFirst();

  const total = Number(totalRow?.count ?? 0);

  const logs = await baseQuery
    .selectAll('article_filter_logs')
    .select('articles.title as article_title')
    .orderBy('article_filter_logs.created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  // 标准化时间字段为 UTC
  const normalizedLogs = (logs as FilterLogRecord[]).map(log =>
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
