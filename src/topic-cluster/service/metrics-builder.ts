/**
 * 周期指标构建（零 token）。
 *
 * 口径与规模现实（设计文档 §7.6）：
 *   一个主题在 800 篇量级下约 27~40 篇，摊到 8 个月 ≈ 每月 3~5 篇。
 *   **因此只做月度指标，不做日级**——日级噪声大于信号。
 *
 * 所有指标都是确定性的几何/统计量；前端据此画趋势，LLM 只负责写「焦点转移」那句话。
 */

import { CLUSTER_CONFIG, CLUSTER_LIMITS } from '../config.js';
import { centroidDrift, entropy, monthsBetween, toPeriod } from '../domain/metrics.js';
import { centroidOf } from '../domain/vector.js';
import { replaceTopicMetrics, type MetricRow } from '../repo/metrics.js';
import { getArticleAngleMap } from '../repo/threads.js';
import { loadTopicMembers } from './member-view.js';

export interface MetricsBuildResult {
  periods: number;
  insufficient: boolean;
}

export interface PeriodPoint {
  period: string;
  articleIds: number[];
  primaryCount: number;
  avgSimilarity: number;
  /** 该周期内全部成员向量（累计质心由调用方拼接后重算） */
  vectors: Float32Array[];
  methodKeys: string[];
  objectKeys: string[];
}

/** 重建某主题的周期指标（整体替换） */
export async function rebuildTopicMetrics(topicId: number): Promise<MetricsBuildResult> {
  const { members } = await loadTopicMembers(topicId);
  const points = groupByPeriod(members);

  if (points.length === 0) {
    await replaceTopicMetrics(topicId, []);
    return { periods: 0, insufficient: true };
  }

  const angleMap = await getArticleAngleMap(topicId);
  const rows: MetricRow[] = [];

  let cumulativeLinked = 0;
  let cumulativePrimary = 0;
  let prevCumulativeVector: Float32Array | null = null;
  // 累计质心：用全部历史成员向量重算，而不是逐月平均（避免误差累积）
  const cumulativeVectors: Float32Array[] = [];

  for (const point of points) {
    cumulativeLinked += point.articleIds.length;
    cumulativePrimary += point.primaryCount;
    cumulativeVectors.push(...point.vectors);

    const cumulativeVector = centroidOf(cumulativeVectors);

    rows.push({
      topicId,
      period: point.period,
      addedLinkedCount: point.articleIds.length,
      addedPrimaryCount: point.primaryCount,
      cumulativeLinkedCount: cumulativeLinked,
      cumulativePrimaryCount: cumulativePrimary,
      activeAngleCount: countActiveAngles(point.articleIds, angleMap),
      avgSimilarity: point.avgSimilarity,
      centroidDrift: prevCumulativeVector
        ? centroidDrift(prevCumulativeVector, cumulativeVector)
        : null,
      methodEntropy: point.methodKeys.length > 0 ? entropy(countKeyCounts(point.methodKeys)) : null,
      objectEntropy: point.objectKeys.length > 0 ? entropy(countKeyCounts(point.objectKeys)) : null,
    });

    prevCumulativeVector = cumulativeVector;
  }

  await replaceTopicMetrics(topicId, rows);

  return {
    periods: rows.length,
    // 周期数少于 3 或总篇数低于阈值 → 不足以谈趋势（前端显示「样本不足」）
    insufficient: rows.length < CLUSTER_LIMITS_MIN_PERIODS || points.length === 0,
  };
}

/** 与 CLUSTER_LIMITS.stalePeriods 对齐：少于 3 个月无法判断消长 */
const CLUSTER_LIMITS_MIN_PERIODS = 3;

/* ── 内部工具 ── */

function groupByPeriod(members: Awaited<ReturnType<typeof loadTopicMembers>>['members']): PeriodPoint[] {
  const buckets = new Map<string, typeof members>();
  for (const member of members) {
    const period = toPeriod(member.eventDate);
    if (!period) continue;
    const bucket = buckets.get(period);
    if (bucket) bucket.push(member);
    else buckets.set(period, [member]);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, bucket]) => ({
      period,
      articleIds: bucket.map((member) => member.articleId),
      primaryCount: bucket.filter((member) => member.isPrimary).length,
      avgSimilarity: mean(bucket.map((member) => member.similarity)),
      vectors: bucket.map((member) => member.vector),
      methodKeys: bucket.flatMap((member) => member.methodKeys),
      objectKeys: bucket.flatMap((member) => member.objectKeys),
    }));
}

function countActiveAngles(articleIds: number[], angleMap: Map<number, string>): number {
  const angles = new Set<string>();
  for (const articleId of articleIds) {
    const angle = angleMap.get(articleId);
    if (angle) angles.add(angle);
  }
  return angles.size;
}

function countKeyCounts(keys: string[]): number[] {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts.values()];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 供 analysis-runner 渲染统计文本 */
export function renderMetricsSummary(
  rows: MetricRow[],
  thresholds: { minSamples: number } = { minSamples: CLUSTER_CONFIG.minTrendSamples }
): string {
  const lines: string[] = [];
  const recent = rows.slice(-12);

  lines.push(`【月度序列（最多近 12 个月）】`);
  if (recent.length === 0) {
    lines.push('（无可用时间戳，无法给出趋势）');
  } else {
    for (const row of recent) {
      const drift = row.centroidDrift === null ? '—' : row.centroidDrift.toFixed(3);
      const methodEntropy = row.methodEntropy === null ? '—' : row.methodEntropy.toFixed(2);
      lines.push(
        `- ${row.period}：新增 ${row.addedLinkedCount} 篇（累计 ${row.cumulativeLinkedCount}），` +
          `平均相似度 ${row.avgSimilarity?.toFixed(3) ?? '—'}，质心漂移 ${drift}，方法熵 ${methodEntropy}`
      );
    }
  }

  const totalArticles = rows.length > 0 ? rows[rows.length - 1].cumulativeLinkedCount : 0;
  lines.push(`【样本充足性】${sufficiencyNote(totalArticles, recent.length, thresholds.minSamples)}`);

  const staleness = renderStaleness(recent);
  if (staleness) {
    lines.push('');
    lines.push(staleness);
  }

  return lines.join('\n');
}

function sufficiencyNote(totalArticles: number, monthCount: number, minSamples: number): string {
  if (totalArticles < minSamples || monthCount < CLUSTER_LIMITS_MIN_PERIODS) {
    return (
      `**样本不足**：累计 ${totalArticles} 篇、覆盖 ${monthCount} 个月。` +
      `请如实说明样本有限，不得给出确定的趋势或演化结论。`
    );
  }
  return `累计 ${totalArticles} 篇，覆盖 ${monthCount} 个月。`;
}

/**
 * 时效缺口（staleness）：最近一次纳入文献距今已超过 stalePeriods 个月。
 *
 * 这是「研究退潮」类空白的**结构化依据**——没有这条信号，
 * 模型只能凭印象说“该方向研究不足”，而那是无法证伪的。
 */
function renderStaleness(recent: MetricRow[]): string | null {
  if (recent.length === 0) return null;
  const lastPeriod = recent[recent.length - 1].period;
  const nowPeriod = toPeriod(new Date().toISOString());
  if (!nowPeriod) return null;

  const gap = monthsBetween(lastPeriod, nowPeriod);
  if (gap === null) return null;
  if (gap < CLUSTER_LIMITS.stalePeriods) {
    return `【时效】最近纳入文献为 ${lastPeriod}，距今 ${gap} 个月，未见明显停滞。`;
  }
  return (
    `【时效缺口】**最近一次纳入文献为 ${lastPeriod}，距今 ${gap} 个月无新增**。` +
    `可作为「研究退潮 / 该方向近年停滞」类空白的依据（basis 取 staleness）。`
  );
}
