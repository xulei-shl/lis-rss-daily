/**
 * 周期指标仓储（topic_metrics_period）。
 * 指标全部由 domain/metrics.ts 的纯函数算出，本文件只负责落库与读取。
 */

import { getDb, type TopicMetricsPeriodSelection } from '../../db.js';

export interface MetricRow {
  topicId: number;
  period: string;
  addedLinkedCount: number;
  addedPrimaryCount: number;
  cumulativeLinkedCount: number;
  cumulativePrimaryCount: number;
  activeAngleCount: number | null;
  avgSimilarity: number | null;
  centroidDrift: number | null;
  methodEntropy: number | null;
  objectEntropy: number | null;
}

export async function replaceTopicMetrics(topicId: number, rows: MetricRow[]): Promise<void> {
  const db = getDb();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('topic_metrics_period').where('topic_id', '=', topicId).execute();
    if (rows.length === 0) return;
    await trx
      .insertInto('topic_metrics_period')
      .values(
        rows.map((row) => ({
          topic_id: row.topicId,
          period: row.period,
          added_linked_count: row.addedLinkedCount,
          added_primary_count: row.addedPrimaryCount,
          cumulative_linked_count: row.cumulativeLinkedCount,
          cumulative_primary_count: row.cumulativePrimaryCount,
          active_angle_count: row.activeAngleCount,
          avg_similarity: row.avgSimilarity,
          centroid_drift: row.centroidDrift,
          method_entropy: row.methodEntropy,
          object_entropy: row.objectEntropy,
        }))
      )
      .execute();
  });
}

/**
 * 按时间升序读取周期指标。
 *
 * 刻意返回 camelCase 的 MetricRow（而非原始 selection）：这些指标要直接喂给
 * 渲染与统计函数，保持 DTO 一致比「与表字段同名」更有价值。
 */
export async function listTopicMetrics(topicId: number, limit = 24): Promise<MetricRow[]> {
  const rows = await getDb()
    .selectFrom('topic_metrics_period')
    .selectAll()
    .where('topic_id', '=', topicId)
    .orderBy('period', 'desc')
    .limit(limit)
    .execute();
  return rows.reverse().map(toMetricRow);
}

function toMetricRow(row: TopicMetricsPeriodSelection): MetricRow {
  return {
    topicId: row.topic_id,
    period: row.period,
    addedLinkedCount: row.added_linked_count,
    addedPrimaryCount: row.added_primary_count,
    cumulativeLinkedCount: row.cumulative_linked_count,
    cumulativePrimaryCount: row.cumulative_primary_count,
    activeAngleCount: row.active_angle_count ?? null,
    avgSimilarity: row.avg_similarity ?? null,
    centroidDrift: row.centroid_drift ?? null,
    methodEntropy: row.method_entropy ?? null,
    objectEntropy: row.object_entropy ?? null,
  };
}
