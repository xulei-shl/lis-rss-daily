/**
 * 主题内洞察编排。
 *
 * 每个大主题内部，把它的多个综述子簇与研究空白做二次聚类；只有跨至少两个
 * 综述子簇的元簇才生成报告，不跨大主题。每次运行都会重新聚类（纯代码、秒级），
 * 但只对「成员内容哈希变化」的元簇调用 LLM。成员变化按 Jaccard 续写同一行，
 * 成员散开的旧报告置为 superseded。
 */

import { createHash } from 'node:crypto';
import { logger } from '../../logger.js';
import type {
  ClusterInsightReportsSelection,
  ClusterTopicGapsSelection,
  ClusterTopicReviewsSelection,
  ClusterTopicsSelection,
} from '../../db.js';
import { CLUSTER_LIMITS } from '../config.js';
import { vectorToBlob } from '../domain/vector.js';
import { synthesizeInsightReport, type InsightReport } from '../llm/insight.js';
import { listActiveGapsBySet } from '../repo/gaps.js';
import {
  getInsightReportByKey,
  insertInsightReport,
  listActiveInsightReports,
  supersedeInsightReport,
  updateInsightReport,
  type InsightMemberRef,
} from '../repo/insights.js';
import { listActiveReviewsBySet } from '../repo/reviews.js';
import { listTopicsByVersion } from '../repo/topics.js';
import { buildTopicInsightClusters, refKey, type InsightCluster } from './insight-builder.js';

const log = logger.child({ module: 'topic-cluster/insight-runner' });

export interface InsightRunResult {
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  clusters: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ clusterKey: string; error: string }>;
}

export interface RunInsightOptions {
  /** 单轮最多生成的报告数（跨全部主题） */
  limit?: number;
  force?: boolean;
  /** 只处理这些主题；不传则处理集合内全部主题（单主题重跑用） */
  topicIds?: readonly number[];
}

export async function runInsightReports(
  setVersion: number,
  options: RunInsightOptions = {}
): Promise<InsightRunResult> {
  const [reviews, gaps, allTopics, existing] = await Promise.all([
    listActiveReviewsBySet(setVersion),
    listActiveGapsBySet(setVersion),
    listTopicsByVersion(setVersion),
    listActiveInsightReports(setVersion),
  ]);
  const targetTopicIds = options.topicIds ? new Set(options.topicIds) : null;
  const topics = targetTopicIds
    ? allTopics.filter((topic) => targetTopicIds.has(topic.id))
    : allTopics;

  // 052 之前的跨主题报告无法归属单一主题，保留审计但不再参与增量匹配。
  // 单主题重跑不清理全库遗留报告，避免误伤其他主题。
  if (!targetTopicIds) {
    for (const report of existing) {
      if (report.topic_id == null) await supersedeInsightReport(report.id, null);
    }
  }

  const reviewsByTopic = groupByTopic(reviews);
  const gapsByTopic = groupByTopic(gaps);
  const existingByTopic = new Map<number, ClusterInsightReportsSelection[]>();
  for (const report of existing) {
    if (report.topic_id == null) continue;
    const rows = existingByTopic.get(report.topic_id) ?? [];
    rows.push(report);
    existingByTopic.set(report.topic_id, rows);
  }

  const candidates: Array<{ topic: ClusterTopicsSelection; cluster: InsightCluster; match: ClusterInsightReportsSelection | null }> = [];
  let clusterCount = 0;

  for (const topic of topics) {
    const topicReviews = reviewsByTopic.get(topic.id) ?? [];
    const clusters = buildTopicInsightClusters({
      topic,
      reviews: topicReviews,
      gaps: gapsByTopic.get(topic.id) ?? [],
    });
    clusterCount += clusters.length;

    const topicExisting = existingByTopic.get(topic.id) ?? [];
    const usedExisting = new Set<number>();

    for (const cluster of clusters) {
      const match = matchExisting(cluster, topicExisting, usedExisting);
      if (match) usedExisting.add(match.id);
      candidates.push({ topic, cluster, match });
    }

    // 该主题已不再成立的旧报告：成员已散开或子簇不足。
    for (const report of topicExisting) {
      if (!usedExisting.has(report.id)) await supersedeInsightReport(report.id, null);
    }
  }

  if (candidates.length === 0) {
    return { status: 'skipped', clusters: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  }

  const limit = Math.min(
    Math.max(options.limit ?? CLUSTER_LIMITS.insightWeeklyLimit, 1),
    CLUSTER_LIMITS.insightWeeklyLimit
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: InsightRunResult['errors'] = [];
  let attempted = 0;

  for (const { topic, cluster, match } of candidates) {
    if (attempted >= limit) {
      skipped += 1;
      continue;
    }

    const inputHash = computeReportHash(cluster, reviews, gaps);
    if (match && !options.force && match.input_hash === inputHash && match.status === 'ok') {
      skipped += 1;
      continue;
    }

    attempted += 1;
    const previous = match ? parsePreviousReport(match) : null;
    const previousRefs = match ? parseRefs(match.member_refs_json) : [];
    const previousKeys = new Set(previousRefs.map(refKey));
    const newRefKeys = cluster.refs
      .map(refKey)
      .filter((key) => !previousKeys.has(key));

    try {
      const report = await synthesizeInsightReport({
        userId: topic.user_id,
        scope: cluster.scope,
        reviews: cluster.reviews,
        gaps: cluster.gaps,
        previousReport: previous,
        newRefKeys,
      });

      const row = {
        userId: topic.user_id,
        setVersion,
        topicId: topic.id,
        title: report.title,
        reportJson: JSON.stringify(report),
        memberRefs: cluster.refs,
        topicIds: cluster.topicIds,
        centroid: vectorToBlob(cluster.centroid),
        centroidDim: cluster.centroid.length,
        inputHash,
        status: 'ok' as const,
        supersedesId: match?.supersedes_id ?? null,
      };

      if (match) {
        await updateInsightReport(match.id, { ...row, version: match.version + 1 });
        updated += 1;
      } else {
        const duplicate = await getInsightReportByKey(setVersion, topic.id, cluster.key);
        if (duplicate) {
          await updateInsightReport(duplicate.id, {
            ...row,
            supersedesId: null,
            version: duplicate.version + 1,
          });
          updated += 1;
        } else {
          await insertInsightReport({ ...row, reportKey: cluster.key });
          created += 1;
        }
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ clusterKey: cluster.key, error: message });
      log.warn(
        { setVersion, topicId: topic.id, cluster: cluster.key, error: message },
        '主题内洞察生成失败'
      );
    }
  }

  return {
    status: failed === 0 ? 'ok' : failed === attempted ? 'failed' : 'partial',
    clusters: clusterCount,
    created,
    updated,
    skipped,
    failed,
    errors,
  };
}

function groupByTopic<T extends { topic_id: number }>(rows: T[]): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.topic_id) ?? [];
    list.push(row);
    grouped.set(row.topic_id, list);
  }
  return grouped;
}

function matchExisting(
  cluster: InsightCluster,
  existing: ClusterInsightReportsSelection[],
  used: ReadonlySet<number>
): ClusterInsightReportsSelection | null {
  const clusterKeys = new Set(cluster.refs.map(refKey));
  let best: ClusterInsightReportsSelection | null = null;
  let bestScore = 0;

  for (const report of existing) {
    if (used.has(report.id)) continue;
    if (report.topic_id !== cluster.topicId) continue;
    const reportKeys = parseRefs(report.member_refs_json).map(refKey);
    const score = jaccardStrings([...clusterKeys], reportKeys);
    if (score > bestScore) {
      bestScore = score;
      best = report;
    }
  }

  return best && bestScore >= 0.5 ? best : null;
}

function computeReportHash(
  cluster: InsightCluster,
  reviews: ClusterTopicReviewsSelection[],
  gaps: ClusterTopicGapsSelection[]
): string {
  const reviewHash = new Map(reviews.map((review) => [review.id, review.input_hash]));
  const gapHash = new Map(gaps.map((gap) => [gap.id, `${gap.gap}|${gap.source_analysis_hash}`]));
  const parts = cluster.refs
    .map((ref) =>
      ref.kind === 'review'
        ? `${refKey(ref)}=${reviewHash.get(ref.id) ?? ''}`
        : `${refKey(ref)}=${gapHash.get(ref.id) ?? ''}`
    )
    .sort();

  return createHash('sha256')
    .update(`insight:v2|topic:${cluster.topicId}|${parts.join('|')}`)
    .digest('hex');
}

function parsePreviousReport(
  report: ClusterInsightReportsSelection
): { title: string; thesis: string } | null {
  try {
    const parsed = JSON.parse(report.report_json) as Partial<InsightReport>;
    return {
      title: typeof parsed.title === 'string' ? parsed.title : report.title,
      thesis: typeof parsed.thesis === 'string' ? parsed.thesis : '',
    };
  } catch {
    return { title: report.title, thesis: '' };
  }
}

function parseRefs(raw: string | null | undefined): InsightMemberRef[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is InsightMemberRef =>
          Boolean(item) &&
          (item.kind === 'review' || item.kind === 'gap') &&
          Number.isFinite(Number(item.id)) &&
          Number.isFinite(Number(item.topicId))
      )
      .map((item) => ({ kind: item.kind, id: Number(item.id), topicId: Number(item.topicId) }));
  } catch {
    return [];
  }
}

function jaccardStrings(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const left = new Set(a);
  const right = new Set(b);
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
