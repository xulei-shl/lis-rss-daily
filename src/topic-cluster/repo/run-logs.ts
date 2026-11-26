/**
 * 主题聚类执行日志仓储（cluster_run_logs）。
 *
 * 这是纯旁路记录：每轮流水线执行前后各写一次，用于页面展示
 * 「执行时间 / 触发方式 / 新增聚类文献数」。任何写入失败都不应影响流水线本身，
 * 因此本文件内部捕获日志写入错误并降级为告警。
 */

import { sql } from 'kysely';
import { getDb } from '../../db.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'topic-cluster/run-logs' });

export type ClusterRunTrigger = 'cron' | 'manual' | 'cold_start' | 'rebuild';
export type ClusterRunStatus = 'running' | 'completed' | 'failed';

/** 某一主题在一轮再平衡中的增量 */
export interface TopicRebalanceDelta {
  /** 新增的归属链接数（含次归属） */
  added: number;
  /** 被淘汰的归属链接数 */
  removed: number;
  /** 主归属从其他主题迁入的文章数 */
  migratedIn: number;
}

/** topic_id → 该轮再平衡增量（未出现的主题表示未改动） */
export type TopicRebalanceDeltas = Record<string, TopicRebalanceDelta>;

/** 一轮执行的整体计数（所有主题合计） */
export interface ClusterRunCounters {
  facetSucceeded: number;
  facetFailed: number;
  routedArticles: number;
  newTopics: number;
  reclaimedLinks: number;
  analyzedTopics: number;
  reviewedTopics: number;
  newReviews: number;
  insightReports: number;
  /** 本轮再平衡中归属变化的文章数 */
  rebalancedArticles: number;
  /** 本轮再平衡中迁移主归属的文章数 */
  primarySwitches: number;
  /** 本轮结束时待抽取切面的积压篇数 */
  facetPending: number;
  /** 本轮再平衡按主题的增量（未改动的主题不出现） */
  rebalanceDeltas?: TopicRebalanceDeltas;
  /** 本轮是否执行了归属再平衡 */
  rebalanceExecuted?: boolean;
  /** 本轮是否执行了周分析（两阶段分析/综述/洞察） */
  analysisExecuted?: boolean;
  /** 周分析溯源：本轮洞察覆盖的再平衡轮次与调整规模 */
  sourceRebalance?: RebalanceProvenance;
}

/** 周分析覆盖的再平衡轮次汇总 */
export interface RebalanceProvenance {
  /** 覆盖的再平衡轮次数 */
  runs: number;
  /** 覆盖的再平衡调整文章数合计 */
  articles: number;
  /** 覆盖范围内最近一次再平衡完成时间 */
  lastAt: string | null;
}

/** topic_id → 该轮新增链接数 */
export type TopicDeltas = Record<string, number>;

export interface ClusterRunLog {
  id: number;
  setVersion: number | null;
  trigger: ClusterRunTrigger;
  status: ClusterRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  facetSucceeded: number;
  facetFailed: number;
  routedArticles: number;
  newTopics: number;
  reclaimedLinks: number;
  analyzedTopics: number;
  reviewedTopics: number;
  newReviews: number;
  insightReports: number;
  rebalancedArticles: number;
  primarySwitches: number;
  facetPending: number;
  rebalanceDeltas: TopicRebalanceDeltas;
  rebalanceExecuted: boolean;
  analysisExecuted: boolean;
  sourceRebalance: RebalanceProvenance;
  topicDeltas: TopicDeltas;
  reviewDeltas: TopicDeltas;
  errorMessage: string | null;
}

export interface BeginClusterRunInput {
  userId: number;
  setVersion: number | null;
  trigger: ClusterRunTrigger;
}

/** 记录一轮执行开始，返回 run id */
export async function beginClusterRun(input: BeginClusterRunInput): Promise<number> {
  const result = await getDb()
    .insertInto('cluster_run_logs')
    .values({
      user_id: input.userId,
      set_version: input.setVersion,
      trigger: input.trigger,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .executeTakeFirst();
  return Number(result.insertId);
}

export interface FinishClusterRunInput {
  status: Exclude<ClusterRunStatus, 'running'>;
  durationMs: number;
  counters?: ClusterRunCounters;
  topicDeltas?: TopicDeltas;
  reviewDeltas?: TopicDeltas;
  errorMessage?: string;
}

/** 记录一轮执行结束（成功或失败） */
export async function finishClusterRun(runId: number, input: FinishClusterRunInput): Promise<void> {
  const counters = input.counters;
  await getDb()
    .updateTable('cluster_run_logs')
    .set({
      status: input.status,
      finished_at: new Date().toISOString(),
      duration_ms: input.durationMs,
      facet_succeeded: counters?.facetSucceeded ?? 0,
      facet_failed: counters?.facetFailed ?? 0,
      routed_articles: counters?.routedArticles ?? 0,
      new_topics: counters?.newTopics ?? 0,
      reclaimed_links: counters?.reclaimedLinks ?? 0,
      analyzed_topics: counters?.analyzedTopics ?? 0,
      reviewed_topics: counters?.reviewedTopics ?? 0,
      new_reviews: counters?.newReviews ?? 0,
      insight_reports: counters?.insightReports ?? 0,
      rebalanced_articles: counters?.rebalancedArticles ?? 0,
      primary_switches: counters?.primarySwitches ?? 0,
      facet_pending: counters?.facetPending ?? 0,
      rebalance_deltas:
        input.counters?.rebalanceDeltas && Object.keys(input.counters.rebalanceDeltas).length > 0
          ? JSON.stringify(input.counters.rebalanceDeltas)
          : null,
      rebalance_executed: counters?.rebalanceExecuted ? 1 : 0,
      analysis_executed: counters?.analysisExecuted ? 1 : 0,
      source_rebalance_runs: counters?.sourceRebalance?.runs ?? 0,
      source_rebalanced_articles: counters?.sourceRebalance?.articles ?? 0,
      source_last_rebalance_at: counters?.sourceRebalance?.lastAt ?? null,
      topic_deltas:
        input.topicDeltas && Object.keys(input.topicDeltas).length > 0
          ? JSON.stringify(input.topicDeltas)
          : null,
      review_deltas:
        input.reviewDeltas && Object.keys(input.reviewDeltas).length > 0
          ? JSON.stringify(input.reviewDeltas)
          : null,
      error_message: input.errorMessage ?? null,
    })
    .where('id', '=', runId)
    .execute();
}

/** 当前版本下每个主题的链接数（用于计算一轮执行的新增量） */
export async function countLinksByTopic(setVersion: number): Promise<Map<number, number>> {
  const rows = await getDb()
    .selectFrom('article_topic_links')
    .select((eb) => ['topic_id as topic_id', eb.fn.count('article_id').as('count')])
    .where('set_version', '=', setVersion)
    .groupBy('topic_id')
    .execute();

  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.topic_id, Number(row.count));
  return counts;
}

/** 执行前后链接数之差（只保留新增，即增量 > 0 的主题） */
export function diffTopicLinkCounts(
  before: Map<number, number>,
  after: Map<number, number>
): TopicDeltas {
  const deltas: TopicDeltas = {};
  for (const [topicId, count] of after) {
    const added = count - (before.get(topicId) ?? 0);
    if (added > 0) deltas[String(topicId)] = added;
  }
  return deltas;
}

/**
 * 最近一轮执行过归属再平衡的流水线（日增量 / 手动）。
 * 冷启动与重建不跑再平衡，因此排除，避免页面显示一轮 0 调整的记录。
 */
export async function getLatestRebalanceRun(input: {
  userId: number;
  setVersion: number;
}): Promise<ClusterRunLog | null> {
  const row = await getDb()
    .selectFrom('cluster_run_logs')
    .selectAll()
    .where('user_id', '=', input.userId)
    .where('set_version', '=', input.setVersion)
    .where('status', '=', 'completed')
    .where('trigger', 'in', ['cron', 'manual'])
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ? toRunLog(row) : null;
}

/**
 * 汇总「上一次周分析之后」所有再平衡轮次，供周分析执行记录标注溯源。
 * 若从未跑过周分析，则汇总全部再平衡轮次。
 */
export async function summarizeRebalanceSinceLastAnalysis(input: {
  userId: number;
  setVersion: number;
}): Promise<RebalanceProvenance> {
  const db = getDb();
  const lastAnalysis = await db
    .selectFrom('cluster_run_logs')
    .select('id')
    .where('user_id', '=', input.userId)
    .where('set_version', '=', input.setVersion)
    .where('analysis_executed', '=', 1)
    .where('status', '=', 'completed')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();

  let query = db
    .selectFrom('cluster_run_logs')
    .select((eb) => [
      eb.fn.count('id').as('runs'),
      eb.fn.sum('rebalanced_articles').as('articles'),
      eb.fn.max('finished_at').as('lastAt'),
    ])
    .where('user_id', '=', input.userId)
    .where('set_version', '=', input.setVersion)
    .where('rebalance_executed', '=', 1)
    .where('status', '=', 'completed');

  if (lastAnalysis) {
    query = query.where('id', '>', lastAnalysis.id);
  }

  const row = await query.executeTakeFirst();
  return {
    runs: Number(row?.runs ?? 0),
    articles: Number(row?.articles ?? 0),
    lastAt: (row?.lastAt as string | null) ?? null,
  };
}

/** 页面用：某版本最近几轮流水线执行（含失败轮次），最新的在前 */
export async function listRecentRuns(input: {
  userId: number;
  setVersion: number;
  limit?: number;
}): Promise<ClusterRunLog[]> {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 30);
  const rows = await getDb()
    .selectFrom('cluster_run_logs')
    .selectAll()
    .where('user_id', '=', input.userId)
    .where('set_version', '=', input.setVersion)
    .where('status', '!=', 'running')
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();
  return rows.map(toRunLog);
}

export interface ListTopicRunLogsInput {
  userId: number;
  setVersion: number;
  /** 只返回该主题创建之后结束的执行 */
  topicCreatedAt: string | null;
  limit?: number;
}

/**
 * 主题维度的执行日志（最近的在前）。
 * 调用方用 topicDeltas[topicId] 取该主题本轮新增篇数。
 */
export async function listTopicRunLogs(input: ListTopicRunLogsInput): Promise<ClusterRunLog[]> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);

  let query = getDb()
    .selectFrom('cluster_run_logs')
    .selectAll()
    .where('user_id', '=', input.userId)
    .where('set_version', '=', input.setVersion);

  if (input.topicCreatedAt) {
    // created_at 为 CURRENT_TIMESTAMP（"YYYY-MM-DD HH:MM:SS"），日志为 ISO 字符串，
    // 交给 SQLite datetime() 统一解析，避免两种格式直接比较出错。
    query = query.where(
      sql<boolean>`datetime(finished_at) >= datetime(${input.topicCreatedAt})`
    );
  }

  const rows = await query.orderBy('id', 'desc').limit(limit).execute();
  return rows.map(toRunLog);
}

function toRunLog(row: {
  id: number;
  set_version: number | null;
  trigger: ClusterRunTrigger;
  status: ClusterRunStatus;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  facet_succeeded: number;
  facet_failed: number;
  routed_articles: number;
  new_topics: number;
  reclaimed_links: number;
  analyzed_topics: number;
  reviewed_topics: number;
  new_reviews: number;
  insight_reports: number;
  rebalanced_articles: number;
  primary_switches: number;
  facet_pending: number;
  rebalance_deltas: string | null;
  rebalance_executed: number;
  analysis_executed: number;
  source_rebalance_runs: number;
  source_rebalanced_articles: number;
  source_last_rebalance_at: string | null;
  topic_deltas: string | null;
  review_deltas: string | null;
  error_message: string | null;
}): ClusterRunLog {
  return {
    id: row.id,
    setVersion: row.set_version,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    facetSucceeded: row.facet_succeeded,
    facetFailed: row.facet_failed,
    routedArticles: row.routed_articles,
    newTopics: row.new_topics,
    reclaimedLinks: row.reclaimed_links,
    analyzedTopics: row.analyzed_topics,
    reviewedTopics: row.reviewed_topics,
    newReviews: row.new_reviews,
    insightReports: row.insight_reports,
    rebalancedArticles: row.rebalanced_articles,
    primarySwitches: row.primary_switches,
    facetPending: row.facet_pending,
    rebalanceDeltas: parseRebalanceDeltas(row.rebalance_deltas),
    rebalanceExecuted: row.rebalance_executed === 1,
    analysisExecuted: row.analysis_executed === 1,
    sourceRebalance: {
      runs: row.source_rebalance_runs ?? 0,
      articles: row.source_rebalanced_articles ?? 0,
      lastAt: row.source_last_rebalance_at ?? null,
    },
    topicDeltas: parseTopicDeltas(row.topic_deltas),
    reviewDeltas: parseTopicDeltas(row.review_deltas),
    errorMessage: row.error_message,
  };
}

function parseRebalanceDeltas(raw: string | null): TopicRebalanceDeltas {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const deltas: TopicRebalanceDeltas = {};
    for (const [topicId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;
      const item = value as Record<string, unknown>;
      deltas[topicId] = {
        added: Number(item.added ?? 0) || 0,
        removed: Number(item.removed ?? 0) || 0,
        migratedIn: Number(item.migratedIn ?? 0) || 0,
      };
    }
    return deltas;
  } catch {
    log.warn('cluster_run_logs.rebalance_deltas 解析失败，按空增量处理');
    return {};
  }
}

function parseTopicDeltas(raw: string | null): TopicDeltas {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const deltas: TopicDeltas = {};
    for (const [topicId, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && value > 0) deltas[topicId] = value;
    }
    return deltas;
  } catch {
    log.warn('cluster_run_logs.topic_deltas 解析失败，按空增量处理');
    return {};
  }
}
