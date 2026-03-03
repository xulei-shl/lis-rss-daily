import { getFilterLogs } from './filter-logs.js';
import { getCrawlLogs } from './journals.js';
import { getRssFetchLogs } from './rss-fetch-logs.js';
import { getProcessLogs } from './process-logs.js';
import { getKeywordCrawlLogs } from './keywords.js';
import type { FilterLogRecord } from './filter-logs.js';
import type { RssFetchLogRecord } from './rss-fetch-logs.js';
import type { ProcessLogRecord } from './process-logs.js';

export type UnifiedLogType = 'filter' | 'rss_fetch' | 'journal_crawl' | 'process' | 'keyword_crawl';

export interface UnifiedLogsQuery {
  userId: number;
  page?: number;
  limit?: number;
  fromDate?: string;
  toDate?: string;
  types?: UnifiedLogType[];
}

export interface UnifiedLogEntry {
  id: string;
  type: UnifiedLogType;
  created_at: string;
  status: string;
  data: Record<string, unknown>;
}

export interface UnifiedLogsResult {
  logs: UnifiedLogEntry[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  totalsByType: Record<UnifiedLogType, number>;
}

const ALL_TYPES: UnifiedLogType[] = ['filter', 'rss_fetch', 'journal_crawl', 'process', 'keyword_crawl'];

export async function getUnifiedLogs(params: UnifiedLogsQuery): Promise<UnifiedLogsResult> {
  const page = params.page ?? 1;
  const limit = params.limit ?? 20;
  const offset = (page - 1) * limit;
  const types = params.types && params.types.length > 0 ? params.types : ALL_TYPES;
  const fetchLimitPerType = limit * page + limit;

  const resultsByType: Partial<Record<UnifiedLogType, { entries: UnifiedLogEntry[]; total: number }>> = {};

  if (types.includes('filter')) {
    const filterResult = await getFilterLogs({
      userId: params.userId,
      page: 1,
      limit: fetchLimitPerType,
      fromDate: params.fromDate,
      toDate: params.toDate,
    });
    resultsByType.filter = {
      entries: filterResult.logs.map(mapFilterLog),
      total: filterResult.total,
    };
  }

  if (types.includes('rss_fetch')) {
    const rssResult = await getRssFetchLogs({
      userId: params.userId,
      page: 1,
      limit: fetchLimitPerType,
      fromDate: params.fromDate,
      toDate: params.toDate,
    });
    resultsByType.rss_fetch = {
      entries: rssResult.logs.map(mapRssLog),
      total: rssResult.total,
    };
  }

  if (types.includes('journal_crawl')) {
    const crawlResult = await getCrawlLogs(params.userId, undefined, 1, fetchLimitPerType, {
      fromDate: params.fromDate,
      toDate: params.toDate,
    });
    resultsByType.journal_crawl = {
      entries: crawlResult.logs.map(mapCrawlLog),
      total: crawlResult.total,
    };
  }

  if (types.includes('process')) {
    const processResult = await getProcessLogs({
      userId: params.userId,
      page: 1,
      limit: fetchLimitPerType,
      fromDate: params.fromDate,
      toDate: params.toDate,
    });
    resultsByType.process = {
      entries: processResult.logs.map(mapProcessLog),
      total: processResult.total,
    };
  }

  if (types.includes('keyword_crawl')) {
    const keywordResult = await getKeywordCrawlLogs(
      params.userId,
      undefined,
      1,
      fetchLimitPerType,
      {
        fromDate: params.fromDate,
        toDate: params.toDate,
      }
    );
    resultsByType.keyword_crawl = {
      entries: keywordResult.logs.map(mapKeywordCrawlLog),
      total: keywordResult.total,
    };
  }

  const combinedEntries: UnifiedLogEntry[] = Object.values(resultsByType)
    .flatMap((result) => result?.entries ?? [])
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const pagedLogs = combinedEntries.slice(offset, offset + limit);

  const totalsByType: Record<UnifiedLogType, number> = {
    filter: resultsByType.filter?.total ?? 0,
    rss_fetch: resultsByType.rss_fetch?.total ?? 0,
    journal_crawl: resultsByType.journal_crawl?.total ?? 0,
    process: resultsByType.process?.total ?? 0,
    keyword_crawl: resultsByType.keyword_crawl?.total ?? 0,
  };

  const total = types.reduce((sum, type) => sum + (totalsByType[type] ?? 0), 0);
  const totalPages = Math.ceil(total / limit);

  return {
    logs: pagedLogs,
    page,
    limit,
    total,
    totalPages,
    totalsByType,
  };
}

function mapFilterLog(log: FilterLogRecord): UnifiedLogEntry {
  const status = log.is_passed ? 'passed' : 'rejected';
  return {
    id: `filter:${log.id}`,
    type: 'filter',
    created_at: log.created_at,
    status,
    data: {
      id: log.id,
      article_id: log.article_id,
      article_title: log.article_title,
      domain_id: log.domain_id,
      is_passed: Boolean(log.is_passed),
      relevance_score: log.relevance_score,
      filter_reason: log.filter_reason,
      matched_keywords: log.matched_keywords,
      llm_response: log.llm_response,
      created_at: log.created_at,
    },
  };
}

function mapRssLog(log: RssFetchLogRecord): UnifiedLogEntry {
  return {
    id: `rss_fetch:${log.id}`,
    type: 'rss_fetch',
    created_at: log.created_at,
    status: log.status,
    data: {
      id: log.id,
      rss_source_id: log.rss_source_id,
      rss_source_name: log.rss_source_name,
      articles_count: log.articles_count,
      new_articles_count: log.new_articles_count,
      duration_ms: log.duration_ms,
      is_scheduled: Boolean(log.is_scheduled),
      error_message: log.error_message,
      created_at: log.created_at,
    },
  };
}

function mapCrawlLog(log: { journal_name: string } & Record<string, any>): UnifiedLogEntry {
  return {
    id: `journal_crawl:${log.id}`,
    type: 'journal_crawl',
    created_at: log.created_at,
    status: log.status,
    data: {
      id: log.id,
      journal_id: log.journal_id,
      journal_name: log.journal_name,
      crawl_year: log.crawl_year,
      crawl_issue: log.crawl_issue,
      crawl_volume: log.crawl_volume,
      articles_count: log.articles_count,
      new_articles_count: log.new_articles_count,
      duration_ms: log.duration_ms,
      error_message: log.error_message,
      created_at: log.created_at,
    },
  };
}

function mapProcessLog(log: ProcessLogRecord): UnifiedLogEntry {
  return {
    id: `process:${log.id}`,
    type: 'process',
    created_at: log.created_at,
    status: log.status,
    data: {
      id: log.id,
      article_id: log.article_id,
      article_title: log.article_title,
      stage: log.stage,
      status: log.status,
      duration_ms: log.duration_ms,
      error_message: log.error_message,
      details: log.details,
      source_origin: log.source_origin,
      created_at: log.created_at,
    },
  };
}

function mapKeywordCrawlLog(log: { keyword: string; spider_type: string } & Record<string, any>): UnifiedLogEntry {
  return {
    id: `keyword_crawl:${log.id}`,
    type: 'keyword_crawl',
    created_at: log.created_at,
    status: log.status,
    data: {
      id: log.id,
      keyword_id: log.keyword_id,
      keyword: log.keyword,
      spider_type: log.spider_type,
      year_start: log.year_start,
      year_end: log.year_end,
      articles_count: log.articles_count,
      new_articles_count: log.new_articles_count,
      duration_ms: log.duration_ms,
      error_message: log.error_message,
      created_at: log.created_at,
    },
  };
}
