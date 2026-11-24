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

/** 一轮执行的整体计数（所有主题合计） */
export interface ClusterRunCounters {
  facetSucceeded: number;
  facetFailed: number;
  routedArticles: number;
  newTopics: number;
  reclaimedLinks: number;
  analyzedTopics: number;
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
  topicDeltas: TopicDeltas;
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
      topic_deltas:
        input.topicDeltas && Object.keys(input.topicDeltas).length > 0
          ? JSON.stringify(input.topicDeltas)
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
  topic_deltas: string | null;
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
    topicDeltas: parseTopicDeltas(row.topic_deltas),
    errorMessage: row.error_message,
  };
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
