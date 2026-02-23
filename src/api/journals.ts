/**
 * Journals API Service
 * 期刊管理服务
 */

import { getDb, type JournalsTable, type JournalCrawlLogsTable } from '../db.js';
import { logger } from '../logger.js';
import type { JournalSourceType, PublicationCycle, JournalInfo } from '../spiders/types.js';

const log = logger.child({ module: 'journals-api' });

/**
 * 期刊创建参数
 */
export interface CreateJournalParams {
  userId: number;
  name: string;
  sourceType: JournalSourceType;
  sourceUrl?: string;
  journalCode?: string;
  publicationCycle: PublicationCycle;
  issuesPerYear: number;
  volumeOffset?: number;
}

/**
 * 期刊更新参数
 */
export interface UpdateJournalParams {
  name?: string;
  sourceUrl?: string;
  journalCode?: string;
  publicationCycle?: PublicationCycle;
  issuesPerYear?: number;
  volumeOffset?: number;
  status?: 'active' | 'inactive';
}

/**
 * 期刊列表查询参数
 */
export interface ListJournalsParams {
  userId: number;
  status?: 'active' | 'inactive';
  sourceType?: JournalSourceType;
  page?: number;
  limit?: number;
}

/**
 * 期刊列表分页结果
 */
export interface ListJournalsResult {
  journals: JournalsTable[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * 获取所有活跃期刊
 */
export async function getActiveJournals(userId: number): Promise<JournalInfo[]> {
  const db = getDb();

  const journals = await db
    .selectFrom('journals')
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .selectAll()
    .execute();

  return journals.map(mapToJournalInfo);
}

/**
 * 获取期刊列表（支持分页）
 */
export async function listJournals(params: ListJournalsParams): Promise<ListJournalsResult> {
  const db = getDb();

  const page = params.page || 1;
  const limit = params.limit || 10;
  const offset = (page - 1) * limit;

  let query = db
    .selectFrom('journals')
    .where('user_id', '=', params.userId);

  if (params.status) {
    query = query.where('status', '=', params.status);
  }

  if (params.sourceType) {
    query = query.where('source_type', '=', params.sourceType);
  }

  // 获取总数
  const countResult = await query
    .select((eb) => [eb.fn.count('id').as('total')])
    .executeTakeFirst();

  const total = Number(countResult?.total || 0);
  const totalPages = Math.ceil(total / limit);

  // 获取分页数据
  const journals = await query
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  return {
    journals,
    page,
    limit,
    total,
    totalPages,
  };
}

/**
 * 获取单个期刊
 */
export async function getJournal(userId: number, journalId: number): Promise<JournalsTable | null> {
  const db = getDb();

  const journal = await db
    .selectFrom('journals')
    .where('id', '=', journalId)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst();

  return journal || null;
}

/**
 * 创建期刊
 */
export async function createJournal(params: CreateJournalParams): Promise<JournalsTable> {
  const db = getDb();

  // 验证参数
  validateJournalParams(params);

  const now = new Date().toISOString();

  const result = await db
    .insertInto('journals')
    .values({
      user_id: params.userId,
      name: params.name,
      source_type: params.sourceType,
      source_url: params.sourceUrl || null,
      journal_code: params.journalCode || null,
      publication_cycle: params.publicationCycle,
      issues_per_year: params.issuesPerYear,
      volume_offset: params.volumeOffset || 1956,
      status: 'active',
      created_at: now,
      updated_at: now,
    } as any)
    .returningAll()
    .executeTakeFirstOrThrow();

  log.info({ journalId: result.id, name: result.name }, 'Journal created');

  return result;
}

/**
 * 更新期刊
 */
export async function updateJournal(
  userId: number,
  journalId: number,
  params: UpdateJournalParams
): Promise<JournalsTable | null> {
  const db = getDb();

  // 检查期刊是否存在
  const existing = await getJournal(userId, journalId);
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();

  const result = await db
    .updateTable('journals')
    .set({
      ...params,
      updated_at: now,
    })
    .where('id', '=', journalId)
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirstOrThrow();

  log.info({ journalId, updates: Object.keys(params) }, 'Journal updated');

  return result;
}

/**
 * 删除期刊
 */
export async function deleteJournal(userId: number, journalId: number): Promise<boolean> {
  const db = getDb();

  const result = await db
    .deleteFrom('journals')
    .where('id', '=', journalId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  const deleted = result.numDeletedRows > 0;

  if (deleted) {
    log.info({ journalId }, 'Journal deleted');
  }

  return deleted;
}

/**
 * 更新期刊爬取状态
 */
export async function updateJournalCrawlStatus(
  journalId: number,
  year: number,
  issue: number,
  volume?: number
): Promise<void> {
  const db = getDb();

  const now = new Date().toISOString();

  await db
    .updateTable('journals')
    .set({
      last_year: year,
      last_issue: issue,
      last_volume: volume || null,
      updated_at: now,
    })
    .where('id', '=', journalId)
    .execute();

  log.info({ journalId, year, issue, volume }, 'Journal crawl status updated');
}

/**
 * 创建爬取日志
 */
export async function createCrawlLog(params: {
  journalId: number;
  year: number;
  issue: number;
  volume?: number;
  articlesCount: number;
  newArticlesCount: number;
  status: 'success' | 'failed' | 'partial';
  errorMessage?: string;
  durationMs: number;
}): Promise<JournalCrawlLogsTable> {
  const db = getDb();

  const result = await db
    .insertInto('journal_crawl_logs')
    .values({
      journal_id: params.journalId,
      crawl_year: params.year,
      crawl_issue: params.issue,
      crawl_volume: params.volume || null,
      articles_count: params.articlesCount,
      new_articles_count: params.newArticlesCount,
      status: params.status,
      error_message: params.errorMessage || null,
      duration_ms: params.durationMs,
      created_at: new Date().toISOString(),
    } as any)
    .returningAll()
    .executeTakeFirstOrThrow();

  log.info({ logId: result.id, journalId: params.journalId, status: params.status }, 'Crawl log created');

  return result;
}

/**
 * 爬取日志列表分页结果
 */
export interface ListCrawlLogsResult {
  logs: Array<JournalCrawlLogsTable & { journal_name: string }>;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * 获取爬取日志列表（支持分页）
 */
export async function getCrawlLogs(
  userId: number,
  journalId?: number,
  page: number = 1,
  limit: number = 10
): Promise<ListCrawlLogsResult> {
  const db = getDb();

  const offset = (page - 1) * limit;

  let query = db
    .selectFrom('journal_crawl_logs')
    .innerJoin('journals', 'journals.id', 'journal_crawl_logs.journal_id')
    .where('journals.user_id', '=', userId)
    .select([
      'journal_crawl_logs.id',
      'journal_crawl_logs.journal_id',
      'journal_crawl_logs.crawl_year',
      'journal_crawl_logs.crawl_issue',
      'journal_crawl_logs.crawl_volume',
      'journal_crawl_logs.articles_count',
      'journal_crawl_logs.new_articles_count',
      'journal_crawl_logs.status',
      'journal_crawl_logs.error_message',
      'journal_crawl_logs.duration_ms',
      'journal_crawl_logs.created_at',
      'journals.name as journal_name',
    ]);

  if (journalId) {
    query = query.where('journal_crawl_logs.journal_id', '=', journalId);
  }

  // 获取总数
  const countResult = await query
    .select((eb) => [eb.fn.count('journal_crawl_logs.id').as('total')])
    .executeTakeFirst();

  const total = Number(countResult?.total || 0);
  const totalPages = Math.ceil(total / limit);

  // 获取分页数据
  const logs = await query
    .selectAll()
    .orderBy('journal_crawl_logs.created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  return {
    logs,
    page,
    limit,
    total,
    totalPages,
  };
}

/**
 * 验证期刊参数
 */
function validateJournalParams(params: CreateJournalParams): void {
  // CNKI 期刊必须有 sourceUrl
  if (params.sourceType === 'cnki' && !params.sourceUrl) {
    throw new Error('CNKI 期刊必须提供 sourceUrl');
  }

  // 人大报刊期刊必须有 journalCode
  if (params.sourceType === 'rdfybk' && !params.journalCode) {
    throw new Error('人大报刊期刊必须提供 journalCode');
  }

  // 验证发行周期和每年期数匹配
  const cycleIssueMap: Record<PublicationCycle, number> = {
    monthly: 12,
    bimonthly: 6,
    semimonthly: 24,
    quarterly: 4,
  };

  const expectedIssues = cycleIssueMap[params.publicationCycle];
  if (params.issuesPerYear !== expectedIssues) {
    log.warn(
      { publicationCycle: params.publicationCycle, issuesPerYear: params.issuesPerYear, expectedIssues },
      'Issues per year does not match publication cycle'
    );
  }
}

/**
 * 将数据库记录映射为 JournalInfo
 */
function mapToJournalInfo(row: JournalsTable): JournalInfo {
  return {
    id: row.id,
    name: row.name,
    source_type: row.source_type as JournalSourceType,
    source_url: row.source_url,
    journal_code: row.journal_code,
    publication_cycle: row.publication_cycle as PublicationCycle,
    issues_per_year: row.issues_per_year,
    volume_offset: row.volume_offset,
    last_year: row.last_year,
    last_issue: row.last_issue,
    last_volume: row.last_volume,
  };
}

/**
 * 计算需要爬取的期号列表
 */
export function calculateIssuesToCrawl(
  journal: JournalInfo,
  currentYear: number,
  currentMonth: number
): Array<{ year: number; issue: number; volume?: number }> {
  const issues: Array<{ year: number; issue: number; volume?: number }> = [];

  // 如果从未爬取，只爬取最新一期
  if (!journal.last_year || !journal.last_issue) {
    const latestIssue = estimateLatestIssue(journal, currentYear, currentMonth);
    issues.push(latestIssue);
    return issues;
  }

  // 计算从上次爬取到现在的所有未爬期号
  const lastYear = journal.last_year;
  const lastIssue = journal.last_issue;
  const issuesPerYear = journal.issues_per_year;

  // 从上次爬取的下一期开始
  let year = lastYear;
  let issue = lastIssue + 1;

  // 如果超过当年期数，进入下一年
  if (issue > issuesPerYear) {
    year++;
    issue = 1;
  }

  // 添加所有未爬取的期号，直到当前最新期
  while (year < currentYear || (year === currentYear && issue <= estimateCurrentIssue(journal, currentMonth))) {
    // 计算 volume（仅 LIS 期刊使用）
    const volume = journal.source_type === 'lis' ? year - journal.volume_offset : undefined;

    issues.push({ year, issue, volume });

    issue++;
    if (issue > issuesPerYear) {
      year++;
      issue = 1;
    }

    // 安全限制：最多爬取 24 期
    if (issues.length >= 24) {
      log.warn({ journalId: journal.id }, 'Too many issues to crawl, limiting to 24');
      break;
    }
  }

  return issues;
}

/**
 * 估算当前最新期号
 */
function estimateLatestIssue(
  journal: JournalInfo,
  currentYear: number,
  currentMonth: number
): { year: number; issue: number; volume?: number } {
  const issue = estimateCurrentIssue(journal, currentMonth);
  const volume = journal.source_type === 'lis' ? currentYear - journal.volume_offset : undefined;

  return { year: currentYear, issue, volume };
}

/**
 * 估算当前期号（基于月份和发行周期）
 */
function estimateCurrentIssue(journal: JournalInfo, currentMonth: number): number {
  const issuesPerYear = journal.issues_per_year;

  switch (journal.publication_cycle) {
    case 'monthly':
      // 月刊：每月 1 期
      return currentMonth;
    case 'bimonthly':
      // 双月刊：每 2 个月 1 期
      return Math.ceil(currentMonth / 2);
    case 'semimonthly':
      // 半月刊：每月 2 期
      return currentMonth * 2;
    case 'quarterly':
      // 季刊：每 3 个月 1 期
      return Math.ceil(currentMonth / 3);
    default:
      return Math.ceil((currentMonth / 12) * issuesPerYear);
  }
}
