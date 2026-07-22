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
  /** 'blacklist' = 命中黑名单关键词；'llm' = LLM 评估；undefined = 全部 */
  filterType?: 'blacklist' | 'llm';
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
    .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
    .leftJoin('web_sources', 'web_sources.id', 'articles.web_source_id')
    .leftJoin('email_sources', 'email_sources.id', 'articles.email_source_id')
    .where((eb) =>
      eb.or([
        eb('rss_sources.user_id', '=', params.userId),
        eb.and([eb('articles.journal_id', 'is not', null), eb('journals.user_id', '=', params.userId)]),
        eb.and([eb('articles.keyword_id', 'is not', null), eb('keyword_subscriptions.user_id', '=', params.userId)]),
        eb.and([eb('articles.web_source_id', 'is not', null), eb('web_sources.user_id', '=', params.userId)]),
        eb.and([eb('articles.email_source_id', 'is not', null), eb('email_sources.user_id', '=', params.userId)]),
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

  if (params.filterType === 'blacklist') {
    // 黑名单过滤日志：domain_id IS NULL 且 filter_reason 包含黑名单关键词
    baseQuery = baseQuery.where('article_filter_logs.domain_id', 'is', null)
      .where('article_filter_logs.filter_reason', 'like', '%黑名单%');
  } else if (params.filterType === 'llm') {
    // LLM 过滤日志：有 domain_id 或者 filter_reason 不含黑名单关键词
    baseQuery = baseQuery.where((eb) =>
      eb.or([
        eb('article_filter_logs.domain_id', 'is not', null),
        eb.and([
          eb('article_filter_logs.domain_id', 'is', null),
          eb('article_filter_logs.filter_reason', 'not like', '%黑名单%'),
        ]),
      ])
    );
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

  // 增强日志记录：标记是否为黑名单过滤
  const normalizedLogs = (logs as FilterLogRecord[]).map(log => {
    const enhanced = normalizeDateFields(log as Record<string, any>, ['created_at']) as FilterLogRecord & { is_blacklist_rejection?: boolean };
    enhanced.is_blacklist_rejection = !!(enhanced.filter_reason && enhanced.filter_reason.includes('黑名单'));
    return enhanced;
  });

  return {
    logs: normalizedLogs,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
